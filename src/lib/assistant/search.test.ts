import { describe, expect, it } from 'vitest'
import { searchCatalog } from './search'
import type { Catalog, Listing } from './types'

function candidateListing(id: string, country: string): Listing {
  return {
    id: `candidate:${id}`,
    type: 'candidate',
    name: id,
    description: '',
    url: '#',
    pageUrl: '/hire',
    meta: { country },
  }
}

function catalogOf(listings: Listing[]): Catalog {
  return { listings, generatedAt: new Date().toISOString() }
}

describe('searchCatalog — country filter region aliasing', () => {
  it('a region name matches every listing whose country is a member of it', async () => {
    const catalog = catalogOf([
      candidateListing('priya', 'UK'),
      candidateListing('hannah', 'Germany'),
      candidateListing('mei-lin', 'Canada'),
      candidateListing('fatima', 'UAE'),
    ])
    const hits = await searchCatalog(catalog, {
      type: 'candidate',
      filters: { country: 'Europe' },
    })
    expect(hits.map(h => h.listing.id).sort()).toEqual([
      'candidate:hannah',
      'candidate:priya',
    ])
  })

  it('is case-insensitive on the region name', async () => {
    const catalog = catalogOf([candidateListing('priya', 'UK')])
    const hits = await searchCatalog(catalog, {
      type: 'candidate',
      filters: { country: 'europe' },
    })
    expect(hits).toHaveLength(1)
  })

  it('still does a plain substring match for a literal country', async () => {
    const catalog = catalogOf([
      candidateListing('priya', 'UK'),
      candidateListing('mei-lin', 'Canada'),
    ])
    const hits = await searchCatalog(catalog, {
      type: 'candidate',
      filters: { country: 'Canada' },
    })
    expect(hits.map(h => h.listing.id)).toEqual(['candidate:mei-lin'])
  })

  it('an OR array of regions unions their members', async () => {
    const catalog = catalogOf([
      candidateListing('priya', 'UK'),
      candidateListing('mei-lin', 'Canada'),
      candidateListing('ananya', 'India'),
    ])
    const hits = await searchCatalog(catalog, {
      type: 'candidate',
      filters: { country: ['Europe', 'North America'] },
    })
    expect(hits.map(h => h.listing.id).sort()).toEqual([
      'candidate:mei-lin',
      'candidate:priya',
    ])
  })
})
