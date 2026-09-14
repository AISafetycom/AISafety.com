import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AREA_LABELS,
  BACKGROUND_IMAGE_URL,
  BASE_LOGO_SIZE,
  GRID_BOUNDS,
  GRID_SIZE,
  LOGO_GLOBAL_SCALE,
  MAP_HEIGHT,
  MAP_OFFSET_X,
  MAP_OFFSET_Y,
  MAP_WIDTH,
  PADDING_FACTOR,
  SIZE_TO_SCALE,
  clampGrid,
  gridToPx,
  inGridBounds,
  logoMetrics,
  pxToGrid,
  roundGrid,
} from './map-geometry'

// ─── Drift guard: the public map's numbers must equal our copy ─────────────
// D3Map.tsx is never imported by admin code (it is the public /map renderer);
// instead we read its source and pin the literals we copied.

const d3MapSource = readFileSync(
  join(process.cwd(), 'src/app/map/D3Map.tsx'),
  'utf8'
)

function literal(name: string): string {
  const m = d3MapSource.match(new RegExp(`const ${name} = ([^\\n]+)`))
  if (!m) throw new Error(`D3Map.tsx no longer defines ${name}`)
  return m[1].trim()
}

describe('map-geometry mirrors src/app/map/D3Map.tsx', () => {
  it('canvas constants', () => {
    expect(literal('MAP_WIDTH')).toBe(String(MAP_WIDTH))
    expect(literal('MAP_HEIGHT')).toBe(String(MAP_HEIGHT))
    expect(literal('PADDING_FACTOR')).toBe(String(PADDING_FACTOR))
    expect(literal('GRID_SIZE')).toBe('MAP_WIDTH / 60')
    expect(literal('BASE_LOGO_SIZE')).toBe(String(BASE_LOGO_SIZE))
    expect(Number(literal('LOGO_GLOBAL_SCALE'))).toBe(LOGO_GLOBAL_SCALE)
    // The background URL is the one value D3Map imports instead of defining.
    expect(d3MapSource).toContain(
      "import { MAP_BACKGROUND_URL } from '@/lib/map-images'"
    )
    expect(d3MapSource).toContain(".attr('xlink:href', MAP_BACKGROUND_URL)")
    expect(BACKGROUND_IMAGE_URL).toBe('/images/map-1.5.1.svg')
  })

  it('offsets (public map: /2 horizontally, /20 vertically)', () => {
    expect(d3MapSource).toContain(
      'const offsetX = (PADDED_WIDTH - MAP_WIDTH) / 2'
    )
    expect(d3MapSource).toContain(
      'const offsetY = (PADDED_HEIGHT - MAP_HEIGHT) / 20'
    )
    expect(MAP_OFFSET_X).toBeCloseTo(124.25, 6)
    expect(MAP_OFFSET_Y).toBeCloseTo(6.775, 6)
  })

  it('scale table', () => {
    for (const [name, value] of Object.entries(SIZE_TO_SCALE)) {
      expect(d3MapSource).toMatch(new RegExp(`\\b${name}: ${value},`))
    }
  })

  it('area labels', () => {
    for (const { label, x, y } of AREA_LABELS) {
      expect(d3MapSource).toContain(`{ label: '${label}', x: ${x}, y: ${y} }`)
    }
    const count = (d3MapSource.match(/\{ label: '/g) ?? []).length
    expect(count).toBe(AREA_LABELS.length)
  })

  it('glyph metrics formulas', () => {
    expect(d3MapSource).toContain('const labelOffset = 11 * rawScale * 1.5')
    expect(d3MapSource).toContain('const fontSize = 6 * rawScale * 1.5')
    expect(d3MapSource).toContain('const padX = 6 * rawScale * 1.5')
    expect(d3MapSource).toContain('const padY = 3 * rawScale * 1.5')
    expect(d3MapSource).toContain('const padding = 2')
    expect(d3MapSource).toContain(
      "const rawScale = SIZE_TO_SCALE[org.scale || 'Medium'] || 0.6"
    )
  })
})

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe('logoMetrics', () => {
  it('matches D3Map arithmetic for each scale', () => {
    const m = logoMetrics('Large')
    expect(m.rawScale).toBe(0.8)
    expect(m.iconSize).toBeCloseTo(51.2)
    expect(m.contentSize).toBeCloseTo(47.2)
    expect(m.labelOffset).toBeCloseTo(13.2)
    expect(m.labelY).toBeCloseTo(25.6 + 13.2)
    expect(m.fontSize).toBeCloseTo(7.2)
    expect(m.padX).toBeCloseTo(7.2)
    expect(m.padY).toBeCloseTo(3.6)
  })
  it('defaults to Medium when Scale is unset or unknown', () => {
    expect(logoMetrics(null).rawScale).toBe(0.6)
    expect(logoMetrics('Huge').rawScale).toBe(0.6)
    expect(logoMetrics('small').rawScale).toBe(0.4)
  })
})

describe('grid conversions', () => {
  it('round-trips through pixels', () => {
    expect(GRID_SIZE).toBeCloseTo(41.4166667, 6)
    expect(pxToGrid(gridToPx(22.2))).toBeCloseTo(22.2, 9)
    expect(gridToPx(30)).toBeCloseTo(MAP_WIDTH / 2)
  })
  it('rounds to one decimal without -0', () => {
    expect(roundGrid(12.34)).toBe(12.3)
    expect(roundGrid(12.36)).toBe(12.4)
    expect(roundGrid(-0.04)).toBe(0)
    expect(Object.is(roundGrid(-0.04), 0)).toBe(true)
    expect(roundGrid(22.2)).toBe(22.2)
  })
  it('bounds cover the map and nothing else', () => {
    expect(GRID_BOUNDS.x).toEqual([0, 60])
    expect(GRID_BOUNDS.y[0]).toBe(0)
    expect(GRID_BOUNDS.y[1]).toBe(32.7)
    expect(inGridBounds(0, 0)).toBe(true)
    expect(inGridBounds(60, 32.7)).toBe(true)
    expect(inGridBounds(60.1, 10)).toBe(false)
    expect(inGridBounds(10, -0.1)).toBe(false)
    expect(clampGrid(-3, 40)).toEqual({ x: 0, y: 32.7 })
    expect(clampGrid(61, 5)).toEqual({ x: 60, y: 5 })
    expect(clampGrid(22.2, 17.2)).toEqual({ x: 22.2, y: 17.2 })
  })
})
