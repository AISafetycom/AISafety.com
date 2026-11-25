import { describe, expect, it } from 'vitest'
import type { SearchEntry } from '@/lib/data/search-index'
import { findListing, pickableListings } from './listing-pick'

function entry(over: Partial<SearchEntry>): SearchEntry {
  return {
    type: 'event',
    title: 'Untitled',
    subtitle: '',
    description: '',
    category: '',
    url: '',
    logo: null,
    ...over,
  }
}

const index: SearchEntry[] = [
  entry({ type: 'event', title: 'AI Safety Camp', id: 'recEvent0000000001' }),
  entry({ type: 'training', title: 'ARENA', id: 'recTrain0000000001' }),
  entry({
    type: 'training',
    title: 'ARENA',
    id: 'recTrain0000000002',
    recurring: true,
  }),
  entry({
    type: 'funder',
    title: 'Open Philanthropy',
    id: 'recFund00000000001',
  }),
  entry({ type: 'map', title: 'Open Philanthropy', id: 'recMap000000000001' }),
  entry({ type: 'job', title: 'Research Engineer', id: 'recJob000000000001' }),
  entry({ type: 'page', title: 'Events', url: '/events' }),
]

describe('pickableListings', () => {
  it("lists every page's listings, each title once per page, without jobs or pages", () => {
    expect(
      pickableListings(index).map(l => `${l.resource}: ${l.title}`)
    ).toEqual([
      'Events: AI Safety Camp',
      'Training programs: ARENA',
      'Recurring training programs: ARENA',
      'Funding: Open Philanthropy',
      'Field map: Open Philanthropy',
    ])
  })

  it("keeps to one page's listings when its page is chosen", () => {
    expect(pickableListings(index, 'Funding').map(l => l.id)).toEqual([
      'recFund00000000001',
    ])
  })

  it('keeps recurring programs and upcoming cohorts apart', () => {
    expect(
      pickableListings(index, 'Recurring training programs').map(l => l.id)
    ).toEqual(['recTrain0000000002'])
    expect(pickableListings(index, 'Training programs').map(l => l.id)).toEqual(
      ['recTrain0000000001']
    )
  })
  it('knows a recurring program in an older copy of the index by its details', () => {
    const old = [
      entry({
        type: 'training',
        title: 'AISB',
        id: 'recTrain0000000003',
        category: 'Recurring · Bootcamp · London',
      }),
    ]
    expect(pickableListings(old, 'Recurring training programs')).toHaveLength(1)
    expect(pickableListings(old, 'Training programs')).toHaveLength(0)
  })
})

describe('findListing', () => {
  const all = pickableListings(index)

  it('finds the listing with that title, ignoring case and spaces', () => {
    expect(findListing(all, '  ai safety camp ')).toEqual({
      id: 'recEvent0000000001',
      title: 'AI Safety Camp',
      resource: 'Events',
      logo: null,
    })
  })

  it('finds nothing for a name that is no listing', () => {
    expect(findListing(all, 'AI Safety Cam')).toBeUndefined()
    expect(findListing(all, '')).toBeUndefined()
  })

  it('says when listings on two pages share the name', () => {
    expect(findListing(all, 'Open Philanthropy')).toBe('ambiguous')
    expect(
      findListing(pickableListings(index, 'Field map'), 'Open Philanthropy')
    ).toEqual({
      id: 'recMap000000000001',
      title: 'Open Philanthropy',
      resource: 'Field map',
      logo: null,
    })
  })
})
