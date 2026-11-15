// A geo search's `distanceKm` is measured from whatever place the model
// searched. That is the visitor's own place only when they named it; when the
// model searched around the approximate location in the context (a guess from
// the visitor's network), the number says nothing reliable about them. This
// note rides with the results so the model reads it next to the numbers.

import type { NearOptions } from './search'

export function distanceNote(
  near: NearOptions | undefined,
  hasDistances: boolean
): string | null {
  if (!near || !hasDistances) return null
  // Same precedence as searchCatalog: coordinates win over a city name.
  const byCoords = typeof near.lat === 'number' && typeof near.lng === 'number'
  const city = near.city?.trim()
  if (!byCoords && !city) return null
  const from = byCoords
    ? 'the coordinates you searched'
    : `the center of "${city}", the place you searched`
  return `distanceKm is measured from ${from} – it is the user's own distance only if they named that place themselves. If you took the place from the approximate location in the context, say where each listing is by naming its city, and do NOT quote a distance or call any listing "the closest" or "the nearest".`
}
