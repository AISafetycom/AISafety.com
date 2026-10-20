// How long a dated training program stays on /training (Bryce, 15 Oct
// 2026). A program leaves once it has started. When the org gave only rough
// timing, "Start date (approximate)" holds their wording and Start date is
// just an anchor (the 1st of the known month, 1 January for a year), so
// leaving on the anchor pulled a program on the 2nd of its month while it
// might not start for weeks (DISPATCH, October 2026). Such a program stays
// until that rough period is over instead: "October 2026" through 31
// October, "week of 14 September" through 20 September, "2027" through the
// end of 2027. Broom's training sweep (~/Broom/training/sweep.py) mirrors
// this rule to pick the records it checks; change both together.

const MONTH_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/gi
const MONTH_KEYS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]
const YEAR_RE = /\b(20\d\d)\b/g
// The last month of each season (northern hemisphere, as the orgs listed
// mostly are); winter runs into the next year, which the roll-forward below
// handles.
const SEASON_END: Record<string, number> = {
  spring: 4,
  summer: 7,
  fall: 10,
  autumn: 10,
  winter: 1,
}

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
}

function lastDayOfMonth(y: number, m: number): string {
  return iso(y, m + 1, 0)
}

/** Each month the wording names, in order, with where it sits. "may" only
 *  counts written as "May": lowercase it is the verb ("dates may change"). */
function monthsIn(text: string): { month: number; at: number; end: number }[] {
  const found: { month: number; at: number; end: number }[] = []
  for (const m of text.matchAll(MONTH_RE)) {
    if (m[1].toLowerCase() === 'may' && m[1] !== 'May') continue
    found.push({
      month: MONTH_KEYS.indexOf(m[1].slice(0, 3).toLowerCase()),
      at: m.index,
      end: m.index + m[0].length,
    })
  }
  return found
}

function yearsIn(text: string): { year: number; at: number }[] {
  return [...text.matchAll(YEAR_RE)].map(m => ({
    year: Number(m[1]),
    at: m.index,
  }))
}

/**
 * The last day (YYYY-MM-DD) of the rough period `wording` names, for a
 * program whose Start date anchor is `anchor` (YYYY-MM-DD). Errs late: a
 * qualifier inside a month ("early", "mid", "first week of") still runs to
 * the month's end, since showing a program a little long costs far less
 * than pulling one people could still join. Never before the anchor.
 */
export function approxPeriodEnd(anchor: string, wording: string): string {
  const anchorYear = Number(anchor.slice(0, 4))
  const text = wording.trim()
  const months = monthsIn(text)
  const years = yearsIn(text)
  const lastYear = years.length ? years[years.length - 1].year : anchorYear

  const atLeastAnchor = (end: string, mayRoll = false): string => {
    // A period named without its year that sits before the anchor is the
    // next one ("November to February", "winter" starting in December).
    // With the year written, it's a slip in the record: hold to the anchor.
    if (end < anchor && mayRoll) {
      end = iso(
        Number(end.slice(0, 4)) + 1,
        Number(end.slice(5, 7)) - 1,
        Number(end.slice(8, 10))
      )
    }
    return end < anchor ? anchor : end
  }

  // "week of 14 September" / "week of September 14": that week.
  const week =
    /\bweek of\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/i.exec(text) ??
    /\bweek of\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(text)
  if (week) {
    const [day, name] = /^\d/.test(week[1])
      ? [week[1], week[2]]
      : [week[2], week[1]]
    const month = monthsIn(name)[0]?.month
    if (month !== undefined) {
      return atLeastAnchor(iso(lastYear, month, Number(day) + 6), !years.length)
    }
  }

  // Named months: the end of the last one ("October to December 2026" runs
  // to 31 December), in the year written after it, else the latest year
  // written, else the anchor's.
  if (months.length) {
    const last = months[months.length - 1]
    const yearAfter = years.find(y => y.at >= last.end)?.year
    return atLeastAnchor(
      lastDayOfMonth(yearAfter ?? lastYear, last.month),
      yearAfter === undefined
    )
  }

  // Quarters, halves, and seasons.
  const quarter = /\bq([1-4])\b/i.exec(text)
  if (quarter) {
    return atLeastAnchor(
      lastDayOfMonth(lastYear, Number(quarter[1]) * 3 - 1),
      !years.length
    )
  }
  if (/\b(first|1st) half\b|\bh1\b/i.test(text)) {
    return atLeastAnchor(lastDayOfMonth(lastYear, 5), !years.length)
  }
  if (/\b(second|2nd) half\b|\bh2\b/i.test(text)) {
    return atLeastAnchor(lastDayOfMonth(lastYear, 11), !years.length)
  }
  const season = /\b(spring|summer|fall|autumn|winter)\b/i.exec(text)
  if (season) {
    const name = season[1].toLowerCase()
    // "winter 2026" starts in December 2026 and ends in February 2027.
    return atLeastAnchor(
      lastDayOfMonth(lastYear, SEASON_END[name]),
      name === 'winter' || !years.length
    )
  }

  // A year alone ("2027", "in 2027", "late 2026"): its end.
  if (years.length) return atLeastAnchor(iso(lastYear, 11, 31))

  // Wording we can't read: the anchor's month, which is the month the
  // anchor convention says the org named.
  return atLeastAnchor(
    lastDayOfMonth(anchorYear, Number(anchor.slice(5, 7)) - 1)
  )
}

/**
 * The last day (YYYY-MM-DD) a dated program shows on /training: its start
 * date, or with only rough timing on file the end of that period. Null for
 * a program with no start date, which stays until its end date passes.
 */
export function lastDayListed(
  startDate: string | null,
  startDateApprox: string | null
): string | null {
  if (!startDate) return null
  if (!startDateApprox?.trim()) return startDate
  return approxPeriodEnd(startDate, startDateApprox)
}
