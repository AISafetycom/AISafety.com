import { describe, expect, it } from 'vitest'
import { lastCompleteMonth } from './events'

describe('lastCompleteMonth', () => {
  it('is the calendar month before the current one, in UTC', () => {
    const { month, range } = lastCompleteMonth(Date.UTC(2026, 8, 19, 14, 0))
    expect(month).toBe('2026-08')
    expect(range.startMs).toBe(Date.UTC(2026, 7, 1))
    expect(range.endMs).toBe(Date.UTC(2026, 8, 1) - 1)
  })

  it('rolls back over a year boundary', () => {
    const { month, range } = lastCompleteMonth(Date.UTC(2027, 0, 1, 0, 0, 1))
    expect(month).toBe('2026-12')
    expect(range.startMs).toBe(Date.UTC(2026, 11, 1))
    expect(range.endMs).toBe(Date.UTC(2027, 0, 1) - 1)
  })

  it('switches at the first instant of a new month', () => {
    expect(lastCompleteMonth(Date.UTC(2026, 9, 1, 0, 0, 0)).month).toBe(
      '2026-09'
    )
    expect(lastCompleteMonth(Date.UTC(2026, 9, 1, 0, 0, 0) - 1).month).toBe(
      '2026-08'
    )
  })
})
