// Bringing a declined suggestion back (Bryce, 20 Oct 2026). He wanted to
// publish AI Safety Essentials Fellowship a week after declining it: the
// submitter had answered the decline that day, but the reply never reached
// the Queue, search could not find the item, and the Mac worker had deleted
// its record a day after the Reject. Now Reopen (key B) on a declined
// addition writes a short-lived marker on the row – the proposal's `reopen`
// – and the Mac (~/Queue/reopen.py: the agent at once, the worker as the
// fallback) brings the record back, rebuilt from the row's saved copy when it
// is gone, with its logo fetched again, and puts the row back as open with a
// "good news" reply draft. A reply to the decline in its Gmail thread does
// the same by itself (the Secretary marks it), with the reply as `pushback`
// and Fable's one-line take on it.

export interface Reopening {
  /** When it was asked for. */
  at: string | null
  /** 'page' (Reopen), 'reply' (their answer to the decline) or 'hand'. */
  by: string
  /** Why the Mac could not bring it back (the row stays decided); null
   *  while it is on its way. */
  error: string | null
}

export interface Pushback {
  /** Their address and name, as the reply came. */
  from: string
  name: string | null
  /** When they wrote (ISO). */
  at: string | null
  /** Their reply in Gmail. */
  link: string | null
  /** Their words, quoted text left out. */
  text: string
  /** Fable's one line on whether the reply changes the call; null until
   *  the Mac has written it. */
  take: string | null
  changes: 'yes' | 'no' | 'unsure' | null
  /** When Fable's full review ran again with their reply as context, which
   *  refreshed the verdict and its reasons; null until it has. */
  reviewed: string | null
}

export interface Reopened {
  at: string | null
  by: string | null
  /** The record had been deleted and was made again from the saved copy. */
  rebuilt: boolean
  /** Where the logo came from: 'site', 'fable', 'kept', 'none', or
   *  'wanted' while Fable is still looking. */
  logo: string | null
}

/** The decline the person already has, on a row brought back with no word
 *  from them since: Reject then saves no new draft (no second decline). */
export interface DeclinedBefore {
  date: string | null
  reason: string | null
  text: string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** The proposal's `reopen` marker: the Mac has a reopen to finish (or
 *  failed to, with `error`). */
export function reopeningOf(v: unknown): Reopening | null {
  if (!isRecord(v)) return null
  return {
    at: text(v.at),
    by: text(v.by) ?? 'page',
    error: text(v.error),
  }
}

const CHANGES = ['yes', 'no', 'unsure'] as const

/** The proposal's `pushback`: their reply to the decline. Only a Gmail
 *  link is kept. */
export function pushbackOf(v: unknown): Pushback | null {
  if (!isRecord(v)) return null
  const words = text(v.text)
  if (!words) return null
  const link = text(v.link)
  const changes = text(v.changes)
  return {
    from: text(v.from) ?? '',
    name: text(v.name),
    at: text(v.at),
    link: link?.startsWith('https://mail.google.com/') ? link : null,
    text: words,
    take: text(v.take),
    changes: (CHANGES as readonly string[]).includes(changes ?? '')
      ? (changes as Pushback['changes'])
      : null,
    reviewed: text(v.reviewed),
  }
}

/** The proposal's `reopened`: when and how it came back. */
export function reopenedOf(v: unknown): Reopened | null {
  if (!isRecord(v)) return null
  return {
    at: text(v.at),
    by: text(v.by),
    rebuilt: v.rebuilt === true,
    logo: text(v.logo),
  }
}

/** The item came back, or Fable reviewed it again, after the newest message
 *  in its chat (`chatAt`, ISO; null for an empty thread): the verdict and
 *  its reasons are the news, so the side panel opens at its top rather than
 *  at the foot of the old chat (Bryce, 20 Oct 2026, on AI Safety Essentials
 *  Fellowship, re-reviewed to Publish after their reply while the panel
 *  showed his 13 Oct chat: "Where's Fable's new review?"). */
export function reviewNewerThanChat(
  item: { pushback: Pushback | null; reopened: Reopened | null },
  chatAt: string | null
): boolean {
  const times = [item.pushback?.reviewed, item.reopened?.at]
    .map(at => Date.parse(at ?? ''))
    .filter(Number.isFinite)
  if (!times.length) return false
  const chat = Date.parse(chatAt ?? '')
  return !Number.isFinite(chat) || Math.max(...times) > chat
}

/** The reply block's `declined`, when no reply from them came since. */
export function declinedBeforeOf(
  reply: unknown,
  pushback: Pushback | null
): DeclinedBefore | null {
  if (pushback || !isRecord(reply) || !isRecord(reply.declined)) return null
  const was = reply.declined
  return {
    date: text(was.date),
    reason: text(was.reason),
    text: text(was.text),
  }
}

// A rejected suggestion the Mac deleted is marked Applied a day after the
// decision; an accept writes Decided at and Applied at together.
const DELETE_GAP_MS = 12 * 60 * 60 * 1000

/** What a row says about its decision, for wasDeclined. */
export interface DecisionFacts {
  type: string
  status: string
  decidedAt: string | null
  appliedAt: string | null
  rejectReason: string | null
  /** The reply chosen at Reject, or a reject block on the proposal. */
  rejectReplied: boolean
  error: string | null
}

/** The decision was a Reject of an addition: still Rejected, or marked
 *  Applied by the Mac worker once it deleted the record a day later (or
 *  Closed because the record was gone already). Mirrors `was_declined` in
 *  ~/Queue/reopen.py. */
export function wasDeclined(row: DecisionFacts): boolean {
  if (row.type !== 'Add' || !row.decidedAt) return false
  if (row.status === 'Rejected') return true
  if (row.status === 'Closed') return row.error === 'Record already deleted'
  if (row.status !== 'Applied') return false
  if (row.rejectReason || row.rejectReplied) return true
  const decided = Date.parse(row.decidedAt)
  const applied = Date.parse(row.appliedAt ?? '')
  return (
    Number.isFinite(decided) &&
    Number.isFinite(applied) &&
    applied - decided > DELETE_GAP_MS
  )
}

/** The marker Reopen writes into the proposal. A record a failed attempt
 *  already made is kept, so the Mac never makes a second one. */
export function withReopenMarker(
  proposal: Record<string, unknown>,
  at: string
): Record<string, unknown> {
  const old = isRecord(proposal.reopen) ? proposal.reopen : null
  const made = old && typeof old.new === 'string' ? { new: old.new } : {}
  return { ...proposal, reopen: { ...made, at, by: 'page' } }
}

/** What the row's line says while the Mac brings it back. */
export function reopeningLabel(r: Reopening): string {
  if (r.error) return `Could not bring it back · ${r.error}`
  return r.by === 'reply'
    ? 'They replied · bringing it back'
    : 'Bringing it back'
}
