/*
  "Bryce checks first" (27 November 2026): a new teammate works the Queue
  with the 'suggest' grant (access.ts). Their Publish or Apply, Reject,
  Delete and Review again in a week change nothing live: each saves a
  suggestion on the row, and someone with full Queue edit confirms it with
  the usual key or button, changes it first, or decides differently. They
  can also ask a question on any item ("Ask Bryce"), decided ones included,
  which someone with full edit answers on the card.

  Both live in one field of the Queue row, For Bryce (fldWFnmC0u06GNC6B,
  queue.ts), as JSON: a suggestion or a question, never both. Its own field
  rather than a key in the Proposal, so no bot that rewrites the Proposal
  can wipe one. A suggestion leaves the row Pending with no Decided at, so
  none of the Mac's decision steps run on it (reply drafts, declines,
  deletions, rule teaching): they key on a real decision. Deciding the item
  clears the field in the same write, and the History line keeps both names
  (queue-history.ts, `suggested`).

  A suggestion keeps a fingerprint of what it was made on (`print`): the
  verdict, the proposed changes, the target, the row's Edits and its Reply
  draft. A decision is refused (412) once any of those differ, so the person
  deciding sees the item as it is now first. The refusal says what changed
  and carries the row's fingerprint now; the page reads the item again and
  sends that fingerprint back with the next press, which then goes unless
  the item changed once more (unseenParts). So a Mac duty rewriting the
  reply draft or a picture link stops one press, never the item for good.
  The Proposal's other keys are left out on purpose: the Mac's duties
  rewrite them all day.

  Dependency-free, so the page and the server share it.
*/

import { CHECKER_NAME } from './access'

export { CHECKER_NAME }

/** What a suggestion would do once confirmed: the decision it stands for. */
export type SuggestDid = 'accept' | 'reject' | 'delete' | 'later'
export const SUGGEST_DIDS: readonly SuggestDid[] = [
  'accept',
  'reject',
  'delete',
  'later',
]

/** The parts of a row a suggestion was made on, each as a short hash. */
export interface Print {
  verdict: string
  changes: string
  target: string
  edits: string
  reply: string
}
const PRINT_KEYS: readonly (keyof Print)[] = [
  'verdict',
  'changes',
  'target',
  'edits',
  'reply',
]

export interface Suggestion {
  kind: 'suggest'
  /** The suggester's name, as the History keeps it. */
  by: string | null
  /** When, ISO. The page sends it back with Confirm. */
  at: string
  did: SuggestDid
  /** Why: the reject reason, or a note with another call. */
  reason: string | null
  /** Reject: the decline text as their page showed it. */
  rejectReply: string | null
  /** Accept of a change: proposed fields Fable had already changed on the
   *  record, which Accept leaves as they are. */
  keep: string[]
  /** Accept of a rule that brings wording for the public listing policy:
   *  what they chose for it. */
  publicChoice: 'apply' | 'internal' | null
  /** The fields their edits set, for the card. */
  edited: string[]
  print: Print
  /** Their question this suggestion took the place of, with its answer. */
  asked: { question: string; answer: string | null; by: string | null } | null
}

export interface Question {
  kind: 'ask'
  by: string | null
  at: string
  question: string
  /** Set by 'answer'; the item is then theirs again, with the answer. */
  answer: string | null
  answeredBy: string | null
  answeredAt: string | null
}

export type ForBryce = Suggestion | Question

export const MAX_TEXT = 5000
const MAX_NAME = 100
const MAX_FIELDS = 50

function text(v: unknown, cap = MAX_TEXT): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, cap)
  return t || null
}

function when(v: unknown): string | null {
  const t = text(v, 40)
  return t && Number.isFinite(Date.parse(t)) ? t : null
}

function names(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    const n = text(x, MAX_NAME)
    if (n && !out.includes(n)) out.push(n)
    if (out.length >= MAX_FIELDS) break
  }
  return out
}

/** A fingerprint as stored or as a page sent it back; null when it is not
 *  one. */
export function parsePrint(v: unknown): Print | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const out = {} as Print
  for (const k of PRINT_KEYS) {
    if (typeof o[k] !== 'string') return null
    out[k] = o[k] as string
  }
  return out
}

/** The For Bryce field as a suggestion or a question; null when empty or
 *  unreadable (a hand edit), which the page then simply does not show. */
export function forBryceOf(raw: unknown): ForBryce | null {
  let o: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return null
    try {
      o = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const r = o as Record<string, unknown>
  const at = when(r.at)
  if (!at) return null
  const by = text(r.by, MAX_NAME)
  if (r.kind === 'suggest') {
    const did = r.did as SuggestDid
    const print = parsePrint(r.print)
    if (!SUGGEST_DIDS.includes(did) || !print) return null
    const asked =
      r.asked && typeof r.asked === 'object'
        ? (r.asked as Record<string, unknown>)
        : null
    const question = asked ? text(asked.question) : null
    return {
      kind: 'suggest',
      by,
      at,
      did,
      reason: text(r.reason),
      rejectReply: text(r.rejectReply),
      keep: names(r.keep),
      publicChoice:
        r.publicChoice === 'apply' || r.publicChoice === 'internal'
          ? r.publicChoice
          : null,
      edited: names(r.edited),
      print,
      asked:
        asked && question
          ? {
              question,
              answer: text(asked.answer),
              by: text(asked.by, MAX_NAME),
            }
          : null,
    }
  }
  if (r.kind === 'ask') {
    const question = text(r.question)
    if (!question) return null
    const answer = text(r.answer)
    return {
      kind: 'ask',
      by,
      at,
      question,
      answer,
      answeredBy: answer ? text(r.answeredBy, MAX_NAME) : null,
      answeredAt: answer ? when(r.answeredAt) : null,
    }
  }
  return null
}

/** Still waiting for someone with full edit: any suggestion, or a question
 *  with no answer yet. An answered question is the asker's again. */
export function isWaiting(fb: ForBryce | null | undefined): boolean {
  if (!fb) return false
  return fb.kind === 'suggest' || fb.answer === null
}

/** The suggestion still waiting, when there is one. */
export function openSuggestion(
  fb: ForBryce | null | undefined
): Suggestion | null {
  return fb?.kind === 'suggest' ? fb : null
}

/** The time of the suggestion waiting on an item, or null: what the page
 *  notes on a draft it makes from the row, so a draft made before this
 *  suggestion (or on another one) is known for what it is. */
export function suggestionAt(fb: ForBryce | null | undefined): string | null {
  return openSuggestion(fb)?.at ?? null
}

/** The page's drafts made on another suggestion than the one now on their
 *  item, or on none: they hold the edits the page had before, not the ones
 *  the suggestion was made with, so the page makes them again from the row
 *  and a confirm sends what the card shows. A draft whose decision is on
 *  its way is left alone, and so is one whose item the page no longer
 *  lists. */
export function staleDrafts(
  drafts: Record<string, { seed: string | null; busy: boolean }>,
  items: readonly { id: string; forBryce?: ForBryce | null }[]
): string[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const out: string[] = []
  for (const [id, d] of Object.entries(drafts)) {
    const item = byId.get(id)
    if (!item || d.busy) continue
    if (d.seed !== suggestionAt(item.forBryce)) out.push(id)
  }
  return out
}

// ─── The fingerprint ────────────────────────────────────────────────────────

/** JSON with every object's keys in order, so the same value always reads
 *  the same however it was written. */
export function stableJson(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .filter(k => o[k] !== undefined)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`
}

/** A short hash of a value (FNV-1a, 32 bits): enough to tell one version
 *  of a field from the next, which is all it is for. */
export function hashOf(v: unknown): string {
  const s = stableJson(v)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function blank(v: unknown): unknown {
  return v === undefined ||
    v === '' ||
    (v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).length === 0)
    ? null
    : v
}

/** The Edits part of a fingerprint: the row's Edits as stored (an empty
 *  one reads the same as none). */
export function editsPrint(edits: unknown): string {
  return hashOf(blank(edits))
}

/** The Reply draft part of a fingerprint. */
export function replyPrint(reply: unknown): string {
  return hashOf(typeof reply === 'string' ? reply.trim() || null : null)
}

/** The fingerprint from the row's own values: the verdict, the proposed
 *  changes as the Proposal holds them (not the prepared pictures, whose
 *  links Airtable renews on every read), the target, the Edits and the
 *  Reply draft. */
export function makePrint(parts: {
  verdict: unknown
  changes: unknown
  table: unknown
  record: unknown
  edits: unknown
  reply: unknown
}): Print {
  return {
    verdict: hashOf(blank(parts.verdict)),
    changes: hashOf(blank(parts.changes)),
    target: hashOf(`${parts.table ?? ''}/${parts.record ?? ''}`),
    edits: editsPrint(parts.edits),
    reply: replyPrint(parts.reply),
  }
}

/** The parts that differ between two fingerprints, in a fixed order. */
export function printDiff(a: Print, b: Print): (keyof Print)[] {
  return PRINT_KEYS.filter(k => a[k] !== b[k])
}

/** The parts of the row as it is now (`now`) that the person deciding has
 *  not seen: changed since the suggestion was made (`made`), and not as
 *  their page last read them either (`seen`, the fingerprint an earlier
 *  refusal gave it, or null). Empty means the decision may go. */
export function unseenParts(
  made: Print,
  now: Print,
  seen: Print | null
): (keyof Print)[] {
  return PRINT_KEYS.filter(
    k => now[k] !== made[k] && (seen === null || now[k] !== seen[k])
  )
}

const PART_WORD: Record<keyof Print, string> = {
  verdict: 'its verdict',
  changes: 'the proposed changes',
  target: 'the listing it is about',
  edits: 'the edits',
  reply: 'the reply draft',
}

/** "the edits", "its verdict and the reply draft", … */
export function partWords(parts: (keyof Print)[]): string {
  const words = parts.map(p => PART_WORD[p])
  if (words.length <= 1) return words[0] ?? 'the item'
  return `${words.slice(0, -1).join(', ')}${words.length > 2 ? ',' : ''} and ${words[words.length - 1]}`
}

// ─── Words for the page ─────────────────────────────────────────────────────

/** A suggestion's call in the page's button words: Publish, Apply, Reject,
 *  Delete, Review again in a week. */
export function suggestWord(
  did: SuggestDid,
  type: 'Add' | 'Change' | 'Rule'
): string {
  switch (did) {
    case 'accept':
      return type === 'Add' ? 'Publish' : 'Apply'
    case 'reject':
      return 'Reject'
    case 'delete':
      return 'Delete'
    case 'later':
      return 'Review again in a week'
  }
}

/** The first word of a name ("Rob" for "Rob Grayson"), or the part of an
 *  email before the @; "Someone" when there is none. */
export function firstName(name: string | null | undefined): string {
  const t = (name ?? '').trim()
  if (!t) return 'Someone'
  const word = t.split(/\s+/)[0]
  return word.includes('@') ? word.split('@')[0] : word
}

/** The From section's label, from whoever is waiting in it: "From Rob",
 *  "From Rob and Sam", "From Rob, Sam, and Ana". */
export function fromLabel(by: (string | null)[]): string {
  const first: string[] = []
  for (const b of by) {
    const n = firstName(b)
    if (!first.includes(n)) first.push(n)
  }
  if (first.length === 0) return 'From the team'
  if (first.length === 1) return `From ${first[0]}`
  if (first.length === 2) return `From ${first[0]} and ${first[1]}`
  return `From ${first.slice(0, -1).join(', ')}, and ${first[first.length - 1]}`
}

/** A short line for the list row: "Rob suggests Publish", "Rob asked",
 *  "Bryce answered". */
export function rowNote(fb: ForBryce, type: 'Add' | 'Change' | 'Rule'): string {
  if (fb.kind === 'suggest') {
    return `${firstName(fb.by)} suggests ${suggestWord(fb.did, type)}`
  }
  if (fb.answer) return `${firstName(fb.answeredBy)} answered`
  return `${firstName(fb.by)} asked`
}

/** Where a confirmed Reject starts: the suggester's reason, as one of the
 *  reject buttons when it is one, else typed, and their decline text. */
export function rejectSeed(
  fb: ForBryce | null | undefined,
  chips: string[]
): { chip: string | null; other: string; decline: string | null } | null {
  const s = openSuggestion(fb)
  if (!s || s.did !== 'reject') return null
  const reason = s.reason ?? ''
  const chip = chips.includes(reason) ? reason : null
  return { chip, other: chip ? '' : reason, decline: s.rejectReply }
}

/** Where a confirmed Apply of a rule starts on its public listing policy
 *  wording: as the suggester chose (true = it stays internal), or null to
 *  leave it as the row has it. */
export function publicSeed(fb: ForBryce | null | undefined): boolean | null {
  const s = openSuggestion(fb)
  if (!s || s.did !== 'accept' || !s.publicChoice) return null
  return s.publicChoice === 'internal'
}
