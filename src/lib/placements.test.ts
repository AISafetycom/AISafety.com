import { describe, expect, it } from 'vitest'
import { gridListings, placementsById } from './placements'

interface Item {
  id: string
  featured: string | null
}

function item(id: string, featured: string | null = null): Item {
  return { id, featured }
}

describe('placementsById', () => {
  it('stamps ranks 1 and 2 as F-slots and numbers the rest in order', () => {
    const items = [item('a'), item('f1', '1'), item('b'), item('f2', '2')]
    const placements = placementsById(items)
    expect(placements.get('a')).toBe('1')
    expect(placements.get('f1')).toBe('F1')
    expect(placements.get('b')).toBe('2')
    expect(placements.get('f2')).toBe('F2')
  })

  it('takes the displayed row on queue pages, stand-ins included', () => {
    const items = [item('a', '3'), item('b', '1'), item('c')]
    const row = [item('b', '1'), item('c')]
    const placements = placementsById(items, row)
    expect(placements.get('b')).toBe('F1')
    expect(placements.get('c')).toBe('F2')
    expect(placements.get('a')).toBe('1')
  })
})

describe('gridListings', () => {
  const items = [item('a'), item('f1', '1'), item('b'), item('f2', '2')]
  const placements = placementsById(items)

  it('leaves the featured cards out of the grid when nothing is filtered', () => {
    expect(gridListings(items, placements, false).map(i => i.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('shows every match, featured included, once a filter is on', () => {
    expect(gridListings(items, placements, true)).toEqual(items)
  })

  it('keeps the grid order untouched either way', () => {
    const filtered = [item('f2', '2'), item('a')]
    expect(gridListings(filtered, placements, true).map(i => i.id)).toEqual([
      'f2',
      'a',
    ])
    expect(gridListings(filtered, placements, false).map(i => i.id)).toEqual([
      'a',
    ])
  })
})
