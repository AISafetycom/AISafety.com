/*
  "Review again in a week" on /admin/queue (Bryce, 8 Oct 2026, on a march
  whose Luma page was still a placeholder). The button sets the row's
  Review again on to a week from now; until then the page treats the item
  like a decision (out of the list, under Done today the day it was set,
  Undo brings it back). When it is due, the Mac worker has Fable review the
  listing again and clears the date (~/Queue worker.py, `later` duty); the
  item is back in the list from the date on even if the Mac is off.
*/

export const REVIEW_AGAIN_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** Pure: when an item set aside at `now` comes back, as an ISO instant. */
export function reviewAgainAt(now: number): string {
  return new Date(now + REVIEW_AGAIN_DAYS * DAY_MS).toISOString()
}

/** Pure: the return date of an item set aside and not due yet, else null.
 *  Only an open item can be set aside; a decided one's date means nothing. */
export function laterUntil(
  item: { status: string; reviewAgainOn: string | null },
  now: number
): string | null {
  if (item.status !== 'Pending' && item.status !== 'Failed') return null
  const at = item.reviewAgainOn ? Date.parse(item.reviewAgainOn) : NaN
  return Number.isFinite(at) && at > now ? item.reviewAgainOn : null
}

/** Pure: when the item was set aside (a week before it comes back). */
export function laterSince(reviewAgainOn: string): string {
  return new Date(
    Date.parse(reviewAgainOn) - REVIEW_AGAIN_DAYS * DAY_MS
  ).toISOString()
}
