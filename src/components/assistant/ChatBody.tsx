'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  CitationRef,
  MessageEvent,
  UIToolCall,
} from '@/lib/assistant/types'
import { extractChips, stripChipTokens } from '@/lib/assistant/tokens'
import Composer from './Composer'
import MessageContent from './MessageContent'
import ToolCallPill from './ToolCallPill'
import Icon from '@/components/Icon'
import styles from './Assistant.module.css'

const SCROLL_LOCK_THRESHOLD = 60

// Tolerant of whitespace and capitalization so model slip-ups still trip
// the boundary: matches `[[/thinking]]`, `[[ /thinking ]]`, `[[/Thinking]]`.
const THINKING_DONE_RE = /\[\[\s*\/\s*thinking\s*\]\]/i

/** Index of the LAST boundary event, or -1. Using the last (not first) means
 *  that if the model re-emits [[/thinking]] mid-answer (e.g. drafts a reply,
 *  searches, then restarts), only the content after the final marker is shown
 *  as the answer. */
function lastThinkingDoneIndex(events: MessageEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'thinking_done') return i
  }
  return -1
}

/** Append a text delta to the message events. If the delta (concatenated
 *  with any pending in-flight last text) crosses the [[/thinking]] marker,
 *  split: pre-marker text stays in the current text event, push a
 *  `thinking_done` event, then start a new text event with the remainder.
 *  Handles the marker arriving across multiple deltas. */
function appendTextDelta(
  events: MessageEvent[],
  delta: string
): MessageEvent[] {
  // Always look for the marker in the combined "pending text" — even after a
  // prior boundary. A misbehaving model can re-emit [[/thinking]] (draft an
  // answer, then search, then restart the answer); we split again on each one,
  // and the render uses the LAST boundary, so only the final answer shows and
  // a second marker never leaks as literal text. A partial marker can straddle
  // deltas, so we check the last text event's content + this delta together.
  const last = events[events.length - 1]
  const lastText = last && last.kind === 'text' ? last.text : ''
  const combined = lastText + delta
  const markerMatch = THINKING_DONE_RE.exec(combined)

  if (!markerMatch) {
    return appendDeltaToLastText(events, delta)
  }

  // Split. Pre-marker portion stays in the current text event.
  const markerIdx = markerMatch.index
  const before = combined.slice(0, markerIdx).trimEnd()
  const after = combined.slice(markerIdx + markerMatch[0].length).trimStart()

  const next: MessageEvent[] = []
  for (let i = 0; i < events.length; i++) {
    if (i === events.length - 1 && events[i].kind === 'text') {
      // Replace the last text event with the trimmed pre-marker portion
      if (before.length > 0) next.push({ kind: 'text', text: before })
    } else {
      next.push(events[i])
    }
  }
  // If there was no prior text event (unlikely — marker came in first delta),
  // ensure the pre-marker text is captured if non-empty.
  if (
    before.length > 0 &&
    (events.length === 0 || events[events.length - 1].kind !== 'text')
  ) {
    next.push({ kind: 'text', text: before })
  }

  next.push({ kind: 'thinking_done' })

  if (after.length > 0) {
    next.push({ kind: 'text', text: after })
  }

  return next
}

/** The answer window that was actually ON SCREEN when the redo at `redoIdx`
 *  fired, or null when the visitor was looking at the loading dots. Walks the
 *  redo chain from the start: the window before the first redo was displayed
 *  live; once a draft freezes it stays frozen through any later redos (their
 *  preceding windows streamed hidden behind it and were never seen); and when
 *  nothing was frozen, a rewrite was only on screen once its own
 *  thinking_done — the second one after that redo — had text following it. */
function frozenDraftAt(
  events: MessageEvent[],
  redoIdx: number
): MessageEvent[] | null {
  let prevRedo = -1
  let shown: MessageEvent[] | null = null
  for (let i = 0; i <= redoIdx && i < events.length; i++) {
    if (events[i].kind !== 'redo') continue
    if (shown === null) shown = liveWindowBefore(events, i, prevRedo)
    prevRedo = i
  }
  return shown
}

/** The window the visitor was watching live inside (prevRedo, r): bounded
 *  below by the last thinking_done/tool before r. Before any redo, text is
 *  visible once some [[/thinking]] marker has arrived; after a redo (with
 *  nothing frozen), only once the rewrite's OWN marker — the second
 *  thinking_done after the redo — has been passed. Null when that window was
 *  never displayed or holds no text. */
function liveWindowBefore(
  events: MessageEvent[],
  r: number,
  prevRedo: number
): MessageEvent[] | null {
  let prevBoundary = -1
  let sawThinkingDone = false
  for (let b = r - 1; b > prevRedo; b--) {
    const kind = events[b].kind
    if (kind === 'thinking_done' || kind === 'tool') {
      if (prevBoundary === -1) prevBoundary = b
      if (kind === 'thinking_done') {
        sawThinkingDone = true
        break
      }
    }
  }
  if (prevBoundary === -1) return null
  if (prevRedo === -1) {
    // Pre-redo: visible once any marker arrived at or before the boundary.
    if (!sawThinkingDone) {
      let anyMarker = false
      for (let b = prevBoundary - 1; b >= 0; b--) {
        if (events[b].kind === 'thinking_done') {
          anyMarker = true
          break
        }
      }
      if (!anyMarker) return null
    }
  } else {
    // After a redo with nothing frozen: the dots stayed up until the
    // rewrite's own marker (its second thinking_done) arrived.
    let markers = 0
    for (let b = prevRedo + 1; b <= prevBoundary; b++) {
      if (events[b].kind === 'thinking_done') markers++
    }
    if (markers < 2) return null
  }
  const w = events.slice(prevBoundary + 1, r)
  return w.some(e => e.kind === 'text' && e.text.trim()) ? w : null
}

function appendDeltaToLastText(
  events: MessageEvent[],
  delta: string
): MessageEvent[] {
  const next = [...events]
  const last = next[next.length - 1]
  if (last && last.kind === 'text') {
    next[next.length - 1] = { kind: 'text', text: last.text + delta }
  } else {
    next.push({ kind: 'text', text: delta })
  }
  return next
}

export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  events: MessageEvent[]
  toolCalls: UIToolCall[]
  citations: CitationRef[]
  followUpChips: string[]
  isStreaming: boolean
  error?: string
  /** Visitor's thumbs rating of this assistant reply, if any. Kept in the
   *  session-persisted message so it survives a reload within the tab. */
  rating?: 'up' | 'down'
}

export interface ChatBodyHandle {
  clear: () => void
  /** Focus the composer input so the user can start typing immediately. */
  focusInput: () => void
}

/** How one reply's request went, from the browser's point of view. See the
 *  `onTurnLifecycle` prop. */
export interface TurnLifecycleEvent {
  phase: 'start' | 'received' | 'stopped' | 'error'
  /** The reply's index in the message list. */
  turnIndex: number
  /** Milliseconds since the message was sent (0 for 'start'). */
  ms: number
  /** For 'error': what went wrong — the exception's name and message, the
   *  server's error event, or 'empty reply' — and how much of the reply had
   *  arrived, so the log can say whether the visitor saw the answer. */
  error?: string
}

/** One line for the delivery report on a failed turn: what went wrong and
 *  how much text had already arrived, so the admin log can tell a
 *  dead-on-arrival failure from a connection that dropped at the very end. */
function describeFailure(
  errorText: string | undefined,
  arrivedChars: number
): string {
  const what = errorText ?? 'unknown error'
  return arrivedChars > 0
    ? `${what} (${arrivedChars} characters had arrived)`
    : `${what} (nothing had arrived)`
}

interface AssistantMessageViewProps {
  message: UIMessage
  // Every listing seen so far in the conversation, so a card for a
  // previously-shown listing still resolves even if this turn ran no search
  // (e.g. "show me that fund again").
  allCitations: CitationRef[]
  onSuggest?: (query: string, type?: string) => void
  onCitationClick?: (c: CitationRef) => void
  onLinkClick?: (href: string, label: string) => void
}

/** Renders an assistant message. The reasoning/tool trail before the
 *  [[/thinking]] boundary is hidden – users only see a loading indicator
 *  while the bot is reasoning, then the user-facing answer when it arrives. */
function AssistantMessageView({
  message,
  allCitations,
  onSuggest,
  onCitationClick,
  onLinkClick,
}: AssistantMessageViewProps) {
  let boundary = lastThinkingDoneIndex(message.events)
  // A tool call AFTER the marker means the model was still working — text in
  // between is narration ("Let me read the page…"), not the answer, so the
  // real boundary is the LAST of (marker, tool call) and the reasoning trail
  // never leaks into the final message. The same scan doubles as the fallback
  // for a model that forgot the marker entirely but did make tool calls —
  // in that case only applied once streaming ends (during streaming we show
  // the loading indicator until the marker arrives).
  if (boundary !== -1 || !message.isStreaming) {
    for (let i = message.events.length - 1; i > boundary; i--) {
      if (message.events[i].kind === 'tool') {
        boundary = i
        break
      }
    }
  }
  const hasBoundary = boundary !== -1

  const renderInline = (
    events: MessageEvent[],
    keyPrefix: string,
    streamingTail: boolean
  ) =>
    events.map((ev, i) => {
      if (ev.kind === 'thinking_done') return null
      if (ev.kind === 'text') {
        // Defensive: strip any literal [[/thinking]] that slipped through so
        // the marker can never render as visible text.
        const stripped = stripChipTokens(ev.text).replace(
          /\[\[\s*\/\s*thinking\s*\]\]/gi,
          ''
        )
        if (!stripped.trim()) return null
        const isLast = i === events.length - 1
        return (
          <MessageContent
            key={`${keyPrefix}-${i}`}
            text={stripped}
            citations={allCitations}
            isStreaming={streamingTail && isLast}
            onSuggest={onSuggest}
            onCitationClick={onCitationClick}
            onLinkClick={onLinkClick}
          />
        )
      }
      // Boundary/redo marker events render nothing themselves.
      if (ev.kind !== 'tool') return null
      const call = message.toolCalls.find(tc => tc.id === ev.toolCallId)
      if (!call) return null
      return <ToolCallPill key={`${keyPrefix}-${i}`} call={call} />
    })

  // While streaming, show a loading indicator until the bot finishes its
  // reasoning and emits [[/thinking]]. After the boundary, stream only the
  // user-facing answer. The reasoning/tool trail is never shown.
  // Index of the last redo event — the server sent the model back to rewrite
  // a broken draft (fabricated cards, unearned suggest form, …).
  let lastRedo = -1
  for (let i = message.events.length - 1; i >= 0; i--) {
    if (message.events[i].kind === 'redo') {
      lastRedo = i
      break
    }
  }

  if (hasBoundary) {
    // The visible window never extends into a redo event: everything after it
    // is the rewrite's reasoning, not answer text.
    let end = message.events.length
    for (let i = boundary + 1; i < message.events.length; i++) {
      if (message.events[i].kind === 'redo') {
        end = i
        break
      }
    }
    let post = message.events.slice(boundary + 1, end)
    let frozenDraft = false
    if (lastRedo !== -1) {
      // A redo rewrote (or is rewriting) the reply. Rewrites are
      // near-verbatim, so if a retracted draft was on screen, hold it there
      // for the rest of the stream and settle into the rewrite in one step at
      // the end — far less jarring than visibly deleting a long answer and
      // re-typing it. If the visitor only ever saw the loading dots, stream
      // the rewrite live instead, but only once its own [[/thinking]] has
      // arrived (at most one boundary, the synthetic draft-closer, precedes
      // it after the redo) — text before that is rewrite reasoning, never
      // answer. The same rules apply when the stream ended mid-rewrite
      // (Stop, token limit, reload): show the draft rather than leaking the
      // rewrite's reasoning or blanking the bubble.
      const draft = frozenDraftAt(message.events, lastRedo)
      let markersAfterRedo = 0
      for (let i = lastRedo + 1; i < message.events.length; i++) {
        if (message.events[i].kind === 'thinking_done') markersAfterRedo++
      }
      const rewriteVisible =
        markersAfterRedo >= 2 &&
        post.some(e => e.kind === 'text' && e.text.trim())
      if (message.isStreaming) {
        if (draft) {
          post = draft
          frozenDraft = true
        } else if (!rewriteVisible) {
          post = []
        }
      } else if (!rewriteVisible && draft) {
        post = draft
        frozenDraft = true
      }
      // Not streaming, no draft, rewrite's marker never arrived: leave post
      // as-is — a completed rewrite that forgot its own marker is still the
      // real answer.
    }
    if (post.length > 0) {
      return (
        <>
          {renderInline(
            post,
            frozenDraft ? 'draft' : 'post',
            message.isStreaming
          )}
        </>
      )
    }
    if (message.isStreaming) {
      return (
        <div className={styles.thinking} aria-label="Writing">
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
          <span className={styles.thinkingDot} />
        </div>
      )
    }
    return null
  }

  // No boundary yet. While streaming, just show the loading indicator. Once
  // the stream ends without a boundary (rare – short refusals, simple Q&A),
  // treat the whole thing as the answer.
  if (message.isStreaming) {
    return (
      <div className={styles.thinking} aria-label="Thinking">
        <span className={styles.thinkingDot} />
        <span className={styles.thinkingDot} />
        <span className={styles.thinkingDot} />
      </div>
    )
  }
  return <>{renderInline(message.events, 'flat', false)}</>
}

interface Props {
  /** API endpoint to POST messages to. */
  endpoint: string
  /** Extra fields merged into the POST body. Function form is called per
   *  send so it can capture dynamic context. */
  bodyExtras?:
    | Record<string, unknown>
    | (() => Record<string, unknown> | Promise<Record<string, unknown>>)
  /** Page chips for the empty state. */
  chips?: string[]
  /** Greeting bubble for the empty state. */
  greeting?: string
  /** sessionStorage key for persisting messages (omit to disable). */
  storageKey?: string
  /** Fires when the visitor presses a "Suggest a listing" button in a reply.
   *  `turnIndex` is the reply's position in the message list (matching its
   *  index in the stored history), so the admin can badge the button the
   *  visitor pressed. */
  onSuggest?: (query: string, type?: string, turnIndex?: number) => void
  /** `turnIndex` is the clicked card's position in the message list, which
   *  matches its index in the stored conversation history — so the admin can
   *  badge the exact card the visitor opened. */
  onCitationClick?: (c: CitationRef, turnIndex: number) => void
  /** Fires when the visitor clicks an inline markdown link in a reply.
   *  `turnIndex` is the reply's position in the message list (matching its
   *  index in the stored history), so the admin can badge the one link the
   *  visitor clicked instead of every copy of that href across the chat. */
  onLinkClick?: (href: string, label: string, turnIndex?: number) => void
  /** Fires when the visitor thumbs-rates an assistant reply, or clicks the
   *  same thumb again to take the rating back (`value` null). `turnIndex` is
   *  the reply's position in the message list (matching its index in the
   *  stored history), so the rating can be pinned to the exact turn. */
  onRate?: (value: 'up' | 'down' | null, turnIndex: number) => void
  /** Fires when the user sends a message (typed or via a chip), excluding
   *  retries — lets the public chatbot count engagement while the admin
   *  playground (which doesn't pass this) stays out of the numbers. */
  onUserSend?: () => void
  /** Fires once when a reply's request goes out ('start') and once when it
   *  ends: 'received' (the stream finished and an answer showed), 'stopped'
   *  (the visitor pressed Stop / cleared the chat), or 'error' (the request
   *  failed, the server sent an error, or the reply came back blank).
   *  `turnIndex` is the reply's position in the message list (matching its
   *  index in the stored history); `ms` is measured from the send. Lets the
   *  public chatbot report whether the visitor actually got the answer. */
  onTurnLifecycle?: (event: TurnLifecycleEvent) => void
  /** Fires whenever the message count transitions between 0 and >0, so the
   *  parent can show/hide a clear button without polling. */
  onHasMessagesChange?: (hasMessages: boolean) => void
  /** Whether to react to user-pressed Escape (production wants this; admin
   *  rarely does). */
  closeOnEscape?: boolean
  onCloseEscape?: () => void
  /** When true, snap to bottom whenever the parent layout might have
   *  changed dimensions (e.g. panel expand toggle). */
  resizeKey?: string | number
}

const ChatBody = forwardRef<ChatBodyHandle, Props>(function ChatBody(
  {
    endpoint,
    bodyExtras,
    chips,
    greeting,
    storageKey,
    onSuggest,
    onCitationClick,
    onLinkClick,
    onRate,
    onUserSend,
    onTurnLifecycle,
    onHasMessagesChange,
    closeOnEscape,
    onCloseEscape,
    resizeKey,
  },
  ref
) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
  const [isWaiting, setIsWaiting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Latest onUserSend in a ref so send() can call it without it being a dep.
  const onUserSendRef = useRef(onUserSend)
  useEffect(() => {
    onUserSendRef.current = onUserSend
  }, [onUserSend])
  // Same for onTurnLifecycle.
  const onTurnLifecycleRef = useRef(onTurnLifecycle)
  useEffect(() => {
    onTurnLifecycleRef.current = onTurnLifecycle
  }, [onTurnLifecycle])

  // Hydrate from session storage (when key provided)
  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as UIMessage[]
      if (Array.isArray(parsed)) {
        setMessages(
          parsed
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ ...m, isStreaming: false }))
        )
      }
    } catch {
      // ignore
    }
  }, [storageKey])

  // Persist messages
  useEffect(() => {
    if (!storageKey) return
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages))
    } catch {
      // ignore quota
    }
  }, [storageKey, messages])

  // Notify parent only on the 0 ↔ N transition so it can show/hide a clear
  // button. Parent gets exact-time updates without polling our handle.
  const hasAnyMessage = messages.length > 0
  useEffect(() => {
    onHasMessagesChange?.(hasAnyMessage)
  }, [hasAnyMessage, onHasMessagesChange])

  // Escape to close
  useEffect(() => {
    if (!closeOnEscape) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseEscape?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closeOnEscape, onCloseEscape])

  // Auto-scroll if user is at bottom
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance < SCROLL_LOCK_THRESHOLD) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  // Resize key change → snap to bottom
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const t = setTimeout(() => {
      el.scrollTop = el.scrollHeight
    }, 250)
    return () => clearTimeout(t)
  }, [resizeKey])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const handleClear = useCallback(() => {
    setMessages([])
    setInput('')
    abortRef.current?.abort()
    abortRef.current = null
    setIsWaiting(false)
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      clear: handleClear,
      focusInput: () => composerRef.current?.focus(),
    }),
    [handleClear]
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsWaiting(false)
    setMessages(prev =>
      prev.map(m =>
        m.isStreaming
          ? { ...m, isStreaming: false, content: m.content || '(stopped)' }
          : m
      )
    )
  }, [])

  const send = useCallback(
    async (text: string, historyOverride?: UIMessage[]) => {
      const trimmed = text.trim()
      if (!trimmed || isWaiting) return
      // A fresh user message (not a retry/regenerate) — funnel "sent a message".
      if (!historyOverride) onUserSendRef.current?.()

      const baseHistory: UIMessage[] = historyOverride ?? [
        ...messages,
        {
          id: `u-${Date.now()}`,
          role: 'user',
          content: trimmed,
          events: [{ kind: 'text', text: trimmed }],
          toolCalls: [],
          citations: [],
          followUpChips: [],
          isStreaming: false,
        },
      ]
      const asstId = `a-${Date.now()}`
      const asstMsg: UIMessage = {
        id: asstId,
        role: 'assistant',
        content: '',
        events: [],
        toolCalls: [],
        citations: [],
        followUpChips: [],
        isStreaming: true,
      }
      setMessages([...baseHistory, asstMsg])
      setInput('')
      setIsWaiting(true)
      requestAnimationFrame(() => {
        const el = bodyRef.current
        if (el) el.scrollTop = el.scrollHeight
      })

      const controller = new AbortController()
      abortRef.current = controller

      // Delivery reporting: the reply's index is where asstMsg sits in the
      // list, which is also its index in the history the server stores.
      // Timed from here so `ms` is the visitor's real wait, including the
      // context lookups before the request goes out.
      const turnIndex = baseHistory.length
      const sentAt = Date.now()
      onTurnLifecycleRef.current?.({ phase: 'start', turnIndex, ms: 0 })
      let outcome: TurnLifecycleEvent['phase'] = 'error'
      // For the delivery report when the turn fails: what went wrong, and
      // how much text had arrived by then.
      let errorText: string | undefined
      let arrivedChars = 0

      try {
        const extras =
          typeof bodyExtras === 'function'
            ? await bodyExtras()
            : (bodyExtras ?? {})
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: baseHistory.map(m => ({
              role: m.role,
              content: m.content,
            })),
            ...extras,
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          if (res.status === 429) {
            try {
              const parsed = JSON.parse(errText) as { message?: string }
              if (parsed.message) throw new Error(parsed.message)
            } catch (e) {
              if (e instanceof Error && e.message) throw e
            }
            throw new Error("You've hit the message limit. Try again later.")
          }
          throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
        }
        if (!res.body) throw new Error('no response body')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let streamingText = ''
        // Text length when the last tool call started — everything before it
        // is reasoning. Used below to repair a reply whose [[/thinking]]
        // marker never arrived.
        let lastToolTextOffset = 0
        // The server reported a generation failure mid-stream.
        let sawServerError = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const eventLine = rawEvent
              .split('\n')
              .find(l => l.startsWith('event:'))
            const dataLine = rawEvent
              .split('\n')
              .find(l => l.startsWith('data:'))
            if (!eventLine || !dataLine) continue
            const eventType = eventLine.slice(6).trim()
            const data = JSON.parse(dataLine.slice(5).trim())

            if (eventType === 'text') {
              const delta = data.delta as string
              streamingText += delta
              arrivedChars = streamingText.length
              setMessages(prev =>
                prev.map(m => {
                  if (m.id !== asstId) return m
                  const events = appendTextDelta(m.events, delta)
                  return { ...m, content: streamingText, events }
                })
              )
            } else if (eventType === 'tool_call_start') {
              lastToolTextOffset = streamingText.length
              const newCall: UIToolCall = {
                id: data.id,
                name: data.name,
                input: {},
                status: 'running',
              }
              setMessages(prev =>
                prev.map(m =>
                  m.id === asstId
                    ? {
                        ...m,
                        toolCalls: [...m.toolCalls, newCall],
                        events: [
                          ...m.events,
                          { kind: 'tool', toolCallId: data.id },
                        ],
                      }
                    : m
                )
              )
            } else if (eventType === 'tool_call_done') {
              const incoming =
                (data.listings as CitationRef[] | undefined) ?? []
              setMessages(prev =>
                prev.map(m => {
                  if (m.id !== asstId) return m
                  const updatedCalls = m.toolCalls.map(tc =>
                    tc.id === data.id
                      ? {
                          ...tc,
                          status: (data.ok ? 'done' : 'error') as
                            | 'done'
                            | 'error',
                          resultSummary: data.summary,
                          input:
                            (data.input as Record<string, unknown>) ?? tc.input,
                          listings: incoming,
                        }
                      : tc
                  )
                  const allListings: CitationRef[] = []
                  const seen = new Set<string>()
                  for (const tc of updatedCalls) {
                    for (const l of tc.listings ?? []) {
                      if (!seen.has(l.id)) {
                        seen.add(l.id)
                        allListings.push(l)
                      }
                    }
                  }
                  return {
                    ...m,
                    toolCalls: updatedCalls,
                    citations: allListings,
                  }
                })
              )
            } else if (eventType === 'redo') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === asstId
                    ? { ...m, events: [...m.events, { kind: 'redo' }] }
                    : m
                )
              )
            } else if (eventType === 'error') {
              sawServerError = true
              errorText = `server error: ${
                typeof data.message === 'string' ? data.message : 'no message'
              }`
              setMessages(prev =>
                prev.map(m =>
                  m.id === asstId
                    ? {
                        ...m,
                        error:
                          (data.message as string) ?? 'Something went wrong.',
                        isStreaming: false,
                      }
                    : m
                )
              )
            }
            // 'done' is a no-op here; finalisation happens once below after
            // the read loop exits, so the same fields are set whether the
            // server emits 'done' or just closes the stream.
          }
        }
        // A reply that ran tools but never emitted [[/thinking]] after its
        // last tool call leaves reasoning narration ("I'll search for…")
        // glued to the answer in the flat content string. The rendered view
        // already hides it (its boundary falls back to the last tool call),
        // but `content` is what gets sent back as history on later turns —
        // and stored in the conversation log — so repair it the same way:
        // inject the marker where the last tool call sat. Mirrors the
        // identical repair in runAssistantStream.
        if (
          lastToolTextOffset > 0 &&
          !THINKING_DONE_RE.test(streamingText.slice(lastToolTextOffset))
        ) {
          streamingText = `${streamingText.slice(0, lastToolTextOffset).trimEnd()}\n[[/thinking]]\n${streamingText.slice(lastToolTextOffset).trimStart()}`
        }
        // The visible answer is whatever follows the last [[/thinking]] marker
        // (or the whole reply if there's no marker). If that's empty, the turn
        // produced no answer — a transient hiccup or an empty completion. Show a
        // clear retry prompt instead of leaving a silent blank bubble.
        const answer =
          streamingText.split(/\[\[\s*\/\s*thinking\s*\]\]/i).pop() ?? ''
        // Chips come from the visible answer only — a redone draft (before the
        // last [[/thinking]] marker) may carry its own, now-stale chips.
        const followUp = extractChips(answer)
        setMessages(prev =>
          prev.map(m =>
            m.id === asstId
              ? answer.trim() === ''
                ? {
                    ...m,
                    content: streamingText,
                    isStreaming: false,
                    error: 'Sorry, something went wrong. Please try again.',
                  }
                : {
                    ...m,
                    content: streamingText,
                    isStreaming: false,
                    followUpChips: followUp,
                  }
              : m
          )
        )
        if (answer.trim() !== '' && !sawServerError) outcome = 'received'
        else if (!sawServerError) errorText = 'empty reply'
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          outcome = 'stopped'
          setMessages(prev =>
            prev.map(m => (m.id === asstId ? { ...m, isStreaming: false } : m))
          )
        } else {
          errorText =
            err instanceof Error ? `${err.name}: ${err.message}` : String(err)
          setMessages(prev =>
            prev.map(m =>
              m.id === asstId
                ? {
                    ...m,
                    error: err instanceof Error ? err.message : 'Network error',
                    isStreaming: false,
                  }
                : m
            )
          )
        }
      } finally {
        setIsWaiting(false)
        abortRef.current = null
        onTurnLifecycleRef.current?.({
          phase: outcome,
          turnIndex,
          ms: Date.now() - sentAt,
          ...(outcome === 'error'
            ? { error: describeFailure(errorText, arrivedChars) }
            : {}),
        })
      }
    },
    [bodyExtras, endpoint, isWaiting, messages]
  )

  const handleChipClick = useCallback((chip: string) => void send(chip), [send])

  const handleSubmit = useCallback(() => void send(input), [input, send])

  // Re-send the user message that produced a failed/blank reply, dropping the
  // failed assistant bubble. Not counted as a fresh send (historyOverride is
  // set), so engagement metrics aren't inflated by retries.
  const handleRetry = useCallback(
    (msgId: string) => {
      const idx = messages.findIndex(m => m.id === msgId)
      if (idx <= 0) return
      const userMsg = messages[idx - 1]
      if (userMsg.role !== 'user') return
      void send(userMsg.content, messages.slice(0, idx))
    },
    [messages, send]
  )

  const handleEdit = useCallback(
    (msgId: string) => {
      const idx = messages.findIndex(m => m.id === msgId)
      if (idx === -1) return
      const target = messages[idx]
      if (target.role !== 'user') return
      setInput(target.content)
      setMessages(messages.slice(0, idx))
    },
    [messages]
  )

  // Record the visitor's thumbs rating of an assistant reply. Re-clicking the
  // already-chosen thumb takes the rating back; switching thumbs overwrites.
  // The turn's position in the list (matching the stored history index) is
  // handed up so the rating can be pinned to the exact turn.
  const handleRate = useCallback(
    (msgId: string, value: 'up' | 'down') => {
      const idx = messages.findIndex(m => m.id === msgId)
      if (idx === -1) return
      const next = messages[idx].rating === value ? null : value
      setMessages(prev =>
        prev.map(m =>
          m.id === msgId ? { ...m, rating: next ?? undefined } : m
        )
      )
      onRate?.(next, idx)
    },
    [messages, onRate]
  )

  // Union of every listing cited across the whole conversation. Cards resolve
  // against this (not just the current turn's results), so re-showing a
  // previously-surfaced listing renders even when this turn ran no search.
  const allCitations = useMemo(() => {
    const byId = new Map<string, CitationRef>()
    for (const m of messages) {
      for (const c of m.citations) byId.set(c.id, c)
    }
    return Array.from(byId.values())
  }, [messages])

  return (
    <>
      <div className={styles.body} ref={bodyRef}>
        {messages.length === 0 ? (
          <>
            {greeting && (
              <div className={styles.greetingBubble}>{greeting}</div>
            )}
            <div className={styles.privacyNote}>
              This conversation may be reviewed by the AISafety.com team and
              trusted partners to improve the chatbot.
            </div>
            {chips && chips.length > 0 && (
              <div className={styles.chipsRow}>
                {chips.map(chip => (
                  <button
                    key={chip}
                    type="button"
                    className={styles.chip}
                    onClick={() => handleChipClick(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          messages.map((m, turnIndex) =>
            m.role === 'user' ? (
              <div key={m.id} className={styles.userMessageWrap}>
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={() => handleEdit(m.id)}
                  aria-label="Edit message"
                  title="Edit"
                >
                  <Icon src="/images/icons/pencil.svg" size={16} />
                </button>
                <div className={styles.userMessage}>{m.content}</div>
              </div>
            ) : (
              <div key={m.id} className={styles.message}>
                <AssistantMessageView
                  message={m}
                  allCitations={allCitations}
                  onSuggest={
                    onSuggest
                      ? (query: string, type?: string) =>
                          onSuggest(query, type, turnIndex)
                      : undefined
                  }
                  onCitationClick={
                    onCitationClick
                      ? (c: CitationRef) => onCitationClick(c, turnIndex)
                      : undefined
                  }
                  onLinkClick={
                    onLinkClick
                      ? (href: string, label: string) =>
                          onLinkClick(href, label, turnIndex)
                      : undefined
                  }
                />
                {!m.isStreaming && m.followUpChips.length > 0 && (
                  <div className={styles.followUpRow}>
                    {m.followUpChips.map(chip => (
                      <button
                        key={chip}
                        type="button"
                        className={styles.chip}
                        onClick={() => handleChipClick(chip)}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
                {!m.isStreaming && !m.error && m.content.trim() && (
                  <div className={styles.feedbackRow}>
                    <button
                      type="button"
                      className={`${styles.feedbackButton} ${styles.feedbackButtonUp}${m.rating === 'up' ? ` ${styles.feedbackButtonActive}` : ''}`}
                      onClick={() => handleRate(m.id, 'up')}
                      aria-label="Good response"
                      aria-pressed={m.rating === 'up'}
                    >
                      <Icon src="/images/icons/thumbs-up.svg" size={16} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.feedbackButton} ${styles.feedbackButtonDown}${m.rating === 'down' ? ` ${styles.feedbackButtonActive}` : ''}`}
                      onClick={() => handleRate(m.id, 'down')}
                      aria-label="Bad response"
                      aria-pressed={m.rating === 'down'}
                    >
                      <Icon src="/images/icons/thumbs-down.svg" size={16} />
                    </button>
                  </div>
                )}
                {m.error && (
                  <div className={styles.errorMessage}>
                    <span>{m.error}</span>
                    <button
                      type="button"
                      className={styles.retryButton}
                      onClick={() => handleRetry(m.id)}
                    >
                      Try again
                    </button>
                  </div>
                )}
              </div>
            )
          )
        )}
      </div>

      <Composer
        ref={composerRef}
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={isWaiting && !abortRef.current}
        isStreaming={isWaiting}
        onStop={handleStop}
      />
    </>
  )
})

export default ChatBody
