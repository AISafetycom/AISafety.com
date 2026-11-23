import { describe, expect, it } from 'vitest'
import { mapArea, mapOrgCardProps } from './card'

const org = {
  title: 'Org',
  description: 'desc',
  logo: null,
  link: 'https://example.org',
}

describe('mapOrgCardProps', () => {
  it('shows an active org its categories only', () => {
    const { meta } = mapOrgCardProps({
      ...org,
      category: 'Governance, Advocacy',
      status: 'Active',
    })
    expect(meta.map(m => m.value)).toEqual(['Governance, Advocacy'])
  })
  it('shows a shut-down org its categories, then "No longer active"', () => {
    const { meta } = mapOrgCardProps({
      ...org,
      category: 'Funding',
      status: 'Inactive',
    })
    expect(meta.map(m => [m.label, m.value])).toEqual([
      ['Category', 'Funding'],
      ['Status', 'No longer active'],
    ])
    expect(meta[1].icon).toBe('/images/icons/x-in-circle.svg')
  })
  it('never shows "No longer active" as a category', () => {
    const { meta } = mapOrgCardProps({
      ...org,
      category: 'No longer active',
      status: 'Inactive',
    })
    expect(meta.map(m => m.label)).toEqual(['Status'])
  })
})

describe('mapArea', () => {
  it('reports "No longer active" for a shut-down org', () => {
    expect(mapArea({ category: 'Funding', status: 'Inactive' })).toBe(
      'No longer active'
    )
    expect(mapArea({ category: 'Funding, Resource', status: 'Active' })).toBe(
      'Funding'
    )
  })
})
