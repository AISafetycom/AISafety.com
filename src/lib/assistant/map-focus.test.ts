import { describe, expect, it } from 'vitest'
import { firstMapOrgId } from './map-focus'

describe('firstMapOrgId', () => {
  it('finds the first org card', () => {
    const answer =
      'Yes, it is on the map.\n[[card:org:recAAA111|Runs courses]]\n[[card:org:recBBB222]]'
    expect(firstMapOrgId(answer, [])).toBe('recAAA111')
  })

  it('skips cards of other types', () => {
    const answer =
      '[[card:training:recTRN001|A course]] and [[card:org:recORG002]]'
    expect(firstMapOrgId(answer, [])).toBe('recORG002')
  })

  it('reads inline id tokens too', () => {
    expect(firstMapOrgId('See [[id:org:recORG003]].', [])).toBe('recORG003')
  })

  it('counts a card without a type when the search returned it as an org', () => {
    const answer = '[[card:recCOM004]] [[card:recORG005]]'
    const listings = [
      { id: 'community:recCOM004', type: 'community' },
      { id: 'org:recORG005', type: 'org' },
    ]
    expect(firstMapOrgId(answer, listings)).toBe('recORG005')
  })

  it('accepts a doubled type prefix', () => {
    expect(firstMapOrgId('[[card:org:org:recORG006]]', [])).toBe('recORG006')
  })

  it('returns null when no org is shown', () => {
    expect(firstMapOrgId('The Field map lists many labs.', [])).toBeNull()
    expect(firstMapOrgId('[[card:event:recEVT007]]', [])).toBeNull()
  })
})
