/*
  Pure logic for the admin map editor: Airtable field IDs for the Map table,
  the record shape the editor works with, request validation for the move
  API, and the /map stacking order.

  Deliberately does NOT import src/lib/data/map.ts or src/lib/data/airtable.ts
  (those are the public /map's data path — cached, publish-filtered, and
  wired into Blob mirroring). The editor keeps its own copies of the few
  things it needs so nothing about /map changes. Keep the FIELD ids and the
  comparator in sync with src/lib/data/map.ts.

  No next/d3/DOM imports — importable from tests, server and client code.
*/

import { MAP_AREA_BY_CATEGORY, placingCategory } from '@/lib/data/map-areas'
import { GRID_DECIMALS, inGridBounds, roundGrid } from './map-geometry'

export const MAP_TABLE_ID = 'tblvzbGL9q9dOO9Nc'

/** Permanent field IDs (same values as src/lib/data/map.ts FIELD). Reads use
 *  returnFieldsByFieldId; the ONLY fields the editor ever writes are x, y and
 *  Scale (see buildPositionFields / buildScaleFields). */
export const FIELD = {
  longName: 'fldqYJa5li27kVOUW', // Long name
  longNameForCards: 'fldPEouzOZbCIZr7p', // Long name for cards
  shortName: 'fldIL5rLAwlbvdhtg', // Short name
  description: 'fldUZfd5kQQP0DoOS', // Description
  categoryText: 'fldddK6whfSl9DWNd', // Category (text)
  category: 'fldhofDtTtJqWXLuf', // Category
  status: 'fld2OFKbXPhO2NQRx', // Status
  logoForMap: 'fldua2ISy01Yntwof', // Logo (for map)
  x: 'fld2FlBMPjxhjGuFO', // x
  y: 'fldkAQPZaibRGawVw', // y
  scale: 'fldw2bKsCY0VdTCN6', // Scale
  publish: 'fldCCQ2OYlQluuarR', // Publish?
  hide: 'fldKwedEOWPFuWSe7', // Hide?
} as const

/** Fields the editor reads. Publish? is read so drafts can be marked; Hide?
 *  is filtered out at the query, so it isn't needed in the response. */
export const READ_FIELDS: string[] = [
  FIELD.longName,
  FIELD.longNameForCards,
  FIELD.shortName,
  FIELD.description,
  FIELD.categoryText,
  FIELD.category,
  FIELD.status,
  FIELD.logoForMap,
  FIELD.x,
  FIELD.y,
  FIELD.scale,
  FIELD.publish,
]

/** Rows that are page furniture on /map (Merch, Last updated, Suggest…). They
 *  are draggable like anything else, but the editor badges them. */
export const MAGIC_ROW_NAMES = [
  'Merch',
  'Last updated',
  'Suggest correction',
  'Suggest entry',
]

export interface EditorRecord {
  id: string
  /** Card title: Long name for cards, else Long name, else 'Untitled (rec…)'. */
  title: string
  /** Long name (what /map's tooltip shows). */
  tooltipTitle: string
  shortName: string | null
  /** What /map prints under the logo: Short name || title. */
  labelName: string
  description: string | null
  category: string
  /** Field map region for the FIRST category, or null if unmapped. */
  area: string | null
  status: string
  scale: string | null
  mapLogo: string | null
  x: number | null
  y: number | null
  published: boolean
  isMagic: boolean
  /** When the record was created in Airtable (ISO), for tray ordering. */
  createdTime: string | null
  /** Position in /map's stacking order (0 = drawn first / bottom-most). */
  order: number
}

// ─── Coercion (same semantics as src/lib/data/airtable.ts helpers) ─────────

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function strArray(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : []
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string')
  }
  return []
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function attachmentUrl(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const first = value[0] as { url?: unknown }
  return typeof first?.url === 'string' ? first.url : null
}

// ─── Row → record ──────────────────────────────────────────────────────────

export interface AirtableRowLike {
  id: string
  createdTime?: string
  fields: Record<string, unknown>
}

/** Maps a raw Airtable row (fields keyed by ID) to an EditorRecord. `order`
 *  is filled in by sortEditorRecords. */
export function rowToEditorRecord(row: AirtableRowLike): EditorRecord {
  const f = row.fields
  const longName = str(f[FIELD.longName])
  const title =
    str(f[FIELD.longNameForCards]) || longName || `Untitled (${row.id})`
  const shortName = str(f[FIELD.shortName])
  const category =
    str(f[FIELD.categoryText]) || strArray(f[FIELD.category]).join(', ')
  const status = str(f[FIELD.status]) || 'Active'
  const placing = placingCategory(category, status)
  return {
    id: row.id,
    title,
    tooltipTitle: longName || title,
    shortName,
    labelName: shortName || title,
    description: str(f[FIELD.description]),
    category,
    area: (placing && MAP_AREA_BY_CATEGORY[placing]) || null,
    status,
    scale: str(f[FIELD.scale]),
    mapLogo: attachmentUrl(f[FIELD.logoForMap]),
    x: num(f[FIELD.x]),
    y: num(f[FIELD.y]),
    published: f[FIELD.publish] === true,
    isMagic: MAGIC_ROW_NAMES.includes(title),
    createdTime: row.createdTime ?? null,
    order: 0,
  }
}

// ─── Stacking order (copied from src/lib/data/map.ts getMapData) ───────────

const STATUS_ORDER = ['Active', 'Inactive']
const SCALE_ORDER_LARGE_FIRST = ['Large', 'Medium', 'Small']
const CATEGORY_ORDER = [
  'Advocacy',
  'Blog',
  'Capabilities research',
  'Career support',
  'Conceptual research',
  'Empirical research',
  'Forecasting',
  'Funding',
  'Governance',
  'Newsletter',
  'Podcast',
  'Research support',
  'Resource',
  'Strategy',
  'Training and education',
  'Video',
  'No longer active',
]

function rankIn(value: string | null | undefined, order: string[]): number {
  if (!value) return order.length + 1
  const idx = order.indexOf(value)
  return idx === -1 ? order.length : idx
}

function categoryIndices(category: string): number[] {
  if (!category) return [CATEGORY_ORDER.length + 1]
  return category
    .split(',')
    .map(c => c.trim())
    .filter(Boolean)
    .map(c => rankIn(c, CATEGORY_ORDER))
}

function compareCategoryIndices(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/** Same comparator as /map's data layer, so pins overlap in the same order
 *  (later in the array = drawn on top). Keep in sync with map.ts. */
export function compareEditorRecords(a: EditorRecord, b: EditorRecord): number {
  if (a.isMagic !== b.isMagic) return a.isMagic ? 1 : -1
  const statusDiff =
    rankIn(a.status, STATUS_ORDER) - rankIn(b.status, STATUS_ORDER)
  if (statusDiff !== 0) return statusDiff
  const scaleDiff =
    rankIn(a.scale, SCALE_ORDER_LARGE_FIRST) -
    rankIn(b.scale, SCALE_ORDER_LARGE_FIRST)
  if (scaleDiff !== 0) return scaleDiff
  const catDiff = compareCategoryIndices(
    categoryIndices(a.category),
    categoryIndices(b.category)
  )
  if (catDiff !== 0) return catDiff
  return a.title.localeCompare(b.title)
}

/** Sorts in /map order and stamps `order` on each record. */
export function sortEditorRecords(records: EditorRecord[]): EditorRecord[] {
  const sorted = [...records].sort(compareEditorRecords)
  sorted.forEach((r, i) => {
    r.order = i
  })
  return sorted
}

// ─── Move request validation ───────────────────────────────────────────────

export class ValidationError extends Error {}

export interface MoveRequest {
  id: string
  x: number
  y: number
  /** What the client last saw for this record; the server refuses the write
   *  (409) if Airtable now holds something else. */
  expected?: { x: number | null; y: number | null }
}

const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/
const ALLOWED_KEYS = new Set(['id', 'x', 'y', 'expected'])
const ALLOWED_EXPECTED_KEYS = new Set(['x', 'y'])

function coordinate(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${name} must be a finite number`)
  }
  return roundGrid(value)
}

/** Parses and validates a PATCH body. Rejects anything but id/x/y/expected —
 *  the request can never smuggle in other fields. Rounds x/y to Airtable's
 *  precision and requires them to be within the map. */
export function validateMoveBody(body: unknown): MoveRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('body must be a JSON object')
  }
  const obj = body as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new ValidationError(`unexpected key: ${key}`)
    }
  }
  const id = obj.id
  if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) {
    throw new ValidationError('id must be an Airtable record id')
  }
  const x = coordinate(obj.x, 'x')
  const y = coordinate(obj.y, 'y')
  if (!inGridBounds(x, y)) {
    throw new ValidationError('x/y outside the map')
  }
  const out: MoveRequest = { id, x, y }
  if (obj.expected !== undefined) {
    const e = obj.expected
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      throw new ValidationError('expected must be an object')
    }
    const eo = e as Record<string, unknown>
    for (const key of Object.keys(eo)) {
      if (!ALLOWED_EXPECTED_KEYS.has(key)) {
        throw new ValidationError(`unexpected key in expected: ${key}`)
      }
    }
    const ex = eo.x
    const ey = eo.y
    if (
      !(ex === null || (typeof ex === 'number' && Number.isFinite(ex))) ||
      !(ey === null || (typeof ey === 'number' && Number.isFinite(ey)))
    ) {
      throw new ValidationError('expected.x/y must be numbers or null')
    }
    out.expected = { x: ex as number | null, y: ey as number | null }
  }
  return out
}

/** One of the two builders of an Airtable write body for the Map table (the
 *  other is buildScaleFields). Exactly two keys, both by permanent field ID. */
export function buildPositionFields(
  x: number,
  y: number
): Record<string, number> {
  return { [FIELD.x]: x, [FIELD.y]: y }
}

// ─── Scale (logo size) request validation ──────────────────────────────────

/** The Scale single-select's options, exactly as named in Airtable. The
 *  editor can only ever write one of these – never clear the field. */
export const SCALE_OPTIONS = ['Small', 'Medium', 'Large'] as const
export type ScaleName = (typeof SCALE_OPTIONS)[number]

export function isScaleName(value: unknown): value is ScaleName {
  return (
    typeof value === 'string' &&
    (SCALE_OPTIONS as readonly string[]).includes(value)
  )
}

export interface ScaleRequest {
  id: string
  scale: ScaleName
  /** The Scale the client last saw (null = not set); the server refuses the
   *  write (409) if Airtable now holds something else. */
  expected?: string | null
}

const ALLOWED_SCALE_KEYS = new Set(['id', 'scale', 'expected'])

/** True when a PATCH body is asking for a Scale change rather than a move
 *  (the two shapes share the endpoint; each is validated by its own
 *  allow-list, so a body can never mix them). */
export function isScaleBody(body: unknown): boolean {
  return (
    !!body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'scale' in body
  )
}

/** Parses and validates a Scale-change body. Rejects anything but
 *  id/scale/expected and any scale that is not one of SCALE_OPTIONS. */
export function validateScaleBody(body: unknown): ScaleRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('body must be a JSON object')
  }
  const obj = body as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_SCALE_KEYS.has(key)) {
      throw new ValidationError(`unexpected key: ${key}`)
    }
  }
  const id = obj.id
  if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) {
    throw new ValidationError('id must be an Airtable record id')
  }
  if (!isScaleName(obj.scale)) {
    throw new ValidationError(
      `scale must be one of ${SCALE_OPTIONS.join(', ')}`
    )
  }
  const out: ScaleRequest = { id, scale: obj.scale }
  if (obj.expected !== undefined) {
    if (obj.expected !== null && typeof obj.expected !== 'string') {
      throw new ValidationError('expected must be a string or null')
    }
    out.expected = obj.expected
  }
  return out
}

/** The other write-body builder for the Map table: exactly one key, the
 *  Scale field by permanent ID, with a validated option name. */
export function buildScaleFields(scale: ScaleName): Record<string, string> {
  if (!isScaleName(scale)) throw new ValidationError(`bad scale: ${scale}`)
  return { [FIELD.scale]: scale }
}

/** True when two stored positions are the same at Airtable precision. */
export function samePosition(
  a: { x: number | null; y: number | null },
  b: { x: number | null; y: number | null }
): boolean {
  const eq = (p: number | null, q: number | null) =>
    p === null || q === null ? p === q : roundGrid(p) === roundGrid(q)
  return eq(a.x, b.x) && eq(a.y, b.y)
}

export { GRID_DECIMALS }
