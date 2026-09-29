import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AnalyticsEvent } from './events'

// An in-memory stand-in for Upstash: lists keep the newest event at index 0
// (LPUSH order), like the real month lists. Every client instance shares the
// same data, as the store and the bulk reader share one database.
const lists = new Map<string, AnalyticsEvent[]>()
const lrangeCalls: { key: string; start: number; stop: number }[] = []

function at(list: AnalyticsEvent[], i: number): number {
  return i < 0 ? list.length + i : i
}

vi.mock('@upstash/redis', () => {
  class FakeRedis {
    async zrange() {
      return [...lists.keys()]
        .filter(k => k.startsWith('aisafety:analytics:events:'))
        .map(k => k.slice('aisafety:analytics:events:'.length))
        .sort()
    }
    async lrange(key: string, start: number, stop: number) {
      lrangeCalls.push({ key, start, stop })
      const list = lists.get(key) ?? []
      return list.slice(Math.max(0, at(list, start)), at(list, stop) + 1)
    }
    async lindex(key: string, i: number) {
      const list = lists.get(key) ?? []
      return list[at(list, i)] ?? null
    }
    async exists() {
      return 1
    }
    pipeline() {
      const ops: (() => unknown)[] = []
      const p = {
        llen(key: string) {
          ops.push(() => (lists.get(key) ?? []).length)
          return p
        },
        hmget() {
          ops.push(() => null)
          return p
        },
        async exec() {
          return ops.map(op => op())
        },
      }
      return p
    }
  }
  return { Redis: FakeRedis }
})

const MONTH = '2026-09'
const KEY = `aisafety:analytics:events:${MONTH}`
let n = 0
function click(): AnalyticsEvent {
  n += 1
  return {
    type: 'listing_click',
    page: 'Events',
    label: `Listing ${n % 7}`,
    vid: `v${n}`,
    ts: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
  }
}
function add(count: number) {
  const list = lists.get(KEY) ?? []
  for (let i = 0; i < count; i++) list.unshift(click())
  lists.set(KEY, list)
}

let readDashboard: typeof import('./events').readDashboard
beforeAll(async () => {
  process.env.KV_REST_API_URL = 'https://fake.upstash.test'
  process.env.KV_REST_API_TOKEN = 'fake'
  ;({ readDashboard } = await import('./events'))
})

const ALL = { startMs: null, endMs: null }
const clicksIn = async () =>
  (await readDashboard(ALL, 'Events', false)).byPage.find(
    p => p.name === 'Events'
  )?.count

describe('month cache', () => {
  it('downloads only new events on a repeat load, and re-reads after a hand cleanup', async () => {
    add(12_000)
    expect(await clicksIn()).toBe(12_000)
    // A cold read covers the whole list in 5,000-event slices.
    expect(lrangeCalls).toHaveLength(3)

    // Nothing new: no slice is downloaded at all.
    lrangeCalls.length = 0
    expect(await clicksIn()).toBe(12_000)
    expect(lrangeCalls).toHaveLength(0)

    // New events: only they are downloaded, and they're counted.
    add(40)
    lrangeCalls.length = 0
    expect(await clicksIn()).toBe(12_040)
    expect(lrangeCalls).toEqual([{ key: KEY, start: -12_040, stop: -12_001 }])

    // Someone removes junk from the middle by hand, then more arrives: the
    // cached copy no longer lines up, so the month is read again in full.
    lists.get(KEY)!.splice(500, 100)
    add(10)
    lrangeCalls.length = 0
    expect(await clicksIn()).toBe(11_950)
    expect(lrangeCalls).toHaveLength(3)
  })

  it('shares one download between loads that arrive together', async () => {
    add(5)
    lrangeCalls.length = 0
    const counts = await Promise.all([clicksIn(), clicksIn(), clicksIn()])
    expect(counts).toEqual([11_955, 11_955, 11_955])
    expect(lrangeCalls).toHaveLength(1)
  })
})
