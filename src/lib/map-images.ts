// Every image the field map (/map) draws: its background plus one logo per
// placed listing. The map itself and /api/map-images (which the sitewide
// background preload reads) both go through here, so what gets prefetched is
// exactly what gets drawn. A prefetch of anything else is wasted bandwidth,
// and a logo the map draws but this list omits still loads cold.

export const MAP_BACKGROUND_URL = '/images/map-1.5.1.svg'

export interface MapPlacement {
  x: number | null
  y: number | null
  mapLogo: string | null
}

/** A listing is drawn on the map only when it has both coordinates. */
export function isPlacedOnMap(org: MapPlacement): boolean {
  return org.x !== null && org.y !== null
}

/** The background first, then each placed listing's logo, in drawing order
 *  and without repeats. */
export function mapImageUrls(orgs: readonly MapPlacement[]): string[] {
  const urls = new Set<string>([MAP_BACKGROUND_URL])
  for (const org of orgs) {
    if (isPlacedOnMap(org) && org.mapLogo) urls.add(org.mapLogo)
  }
  return [...urls]
}
