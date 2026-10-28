import { describe, expect, it, vi } from 'vitest'
import {
  acceptingApplicationsText,
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

// The wording the bots kept the old "Accepting applications?" field in step
// with until it was deleted (28 October 2026); Data API v1 serves it as
// acceptingApplications, so it must not change.
describe('acceptingApplicationsText', () => {
  it('gives an open funder with a Deadline its closing date, month in full', () => {
    expect(acceptingApplicationsText('Applications open', '2026-10-31')).toBe(
      'Applications close 31 October 2026'
    )
    expect(acceptingApplicationsText('Applications open', '2026-07-01')).toBe(
      'Applications close 1 July 2026'
    )
    expect(acceptingApplicationsText('Applications open', '2027-09-09')).toBe(
      'Applications close 9 September 2027'
    )
  })

  it('reads the date it writes', () => {
    for (const d of ['2026-01-05', '2026-02-28', '2026-12-31']) {
      expect(
        applicationsCloseDate(acceptingApplicationsText('Applications open', d))
      ).toBe(d)
    }
  })

  it('gives an open funder with no Deadline a rolling basis', () => {
    expect(acceptingApplicationsText('Applications open', null)).toBe(
      'Applications on a rolling basis'
    )
  })

  it('gives both closed statuses the one closed wording', () => {
    for (const status of [
      'Not currently accepting applications',
      'Invite only, no applications',
    ]) {
      expect(acceptingApplicationsText(status, null)).toBe(
        'Not accepting applications'
      )
      // A Deadline left on a closed funder changes nothing.
      expect(acceptingApplicationsText(status, '2026-10-31')).toBe(
        'Not accepting applications'
      )
    }
  })

  it('gives a blank or unknown status nothing, as an empty field did', () => {
    expect(acceptingApplicationsText('', null)).toBe('')
    expect(acceptingApplicationsText('', '2026-10-31')).toBe('')
    expect(acceptingApplicationsText('Opening soon', null)).toBe('')
  })

  it('passes a Deadline that is not a date through as given', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(acceptingApplicationsText('Applications open', 'next week')).toBe(
      'Applications close next week'
    )
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('turns a passed closing date into not accepting, the closing day still open', () => {
    const text = acceptingApplicationsText('Applications open', '2026-10-23')
    expect(resolveAcceptingApplications(text, '2026-10-23')).toBe(
      'Applications close 23 October 2026'
    )
    expect(resolveAcceptingApplications(text, '2026-10-24')).toBe(
      'Not accepting applications'
    )
  })
})
