import { describe, expect, it } from 'vitest'
import { approxPeriodEnd, lastDayListed } from './training-listing'

describe('lastDayListed', () => {
  it('is the start date for a program with exact dates', () => {
    expect(lastDayListed('2026-10-19', null)).toBe('2026-10-19')
    expect(lastDayListed('2026-10-19', '  ')).toBe('2026-10-19')
  })

  it('is null without a start date', () => {
    expect(lastDayListed(null, 'October 2026')).toBeNull()
  })

  it('runs to the end of the rough period when the timing is approximate', () => {
    // DISPATCH, October 2026: anchored to the 1st, it would have left on 2 October.
    expect(lastDayListed('2026-10-01', 'October 2026')).toBe('2026-10-31')
  })
})

describe('approxPeriodEnd', () => {
  // Wording as it sits in the Training table on 15 October 2026.
  it.each([
    ['2026-10-01', 'October 2026', '2026-10-31'],
    ['2026-11-01', 'November 2026', '2026-11-30'],
    ['2026-11-01', 'in November 2026', '2026-11-30'],
    ['2026-09-01', 'early September 2026', '2026-09-30'],
    ['2026-09-15', 'mid-September 2026', '2026-09-30'],
    ['2026-10-01', 'beginning of October 2026', '2026-10-31'],
    ['2027-01-01', 'January 2027', '2027-01-31'],
    ['2026-09-14', 'week of 14 September', '2026-09-20'],
    ['2026-09-21', 'week of 21 September', '2026-09-27'],
    ['2027-01-01', '2027', '2027-12-31'],
    ['2027-01-01', 'in 2027', '2027-12-31'],
  ])('%s + "%s" → %s', (anchor, wording, end) => {
    expect(approxPeriodEnd(anchor, wording)).toBe(end)
  })

  it('takes the last month of a range, with the year written after it', () => {
    expect(approxPeriodEnd('2026-10-01', 'October to December 2026')).toBe(
      '2026-12-31'
    )
    expect(approxPeriodEnd('2026-10-01', 'Oct–Dec')).toBe('2026-12-31')
    expect(
      approxPeriodEnd('2026-12-01', 'December 2026 to February 2027')
    ).toBe('2027-02-28')
  })

  it('rolls a range without a year into the next year', () => {
    expect(approxPeriodEnd('2026-11-01', 'November to February')).toBe(
      '2027-02-28'
    )
  })

  it('reads the week either way round, and a first week as its month', () => {
    expect(approxPeriodEnd('2026-09-14', 'week of September 14, 2026')).toBe(
      '2026-09-20'
    )
    expect(approxPeriodEnd('2027-06-01', 'first week of June 2027')).toBe(
      '2027-06-30'
    )
  })

  it('reads quarters, halves, and seasons', () => {
    expect(approxPeriodEnd('2027-01-01', 'Q1 2027')).toBe('2027-03-31')
    expect(approxPeriodEnd('2027-07-01', 'second half of 2027')).toBe(
      '2027-12-31'
    )
    expect(approxPeriodEnd('2027-06-01', 'summer 2027')).toBe('2027-08-31')
    expect(approxPeriodEnd('2026-09-01', 'fall 2026')).toBe('2026-11-30')
    expect(approxPeriodEnd('2026-12-01', 'winter 2026')).toBe('2027-02-28')
  })

  it('runs a year written alone, or with a qualifier, to its end', () => {
    expect(approxPeriodEnd('2026-09-01', 'late 2026')).toBe('2026-12-31')
  })

  it('ignores "may" the verb but reads May the month', () => {
    expect(approxPeriodEnd('2026-10-01', 'October 2026 (dates may move)')).toBe(
      '2026-10-31'
    )
    expect(approxPeriodEnd('2027-05-01', 'May 2027')).toBe('2027-05-31')
  })

  it("falls back to the anchor's month for wording it can't read", () => {
    expect(approxPeriodEnd('2026-10-01', 'soon')).toBe('2026-10-31')
  })

  it('never ends before the anchor', () => {
    expect(approxPeriodEnd('2026-10-01', 'September 2026')).toBe('2026-10-01')
  })
})
