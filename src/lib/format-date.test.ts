import { describe, expect, it } from 'vitest'
import { formatShortDate, formatTimeAgo } from './format-date'

describe('formatShortDate', () => {
  it('writes day, short month and year', () => {
    expect(formatShortDate(new Date('2026-10-31'))).toBe('31 Oct 2026')
  })

  it('abbreviates September as "Sep", not "Sept"', () => {
    expect(formatShortDate(new Date('2026-09-04'))).toBe('4 Sep 2026')
  })
})

describe('formatTimeAgo', () => {
  const now = new Date('2026-08-22T12:00:00Z')

  it('reads "just now" under a minute', () => {
    expect(formatTimeAgo('2026-08-22T11:59:30Z', now)).toBe('just now')
  })

  it('uses minutes under an hour, singular and plural', () => {
    expect(formatTimeAgo('2026-08-22T11:58:59Z', now)).toBe('1 minute ago')
    expect(formatTimeAgo('2026-08-22T11:35:00Z', now)).toBe('25 minutes ago')
    expect(formatTimeAgo('2026-08-22T11:00:01Z', now)).toBe('59 minutes ago')
  })

  it('uses hours under a day, singular and plural', () => {
    expect(formatTimeAgo('2026-08-22T11:00:00Z', now)).toBe('1 hour ago')
    expect(formatTimeAgo('2026-08-22T01:00:00Z', now)).toBe('11 hours ago')
  })

  it('uses days from 24 hours on', () => {
    expect(formatTimeAgo('2026-08-21T12:00:00Z', now)).toBe('1 day ago')
    expect(formatTimeAgo('2026-08-19T11:00:00Z', now)).toBe('3 days ago')
  })

  it('rejects an unparseable date instead of rendering garbage', () => {
    expect(() => formatTimeAgo('not-a-date', now)).toThrow('invalid date')
  })
})
