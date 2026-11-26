/*
  "Waiting on them" on /admin/queue (Bryce, 16 Nov 2026, on a community he
  asked a question before deciding: "instead of waiting a week or something,
  I'm delaying the decision until they respond to my questions. The question
  is what to do with it in queue in the meantime").

  A question to the person behind an Email or Form item sits on the row's
  proposal as `reply.asked`, kept current by the Mac (~/Queue waiting.py):
    {at, text, to, sent?: {at, link}, answer?: {at, from, name, text, link,
     reviewed?}}
  The page only reads it.
  - Saved in Gmail but not sent: the item stays where it is, with a line
    saying so.
  - Sent, no answer: the item waits in the folded "Waiting on them" section
    for WAIT_DAYS, out of the counts. Nothing is his to do.
  - Answered: back at the top with their answer, and Fable reviews an
    addition again with it.
  - No answer after WAIT_DAYS: back in its place, marked "No answer since",
    even if the Mac is off (the page works the date out itself).

  Fable's review with their answer goes at the foot of the chat, and the
  review the item showed before it stays at the head of the side panel
  (Bryce, 25 Nov 2026, on Fangcun AI: "Fable's new review after they
  replied should come at the bottom of the chat. It shouldn't go to the
  top. The original review should be at the top"). The review overwrites
  the row's verdict and reasons, so the Mac keeps both on the answer as
  `review: {before, after}`, each {verdict, reasons, chips?}.

  A question asked anywhere but email (Bryce, 26 Nov 2026, on Common
  Ground: AI Safety, translated, after messaging the host on Luma: "We need
  a button to mark as waiting on them maybe? Or Fable Review should do it
  automatically") sits on the proposal as `waiting_on`: {at, text, by?,
  answer?: {at, text}}. The chat's ```waiting block writes it when he says
  he has asked them, the "Waiting on them" button (G) writes it too, and his
  paste of their answer into the chat adds `answer` (~/Queue waiting.py).
  It reads as a question already sent, with no Gmail link; nothing but him
  brings their answer, and Fable reads it in the chat, so no second review
  is announced.

  An addition with a start date or deadline comes back before that date,
  not only after WAIT_DAYS: once it would be urgent (ADD_URGENT_DAYS ahead,
  queue-urgent.ts), so an answer that never comes still leaves time to
  decide. Never sooner than a day after asking.
*/

import type { Verdict } from './queue'
import { ADD_URGENT_DAYS, type ListingDates } from './queue-urgent'

/** How long an item waits for an answer before it comes back anyway. The
 *  Mac's waiting.py has the same number. */
export const WAIT_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

/** A verdict and its reasons as the item showed them at one point. */
export interface ShownReview {
  verdict: Verdict
  reasons: string[]
  /** The reject buttons with it; null when not kept. */
  chips: string[] | null
}

export interface Answer {
  at: string | null
  /** Who answered: their name when the email gave one, else the address. */
  who: string | null
  text: string
  /** Their email in Gmail (only a Gmail link is kept). */
  link: string | null
  /** Fable has reviewed the listing again with this answer. */
  reviewed: boolean
  /** When it did (null before then, or when the time was not kept). */
  reviewedAt: string | null
  /** The review the item showed before that one, and that one itself;
   *  null when the Mac did not keep them. */
  review: { before: ShownReview; after: ShownReview } | null
}

export interface Asked {
  /** When the question was saved (or, sent by hand, when it went). */
  at: string
  /** The question, as sent once it has gone. */
  text: string
  to: string | null
  /** When he sent it; null while it is still a draft in Gmail. */
  sentAt: string | null
  /** The sent question in Gmail. */
  sentLink: string | null
  answer: Answer | null
  /** Asked outside email (`waiting_on`): no Gmail thread to follow, so
   *  their answer comes only when he pastes it into the chat. */
  elsewhere: boolean
}

/** Where a question stands: still a `draft`, `waiting` on them, `answered`,
 *  or `silent` (the wait ran out with no answer). */
export type AskedState = 'draft' | 'waiting' | 'answered' | 'silent'

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** An ISO instant that parses, else null. */
function instant(v: unknown): string | null {
  const s = text(v)
  return s && Number.isFinite(Date.parse(s)) ? s : null
}

function gmailLink(v: unknown): string | null {
  const s = text(v)
  return s && s.startsWith('https://mail.google.com/') ? s : null
}

const VERDICTS: readonly Verdict[] = ['Publish', "Don't publish", 'Unsure']

function textList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out = v.map(text)
  return out.every((s): s is string => s !== null) ? out : null
}

/** One side of `review`, or null when malformed. */
function shownReviewOf(v: unknown): ShownReview | null {
  if (!isRecord(v)) return null
  const verdict = VERDICTS.find(x => x === v.verdict)
  const reasons = textList(v.reasons)
  if (!verdict || !reasons?.length) return null
  return { verdict, reasons, chips: textList(v.chips) }
}

function reviewPairOf(
  v: unknown
): { before: ShownReview; after: ShownReview } | null {
  if (!isRecord(v)) return null
  const before = shownReviewOf(v.before)
  const after = shownReviewOf(v.after)
  return before && after ? { before, after } : null
}

/** Pure: the reply block's `asked`, or null when absent or malformed. */
export function askedOf(v: unknown): Asked | null {
  if (!isRecord(v)) return null
  const at = instant(v.at)
  if (!at) return null
  const sent = isRecord(v.sent) ? v.sent : null
  const a = isRecord(v.answer) ? v.answer : null
  return {
    at,
    text: text(v.text) ?? '',
    to: text(v.to),
    sentAt: sent ? instant(sent.at) : null,
    sentLink: sent ? gmailLink(sent.link) : null,
    answer: a
      ? {
          at: instant(a.at),
          who: text(a.name) ?? text(a.from),
          text: text(a.text) ?? '',
          link: gmailLink(a.link),
          reviewed: Boolean(text(a.reviewed)),
          reviewedAt: instant(a.reviewed),
          review: reviewPairOf(a.review),
        }
      : null,
    elsewhere: false,
  }
}

/** The proposal key for a question asked outside email (~/Queue
 *  waiting.py ELSEWHERE_KEY). */
export const ELSEWHERE_KEY = 'waiting_on'

/** Pure: the proposal's `waiting_on` as a question already sent, or null
 *  when absent or malformed. */
export function elsewhereOf(v: unknown): Asked | null {
  if (!isRecord(v)) return null
  const at = instant(v.at)
  if (!at) return null
  const a = isRecord(v.answer) ? v.answer : null
  const answerAt = a ? instant(a.at) : null
  return {
    at,
    text: text(v.text) ?? '',
    to: null,
    sentAt: at,
    sentLink: null,
    answer:
      a && answerAt
        ? {
            at: answerAt,
            who: null,
            text: text(a.text) ?? '',
            link: null,
            reviewed: false,
            reviewedAt: null,
            review: null,
          }
        : null,
    elsewhere: true,
  }
}

/** Pure: the question that counts when a row holds both an emailed one and
 *  one asked elsewhere: the later of the two. */
export function latestAsked(
  emailed: Asked | null,
  elsewhere: Asked | null
): Asked | null {
  if (!emailed || !elsewhere) return emailed ?? elsewhere
  return Date.parse(elsewhere.at) >= Date.parse(emailed.at)
    ? elsewhere
    : emailed
}

/** A YYYY-MM-DD day as the epoch ms of its start (UTC), or NaN. */
function dayMs(iso: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN
}

/** Pure: when a sent question's wait runs out, in ms: WAIT_DAYS after it
 *  went, or sooner for an addition whose start date or deadline (`dates`)
 *  would make it urgent before then, but never within a day of asking.
 *  Null while it is unsent. */
function waitEndMs(asked: Asked, dates?: ListingDates): number | null {
  if (!asked.sentAt) return null
  const sent = Date.parse(asked.sentAt)
  let ends = sent + WAIT_DAYS * DAY_MS
  for (const d of [dates?.start, dates?.closes]) {
    const day = dayMs(d)
    if (!Number.isFinite(day) || day <= sent) continue
    ends = Math.min(
      ends,
      Math.max(sent + DAY_MS, day - ADD_URGENT_DAYS * DAY_MS)
    )
  }
  return ends
}

/** Pure: when a sent question's wait runs out, as an ISO instant. */
export function waitEnds(asked: Asked, dates?: ListingDates): string | null {
  const ends = waitEndMs(asked, dates)
  return ends === null ? null : new Date(ends).toISOString()
}

/** The parts of a Queue item the state reads. */
export interface AskedInput {
  status: string
  asked: Asked | null
  /** Its date went by: only the reply is left, so it must not sit waiting. */
  passed: unknown
  /** He has replied to them since their answer: the question is settled. */
  alreadyReplied: unknown
  /** An addition's own dates, which bring it back sooner (waitEnds). */
  dates?: ListingDates
}

/** Pure: where an open item's question stands at `now`, or null when it has
 *  none that matters any more. */
export function askedState(item: AskedInput, now: number): AskedState | null {
  const asked = item.asked
  if (!asked) return null
  if (!['Pending', 'Revising', 'Failed'].includes(item.status)) return null
  if (asked.answer) return item.alreadyReplied ? null : 'answered'
  if (!asked.sentAt) return 'draft'
  if (item.passed) return 'silent'
  const ends = waitEndMs(asked, item.dates) as number
  return now < ends ? 'waiting' : 'silent'
}

/** How long after an answer the page says Fable is reviewing it again; the
 *  note goes quiet if the Mac never gets to it. */
const REVIEWING_MS = 60 * 60 * 1000

/** Pure: Fable's second look at an addition whose question was answered:
 *  `done`, `running` (the answer is under an hour old) or null. Only an
 *  addition is reviewed again. */
export function reviewStage(
  item: { type: string; asked: Asked | null },
  now: number
): 'done' | 'running' | null {
  const answer = item.asked?.answer
  // An answer pasted into the chat is read there: no second review.
  if (!answer || item.type !== 'Add' || item.asked?.elsewhere) return null
  if (answer.reviewed) return 'done'
  const at = answer.at ? Date.parse(answer.at) : NaN
  return Number.isFinite(at) && now - at < REVIEWING_MS ? 'running' : null
}

/** Fable's review with their answer, and the one the item showed before. */
export interface AnsweredReview {
  /** When Fable reviewed it again (null when the time was not kept). */
  at: string | null
  /** Who answered. */
  who: string | null
  before: ShownReview
  after: ShownReview
}

/** Pure: the review with their answer, which goes at the foot of the chat,
 *  and the one before it, which stays at the head of the side panel; null
 *  until Fable has reviewed the addition again and the Mac kept both. It
 *  stays once the item is decided or he has replied, so the panel keeps
 *  its order. */
export function answeredReview(item: {
  type: string
  asked: Asked | null
}): AnsweredReview | null {
  const a = item.asked?.answer
  if (!a?.reviewed || !a.review || item.type !== 'Add') return null
  return { at: a.reviewedAt, who: a.who, ...a.review }
}

/** Pure: "16 Nov" for a row tag, in the viewer's own time zone. */
export function askedDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}
