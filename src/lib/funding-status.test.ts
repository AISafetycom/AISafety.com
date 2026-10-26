import { describe, expect, it } from 'vitest'
import {
  applicationsCloseDate,
  isAcceptingApplications,
  resolveAcceptingApplications,
} from './funding-status'

describe('applicationsCloseDate', () => {
  it('reads the dated wording', () => {
    expect(applicationsCloseDate('Applications close 23 October 2026')).toBe(
      '2026-10-23'
    )
    expect(applicationsCloseDate('Applications close 1 July 2026')).toBe(
      '2026-07-01'
    )
  })

  it('returns null for every other wording', () => {
    expect(applicationsCloseDate('Applications on a rolling basis')).toBeNull()
    expect(applicationsCloseDate('Accepting applications')).toBeNull()
    expect(applicationsCloseDate('Not accepting applications')).toBeNull()
    expect(applicationsCloseDate('Applications close soon')).toBeNull()
    expect(
      applicationsCloseDate('Applications close 23 Octember 2026')
    ).toBeNull()
  })
})

describe('resolveAcceptingApplications', () => {
  it('shows a passed closing date as not accepting', () => {
    expect(
      resolveAcceptingApplications(
        'Applications close 23 October 2026',
        '2026-10-24'
      )
    ).toBe('Not accepting applications')
  })

  it('keeps the wording while the date is ahead, including the closing day', () => {
    expect(
      resolveAcceptingApplications(
        'Applications close 23 October 2026',
        '2026-10-23'
      )
    ).toBe('Applications close 23 October 2026')
    expect(
      resolveAcceptingApplications(
        'Applications close 23 October 2026',
        '2026-10-01'
      )
    ).toBe('Applications close 23 October 2026')
  })

  it('leaves undated wordings alone', () => {
    for (const s of [
      'Applications on a rolling basis',
      'Accepting applications',
      'Not accepting applications',
      'No',
    ]) {
      expect(resolveAcceptingApplications(s, '2030-01-01')).toBe(s)
    }
  })

  it('feeds the open/closed check', () => {
    const resolved = resolveAcceptingApplications(
      'Applications close 1 July 2026',
      '2026-10-26'
    )
    expect(isAcceptingApplications(resolved)).toBe(false)
    expect(
      isAcceptingApplications(
        resolveAcceptingApplications(
          'Applications close 1 July 2026',
          '2026-06-01'
        )
      )
    ).toBe(true)
  })
})
