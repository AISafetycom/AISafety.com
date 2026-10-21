/*
  "Update flag" in the Queue chat (Bryce, 13 Oct 2026, on the Bruin AI
  Safety logo flag: "In this kind of case, the chat should end with an
  'update flag' button"). Broom had flagged a logo change; by the time he
  looked, the club's domain had expired, and Fable worked that out in the
  chat – but the card still showed the old verdict and reasons, so Accept
  or Reject (and the teach loop after them) would act on a finding that was
  no longer true.

  When its checks change what the flag should say, Fable ends the reply
  with a ```flag block; the Mac (~/Queue/chat.py) takes it off the text and
  hangs it on the message as `flag`. The page shows it as a card with an
  Update flag button (Update verdict on an addition), and the click writes
  the new verdict, reasons and reject buttons – and the title and the list
  of field changes, when Fable gave them – onto the Queue row, with Undo.
  The page owns the row; the chat never writes it. Nothing reaches the
  listing itself: that still waits for Accept.
*/

import type { ProposedChange, QueueType, Verdict } from './queue'

/** The verdicts each kind of item can carry (a rule has none). */
export const FLAG_VERDICTS: Record<'Add' | 'Change', readonly Verdict[]> = {
  Add: ['Publish', "Don't publish", 'Unsure'],
  Change: ['Fix', 'Dismiss', 'Unsure'],
}

const MAX_REASONS = 6
const REASON_MAX = 1500
const MAX_CHIPS = 3
// What the Mac still accepts for a reject button (queue_lib._CHIP_KEEP_CHARS;
// it asks for 70).
const CHIP_MAX = 110
const TITLE_MAX = 200
const MAX_CHANGES = 30
const FIELD_MAX = 100

export interface FlagUpdate {
  verdict: Verdict
  reasons: string[]
  /** The reject buttons. Null when Fable gave none: the row's buttons are
   *  cleared, and the Mac worker writes three for the new verdict within
   *  five minutes (its chips duty takes every row without custom ones). */
  chips: string[] | null
  /** A new title for the item; null keeps the one it has. */
  title: string | null
  /** Change items only: the whole new list of field changes, replacing the
   *  old one (e.g. tick Hide? once the org is gone); null keeps it. */
  changes: ProposedChange[] | null
}

/** One line, no markdown bold (the card shows plain text) and no leading
 *  bullet (the Reasons field adds its own). */
function clean(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–•*]\s+/, '')
}

function strings(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) return null
  return v.map(clean).filter(Boolean)
}

function isValue(v: unknown): boolean {
  return (
    v === null ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    (Array.isArray(v) && v.every(x => typeof x === 'string'))
  )
}

/** Pure: a flag update as the Mac sent it (or the page posts it), checked
 *  for the item's kind. Anything off is refused with a reason rather than
 *  trimmed to fit. */
export function parseFlag(
  input: unknown,
  type: QueueType
): { flag: FlagUpdate } | { error: string } {
  if (type === 'Rule') return { error: 'A rule has no flag to update.' }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'The flag update is empty.' }
  }
  const o = input as Record<string, unknown>
  const verdict = FLAG_VERDICTS[type].find(v => v === o.verdict)
  if (!verdict) {
    return {
      error: `"${String(o.verdict)}" is not a verdict for ${type === 'Add' ? 'an addition' : 'a change'} (${FLAG_VERDICTS[type].join(', ')}).`,
    }
  }
  const reasons = strings(o.reasons)
  if (!reasons || reasons.length === 0) {
    return { error: 'The flag update has no reasons.' }
  }
  if (reasons.length > MAX_REASONS) {
    return { error: `The flag update has more than ${MAX_REASONS} reasons.` }
  }
  if (reasons.some(r => r.length > REASON_MAX)) {
    return { error: `A reason is over ${REASON_MAX} characters.` }
  }
  let chips: string[] | null = null
  if (o.chips !== undefined && o.chips !== null) {
    const list = strings(o.chips)
    if (!list) return { error: 'The reject buttons are not a list of text.' }
    if (list.length > MAX_CHIPS) {
      return { error: `More than ${MAX_CHIPS} reject buttons.` }
    }
    if (list.some(c => c.length > CHIP_MAX)) {
      return { error: `A reject button is over ${CHIP_MAX} characters.` }
    }
    chips = list.length ? list : null
  }
  let title: string | null = null
  if (typeof o.title === 'string' && clean(o.title)) {
    title = clean(o.title)
    if (title.length > TITLE_MAX) {
      return { error: `The title is over ${TITLE_MAX} characters.` }
    }
  }
  let changes: ProposedChange[] | null = null
  if (o.changes !== undefined && o.changes !== null) {
    if (type !== 'Change') {
      return { error: 'Only a change has a list of field changes.' }
    }
    if (!Array.isArray(o.changes) || o.changes.length > MAX_CHANGES) {
      return { error: 'The field changes are not a list (of at most 30).' }
    }
    changes = []
    for (const c of o.changes as unknown[]) {
      const x =
        c && typeof c === 'object' && !Array.isArray(c)
          ? (c as Record<string, unknown>)
          : null
      const field = typeof x?.field === 'string' ? x.field.trim() : ''
      if (!x || !field || field.length > FIELD_MAX) {
        return { error: 'A field change has no field name.' }
      }
      if (!isValue(x.to ?? null)) {
        return { error: `The new value for ${field} is not text.` }
      }
      changes.push({ field, from: x.from ?? null, to: x.to ?? null })
    }
  }
  return { flag: { verdict, reasons, chips, title, changes } }
}

/** Pure: the Reasons field as the Mac writes it, one "– " line each. */
export function reasonsText(reasons: string[]): string {
  return reasons.map(r => `– ${r}`).join('\n')
}

// How the page reads a line of Reasons or Reject chips back (queue.ts
// `lines`), so a flag is compared with the row the way the row is shown.
function asRead(s: string): string {
  return s.replace(/^[-–•*]\s*/, '').trim()
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => asRead(x) === asRead(b[i]))
}

function changeKey(changes: ProposedChange[]): string {
  return JSON.stringify(changes.map(c => [c.field, c.to ?? null]))
}

/** Pure: whether the item already shows this flag – its card then says
 *  so, after a reload too. Parts Fable left out are not compared. */
export function flagShown(
  item: {
    verdict: Verdict | null
    reasons: string[]
    rejectChips: string[]
    title: string
    changes: ProposedChange[]
  },
  flag: FlagUpdate
): boolean {
  return (
    item.verdict === flag.verdict &&
    sameList(item.reasons, flag.reasons) &&
    (flag.chips === null || sameList(item.rejectChips, flag.chips)) &&
    (flag.title === null || item.title === flag.title) &&
    (flag.changes === null ||
      changeKey(item.changes) === changeKey(flag.changes))
  )
}

/** The verdict in words, as the card's "Fable says" shows it. */
export function verdictWords(verdict: Verdict | null): string {
  if (verdict === 'Publish') return 'Publish it'
  if (verdict === 'Fix') return 'Fix it'
  if (verdict === 'Dismiss') return 'Dismiss the flag'
  return verdict ?? ''
}
