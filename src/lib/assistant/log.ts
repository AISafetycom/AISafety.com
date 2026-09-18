import {
  DELIVERY_TEXT_MAX,
  isConversationsTableConfigured,
  recordCitationClick,
  recordMessageRating,
  recordTurnDelivery,
} from '@/lib/admin/airtable'
import type { TurnDelivery } from '@/lib/admin/airtable'

export interface AssistantTurnEvent {
  kind: 'turn'
  query: string
  currentPage: string
  responseChars: number
  citations: number
  zeroMatches: boolean
  latencyMs: number
}

export interface AssistantClickEvent {
  kind: 'click'
  /** What was clicked: a listing card (default), or an inline markdown link
   *  in the reply prose (e.g. a "Jobs" link to /jobs). */
  target?: 'card' | 'link'
  /** The listing id, for card clicks. Absent for link clicks. */
  citationId?: string
  /** Which assistant turn the clicked card or link sat in (its index in the
   *  stored conversation history). Lets the admin badge the one instance the
   *  visitor actually clicked instead of every copy of that listing or href
   *  across the chat. Absent for older clients that didn't send it. */
  turnIndex?: number
  /** Destination: the card's url, or the inline link's href. */
  url: string
  /** The link's visible text, for link clicks (shown in the admin viewer). */
  label?: string
  currentPage: string
  /** Conversation this click belongs to, so it can be recorded on the row. */
  sessionId?: string | null
}

export interface AssistantOpenEvent {
  kind: 'open'
  trigger: 'pill' | 'chip' | 'keyboard'
  currentPage: string
}

export interface AssistantSuggestEvent {
  kind: 'suggest'
  query: string
  /** The suggest form's type ('community', 'correction', …). Absent when the
   *  token carried no recognized type (the generic listing form). */
  type?: string
  /** Which assistant turn offered the button (its index in the stored
   *  conversation history), so the admin badges the one instance the visitor
   *  pressed. Absent for older clients that didn't send it. */
  turnIndex?: number
  currentPage: string
  /** Conversation this press belongs to, so it can be recorded on the row. */
  sessionId?: string | null
}

export interface AssistantRatingEvent {
  kind: 'rating'
  /** Thumbs up or down on an assistant reply; null when the visitor clicked
   *  their thumb again to take the rating back. */
  value: 'up' | 'down' | null
  /** Which assistant turn was rated (its index in the stored conversation
   *  history), so the rating can be pinned to the exact turn. */
  turnIndex: number
  currentPage: string
  /** Conversation this rating belongs to, so it can be recorded on the row. */
  sessionId?: string | null
}

export const DELIVERY_OUTCOMES = [
  'received',
  'stopped',
  'error',
  'left',
  'seen',
] as const
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number]

/** What happened to a reply on the visitor's side — the half of the story
 *  the server can't see. Sent by the public chatbot: once when the turn ends
 *  in the browser ('received' — the stream finished; 'stopped' — they pressed
 *  Stop; 'error' — the browser hit an error; 'left' — the page was unloaded
 *  mid-reply, sent as the tab closes), and again with 'seen' if a reply that
 *  arrived out of view (panel closed / tab hidden) is later brought back into
 *  view. Persisted per turn on the conversation row so the admin log can show
 *  whether anyone was there for the answer. */
export interface AssistantDeliveryEvent {
  kind: 'delivery'
  outcome: DeliveryOutcome
  /** Which assistant turn (its index in the stored conversation history). */
  turnIndex: number
  /** Milliseconds from the visitor sending their message to this outcome. */
  ms: number
  /** For 'error': what went wrong, as the browser saw it (the exception's
   *  name and message, the server's error event, or 'empty reply'), and how
   *  much of the reply had arrived by then. */
  error?: string
  /** Whether the chat panel was open at the moment of the outcome. */
  panelOpen?: boolean
  /** Whether the tab was visible at the moment of the outcome. */
  tabVisible?: boolean
  /** ms from send to the panel being closed mid-reply, if it was. */
  panelClosedAtMs?: number
  /** ms from send to the tab going to the background mid-reply, if it did. */
  tabHiddenAtMs?: number
  currentPage: string
  /** Conversation this report belongs to, so it can be recorded on the row. */
  sessionId?: string | null
}

export type AssistantEvent =
  | AssistantTurnEvent
  | AssistantClickEvent
  | AssistantOpenEvent
  | AssistantSuggestEvent
  | AssistantRatingEvent
  | AssistantDeliveryEvent

export async function logAssistantEvent(event: AssistantEvent): Promise<void> {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  })
  console.log(`[assistant] ${line}`)

  // Persist clicks onto the conversation row so the admin viewer can show what
  // the visitor actually opened. Cards are keyed `<turnIndex>:<listing id>`,
  // inline links `<turnIndex>:link:<href>` and suggest-form buttons
  // `<turnIndex>:suggest:<type>`, so the exact instance is known (the same
  // listing or href can appear in several replies; without the turn scope one
  // click badged every copy). The `link:`/`suggest:` prefixes never collide
  // with a `type:recXXX` id. Older clients omit turnIndex — fall back to the
  // unscoped key, which the admin still matches (badging every copy) for
  // legacy rows.
  if (
    (event.kind === 'click' || event.kind === 'suggest') &&
    event.sessionId &&
    isConversationsTableConfigured()
  ) {
    const clickKey =
      event.kind === 'suggest'
        ? event.turnIndex != null
          ? `${event.turnIndex}:suggest:${event.type ?? 'listing'}`
          : `suggest:${event.type ?? 'listing'}`
        : event.target === 'link'
          ? event.turnIndex != null
            ? `${event.turnIndex}:link:${event.url}`
            : `link:${event.url}`
          : event.citationId != null && event.turnIndex != null
            ? `${event.turnIndex}:${event.citationId}`
            : event.citationId
    try {
      if (clickKey) await recordCitationClick(event.sessionId, clickKey)
    } catch (err) {
      console.warn(
        `[assistant] click persist failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // Persist the thumbs rating onto the conversation row's own Ratings field
  // (never Clicked or Data — each writer owns one field so out-of-band writes
  // can't clobber each other). Keyed by turn index like clicks, so the admin
  // transcript can badge the exact reply that was rated.
  if (
    event.kind === 'rating' &&
    event.sessionId &&
    isConversationsTableConfigured()
  ) {
    try {
      await recordMessageRating(event.sessionId, event.turnIndex, event.value)
    } catch (err) {
      console.warn(
        `[assistant] rating persist failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // Persist the browser's delivery report onto the row's own Delivery field,
  // keyed by turn like clicks and ratings. The outcome and its timing go in
  // under the outcome's name; the context (panel/tab state, when the panel was
  // closed or the tab hidden mid-reply) rides along on the same entry, and a
  // later 'seen' merges into it.
  if (
    event.kind === 'delivery' &&
    event.sessionId &&
    isConversationsTableConfigured()
  ) {
    const patch: Partial<TurnDelivery> = { [event.outcome]: event.ms }
    if (event.outcome !== 'seen') {
      if (typeof event.panelOpen === 'boolean')
        patch.panelOpen = event.panelOpen
      if (typeof event.tabVisible === 'boolean') {
        patch.tabVisible = event.tabVisible
      }
      if (typeof event.panelClosedAtMs === 'number') {
        patch.panelClosed = event.panelClosedAtMs
      }
      if (typeof event.tabHiddenAtMs === 'number') {
        patch.tabHidden = event.tabHiddenAtMs
      }
    }
    if (
      event.outcome === 'error' &&
      typeof event.error === 'string' &&
      event.error.trim() !== ''
    ) {
      patch.errorText = event.error.slice(0, DELIVERY_TEXT_MAX)
    }
    try {
      await recordTurnDelivery(event.sessionId, event.turnIndex, patch)
    } catch (err) {
      console.warn(
        `[assistant] delivery persist failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const sinkUrl = process.env.ASSISTANT_LOG_WEBHOOK
  if (!sinkUrl) return
  try {
    await fetch(sinkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: line,
    })
  } catch (err) {
    console.warn(
      `[assistant] log webhook failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
