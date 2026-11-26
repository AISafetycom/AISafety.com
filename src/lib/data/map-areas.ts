// Named regions on the Field map (/map), keyed by org category.
//
// An org's logo is drawn in the region for its FIRST category only:
// "Governance, Advocacy, Conceptual research" → Governance Grove, not Advocacy
// Anchorage. Later categories are secondary tags and don't place the org
// anywhere. The one exception is an org whose Status says it has shut down:
// it sits in the Gone Graveyard whatever its categories are, so it can keep
// the categories it had while active. This file has no dependencies so both
// the chatbot catalog (server) and the system prompt can import it without
// pulling in the Airtable client.
export const MAP_AREA_BY_CATEGORY: Record<string, string> = {
  Advocacy: 'Advocacy Anchorage',
  Blog: 'Blog Beach',
  'Capabilities research': 'Capabilities Cove',
  'Career support': 'Career Castle',
  'Conceptual research': 'Conceptual Cliffs',
  'Empirical research': 'Empirical Escarpment',
  Forecasting: 'Forecasting Falls',
  Funding: 'Funding Forest',
  Governance: 'Governance Grove',
  Newsletter: 'Newsletter Nook',
  Podcast: 'Podcast Port',
  'Research support': 'Support Shoreline',
  Resource: 'Resource Rock',
  Strategy: 'Strategy Summit',
  'Training and education': 'Training Town',
  Video: 'Video Vista',
  'No longer active': 'Gone Graveyard',
}

/** First entry of an org's comma-joined category list, or null. */
export function primaryCategory(category: string): string | null {
  const first = category.split(',')[0]?.trim()
  return first || null
}

/** The category that stands for the Gone Graveyard. */
export const INACTIVE_CATEGORY = 'No longer active'

/** True when an org's Status says it has shut down. A blank Status counts as
 *  Active, as it does on the page. */
export function isInactive(status: string | null | undefined): boolean {
  return !!status && status !== 'Active'
}

/** The category that places an org on /map: "No longer active" when its
 *  Status says it has shut down (whatever its own categories are), otherwise
 *  its first category. /admin/analytics groups Map activity by this name. */
export function placingCategory(
  category: string,
  status: string | null | undefined
): string | null {
  return isInactive(status) ? INACTIVE_CATEGORY : primaryCategory(category)
}

/** Field map region an org is drawn in: the Gone Graveyard when its Status
 *  says it has shut down, otherwise the region for its first category. */
export function mapAreaFor(
  category: string,
  status: string | null | undefined
): string | null {
  const placing = placingCategory(category, status)
  if (!placing) return null
  const area = MAP_AREA_BY_CATEGORY[placing]
  if (!area) {
    console.warn(
      `[map-areas] No Field map area for category "${placing}" — add it to MAP_AREA_BY_CATEGORY`
    )
    return null
  }
  return area
}
