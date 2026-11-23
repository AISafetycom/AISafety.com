import { describe, expect, it } from 'vitest'
import { findLastUpdated, parsePolicy } from './parse'
import { LISTING_POLICY_MD } from './text'

describe('findLastUpdated', () => {
  it('reads the date and position of the "Last updated" line', () => {
    const blocks = parsePolicy(
      '# Title\n\nIntro.\n\nLast updated: 7 March 2026\n'
    )
    expect(findLastUpdated(blocks)).toEqual({ index: 2, iso: '2026-03-07' })
  })

  it('returns null when the policy has no "Last updated" line', () => {
    expect(findLastUpdated(parsePolicy('# Title\n\nIntro.\n'))).toBeNull()
  })

  it('throws when the line is there but its date is unreadable', () => {
    const blocks = parsePolicy('# Title\n\nLast updated: November 17, 2026\n')
    expect(() => findLastUpdated(blocks)).toThrow(/can't read the date/)
  })

  it('reads the date in the live policy text', () => {
    const found = findLastUpdated(parsePolicy(LISTING_POLICY_MD))
    expect(found?.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
