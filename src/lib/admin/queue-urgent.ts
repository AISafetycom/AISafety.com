// Which open Queue items lose their value by waiting, so the list can put
// them first (Bryce, 4 Oct 2026: the backlog grows faster than it is
// decided, and the old pile was barely touched). Two kinds:
// - a listing whose start date or application deadline falls in the next
//   two weeks: published late, nobody can still go or apply;
// - a fix to a live listing that is sending visitors wrong now: a closed
//   listing still shown, a wrong link, a wrong date or application status.
// Items Fable says to skip (Don't publish, Dismiss) and rule changes are
// never urgent: leaving them costs nothing.

export const URGENT_DAYS = 14

/** A published listing's own dates (YYYY-MM-DD), from the site's catalog:
 *  a Change row carries only the fields it edits. */
export interface ListingDates {
  start?: string | null
  closes?: string | null
}

/** The parts of a Queue item the rules read. */
export interface UrgentInput {
  type: 'Add' | 'Change' | 'Rule'
  verdict: string | null
  fields: Record<string, unknown> | null
  changes: { field: string; to: unknown }[]
}

export interface Urgency {
  /** Days from today to the date that makes it urgent (0 = today); null
   *  for an undated fix, which sorts after every dated item. */
  days: number | null
  /** What the row says: "Closes 10 Oct", "Wrong link · Starts tomorrow". */
  label: string
}

const SKIP_VERDICTS = new Set(["Don't publish", 'Dismiss'])
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** A YYYY-MM-DD date at the start of a value (Airtable dates and date-times
 *  both start that way), else null. */
function isoDay(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

function when(days: number, iso: string): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

/** The field named `name` (any case) in `fields`. */
function field(fields: Record<string, unknown>, name: string): unknown {
  const want = name.toLowerCase()
  for (const [k, v] of Object.entries(fields)) {
    if (k.toLowerCase() === want) return v
  }
  return undefined
}

/** The soonest of `start` and `closes` that is today or later and within
 *  the window; a deadline on the start day reads as the start. */
function soonest(
  start: string | null,
  closes: string | null,
  today: string
): { days: number; label: string } | null {
  const t = dayNumber(today)
  let best: { days: number; label: string } | null = null
  for (const [iso, verb] of [
    [start, 'Starts'],
    [closes, 'Closes'],
  ] as const) {
    if (!iso) continue
    const days = dayNumber(iso) - t
    if (days < 0 || days > URGENT_DAYS) continue
    if (!best || days < best.days) {
      best = { days, label: `${verb} ${when(days, iso)}` }
    }
  }
  return best
}

/** What a Fix corrects that visitors can act on wrongly today, strongest
 *  first, or null when it only tidies (a logo, a name, a description). */
function wrongInfo(changes: UrgentInput['changes']): string | null {
  const names = changes.map(c => ({ name: c.field.toLowerCase(), to: c.to }))
  if (
    names.some(
      c =>
        (c.name === 'hide?' && c.to === true) ||
        (c.name === 'publish?' && c.to === false)
    )
  ) {
    return 'Listing closed'
  }
  if (names.some(c => /^(url|link|website)$/.test(c.name))) return 'Wrong link'
  if (names.some(c => /^(start date|end date|deadline)/.test(c.name))) {
    return 'Wrong date'
  }
  if (
    names.some(c =>
      /accepting applications|application status|not yet open/.test(c.name)
    )
  ) {
    return 'Wrong status'
  }
  return null
}

/** Why `item` can't wait, or null. `listing` is the published record's own
 *  dates (Changes only); `today` is the viewer's YYYY-MM-DD. */
export function urgencyOf(
  item: UrgentInput,
  listing: ListingDates | undefined,
  today: string
): Urgency | null {
  if (item.type === 'Rule') return null
  if (item.verdict && SKIP_VERDICTS.has(item.verdict)) return null

  let start: string | null = null
  let closes: string | null = null
  let wrong: string | null = null
  if (item.type === 'Add') {
    const f = item.fields ?? {}
    start = isoDay(field(f, 'Start date'))
    closes = isoDay(field(f, 'Deadline'))
  } else {
    // The corrected value beats the one on the listing now.
    start = isoDay(listing?.start)
    closes = isoDay(listing?.closes)
    for (const c of item.changes) {
      const name = c.field.toLowerCase()
      if (name === 'start date') start = isoDay(c.to)
      if (name === 'deadline') closes = isoDay(c.to)
    }
    if (item.verdict === 'Fix') wrong = wrongInfo(item.changes)
  }

  const dated = soonest(start, closes, today)
  if (dated && wrong) {
    return { days: dated.days, label: `${wrong} · ${dated.label}` }
  }
  if (dated) return dated
  if (wrong) return { days: null, label: wrong }
  return null
}

/** Order for the urgent list: dated items soonest first, then undated
 *  fixes; ties go to the older item. */
export function byUrgency(
  a: { urgency: Urgency; createdAt: string },
  b: { urgency: Urgency; createdAt: string }
): number {
  const da = a.urgency.days ?? Infinity
  const db = b.urgency.days ?? Infinity
  if (da !== db) return da - db
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}
