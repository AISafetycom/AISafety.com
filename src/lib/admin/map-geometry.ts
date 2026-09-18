/*
  Geometry of the public Field map, for the ADMIN map editor only.

  This is a deliberate COPY of the constants and glyph metrics in
  src/app/map/D3Map.tsx (lines ~30–72 and ~262–441). The editor must render
  pins in exactly the places and sizes /map does, but /map is one of the site's
  most-used pages and must not import from, or be changed for, an admin tool.
  So the numbers live here twice, and src/lib/admin/map-geometry.test.ts reads
  D3Map.tsx and fails if the two ever drift apart.

  Pure module: no DOM, no d3, no next — safe to import from tests and from
  both server and client code.
*/

// ─── Canvas ─────────────────────────────────────────────────────────────────

export const MAP_WIDTH = 2485
export const MAP_HEIGHT = 1355
export const PADDING_FACTOR = 1.1
export const PADDED_WIDTH = MAP_WIDTH * PADDING_FACTOR
export const PADDED_HEIGHT = MAP_HEIGHT * PADDING_FACTOR
/** One grid unit in SVG pixels: the map is 60 grid units wide. Airtable's x/y
 *  are in these units (e.g. Training Town's label sits at 22.2, 17.2). */
export const GRID_SIZE = MAP_WIDTH / 60
// The one constant that is shared rather than copied: the background URL also
// feeds the sitewide preload of the map's images (src/lib/map-images.ts), and
// that module is public-map code, not admin code.
export { MAP_BACKGROUND_URL as BACKGROUND_IMAGE_URL } from '@/lib/map-images'

/** The main group's translate inside the padded viewBox (public map values —
 *  note the /20 vertical offset, which differs from the poster map's /2). */
export const MAP_OFFSET_X = (PADDED_WIDTH - MAP_WIDTH) / 2
export const MAP_OFFSET_Y = (PADDED_HEIGHT - MAP_HEIGHT) / 20
export const VIEWBOX = `0 0 ${PADDED_WIDTH} ${PADDED_HEIGHT}`
export const PRESERVE_ASPECT_RATIO = 'xMidYMin meet'
export const ZOOM_EXTENT: [number, number] = [0.5, 8]

// ─── Logos ──────────────────────────────────────────────────────────────────

export const SIZE_TO_SCALE: Record<string, number> = {
  small: 0.4,
  Small: 0.4,
  medium: 0.6,
  Medium: 0.6,
  large: 0.8,
  Large: 0.8,
}
export const BASE_LOGO_SIZE = 64
export const LOGO_GLOBAL_SCALE = 1.0
export const LOGO_PADDING = 2
/** Scale /map assumes when a record has no Scale set. */
export const DEFAULT_SCALE_NAME = 'Medium'

export interface LogoMetrics {
  rawScale: number
  iconSize: number
  contentSize: number
  labelOffset: number
  labelY: number
  fontSize: number
  padX: number
  padY: number
}

/** Same arithmetic as D3Map's per-org block, so a pin drawn from these numbers
 *  is the same size as its /map counterpart. */
export function logoMetrics(scale: string | null): LogoMetrics {
  const rawScale = SIZE_TO_SCALE[scale || DEFAULT_SCALE_NAME] || 0.6
  const iconSize = BASE_LOGO_SIZE * rawScale * LOGO_GLOBAL_SCALE
  const contentSize = iconSize - 2 * LOGO_PADDING
  const labelOffset = 11 * rawScale * 1.5
  return {
    rawScale,
    iconSize,
    contentSize,
    labelOffset,
    labelY: iconSize / 2 + labelOffset,
    fontSize: 6 * rawScale * 1.5,
    padX: 6 * rawScale * 1.5,
    padY: 3 * rawScale * 1.5,
  }
}

// ─── Title and area labels ─────────────────────────────────────────────────

export const TITLE = {
  text: 'Map of AI Existential Safety',
  gridX: 30,
  gridY: 2.5,
  fontSize: 72,
  fontWeight: 400,
  letterSpacing: '-2.16px',
}

export const AREA_LABEL_STYLE = {
  labelScale: 1.75,
  baseFontSize: 14,
  basePadX: 14,
  basePadY: 7,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  pillFill: 'rgba(27, 43, 62, 0.6)',
}

export const AREA_LABELS = [
  { label: 'Conceptual Cliffs', x: 46, y: 5.5 },
  { label: 'Resource Rock', x: 3.5, y: 8 },
  { label: 'Support Shoreline', x: 13, y: 6.7 },
  { label: 'Newsletter Nook', x: 15.8, y: 14.5 },
  { label: 'Video Vista', x: 23, y: 5.6 },
  { label: 'Funding Forest', x: 29.2, y: 7 },
  { label: 'Governance Grove', x: 37.7, y: 5.5 },
  { label: 'Strategy Summit', x: 34.8, y: 19 },
  { label: 'Research Range', x: 45.3, y: 15.9 },
  { label: 'Training Town', x: 22.2, y: 17.2 },
  { label: 'Empirical Escarpment', x: 53.5, y: 16 },
  { label: 'Podcast Port', x: 9.5, y: 20.5 },
  { label: 'Blog Beach', x: 15, y: 25.8 },
  { label: 'Forecasting Falls', x: 39.2, y: 23.8 },
  { label: 'Career Castle', x: 30.5, y: 29.4 },
  { label: 'Advocacy Anchorage', x: 8, y: 31 },
  { label: 'Capabilities Cove', x: 45, y: 27.1 },
  { label: 'Gone Graveyard', x: 56, y: 30 },
]

// ─── Coordinate helpers ────────────────────────────────────────────────────

/** Airtable's x/y fields have precision 1; anything finer is invisible on
 *  /map and would be displayed rounded in Airtable anyway. */
export const GRID_DECIMALS = 1

/** Storable range: the map is 60 units wide and MAP_HEIGHT/GRID_SIZE units
 *  tall (~32.7). Outside this the pin would sit in the blank SVG margin. */
export const GRID_BOUNDS = {
  x: [0, 60] as const,
  y: [0, roundGrid(MAP_HEIGHT / GRID_SIZE)] as const,
}

export function gridToPx(grid: number): number {
  return grid * GRID_SIZE
}

export function pxToGrid(px: number): number {
  return px / GRID_SIZE
}

/** Round to Airtable's precision; never returns -0. */
export function roundGrid(value: number): number {
  const factor = 10 ** GRID_DECIMALS
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded
}

export function clampGrid(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(GRID_BOUNDS.x[1], Math.max(GRID_BOUNDS.x[0], x)),
    y: Math.min(GRID_BOUNDS.y[1], Math.max(GRID_BOUNDS.y[0], y)),
  }
}

export function inGridBounds(x: number, y: number): boolean {
  return (
    x >= GRID_BOUNDS.x[0] &&
    x <= GRID_BOUNDS.x[1] &&
    y >= GRID_BOUNDS.y[0] &&
    y <= GRID_BOUNDS.y[1]
  )
}
