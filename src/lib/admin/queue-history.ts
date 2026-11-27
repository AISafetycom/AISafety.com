/*
  Who did what to a Queue item, and when (Bryce, 18 Nov 2026, with a second
  person about to decide items: "Stamp each change with who made it … a name
  and an undo on each record").

  Every decision made on the page (Publish or Apply, Reject, Review again in
  a week, Delete, Reopen, Undo, and a field fixed after the decision) adds
  one entry to the row's History field in Airtable: a JSON list, oldest
  first, written in the same write as the decision itself. The name is the
  signed-in admin's, as their Google sign-in gives it.

  It is history on the item, not a feed of what a person has been doing
  (the owner had the admin's "Recent activity" trail removed on 6 Sept 2026):
  nothing here lists a person's actions, and nothing is recorded for
  opening, reading or drafting.

  The Mac adds one kind of entry itself (`fable`, ~/Queue chat.py): when a
  reply in an item's Fable chat has changed the listing, with the fields
  and the name of whoever sent the message (Bryce, the same day: "Include
  the name of the user that prompted it"). The page's token to the Mac
  carries that name (agentInfo in queue.ts).

  What is not here: anything else done outside the page. A row the Mac
  closed, a listing approved in Airtable itself and a decision from before
  18 Nov 2026 have no entry, so they show without a name.

  A verdict the page writes from a reply in someone's Fable chat (the
  chat's `flag` block, queue-flag.ts) is kept too when the chat is not the
  owner's own (27 Nov 2026, with the team's chat): `flag`, and `unflag`
  when they put the earlier one back, each with their name. The owner's
  own chat leaves no line, as before.

  With the 'suggest' grant (queue-suggest.ts, 27 Nov 2026) four more kinds
  are kept: `suggest` (a suggested decision, waiting for someone with full
  edit), `withdraw` (taken back by its author, or dismissed), `ask` (a
  question for someone with full edit) and `answer`. A decision that
  confirmed or overrode a suggestion carries `suggested`, so its line keeps
  both names.

  Dependency-free, so the page and the server share it.
*/

import {
  firstName,
  suggestWord,
  SUGGEST_DIDS,
  type SuggestDid,
} from './queue-suggest'

export type HistoryDid =
  | 'accept'
  | 'reject'
  | 'later'
  | 'undo'
  | 'fix'
  | 'reopen'
  | 'delete'
  // "Waiting on them" set or stopped by hand, or set from the chat
  // (queue-asked.ts, 26 Nov 2026).
  | 'wait'
  | 'unwait'
  // Written by the Mac: Fable changed the listing from the item's chat.
  | 'fable'
  // "Bryce checks first" (queue-suggest.ts).
  | 'suggest'
  | 'withdraw'
  | 'ask'
  | 'answer'
  // A teammate's Fable chat changed the item's verdict and reasons, or
  // they put the earlier ones back (queue-flag.ts).
  | 'flag'
  | 'unflag'

const DID: readonly string[] = [
  'accept',
  'reject',
  'later',
  'undo',
  'fix',
  'reopen',
  'delete',
  'wait',
  'unwait',
  'fable',
  'suggest',
  'withdraw',
  'ask',
  'answer',
  'flag',
  'unflag',
]

/** Whose suggestion or question an entry is about, and what it was: on a
 *  `suggest` line, what was suggested; on a decision, the suggestion it
 *  confirmed or overrode; on `withdraw` and `answer`, what was taken back
 *  or answered (`ask` for a question). */
export interface Suggested {
  by: string | null
  did: SuggestDid | 'ask'
}

/** What an Undo took back. */
export type Undid = 'accept' | 'reject' | 'later'
const UNDID: readonly string[] = ['accept', 'reject', 'later']

export interface HistoryEntry {
  /** When, ISO. A decision's is the row's Decided at. */
  at: string
  /** The admin's name; null when the caller had none to give. For `fable`,
   *  whoever asked Fable in the chat. */
  by: string | null
  did: HistoryDid
  /** accept of a change: the fields written · fix: the fields edited ·
   *  fable: the fields Fable changed. */
  fields?: string[]
  /** undo: what it took back. */
  undid?: Undid
  /** See Suggested. */
  suggested?: Suggested
}

// Airtable holds 100,000 characters in a long text field; this keeps the
// list far below that however often an item is decided and undone.
const MAX_ENTRIES = 100
const MAX_FIELDS = 30
const MAX_TEXT = 100

function clean(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const t = text.trim().slice(0, MAX_TEXT)
  return t || null
}

function cleanFields(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const x of list) {
    const name = clean(x)
    if (name && !out.includes(name)) out.push(name)
    if (out.length >= MAX_FIELDS) break
  }
  return out
}

/** One entry, with only what an entry may hold. Null for anything that is
 *  not one (no time, or an action this file does not know). */
function asEntry(x: unknown): HistoryEntry | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const at = clean(o.at)
  const did = clean(o.did)
  if (!at || !Number.isFinite(Date.parse(at))) return null
  if (!did || !DID.includes(did)) return null
  const entry: HistoryEntry = { at, by: clean(o.by), did: did as HistoryDid }
  const fields = cleanFields(o.fields)
  if (fields.length > 0) entry.fields = fields
  const undid = clean(o.undid)
  if (did === 'undo' && undid && UNDID.includes(undid)) {
    entry.undid = undid as Undid
  }
  const sug = o.suggested
  if (sug && typeof sug === 'object') {
    const s = sug as Record<string, unknown>
    const what = clean(s.did)
    if (
      what &&
      (what === 'ask' || (SUGGEST_DIDS as readonly string[]).includes(what))
    ) {
      entry.suggested = { by: clean(s.by), did: what as Suggested['did'] }
    }
  }
  return entry
}

/** The row's History field as entries, oldest first. Anything unreadable
 *  is an empty history, never an error: the item still has to open. */
export function historyOf(raw: unknown): HistoryEntry[] {
  let list: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return []
    try {
      list = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  return list.map(asEntry).filter((e): e is HistoryEntry => e !== null)
}

/** The History field's new value: what the row holds plus one entry. */
export function withEntry(
  history: HistoryEntry[],
  entry: {
    at: string
    by: string | null
    did: HistoryDid
    fields?: string[]
    undid?: Undid | null
    suggested?: Suggested | null
  }
): string {
  const next = asEntry(entry)
  const all = next ? [...history, next] : history
  return JSON.stringify(all.slice(-MAX_ENTRIES))
}

// ─── Reading it back, for the page ──────────────────────────────────────────

/** What a line needs to know of the row it is on. */
export interface HistoryRow {
  id: string
  type: 'Add' | 'Change' | 'Rule'
  source: string
  status: string
  decidedAt: string | null
  /** The decision was a Reject of an addition (queue-reopen.ts). */
  declined: boolean
  /** Set aside with "Review again in a week". */
  reviewAgainOn: string | null
  history: HistoryEntry[]
  /** A change: the proposed fields its Apply wrote, for a decision made
   *  before entries were kept. */
  written: string[]
  /** A change: every field it proposed, so a Reject can say what it
   *  turned down. */
  proposed: string[]
}

/** One line of a listing's history. */
export interface HistoryLine extends HistoryEntry {
  /** The Queue row it happened on. */
  row: string
  type: HistoryRow['type']
  source: string
  /** False for a decision that has no entry: made before 18 Nov 2026, or
   *  outside the page. Its time is the row's Decided at; nobody is named. */
  recorded: boolean
}

// A decision's entry carries the stamp written to Decided at; Airtable may
// hand that back rounded, so the two are matched to within a few seconds.
const SAME_MOMENT_MS = 5000

function sameMoment(a: string, b: string): boolean {
  return Math.abs(Date.parse(a) - Date.parse(b)) <= SAME_MOMENT_MS
}

function isOpenStatus(status: string): boolean {
  return status === 'Pending' || status === 'Failed' || status === 'Revising'
}

/** The entry of the decision that stands on the row now: the Publish, Apply
 *  or Reject its Decided at belongs to, or the "Review again in a week" an
 *  item set aside is waiting out. Null when the row is open, or when its
 *  decision has no entry. */
export function standing(row: HistoryRow): HistoryEntry | null {
  if (isOpenStatus(row.status)) {
    if (!row.reviewAgainOn) return null
    const last = row.history[row.history.length - 1]
    return last?.did === 'later' ? last : null
  }
  const at = row.decidedAt
  if (!at) return null
  for (let i = row.history.length - 1; i >= 0; i--) {
    const e = row.history[i]
    if ((e.did === 'accept' || e.did === 'reject') && sameMoment(e.at, at)) {
      return e
    }
  }
  return null
}

/** Who made the decision that stands; null when nobody is on record. */
export function decidedBy(row: HistoryRow): string | null {
  return standing(row)?.by ?? null
}

/** The row's own lines, oldest first: its entries, and its standing
 *  decision when that has none. */
export function rowLines(row: HistoryRow): HistoryLine[] {
  const base = { row: row.id, type: row.type, source: row.source }
  // A rejected change names the fields it would have changed: the entry
  // itself keeps none, the row's proposal has them.
  const turnedDown =
    row.type === 'Change' && row.proposed.length > 0
      ? { fields: row.proposed.slice(0, MAX_FIELDS) }
      : {}
  const lines: HistoryLine[] = row.history.map(e => ({
    ...e,
    ...(e.did === 'reject' ? turnedDown : {}),
    ...base,
    recorded: true,
  }))
  if (row.decidedAt && !isOpenStatus(row.status) && !standing(row)) {
    const rejected = row.status === 'Rejected' || row.declined
    lines.push({
      at: row.decidedAt,
      by: null,
      did: rejected ? 'reject' : 'accept',
      ...(rejected
        ? turnedDown
        : row.type === 'Change' && row.written.length > 0
          ? { fields: row.written.slice(0, MAX_FIELDS) }
          : {}),
      ...base,
      recorded: false,
    })
  }
  return lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** Every line on a listing, newest first, from all the Queue rows about
 *  it (each row counted once). */
export function listingLines(rows: HistoryRow[]): HistoryLine[] {
  const seen = new Set<string>()
  const lines: HistoryLine[] = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    lines.push(...rowLines(row))
  }
  return lines.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** "Deadline", "Deadline and Location", "Deadline, Location, and URL",
 *  then "Deadline, Location, and 3 more". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more`
}

/** Lines that name their own author in the sentence ("Rob suggested
 *  Publish"), so the page shows no "by" after them. */
export function namesItself(line: HistoryEntry): boolean {
  return (
    line.did === 'suggest' ||
    line.did === 'ask' ||
    line.did === 'flag' ||
    line.did === 'unflag'
  )
}

/** What a suggestion asked for, in a line's words. */
function suggestedWord(s: Suggested, type: HistoryRow['type']): string {
  return s.did === 'ask' ? 'question' : suggestWord(s.did, type)
}

/** What a line says happened, in the words the page uses for a decision. */
export function lineText(line: HistoryLine): string {
  const base = decisionText(line)
  const s = line.suggested
  if (!s || !DECIDES.includes(line.did)) return base
  // A decision on a suggestion: the suggester's name stays with it.
  if (s.did === 'ask') return `${base} · ${firstName(s.by)} had asked`
  return s.did === line.did
    ? `${base} · suggested by ${firstName(s.by)}`
    : `${base} · ${firstName(s.by)} suggested ${suggestWord(s.did, line.type)}`
}

const DECIDES: readonly HistoryDid[] = ['accept', 'reject', 'later', 'delete']

/** What the chat's flag block changes, as the chat's own card calls it. */
function flagNoun(type: HistoryRow['type']): string {
  return type === 'Add' ? 'verdict' : 'flag'
}

function decisionText(line: HistoryLine): string {
  const fields = line.fields ?? []
  switch (line.did) {
    case 'accept':
      if (line.type === 'Add') return 'Published'
      if (line.type === 'Rule') return 'Applied'
      if (fields.length > 0) return `Changed ${nameList(fields)}`
      return line.source === 'Broom' ? 'Flag cleared' : 'Accepted'
    case 'reject':
      return line.type === 'Change' && fields.length > 0
        ? `Rejected a change to ${nameList(fields)}`
        : 'Rejected'
    case 'later':
      return 'Set aside for a week'
    case 'fix':
      return fields.length > 0 ? `Edited ${nameList(fields)}` : 'Edited'
    case 'fable':
      return fields.length > 0
        ? `Fable changed ${nameList(fields)}`
        : 'Fable changed the listing'
    case 'reopen':
      return 'Reopened'
    case 'delete':
      return 'Deleted'
    case 'wait':
      return 'Marked as waiting on them'
    case 'unwait':
      return 'Stopped waiting on them'
    case 'undo':
      if (line.undid === 'later') return 'Brought back early'
      if (line.undid === 'reject') return 'Undid the reject'
      if (line.undid === 'accept') {
        if (line.type === 'Add') return 'Undid the publish'
        if (line.type === 'Rule') return 'Undid the rule'
        return 'Undid the change'
      }
      return 'Undid the decision'
    case 'suggest':
      return line.suggested && line.suggested.did !== 'ask'
        ? `${firstName(line.by)} suggested ${suggestWord(line.suggested.did, line.type)}`
        : `${firstName(line.by)} made a suggestion`
    case 'ask':
      return `${firstName(line.by)} asked a question`
    case 'flag':
      return `Fable changed the ${flagNoun(line.type)} in ${firstName(line.by)}'s chat`
    case 'unflag':
      return `${firstName(line.by)} put the earlier ${flagNoun(line.type)} back`
    case 'answer':
      return line.suggested
        ? `Answered ${firstName(line.suggested.by)}'s question`
        : 'Answered the question'
    case 'withdraw': {
      const s = line.suggested
      if (!s) return 'Took back a suggestion'
      const what = suggestedWord(s, line.type)
      const word = s.did === 'ask' ? 'question' : `suggestion (${what})`
      return s.by && line.by && s.by !== line.by
        ? `Dismissed ${firstName(s.by)}'s ${word}`
        : `Took back the ${word}`
    }
  }
}
