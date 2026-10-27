// The Funding table's "Accepting applications?" field holds free text:
// "Applications on a rolling basis", "Applications close 31 October 2026",
// "Accepting applications" (open, timing unknown), or "Not accepting
// applications". Rather than enumerate every open phrasing, key off the
// closed ones: they all start with "No" ("Not accepting applications",
// legacy "No"), so the open wordings can be reworded freely. Callers only
// pass non-empty statuses.
//
// Lives outside lib/data/ because client components import it — the data
// modules pull in server-only code (next/headers, @vercel/blob).
export function isAcceptingApplications(status: string): boolean {
  return !status.startsWith('No')
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// The dated open wording, exactly as the field's convention writes it.
const CLOSE_DATE = /^Applications close (\d{1,2}) ([A-Z][a-z]+) (\d{4})$/

/** The closing date (YYYY-MM-DD) an "Applications close D Month YYYY"
 *  status carries, or null for every other wording. */
export function applicationsCloseDate(status: string): string | null {
  const m = CLOSE_DATE.exec(status.trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[2])
  if (month === -1) return null
  const day = Number(m[1])
  if (day < 1 || day > 31) return null
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The wording every closed funder shows — a computed status uses the same
 *  words as the rest of the page, never a one-off phrase (Bryce, 26 Oct
 *  2026). */
export const NOT_ACCEPTING = 'Not accepting applications'

/** The status as the site shows it. Airtable keeps the deadline in the
 *  status text ("Applications close 23 October 2026") and nobody edits the
 *  record the day it passes, so — like /training's Deadline field — the
 *  site works the closure out itself: once the closing date is behind
 *  `today` (YYYY-MM-DD; the closing day itself still counts as open), the
 *  listing reads "Not accepting applications" everywhere — card, Open/Closed
 *  filter, chatbot. Every other wording passes through unchanged. */
export function resolveAcceptingApplications(
  status: string,
  today: string = new Date().toISOString().slice(0, 10)
): string {
  const closesOn = applicationsCloseDate(status)
  return closesOn && closesOn < today ? NOT_ACCEPTING : status
}
