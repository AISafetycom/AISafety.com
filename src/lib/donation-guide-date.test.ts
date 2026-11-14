import { describe, expect, it } from 'vitest'
import {
  DONATION_GUIDE_LAST_UPDATED,
  guideShownDate,
} from './donation-guide-date'

describe('guideShownDate', () => {
  it('shows the older date for the publish that only moved the guide into the editor', () => {
    expect(guideShownDate('2026-09-15T17:07:16.521Z')).toBe(
      '2025-12-01T00:00:00.000Z'
    )
  })

  it('shows the publish time for every other publish', () => {
    expect(guideShownDate('2026-12-01T09:30:00.000Z')).toBe(
      '2026-12-01T09:30:00.000Z'
    )
  })

  it('leaves the seed date alone', () => {
    expect(guideShownDate(DONATION_GUIDE_LAST_UPDATED)).toBe(
      DONATION_GUIDE_LAST_UPDATED
    )
  })
})
