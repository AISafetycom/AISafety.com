/** A /map addition's place on the Field map, as the Queue handles it.
 *
 *  The map strip under the listing shows where the new pin would go. Until
 *  it is dragged, that is a suggested spot (map-spot.ts), which is not an
 *  edit: nothing is saved on the row for it and nothing is written to
 *  Airtable. It goes out with Publish, as the listing's x and y, unless the
 *  record or the edits already hold both (Bryce, 14 Nov 2026). */

import { MAP_TABLE_ID } from './map-editor-core'
import { clampGrid, roundGrid } from './map-geometry'
import type { Spot } from './map-spot'

/** The Map table's two place fields, by Airtable name (the Queue's edits
 *  are keyed by field name). */
export const SPOT_FIELDS = ['x', 'y'] as const

type Fields = Record<string, unknown>

/** Whether an item is an addition to the Field map: the kind that gets the
 *  map strip. */
export function wantsSpot(item: {
  type: string
  targetTable: string | null
}): boolean {
  return item.type === 'Add' && item.targetTable === MAP_TABLE_ID
}

function coordinate(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The place the record holds once the edits are in, or null while either
 *  x or y is missing. */
export function spotOf(fields: Fields, edits: Fields): Spot | null {
  const x = coordinate('x' in edits ? edits.x : fields.x)
  const y = coordinate('y' in edits ? edits.y : fields.y)
  return x === null || y === null ? null : { x, y }
}

/** The edits that go with Publish: the suggested spot fills whichever of x
 *  and y the record and the edits leave empty. Anything already there
 *  stays, and so do the edits when there is no suggestion. */
export function withSpot(
  edits: Record<string, string>,
  fields: Fields,
  suggested: Spot | null | undefined
): Record<string, string> {
  if (!suggested) return edits
  const out = { ...edits }
  for (const k of SPOT_FIELDS) {
    if (coordinate(k in edits ? edits[k] : fields[k]) === null) {
      out[k] = String(suggested[k])
    }
  }
  return out
}

/** A place as Airtable stores it: on the map, to one decimal. */
export function tidySpot(x: number, y: number): Spot {
  return clampGrid(roundGrid(x), roundGrid(y))
}
