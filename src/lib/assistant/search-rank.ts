// Two small rules for the chatbot's listing search, kept free of imports so
// they can be tested on their own.

/** Filter keys whose values are single labels where one label sits inside
 *  another: "Active" is part of "Inactive", "Semi-active" and "No longer
 *  active". A substring match on these returned every group for a search that
 *  asked for active ones only, so they match on the whole label instead. Every
 *  other key keeps its substring match (cost "Free" still catches "Free
 *  (assistance available)", location "UK" still catches "London, UK"). */
const WHOLE_LABEL_KEYS = new Set(['activityLevel', 'status'])

export function filterValueMatches(
  key: string,
  have: string,
  want: string
): boolean {
  const h = have.trim().toLowerCase()
  const w = want.trim().toLowerCase()
  if (!w) return false
  return WHOLE_LABEL_KEYS.has(key) ? h === w : h.includes(w)
}

/** In a geo search, listings whose distances fall in the same band count as
 *  the same place. Inside one city the exact distance only says whose pin
 *  happens to sit nearest the center point, which is no reason to lead with a
 *  group. */
export const SAME_PLACE_KM = 25

export function placeBand(distanceKm: number): number {
  return Math.floor(distanceKm / SAME_PLACE_KM)
}

/** Lower sorts first. Only communities carry an activity level; a listing
 *  without one ranks with the active ones. */
export function activityRank(level: string | undefined): number {
  switch ((level ?? '').trim().toLowerCase()) {
    case 'semi-active':
      return 1
    case 'inactive':
      return 2
    default:
      return 0
  }
}
