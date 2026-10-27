import { describe, expect, it } from 'vitest'
import {
  APPLICATIONS,
  FOCUS_AREAS,
  WHO_ITS_FOR,
  focusLabel,
  isApplications,
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
