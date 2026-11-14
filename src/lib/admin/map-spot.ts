/*
  Where a new listing could sit on the Field map: a free spot nestled among
  the listings of its own area, for the Queue's map strip (the suggestion a
  /map addition opens with, before anyone drags it).

  It reads nothing but the pins already placed, so every listing placed by
  hand teaches the next suggestion: how far apart an area's pins sit and
  where the area ends both come from them. It cannot see the artwork, so a
  spot may land on a drawn mountain or house; the strip is there to drag it.

  Pure module: no DOM, no d3, no next. Positions are in the map's grid units
  (Airtable's x and y), sizes come from map-geometry's copy of /map's.
*/

import {
  AREA_LABELS,
  AREA_LABEL_STYLE,
  GRID_BOUNDS,
  GRID_SIZE,
  TITLE,
  logoMetrics,
  roundGrid,
} from './map-geometry'

/** A listing already on the map. */
export interface SpotPin {
  id: string
  x: number
  y: number
  /** Scale option name (Small/Medium/Large), null for /map's default. */
  scale: string | null
  /** What /map prints under the logo. */
  label: string
  /** The Field map region of its first category, null when unmapped. */
  area: string | null
}

/** The listing looking for a place. */
export interface SpotAsk {
  scale: string | null
  label: string
  area: string | null
}

export interface Spot {
  x: number
  y: number
}

// ─── Shapes ────────────────────────────────────────────────────────────────

interface Rect {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** A pin as /map draws it: the logo disc and the name pill under it. */
interface Shape {
  cx: number
  cy: number
  r: number
  pill: Rect
}

/** Inter 600 at /map's letter-spacing: an average letter's width, and a
 *  line's height, in ems. Estimates (the real ones are measured in the
 *  browser); a little generous so a suggested pill never touches another. */
const CHAR_EM = 0.58
const LINE_EM = 1.2

function shapeOf(x: number, y: number, scale: string | null, label: string) {
  const m = logoMetrics(scale)
  const w = (label.length * m.fontSize * CHAR_EM + 2 * m.padX) / GRID_SIZE
  const h = (m.fontSize * LINE_EM + 2 * m.padY) / GRID_SIZE
  const cy = y + m.labelY / GRID_SIZE
  const shape: Shape = {
    cx: x,
    cy: y,
    r: m.iconSize / 2 / GRID_SIZE,
    pill: { x0: x - w / 2, x1: x + w / 2, y0: cy - h / 2, y1: cy + h / 2 },
  }
  return shape
}

function rectsTouch(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x0 - gap < b.x1 &&
    a.x1 + gap > b.x0 &&
    a.y0 - gap < b.y1 &&
    a.y1 + gap > b.y0
  )
}

function discTouchesRect(
  cx: number,
  cy: number,
  r: number,
  b: Rect,
  gap: number
): boolean {
  const dx = cx - Math.max(b.x0, Math.min(cx, b.x1))
  const dy = cy - Math.max(b.y0, Math.min(cy, b.y1))
  return Math.hypot(dx, dy) < r + gap
}

function shapesTouch(a: Shape, b: Shape, gap: number): boolean {
  return (
    Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r + gap ||
    discTouchesRect(a.cx, a.cy, a.r, b.pill, gap) ||
    discTouchesRect(b.cx, b.cy, b.r, a.pill, gap) ||
    rectsTouch(a.pill, b.pill, gap)
  )
}

/** The map's own lettering, which no pin should cover: each area's name
 *  pill and the title. */
function furniture(): Rect[] {
  const s = AREA_LABEL_STYLE
  const font = s.baseFontSize * s.labelScale
  const padX = (s.basePadX * s.labelScale) / GRID_SIZE
  const padY = (s.basePadY * s.labelScale) / GRID_SIZE
  const rects: Rect[] = AREA_LABELS.map(({ label, x, y }) => {
    const half = (label.length * font * CHAR_EM) / GRID_SIZE / 2
    return {
      x0: x - half - padX,
      x1: x + half + padX,
      // The text sits on its baseline at y: most of it is above.
      y0: y - (font * 0.95) / GRID_SIZE - padY,
      y1: y + (font * 0.25) / GRID_SIZE + padY,
    }
  })
  const titleHalf = (TITLE.text.length * TITLE.fontSize * 0.5) / GRID_SIZE / 2
  rects.push({
    x0: TITLE.gridX - titleHalf,
    x1: TITLE.gridX + titleHalf,
    y0: TITLE.gridY - TITLE.fontSize / GRID_SIZE,
    y1: TITLE.gridY + (TITLE.fontSize * 0.25) / GRID_SIZE,
  })
  return rects
}

// ─── The search ────────────────────────────────────────────────────────────

/** Candidate spots are tried on Airtable's own grid (x and y keep one
 *  decimal place). */
const STEP = 0.1
/** How far outside the outline of an area's pins a spot may sit: about on
 *  the line between two of its outermost pins, not beyond it. */
const EDGE = 0.25
/** How far past an area's outermost pins a spot may go when there is no
 *  room at all among them. */
const REACH = 2
/** Air kept between the new pin (disc and name pill) and anything else. */
const GAP = 0.08
/** How many of the area's nearest pins a spot is judged against. */
const NEIGHBOURS = 3
/** The typical distance between neighbouring pins is kept within these, so
 *  one crowded or one empty area cannot set a silly spacing. */
const SPACING_RANGE: [number, number] = [0.95, 1.5]
/** A spot may sit this much closer than the area's typical spacing, no
 *  closer. */
const TIGHTEST = 0.8
/** Pins further apart than this many spacings are not one group. */
const CLUMP = 2.5
/** An area needs this many pins before the ground under them says where
 *  its pins belong. */
const HOME_MIN = 6

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** How far apart an area's pins typically sit: the median distance from
 *  each to its nearest neighbour on the map. */
export function typicalSpacing(own: SpotPin[], all: SpotPin[]): number {
  const nearest: number[] = []
  for (const p of own) {
    let best = Infinity
    for (const q of all) {
      if (q === p) continue
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d < best) best = d
    }
    if (Number.isFinite(best)) nearest.push(best)
  }
  const [lo, hi] = SPACING_RANGE
  if (!nearest.length) return (lo + hi) / 2
  return Math.min(hi, Math.max(lo, median(nearest)))
}

type Point = { x: number; y: number }

/** The outline around a set of points (their convex hull), clockwise on
 *  the map (y grows downward); fewer than three corners when the points
 *  are too few or sit on one line. */
export function outline(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (list: Point[]) => {
    const out: Point[] = []
    for (const p of list) {
      while (
        out.length >= 2 &&
        cross(out[out.length - 2], out[out.length - 1], p) <= 0
      ) {
        out.pop()
      }
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...half(pts), ...half(pts.reverse())]
}

/** How far outside an outline a point is: 0 or less inside it. */
function outsideBy(hull: Point[], x: number, y: number): number {
  let worst = -Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (!len) continue
    // Signed distance from the edge a→b; the inside is on its left here.
    const d = ((b.y - a.y) * (x - a.x) - (b.x - a.x) * (y - a.y)) / len
    if (d > worst) worst = d
  }
  return worst
}

/** A free spot for `ask` among the pins of its own area, or null when it
 *  has no area or there is no room for it.
 *
 *  It looks inside the outline of the area's pins first (of each group of
 *  them, when some sit apart), since past the outermost ones the land
 *  usually ends, and with `ground` only on the kind of ground those pins
 *  sit on. There it takes the spot nestled
 *  closest among them (the smallest average distance to its three nearest)
 *  that keeps about the area's usual spacing and covers no pin, name or
 *  map lettering. A full area gets the roomiest spot left inside it, where
 *  only name pills may touch; one with no room at all, the nearest spot
 *  outside. Every spot has the area's own pins as its nearest neighbours,
 *  so none drifts over a border into the area next door. An area with
 *  nothing in it yet gets a spot just under its name. */
export function suggestSpot(
  pins: SpotPin[],
  ask: SpotAsk,
  ground?: Ground
): Spot | null {
  if (!ask.area) return null
  const placed = pins.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
  const own = placed.filter(p => p.area === ask.area)
  const shapes = placed.map(p => shapeOf(p.x, p.y, p.scale, p.label))
  const fixed = furniture()

  /** Whether the new pin fits at a spot: on the map, off its lettering,
   *  and clear of every pin; `pills` false lets name pills touch. */
  const fits = (x: number, y: number, pills: boolean): boolean => {
    const me = shapeOf(x, y, ask.scale, ask.label)
    if (
      me.cx - me.r < GRID_BOUNDS.x[0] ||
      me.cx + me.r > GRID_BOUNDS.x[1] ||
      me.cy - me.r < GRID_BOUNDS.y[0] ||
      me.pill.y1 > GRID_BOUNDS.y[1]
    ) {
      return false
    }
    for (const r of fixed) {
      if (discTouchesRect(me.cx, me.cy, me.r, r, GAP)) return false
      if (rectsTouch(me.pill, r, GAP)) return false
    }
    for (const s of shapes) {
      if (pills ? shapesTouch(me, s, GAP) : discsTouch(me, s)) return false
    }
    return true
  }

  // Nothing of its kind on the map yet: just under the area's name.
  if (!own.length) {
    const label = AREA_LABELS.find(l => l.label === ask.area)
    if (!label) return null
    return nearestFree(label.x, label.y + 1.5, 4, (x, y) => fits(x, y, true))
  }

  const spacing = typicalSpacing(own, placed)
  const hulls = clumps(own, spacing * CLUMP)
    .map(outline)
    .filter(h => h.length >= 3)
  const isOwn = placed.map(p => p.area === ask.area)
  const k = Math.min(NEIGHBOURS, own.length)
  const home = ground ? homeGround(own, ground) : null

  /** The best spot within `reach` of the outline (of the pins themselves
   *  when they make no outline). */
  const search = (reach: number, roomy: boolean): Spot | null => {
    const xs = own.map(p => p.x)
    const ys = own.map(p => p.y)
    const gx0 = Math.round(
      Math.max(GRID_BOUNDS.x[0], Math.min(...xs) - reach) / STEP
    )
    const gx1 = Math.round(
      Math.min(GRID_BOUNDS.x[1], Math.max(...xs) + reach) / STEP
    )
    const gy0 = Math.round(
      Math.max(GRID_BOUNDS.y[0], Math.min(...ys) - reach) / STEP
    )
    const gy1 = Math.round(
      Math.min(GRID_BOUNDS.y[1], Math.max(...ys) + reach) / STEP
    )
    // A spot closer than this to any pin is not looked at.
    const floor = roomy ? 0 : spacing * TIGHTEST
    let best: Spot | null = null
    let bestScore = Infinity
    for (let gy = gy0; gy <= gy1; gy++) {
      const y = gy * STEP
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = gx * STEP
        if (hulls.length && !hulls.some(h => outsideBy(h, x, y) <= reach)) {
          continue
        }
        // On the kind of ground the area's pins sit on: not out at sea,
        // nor on a drawn mountain they all keep off.
        if (home && !home.has(ground!(x, y) ?? '')) continue
        // The three nearest pins of any area (d1 nearest), how many of
        // them are its own, and its own three nearest (o1 nearest).
        let d1 = Infinity
        let d2 = Infinity
        let d3 = Infinity
        let own1 = false
        let own2 = false
        let own3 = false
        let o1 = Infinity
        let o2 = Infinity
        let o3 = Infinity
        let tooClose = false
        for (let i = 0; i < placed.length; i++) {
          const p = placed[i]
          const d = Math.hypot(p.x - x, p.y - y)
          if (d < floor) {
            tooClose = true
            break
          }
          const mine = isOwn[i]
          if (d < d1) {
            d3 = d2
            own3 = own2
            d2 = d1
            own2 = own1
            d1 = d
            own1 = mine
          } else if (d < d2) {
            d3 = d2
            own3 = own2
            d2 = d
            own2 = mine
          } else if (d < d3) {
            d3 = d
            own3 = mine
          }
          if (mine) {
            if (d < o1) {
              o3 = o2
              o2 = o1
              o1 = d
            } else if (d < o2) {
              o3 = o2
              o2 = d
            } else if (d < o3) {
              o3 = d
            }
          }
        }
        if (tooClose) continue
        // Its own area's pins are what surround it.
        if (!own1) continue
        if (Number(own1) + Number(own2) + Number(own3) < Math.min(2, k))
          continue
        if (o1 > spacing * 2) continue
        let score: number
        if (roomy) {
          // The most room: as far as it can get from its nearest pin.
          score = -d1
        } else {
          // How nestled it is: the average distance to its area's nearest
          // pins. A spot closer than the area's usual spacing is cramped:
          // it has to be that much more nestled to win.
          score = (o1 + (k > 1 ? o2 : 0) + (k > 2 ? o3 : 0)) / k
          score += 1.5 * Math.max(0, spacing - d1)
        }
        if (score >= bestScore) continue
        if (!fits(x, y, !roomy)) continue
        best = { x: roundGrid(x), y: roundGrid(y) }
        bestScore = score
      }
    }
    return best
  }

  return search(EDGE, false) ?? search(EDGE, true) ?? search(REACH, false)
}

/** What the map's picture shows at a spot, as a short name for its colour
 *  (null where that is not known). The browser reads it off the background
 *  image; see groundOf in the Queue's map strip. */
export type Ground = (x: number, y: number) => string | null

/** The kinds of ground an area's pins sit on: every colour under at least
 *  a tenth of them (and under two at least). Null when the area has too
 *  few pins to say, or the picture is not known under them. */
function homeGround(own: SpotPin[], ground: Ground): Set<string> | null {
  if (own.length < HOME_MIN) return null
  const counts = new Map<string, number>()
  for (const p of own) {
    const g = ground(p.x, p.y)
    if (g === null) return null
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  const need = Math.max(2, own.length / 10)
  const home = new Set<string>()
  for (const [g, n] of counts) if (n >= need) home.add(g)
  return home.size ? home : null
}

/** An area's pins in the groups they sit in: two pins share a group when a
 *  chain of pins no further than `link` apart joins them. A listing placed
 *  far from the rest of its area is a group of its own, so it does not
 *  stretch the area's outline across the map. */
export function clumps<T extends Point>(points: T[], link: number): T[][] {
  const group = points.map((_, i) => i)
  const find = (i: number): number => {
    while (group[i] !== i) i = group[i] = group[group[i]]
    return i
  }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
      if (d <= link) group[find(i)] = find(j)
    }
  }
  const out = new Map<number, T[]>()
  points.forEach((p, i) => {
    const g = find(i)
    out.set(g, [...(out.get(g) ?? []), p])
  })
  return [...out.values()]
}

/** Whether two pins' logo discs touch, or one's disc covers the other's
 *  name: the overlaps no spot may have. */
function discsTouch(a: Shape, b: Shape): boolean {
  return (
    Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r + GAP ||
    discTouchesRect(a.cx, a.cy, a.r, b.pill, 0) ||
    discTouchesRect(b.cx, b.cy, b.r, a.pill, 0)
  )
}

/** The free spot closest to a point, within `reach` of it. */
function nearestFree(
  tx: number,
  ty: number,
  reach: number,
  free: (x: number, y: number) => boolean
): Spot | null {
  let best: Spot | null = null
  let bestD = Infinity
  const n = Math.round(reach / STEP)
  const cx = Math.round(tx / STEP)
  const cy = Math.round(ty / STEP)
  for (let gy = cy - n; gy <= cy + n; gy++) {
    for (let gx = cx - n; gx <= cx + n; gx++) {
      const x = gx * STEP
      const y = gy * STEP
      const d = Math.hypot(x - tx, y - ty)
      if (d >= bestD || d > reach) continue
      if (!free(x, y)) continue
      best = { x: roundGrid(x), y: roundGrid(y) }
      bestD = d
    }
  }
  return best
}
