/*
  The work test's rules, with no I/O: which stage a candidate is at, what
  they may see and save there, and when a stage is complete.

  The work test is a sandboxed copy of the admin Queue for people applying to
  work on listings (/work-test/<private link>). Its items are real past
  suggestions, kept with our own decisions in private Airtable tables
  (store.ts). Nothing in it can reach the real Queue or a listing.

  The one thing this file must get right: our decision on an item never
  leaves the server before the candidate has locked in their own. Round one's
  decisions are shown after round one is submitted; round two's and part
  four's never are.
*/

export type Part =
  | 'Briefing'
  | 'Round one'
  | 'Round two'
  | 'Change check'
  | 'Description'
  | 'Reply'
  | 'Push back'

export type Stage = 'intro' | 'round1' | 'review' | 'round2' | 'part4' | 'done'

/** One item as stored, our decision included. Server only. */
export interface ItemRow {
  key: string
  part: Part
  order: number
  name: string
  page: string
  link: string
  /** The day we decided it, YYYY-MM-DD; '' where it doesn't apply. */
  decidedOn: string
  description: string
  fields: Record<string, string>
  source: string
  related: string
  fableVerdict: string
  fableReasons: string[]
  prompt: string
  answerKey: string
  ourReason: string
}

/** What the page gets: the item without our decision. */
export type PublicItem = Omit<ItemRow, 'answerKey' | 'ourReason'>

/** A briefing example: a past decision shown with what we did and why. */
export interface BriefingItem {
  key: string
  name: string
  page: string
  description: string
  fableVerdict: string
  ourAnswer: string
  ourReason: string
}

export interface Candidate {
  /** A short code such as "A". Names stay in Airtable. */
  code: string
  startedAt: string | null
  roundOneAt: string | null
  roundTwoStartedAt: string | null
  roundTwoAt: string | null
  finishedAt: string | null
}

export interface Answer {
  answer: string
  text: string
}

/** One line of the round one review: theirs beside ours. */
export interface ReviewLine {
  key: string
  name: string
  page: string
  yourAnswer: string
  yourReason: string
  ourAnswer: string
  ourReason: string
}

export interface WorkTestState {
  stage: Stage
  briefing: BriefingItem[]
  items: PublicItem[]
  answers: Record<string, Answer>
  /** Round one, theirs beside ours. Empty until round one is submitted. */
  review: ReviewLine[]
}

export const DECISIONS = ['Publish', 'Reject', 'Ask Bryce'] as const
export const CHANGE_DECISIONS = ['Apply', 'Reject'] as const

/** The longest text one answer may carry. */
export const MAX_TEXT = 4000

export function stageOf(c: Candidate): Stage {
  if (c.finishedAt) return 'done'
  if (c.roundTwoAt) return 'part4'
  if (c.roundTwoStartedAt) return 'round2'
  if (c.roundOneAt) return 'review'
  if (c.startedAt) return 'round1'
  return 'intro'
}

/** The parts a candidate works on at each stage. */
const OPEN_PARTS: Record<Stage, Part[]> = {
  intro: [],
  round1: ['Round one'],
  review: [],
  round2: ['Round two'],
  part4: ['Change check', 'Description', 'Reply', 'Push back'],
  done: [],
}

export function openParts(stage: Stage): Part[] {
  return OPEN_PARTS[stage]
}

const PART_ORDER: Part[] = [
  'Briefing',
  'Round one',
  'Round two',
  'Change check',
  'Description',
  'Reply',
  'Push back',
]

function byPartThenOrder(a: ItemRow, b: ItemRow): number {
  return (
    PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part) || a.order - b.order
  )
}

export function publicItem(row: ItemRow): PublicItem {
  // Built field by field, so a column added to the store later stays on the
  // server until someone adds it here on purpose.
  return {
    key: row.key,
    part: row.part,
    order: row.order,
    name: row.name,
    page: row.page,
    link: row.link,
    decidedOn: row.decidedOn,
    description: row.description,
    fields: row.fields,
    source: row.source,
    related: row.related,
    fableVerdict: row.fableVerdict,
    fableReasons: row.fableReasons,
    prompt: row.prompt,
  }
}

/** Whether round one's decisions may be shown: only once theirs are locked. */
function reviewOpen(stage: Stage): boolean {
  return stage === 'review' || stage === 'round2'
}

/** Everything the page may know at this candidate's stage, and no more. */
export function stateFor(
  candidate: Candidate,
  rows: ItemRow[],
  answers: Record<string, Answer>
): WorkTestState {
  const stage = stageOf(candidate)
  const sorted = [...rows].sort(byPartThenOrder)
  const open = openParts(stage)
  const items = sorted.filter(r => open.includes(r.part)).map(publicItem)
  const shownKeys = new Set(items.map(i => i.key))

  const briefing: BriefingItem[] =
    stage === 'done'
      ? []
      : sorted
          .filter(r => r.part === 'Briefing')
          .map(r => ({
            key: r.key,
            name: r.name,
            page: r.page,
            description: r.description,
            fableVerdict: r.fableVerdict,
            ourAnswer: r.answerKey,
            ourReason: r.ourReason,
          }))

  const review: ReviewLine[] = reviewOpen(stage)
    ? sorted
        .filter(r => r.part === 'Round one')
        .map(r => ({
          key: r.key,
          name: r.name,
          page: r.page,
          yourAnswer: answers[r.key]?.answer ?? '',
          yourReason: answers[r.key]?.text ?? '',
          ourAnswer: r.answerKey,
          ourReason: r.ourReason,
        }))
    : []

  const mine: Record<string, Answer> = {}
  for (const [key, a] of Object.entries(answers)) {
    if (shownKeys.has(key)) mine[key] = a
  }

  return { stage, briefing, items, answers: mine, review }
}

function choicesFor(part: Part): readonly string[] | null {
  if (part === 'Round one' || part === 'Round two') return DECISIONS
  if (part === 'Change check') return CHANGE_DECISIONS
  return null
}

/** A save as it will be stored, or why it is refused. */
export function checkSave(
  stage: Stage,
  item: ItemRow | undefined,
  answer: unknown,
  text: unknown
): { ok: true; answer: string; text: string } | { ok: false; error: string } {
  if (!item || !openParts(stage).includes(item.part)) {
    return { ok: false, error: 'That item is not open right now.' }
  }
  const choices = choicesFor(item.part)
  const a = typeof answer === 'string' ? answer : ''
  if (choices ? a !== '' && !choices.includes(a) : a !== '') {
    return { ok: false, error: 'That is not one of the choices.' }
  }
  const t = typeof text === 'string' ? text : ''
  if (t.length > MAX_TEXT) {
    return { ok: false, error: 'That text is too long to save.' }
  }
  return { ok: true, answer: a, text: t }
}

/** True when the item has everything a submit needs. */
export function isComplete(
  item: Pick<ItemRow, 'part'>,
  a: Answer | undefined
): boolean {
  if (!a || a.text.trim() === '') return false
  return choicesFor(item.part) ? a.answer !== '' : true
}

/** The open items still missing a decision or their text. */
export function missingKeys(
  stage: Stage,
  rows: ItemRow[],
  answers: Record<string, Answer>
): string[] {
  const open = openParts(stage)
  return rows
    .filter(r => open.includes(r.part) && !isComplete(r, answers[r.key]))
    .sort(byPartThenOrder)
    .map(r => r.key)
}

export type Move = 'start' | 'submit' | 'next'
export type Stamp = Exclude<keyof Candidate, 'code'>

/** The timestamp a move sets, or null when the move doesn't fit the stage. */
export function stampFor(stage: Stage, move: Move): Stamp | null {
  if (stage === 'intro' && move === 'start') return 'startedAt'
  if (stage === 'round1' && move === 'submit') return 'roundOneAt'
  if (stage === 'review' && move === 'next') return 'roundTwoStartedAt'
  if (stage === 'round2' && move === 'submit') return 'roundTwoAt'
  if (stage === 'part4' && move === 'submit') return 'finishedAt'
  return null
}
