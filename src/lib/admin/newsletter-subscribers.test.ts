import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { historyStale, type ListHistory } from './newsletter-subscribers'

const NOW = Date.parse('2026-10-28T12:00:00Z')
const HOUR_MS = 3_600_000

const kept = (builtAt: number, lists: string[]): ListHistory => ({
  v: 1,
  builtAt,
  unplaced: 0,
  days: Object.fromEntries(lists.map(l => [l, [{ t: NOW, n: 1 }]])),
})

describe('historyStale', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.stubEnv('ACTIVECAMPAIGN_URL', 'https://example.api-us1.com')
    vi.stubEnv('ACTIVECAMPAIGN_KEY', 'test')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('works the figures out when there are none or they are three hours old', () => {
    expect(historyStale(null)).toBe(true)
    expect(historyStale(kept(NOW - 2 * HOUR_MS, ['6', '7', '8']))).toBe(false)
    expect(historyStale(kept(NOW - 4 * HOUR_MS, ['6', '7', '8']))).toBe(true)
  })

  it('works them out again at once when a list has moved since', () => {
    expect(historyStale(kept(NOW - HOUR_MS, ['6', '7']))).toBe(true)
  })

  it('leaves them alone without ActiveCampaign', () => {
    vi.stubEnv('ACTIVECAMPAIGN_KEY', '')
    expect(historyStale(null)).toBe(false)
  })
})
