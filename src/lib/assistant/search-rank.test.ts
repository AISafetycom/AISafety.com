import { describe, expect, it } from 'vitest'
import {
  SAME_PLACE_KM,
  activityRank,
  filterValueMatches,
  placeBand,
} from './search-rank'

describe('filterValueMatches', () => {
  it('matches an activity level on the whole label', () => {
    // The real slip: a search for active London groups also returned a
    // semi-active and an inactive one, because "active" is inside both words.
    expect(filterValueMatches('activityLevel', 'Active', 'Active')).toBe(true)
    expect(filterValueMatches('activityLevel', 'Semi-active', 'Active')).toBe(
      false
    )
    expect(filterValueMatches('activityLevel', 'Inactive', 'Active')).toBe(
      false
    )
    expect(
      filterValueMatches('activityLevel', 'Semi-active', 'semi-active')
    ).toBe(true)
  })

  it('matches a status on the whole label', () => {
    expect(filterValueMatches('status', 'Active', 'active')).toBe(true)
    expect(filterValueMatches('status', 'Inactive', 'Active')).toBe(false)
    expect(filterValueMatches('status', 'No longer active', 'Active')).toBe(
      false
    )
  })

  it('keeps the substring match for every other key', () => {
    expect(
      filterValueMatches('cost', 'Free (assistance available)', 'Free')
    ).toBe(true)
    expect(filterValueMatches('location', 'London, UK', 'uk')).toBe(true)
    expect(filterValueMatches('skillSet', 'Policy, Research', 'Research')).toBe(
      true
    )
    expect(filterValueMatches('mode', 'Online or in person', 'In person')).toBe(
      true
    )
    expect(filterValueMatches('location', 'London, UK', 'Berlin')).toBe(false)
  })

  it('never matches an empty value', () => {
    expect(filterValueMatches('location', 'London, UK', '  ')).toBe(false)
  })
})

describe('placeBand', () => {
  it('puts listings in one city in the same band', () => {
    expect(placeBand(1.1)).toBe(placeBand(3.6))
  })

  it('still separates places that are far apart', () => {
    expect(placeBand(3.6)).toBeLessThan(placeBand(SAME_PLACE_KM + 5))
    expect(placeBand(80)).toBeLessThan(placeBand(400))
  })
})

describe('activityRank', () => {
  it('orders active, then semi-active, then inactive', () => {
    expect(activityRank('Active')).toBeLessThan(activityRank('Semi-active'))
    expect(activityRank('Semi-active')).toBeLessThan(activityRank('Inactive'))
  })

  it('ranks a listing with no activity level with the active ones', () => {
    expect(activityRank(undefined)).toBe(activityRank('Active'))
    expect(activityRank('')).toBe(activityRank('Active'))
  })
})
