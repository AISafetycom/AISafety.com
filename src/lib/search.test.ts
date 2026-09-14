import { describe, expect, it } from 'vitest'
import type { SearchEntry, SearchType } from './data/search-index'
import { typeForPath, withLiveEntries } from './search'

function entry(type: SearchType, title: string): SearchEntry {
  return {
    type,
    title,
    subtitle: '',
    description: '',
    category: '',
    url: '/',
    logo: null,
  }
}

describe('typeForPath', () => {
  it('maps a resource page to the search type of its listings', () => {
    expect(typeForPath('/map')).toBe('map')
    expect(typeForPath('/self-study')).toBe('course')
    expect(typeForPath('/founders')).toBe('founder')
  })

  it('is null for pages without listings', () => {
    expect(typeForPath('/')).toBeNull()
    expect(typeForPath('/about')).toBeNull()
    expect(typeForPath('/admin/preview')).toBeNull()
  })
})

describe('withLiveEntries', () => {
  const index = [
    entry('advisor', 'A'),
    entry('map', 'Old 1'),
    entry('map', 'Old 2'),
    entry('media', 'M'),
    entry('page', 'Home'),
  ]
  const titles = (entries: SearchEntry[]) => entries.map(e => e.title)

  it("replaces the type's entries where they were", () => {
    const out = withLiveEntries(index, 'map', [
      entry('map', 'New 1'),
      entry('map', 'New 2'),
      entry('map', 'New 3'),
    ])
    expect(titles(out)).toEqual(['A', 'New 1', 'New 2', 'New 3', 'M', 'Home'])
  })

  it('drops the type when the live read has nothing (all unpublished)', () => {
    expect(titles(withLiveEntries(index, 'map', []))).toEqual([
      'A',
      'M',
      'Home',
    ])
  })

  it('appends a type the index did not have', () => {
    const out = withLiveEntries(index, 'job', [entry('job', 'J')])
    expect(titles(out)).toEqual(['A', 'Old 1', 'Old 2', 'M', 'Home', 'J'])
  })

  it('leaves the index it was given untouched', () => {
    const before = titles(index)
    withLiveEntries(index, 'map', [entry('map', 'New')])
    expect(titles(index)).toEqual(before)
  })
})
