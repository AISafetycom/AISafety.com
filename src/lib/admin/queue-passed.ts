/*
  Passed items on /admin/queue (Bryce, 16 Nov 2026, on a form event taken
  out silently by the Mac's daily check the morning after it happened: "Let's
  set up a system in queue where somehow I know when this has happened" and
  "she needs a reply").

  The Mac worker's `passed` duty (~/Queue worker.py) looks once a day at
  open /events and /training items whose date the site no longer shows.
  - Someone sent it in and is waiting to hear back (form, email, Discord):
    the item stays, its proposal marked `passed` = {how, on}. The page tags
    it, keeps Publish off and leaves Reject, whose decline is the reply.
  - Nobody is waiting (Comb finds, Broom fixes): the row is Closed with
    Error "Passed: it ended on 15 November 2026. Taken out by the daily
    check". The page lists those for a week at the top of the queue.
*/

export interface Passed {
  /** An event "ended", a training program "started" (it leaves the page
   *  once its start date has gone by). */
  how: 'ended' | 'started'
  /** The day, YYYY-MM-DD (UTC, the site's day). */
  on: string
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Pure: the proposal's `passed` block, or null when absent or malformed. */
export function passedOf(v: unknown): Passed | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  const how = r.how === 'ended' || r.how === 'started' ? r.how : null
  const on = typeof r.on === 'string' && DAY_RE.test(r.on) ? r.on : null
  return how && on ? { how, on } : null
}

/** Pure: "15 November" (no year: it is always within a few weeks). */
export function passedDay(on: string): string {
  const d = new Date(`${on}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

/** Pure: why Publish is off on a passed item (page and API). */
export function passedBlock(p: Passed): string {
  return `It ${p.how} on ${passedDay(p.on)}, so it can't go on the site. Reject it to draft their reply.`
}

/** The daily check closes a row with this Error: "it ended on <day>." once
 *  the day has gone by, or, for an addition taken out on its last day
 *  (since 19 Nov 2026), "it ends today, <day>, too late to publish." */
const TAKEN_OUT_RE =
  /^Passed: it (?:(ended|started) on|(ends|starts) today,) (\d{1,2} [A-Z][a-z]+ \d{4})[.,] .*?Taken out by the daily check/

export interface TakenOut {
  id: string
  title: string
  page: string | null
  how: 'ended' | 'started'
  /** "15 November 2026", as the Error line has it. */
  day: string
  /** Where the record can be opened (its Airtable link), if any. */
  link: string | null
}

/** Pure: a row the daily check took out, read from its Error line, else
 *  null. Only Closed rows count: a row reopened since keeps no such line
 *  for long, but its status is what decides. A row carrying a suggestion
 *  or a question (For Bryce, queue-suggest.ts) is left out: the list read
 *  brings those whatever their age, not only for the week this line
 *  covers, and they have their own place on the page. */
export function takenOutOf(item: {
  id: string
  title: string
  page: string | null
  status: string
  error: string | null
  sourceLink: string | null
  forBryce?: unknown
}): TakenOut | null {
  if (item.forBryce) return null
  if (item.status !== 'Closed' || !item.error) return null
  const m = TAKEN_OUT_RE.exec(item.error)
  if (!m) return null
  return {
    id: item.id,
    title: item.title,
    page: item.page,
    // Read days later, "ends today" has ended: the line says it that way.
    how: (m[1] ?? (m[2] === 'ends' ? 'ended' : 'started')) as TakenOut['how'],
    day: m[3],
    link:
      item.sourceLink && /^https:\/\//.test(item.sourceLink)
        ? item.sourceLink
        : null,
  }
}

/** How long a taken-out item is listed at the top of the queue. */
export const TAKEN_OUT_DAYS = 7

/** The Airtable formula that brings those rows along with the open list:
 *  Closed by the daily check, status set in the last week. */
export const TAKEN_OUT_FORMULA =
  "AND({Status}='Closed',LEFT({Error},7)='Passed:'," +
  `IS_AFTER(LAST_MODIFIED_TIME({Status}),DATEADD(NOW(),-${TAKEN_OUT_DAYS},'day')))`

/** Pure: the ones not dismissed with the ✕ (ids kept in this browser). */
export function unseenTakenOut(
  all: TakenOut[],
  dismissed: readonly string[]
): TakenOut[] {
  const gone = new Set(dismissed)
  return all.filter(t => !gone.has(t.id))
}
