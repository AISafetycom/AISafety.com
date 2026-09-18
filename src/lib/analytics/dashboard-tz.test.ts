import { describe, expect, it } from 'vitest'
import { DASHBOARD_TZ, dashboardDay, dashboardOffset } from './events'

describe('dashboard time zone', () => {
  it('is UTC, so days and offsets never depend on where anyone is', () => {
    expect(DASHBOARD_TZ).toBe('UTC')
    expect(dashboardDay(Date.parse('2026-09-05T23:30:00Z'))).toBe('2026-09-05')
    expect(dashboardDay(Date.parse('2026-09-06T00:10:00Z'))).toBe('2026-09-06')
    expect(dashboardOffset('2026-01-15')).toBe('+00:00')
    expect(dashboardOffset('2026-07-15')).toBe('+00:00')
  })

  it('turns a calendar date into the right epoch bounds', () => {
    const day = '2026-09-05'
    expect(Date.parse(`${day}T00:00:00${dashboardOffset(day)}`)).toBe(
      Date.parse('2026-09-05T00:00:00Z')
    )
  })
})
