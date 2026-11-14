import { describe, expect, it } from 'vitest'
import { AREA_LABELS } from './map-geometry'
import {
  clumps,
  outline,
  suggestSpot,
  typicalSpacing,
  type SpotPin,
} from './map-spot'

const AREA = 'Strategy Summit'
const OTHER = 'Governance Grove'

let n = 0
const pin = (x: number, y: number, area: string | null = AREA): SpotPin => ({
  id: `rec${n++}`,
  x,
  y,
  scale: 'Small',
  label: 'Listing',
  area,
})
const ask = { scale: 'Small', label: 'New one', area: AREA }

/** A block of pins `step` apart, `cols` by `rows`, from (x, y). */
function block(
  x: number,
  y: number,
  cols: number,
  rows: number,
  step: number,
  area = AREA
): SpotPin[] {
  const out: SpotPin[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++)
      out.push(pin(x + c * step, y + r * step, area))
  }
  return out
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

describe('suggestSpot', () => {
  it('has nothing to say without an area', () => {
    expect(suggestSpot(block(30, 22, 3, 3, 1.2), { ...ask, area: null })).toBe(
      null
    )
  })

  it('takes the gap left among the pins of its own area', () => {
    // A 5 by 5 block with its middle pin taken out.
    const pins = block(28, 22, 5, 5, 1.2).filter(
      p => !(Math.abs(p.x - 30.4) < 0.01 && Math.abs(p.y - 24.4) < 0.01)
    )
    expect(suggestSpot(pins, ask)).toEqual({ x: 30.4, y: 24.4 })
  })

  it('stays inside the outline of its area rather than past its edge', () => {
    const pins = block(28, 22, 4, 4, 2.4)
    const spot = suggestSpot(pins, ask)!
    expect(spot.x).toBeGreaterThan(28)
    expect(spot.x).toBeLessThan(28 + 3 * 2.4)
    expect(spot.y).toBeGreaterThan(22)
    expect(spot.y).toBeLessThan(22 + 3 * 2.4)
  })

  it('covers no pin and keeps about the usual spacing', () => {
    const pins = block(28, 22, 4, 4, 2.4)
    const spot = suggestSpot(pins, ask)!
    const nearest = Math.min(...pins.map(p => distance(p, spot)))
    expect(nearest).toBeGreaterThanOrEqual(0.8 * typicalSpacing(pins, pins))
  })

  it('does not drift into the area next door', () => {
    // Its own area is full; the one beside it has gaps.
    const own = block(20, 22, 4, 4, 0.95)
    const next = block(24.5, 22, 3, 3, 2.4, OTHER)
    const spot = suggestSpot([...own, ...next], ask)!
    const nearestOwn = Math.min(...own.map(p => distance(p, spot)))
    const nearestNext = Math.min(...next.map(p => distance(p, spot)))
    expect(nearestOwn).toBeLessThan(nearestNext)
  })

  it('is not pulled across the map by one listing placed far away', () => {
    const near = block(28, 22, 3, 3, 2.4)
    const spot = suggestSpot([...near, pin(55, 8)], ask)!
    expect(spot.x).toBeLessThan(28 + 2 * 2.4 + 0.5)
  })

  it('keeps to the ground its pins sit on', () => {
    // Bare rock, which no pin sits on, right where the spot would go.
    const pins = block(25, 22, 3, 5, 2.4)
    const anywhere = suggestSpot(pins, ask)!
    const ground = (x: number, y: number) =>
      distance({ x, y }, anywhere) < 0.7 ? 'rock' : 'land'
    const onLand = suggestSpot(pins, ask, ground)!
    expect(ground(onLand.x, onLand.y)).toBe('land')
    expect(distance(onLand, anywhere)).toBeGreaterThanOrEqual(0.7)
  })

  it('puts the first listing of an area just under its name', () => {
    const label = AREA_LABELS.find(l => l.label === AREA)!
    const spot = suggestSpot(block(5, 5, 3, 3, 1.2, OTHER), ask)!
    expect(distance(spot, { x: label.x, y: label.y + 1.5 })).toBeLessThan(1)
  })

  it('gives positions to one decimal place', () => {
    const spot = suggestSpot(block(28, 22, 4, 4, 2.4), ask)!
    expect(spot.x).toBe(Math.round(spot.x * 10) / 10)
    expect(spot.y).toBe(Math.round(spot.y * 10) / 10)
  })
})

describe('typicalSpacing', () => {
  it('is the usual distance to the nearest pin, within its limits', () => {
    const pins = block(28, 22, 3, 3, 1.2)
    expect(typicalSpacing(pins, pins)).toBeCloseTo(1.2)
    const tight = block(28, 22, 3, 3, 0.3)
    expect(typicalSpacing(tight, tight)).toBe(0.95)
    const wide = block(28, 22, 3, 3, 4)
    expect(typicalSpacing(wide, wide)).toBe(1.5)
  })
})

describe('outline', () => {
  it('goes round the outermost points only', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    const hull = outline([...corners, { x: 2, y: 2 }, { x: 1, y: 3 }])
    expect(hull).toHaveLength(4)
    expect(hull).toEqual(expect.arrayContaining(corners))
  })
})

describe('clumps', () => {
  it('splits points too far apart to be one group', () => {
    const groups = clumps(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 10, y: 0 },
      ],
      1.5
    )
    expect(groups.map(g => g.length).sort()).toEqual([1, 3])
  })
})
