import { describe, expect, it } from 'vitest'
import { roundToFigures } from './round-figure'

describe('roundToFigures', () => {
  it('rounds to two significant figures by default', () => {
    expect(roundToFigures(14_356)).toBe(14_000)
    expect(roundToFigures(12_050)).toBe(12_000)
    expect(roundToFigures(26_738)).toBe(27_000)
    expect(roundToFigures(9_870)).toBe(9_900)
    expect(roundToFigures(105_432)).toBe(110_000)
  })

  it('rounds to the nearest, not up', () => {
    expect(roundToFigures(14_499)).toBe(14_000)
    expect(roundToFigures(14_500)).toBe(15_000)
  })

  it('leaves small numbers whole', () => {
    expect(roundToFigures(7)).toBe(7)
    expect(roundToFigures(42)).toBe(42)
    expect(roundToFigures(3.6)).toBe(4)
  })

  it('takes a different number of figures', () => {
    expect(roundToFigures(14_356, 3)).toBe(14_400)
    expect(roundToFigures(14_356, 1)).toBe(10_000)
  })

  it('returns 0 for nothing or nonsense', () => {
    expect(roundToFigures(0)).toBe(0)
    expect(roundToFigures(-5)).toBe(0)
    expect(roundToFigures(Number.NaN)).toBe(0)
  })
})
