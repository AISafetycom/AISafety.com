import { describe, expect, it } from 'vitest'
import { laterSince, laterUntil, reviewAgainAt } from './queue-later'

const NOW = Date.parse('2026-10-08T18:00:00.000Z')

describe('reviewAgainAt', () => {
  it('is a week on', () => {
    expect(reviewAgainAt(NOW)).toBe('2026-10-15T18:00:00.000Z')
  })
})

describe('laterUntil', () => {
  const at = '2026-10-15T18:00:00.000Z'
  it('holds an open item until its date', () => {
    expect(laterUntil({ status: 'Pending', reviewAgainOn: at }, NOW)).toBe(at)
    expect(laterUntil({ status: 'Failed', reviewAgainOn: at }, NOW)).toBe(at)
  })
  it('lets it back once the date has come', () => {
    expect(
      laterUntil(
        { status: 'Pending', reviewAgainOn: at },
        Date.parse('2026-10-15T18:00:00.000Z')
      )
    ).toBeNull()
  })
  it('ignores a decided item, and one never set aside', () => {
    expect(laterUntil({ status: 'Applied', reviewAgainOn: at }, NOW)).toBeNull()
    expect(
      laterUntil({ status: 'Pending', reviewAgainOn: null }, NOW)
    ).toBeNull()
    expect(
      laterUntil({ status: 'Pending', reviewAgainOn: 'not a date' }, NOW)
    ).toBeNull()
  })
})

describe('laterSince', () => {
  it('is the week before the return date', () => {
    expect(laterSince('2026-10-15T18:00:00.000Z')).toBe(
      '2026-10-08T18:00:00.000Z'
    )
  })
})
