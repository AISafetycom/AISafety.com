// The old status text: "Applications on a rolling basis", "Applications
// close 31 October 2026", "Accepting applications" (open, timing unknown),
// or "Not accepting applications". It was the Funding table's "Accepting
// applications?" field until 28 October 2026; since then the site works it
// out from Application status and Deadline (acceptingApplicationsText), so
// Data API v1 keeps serving it as acceptingApplications with the same
// values, and old Queue rows still name it.
//
// Rather than enumerate every open phrasing, key off the closed ones: they
// all start with "No" ("Not accepting applications", legacy "No"), so the
// open wordings can be reworded freely. Callers only pass non-empty
// statuses.
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

/**
 * The old status text for a funder's Application status and Deadline
 * (YYYY-MM-DD), worded exactly as the bots kept the "Accepting
 * applications?" field in step until it was deleted: an open funder reads
 * "Applications close D Month YYYY" (the month in full, no leading zero) or,
 * with no Deadline, "Applications on a rolling basis"; either closed status
 * reads "Not accepting applications". A blank or unknown status gives '',
 * as an empty field did. A passed date is left in: resolveAcceptingApplications
 * turns it into "Not accepting applications".
 */
export function acceptingApplicationsText(
  status: string,
  deadline: string | null
): string {
  if (status === 'Applications open') {
    if (!deadline) return 'Applications on a rolling basis'
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline)
    const month = m ? MONTHS[Number(m[2]) - 1] : undefined
    if (!m || !month) {
      // Airtable's date fields are always YYYY-MM-DD, so only a hand edit
      // previewed in the Queue gets here. The text carries it as given,
      // the way the old free-text field passed odd wordings through.
      console.warn(
        `[funding] Deadline "${deadline}" is not a YYYY-MM-DD date; acceptingApplications shows it as given.`
      )
      return `Applications close ${deadline}`
    }
    return `Applications close ${Number(m[3])} ${month} ${m[1]}`
  }
  if (
    status === 'Not currently accepting applications' ||
    status === 'Invite only, no applications'
  ) {
    return NOT_ACCEPTING
  }
  return ''
}

/** The status as the site shows it. The old text carries the deadline
 *  ("Applications close 23 October 2026") and nobody edits the record the
 *  day it passes, so — like /training's Deadline field — the site works the
 *  closure out itself: once the closing date is behind `today` (YYYY-MM-DD;
 *  the closing day itself still counts as open), the listing reads "Not
 *  accepting applications" everywhere — Data API, chatbot. Every other
 *  wording passes through unchanged. */
export function resolveAcceptingApplications(
  status: string,
  today: string = new Date().toISOString().slice(0, 10)
): string {
  const closesOn = applicationsCloseDate(status)
  return closesOn && closesOn < today ? NOT_ACCEPTING : status
}
