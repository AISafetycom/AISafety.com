import { formatShortDate } from './format-date'

// What the Funding page shows for each funder: the card's status, who-can-apply
// and grant-size lines, and the stops behind the Grant size slider. Pure, so the
// card builder, the page's client component and the tests share one copy. Lives
// outside lib/data/ because client components import it (see funding-status.ts).

/** The Application status options in Airtable, in filter order. */
export const APPLICATION_STATUSES = [
  'Applications open',
  'Not currently accepting applications',
  'Invite only, no applications',
] as const

/** The Who can apply options in Airtable, in filter order. */
export const WHO_CAN_APPLY = [
  'Individuals',
  'Nonprofits',
  'For-profits',
  'Universities',
] as const

export function isApplicationStatus(value: string): boolean {
  return (APPLICATION_STATUSES as readonly string[]).includes(value)
}

/**
 * The Application status as the site shows it. Nobody edits a record the day
 * its Deadline passes, so — like the old status text (funding-status.ts) and
 * /training's Deadline — an open funder whose Deadline is behind `today`
 * (YYYY-MM-DD; the closing day itself still counts as open) reads "Not
 * currently accepting applications" everywhere: card, filter, Data API. Every
 * other status passes through unchanged.
 */
export function resolveApplicationStatus(
  status: string,
  deadline: string | null,
  today: string = new Date().toISOString().slice(0, 10)
): string {
  return status === 'Applications open' && deadline && deadline < today
    ? 'Not currently accepting applications'
    : status
}

/**
 * The status line on a card, or null when there is nothing to show. Open
 * funders read "Applications on a rolling basis" unless they have a deadline;
 * the other two statuses are shown as they are.
 */
export function applicationLabel(
  status: string,
  deadline: string | null
): string | null {
  if (status === 'Applications open') {
    return deadline
      ? `Applications close ${formatShortDate(new Date(deadline))}`
      : 'Applications on a rolling basis'
  }
  return isApplicationStatus(status) ? status : null
}

/** "Who can apply: individuals, nonprofits" — lowercase, in the order given
 *  (funderFromRecord puts them in WHO_CAN_APPLY order). */
export function whoCanApplyLabel(who: string[]): string | null {
  return who.length > 0
    ? `Who can apply: ${who.map(w => w.toLowerCase()).join(', ')}`
    : null
}

/** "Grant size: …" from the funder's own wording, or null to hide the line. */
export function grantSizeLabel(display: string): string | null {
  return display ? `Grant size: ${display}` : null
}

// --- Grant size filter ------------------------------------------------------

/** Slider stops in USD. Position i is GRANT_STOPS[i]; the position after the
 *  last stop (GRANT_TOP) means "no upper limit". */
export const GRANT_STOPS = [
  0, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 1_000_000,
]

/** The highest slider position: no upper limit. */
export const GRANT_TOP = GRANT_STOPS.length

export function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${amount / 1_000_000}m`
  if (amount >= 1_000) return `$${amount / 1_000}k`
  return `$${amount}`
}

/** The label at each slider position, lowest to highest ("$0" … "$1m+"). */
export const GRANT_LABELS = [
  ...GRANT_STOPS.map(formatUsd),
  `${formatUsd(GRANT_STOPS[GRANT_STOPS.length - 1])}+`,
]

interface Grant {
  grantMinUsd: number | null
  grantMaxUsd: number | null
}

/** USD at a slider position; the top position has no upper limit. */
function positionValue(position: number): number {
  return position >= GRANT_TOP ? Infinity : GRANT_STOPS[position]
}

/**
 * Whether the funder stays listed for the selected range (positions lo to hi,
 * both ends included): its grants reach into the range. A missing minimum
 * counts as $0 and a missing maximum as no limit; a funder with neither has no
 * stated size and always stays, so nobody misses a funder just because it
 * doesn't publish a grant size.
 */
export function grantOverlaps(funder: Grant, lo: number, hi: number): boolean {
  if (funder.grantMinUsd === null && funder.grantMaxUsd === null) return true
  const min = funder.grantMinUsd ?? 0
  const max = funder.grantMaxUsd ?? Infinity
  return min <= positionValue(hi) && max >= positionValue(lo)
}

/** For each stretch between slider positions, how many funders' grants reach
 *  into it: the heights of the bars above the slider. */
export function grantBars(funders: Grant[]): number[] {
  return GRANT_STOPS.map((_, i) => {
    const lower = positionValue(i)
    const upper = positionValue(i + 1)
    return funders.filter(f => {
      if (f.grantMinUsd === null && f.grantMaxUsd === null) return false
      return (
        (f.grantMinUsd ?? 0) < upper && (f.grantMaxUsd ?? Infinity) >= lower
      )
    }).length
  })
}

/** Whether the slider is narrower than its full travel. */
export function grantRangeActive(lo: number, hi: number): boolean {
  return lo > 0 || hi < GRANT_TOP
}

/** The range in words for the pill: "up to $100k", "$5k – $100k", "$25k+". */
export function grantRangeSummary(lo: number, hi: number): string {
  if (!grantRangeActive(lo, hi)) return ''
  if (lo === 0) return `up to ${GRANT_LABELS[hi]}`
  if (hi >= GRANT_TOP) return `${GRANT_LABELS[lo]}+`
  return `${GRANT_LABELS[lo]} – ${GRANT_LABELS[hi]}`
}
