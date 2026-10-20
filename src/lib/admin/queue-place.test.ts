import { describe, expect, it } from 'vitest'

import {
  roomFor,
  slotOf,
  sortForSlot,
  sortValue,
  type Placed,
} from './queue-place'

const at = (id: string, sort: number | null, featured = false): Placed => ({
  id,
  name: id,
  sort,
  featured,
})

// A page as /funding keeps it: steps of ten, a tight run, featured last.
const PAGE = [
  at('a', 10),
  at('b', 11),
  at('c', 12),
  at('d', 40),
  at('e', 100),
  at('lightcone', 1000, true),
  at('bluedot', 1100, true),
]

describe('slotOf', () => {
  it('puts no Sort at the top', () => {
    expect(slotOf(PAGE, null)).toBe(0)
  })

  it('goes after every lower Sort and before a tie', () => {
    expect(slotOf(PAGE, 5)).toBe(0)
    expect(slotOf(PAGE, 11)).toBe(1)
    expect(slotOf(PAGE, 50)).toBe(4)
    expect(slotOf(PAGE, 5000)).toBe(7)
  })

  it('counts listings with no Sort as above', () => {
    expect(slotOf([at('x', null), ...PAGE], 5)).toBe(1)
  })
})

describe('sortForSlot', () => {
  it('uses ten steps where the gap allows', () => {
    expect(sortForSlot(PAGE, 4)).toBe(50) // between 40 and 100
    expect(sortForSlot(PAGE, 5)).toBe(110) // after 100, before the featured
    expect(sortForSlot(PAGE, 7)).toBe(1110) // the very bottom
  })

  it('goes halfway in a narrow gap', () => {
    expect(sortForSlot(PAGE, 3)).toBe(22) // 12 to 40 still takes ten
    expect(sortForSlot([at('p', 40), at('q', 55)], 1)).toBe(47)
    expect(sortForSlot([at('p', 1685), at('q', 1690)], 1)).toBe(1687)
  })

  it('takes the next value where there is no gap, to be made room for', () => {
    expect(sortForSlot(PAGE, 1)).toBe(11) // between 10 and 11
    expect(slotOf(PAGE, sortForSlot(PAGE, 1))).toBe(1)
  })

  it('places the top below the first Sort', () => {
    expect(sortForSlot(PAGE, 0)).toBe(5)
    expect(sortForSlot([at('p', 100)], 0)).toBe(90)
    expect(sortForSlot([at('p', 1)], 0)).toBe(1)
  })

  it('starts an empty page at ten', () => {
    expect(sortForSlot([], 0)).toBe(10)
  })

  it('lands in the slot it was asked for', () => {
    for (let s = 0; s <= PAGE.length; s++) {
      expect(slotOf(PAGE, sortForSlot(PAGE, s))).toBe(s)
    }
  })

  it('skips listings with no Sort on either side', () => {
    const page = [at('x', null), at('y', 30), at('z', null)]
    expect(sortForSlot(page, 1)).toBe(20)
    expect(sortForSlot(page, 3)).toBe(40)
  })
})

describe('roomFor', () => {
  it('moves nothing when the value is free', () => {
    expect(roomFor(PAGE, 50)).toEqual([])
  })

  it('moves the holder and the run straight after it', () => {
    expect(roomFor(PAGE, 11)).toEqual([
      { id: 'b', name: 'b', sort: 12 },
      { id: 'c', name: 'c', sort: 13 },
    ])
  })

  it('moves every listing that shares a value', () => {
    const page = [at('p', 430), at('q', 430), at('r', 435)]
    expect(roomFor(page, 430).map(m => m.id)).toEqual(['p', 'q'])
  })

  it('never moves the listing being placed', () => {
    expect(roomFor([...PAGE, at('new', 40)], 40, 'new')).toEqual([
      { id: 'd', name: 'd', sort: 41 },
    ])
  })
})

describe('sortValue', () => {
  it('reads numbers and number text', () => {
    expect(sortValue(40)).toBe(40)
    expect(sortValue(' 105 ')).toBe(105)
  })

  it('is null for empty or other text', () => {
    expect(sortValue('')).toBeNull()
    expect(sortValue(null)).toBeNull()
    expect(sortValue('soon')).toBeNull()
  })
})
