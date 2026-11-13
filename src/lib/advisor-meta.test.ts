import { describe, expect, it } from 'vitest'
import {
  APPLICATIONS,
  FOCUS_AREAS,
  WHO_ITS_FOR,
  focusLabel,
  isApplications,
  legacyFocus,
  whoItsForLabel,
} from './advisor-meta'

describe('whoItsForLabel', () => {
  it('lists who an advisor is for in lowercase, in the order given', () => {
    expect(whoItsForLabel(['Newcomers'])).toBe('For: newcomers')
    expect(whoItsForLabel(['Newcomers', 'Existing field members'])).toBe(
      'For: newcomers, existing field members'
    )
  })

  it('has nothing to show when the advisor has none', () => {
    expect(whoItsForLabel([])).toBeNull()
  })
})

describe('focusLabel', () => {
  it('lists the focus areas in lowercase, in the order given', () => {
    expect(focusLabel(['Career', 'Volunteering', 'Donating'])).toBe(
      'Focus: career, volunteering, donating'
    )
    expect(focusLabel(['Well-being'])).toBe('Focus: well-being')
  })

  it('has nothing to show when the advisor has none', () => {
    expect(focusLabel([])).toBeNull()
  })
})

describe('filter options', () => {
  it('knows the two application options and nothing else', () => {
    expect(APPLICATIONS.every(isApplications)).toBe(true)
    expect(isApplications('')).toBe(false)
    expect(isApplications('Maybe')).toBe(false)
  })

  it('lists every option once', () => {
    for (const options of [WHO_ITS_FOR, FOCUS_AREAS, APPLICATIONS]) {
      expect(new Set(options).size).toBe(options.length)
    }
  })
})

// The old Focus value Data API v1 serves as `focus`, worked out the way the
// bots kept the deleted Focus field in step (28 October 2026).
describe('legacyFocus', () => {
  it('is Career/contribution when the focus areas include Career or Founding', () => {
    expect(legacyFocus(['Career'])).toBe('Career/contribution')
    expect(legacyFocus(['Founding'])).toBe('Career/contribution')
    expect(legacyFocus(['Career', 'Research'])).toBe('Career/contribution')
    expect(legacyFocus(['Well-being', 'Founding'])).toBe('Career/contribution')
  })

  it('is Other for every other mix', () => {
    expect(legacyFocus(['Well-being'])).toBe('Other')
    expect(legacyFocus(['Research', 'Legal', 'Visas'])).toBe('Other')
    expect(legacyFocus(['Volunteering'])).toBe('Other')
  })

  it('is empty with no focus areas, as an empty field was', () => {
    expect(legacyFocus([])).toBe('')
  })
})
