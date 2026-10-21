import { beforeAll, describe, expect, it, vi } from 'vitest'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { AnalyticsEvent } from './events'

// An in-memory stand-in for Upstash: lists keep the newest event at index 0
// (LPUSH order), like the real month lists. Every client instance shares the
// same data, as the store and the bulk reader share one database.
const lists = new Map<string, AnalyticsEvent[]>()
const lrangeCalls: { key: string; start: number; stop: number }[] = []
// First-seen lookups: one batch per site-wide build of a ranged view.
let hmgetCalls = 0
// Plain string keys (the saved copy of the default view).
const strings = new Map<string, string>()

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
    async get(key: string) {
      return strings.get(key) ?? null
    }
    async set(key: string, value: string) {
      strings.set(key, value)
      return 'OK'
    }
    pipeline() {
      const ops: (() => unknown)[] = []
      const p = {
        llen(key: string) {
          ops.push(() => (lists.get(key) ?? []).length)
          return p
        },
        hmget() {
          hmgetCalls += 1
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
let saveViewCopy: typeof import('./events').saveViewCopy
let savedViewWhileCold: typeof import('./events').savedViewWhileCold
beforeAll(async () => {
  process.env.KV_REST_API_URL = 'https://fake.upstash.test'
  process.env.KV_REST_API_TOKEN = 'fake'
  ;({ readDashboard, saveViewCopy, savedViewWhileCold } =
    await import('./events'))
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

describe('site view cache', () => {
  const SINCE = { startMs: Date.UTC(2026, 8, 1), endMs: null }
  const eventsClicks = (d: Awaited<ReturnType<typeof readDashboard>>) =>
    d.byPage.find(p => p.name === 'Events')?.count

  it('works the site-wide figures out once for every tab, and again once an event arrives', async () => {
    // A page view, so the build looks its visitor's first visit up.
    n += 1
    lists.get(KEY)!.unshift({
      type: 'page_view',
      page: '/events',
      vid: `v${n}`,
      ts: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
    })
    hmgetCalls = 0
    const events = await readDashboard(SINCE, 'Events')
    const built = hmgetCalls
    expect(built).toBeGreaterThan(0)

    // Other tabs, and tabs loading together, reuse that build.
    const [funding, overview] = await Promise.all([
      readDashboard(SINCE, 'Funding'),
      readDashboard(SINCE),
    ])
    expect(hmgetCalls).toBe(built)
    expect(funding.selectedPage).toBe('Funding')
    expect(funding.topListings).toEqual([])
    expect(overview.byPage).toEqual(events.byPage)
    expect(events.topListings.length).toBeGreaterThan(0)

    // The other count mode is its own build.
    await readDashboard(SINCE, 'Events', false)
    expect(hmgetCalls).toBe(2 * built)

    // A new event means fresh figures, never the cached ones.
    add(1)
    const after = await readDashboard(SINCE, 'Funding')
    expect(hmgetCalls).toBeGreaterThan(2 * built)
    expect(eventsClicks(after)).toBe(eventsClicks(events)! + 1)
  })
})

describe('saved copy of the default view', () => {
  const RANGE = { startMs: Date.UTC(2026, 8, 1), endMs: null }

  it('gives a fresh server the copy a warm one saved, only while it has to read', async () => {
    const live = await readDashboard(RANGE, 'Events')
    await saveViewCopy(RANGE, '30d', true, ['Events', 'Funding'])
    // This server has the months in memory, so the live figures win.
    expect(await savedViewWhileCold(RANGE, '30d', true, 'Events')).toBeNull()

    // A fresh server: same store, nothing read yet.
    vi.resetModules()
    const fresh = await import('./events')
    const copy = await fresh.savedViewWhileCold(RANGE, '30d', true, 'Events')
    expect(copy?.data).toEqual(live)
    // Only the view it saved: not another range, count mode or source
    // filter, nor a page it holds no panels for.
    expect(await fresh.savedViewWhileCold(RANGE, '7d', true)).toBeNull()
    expect(
      await fresh.savedViewWhileCold(RANGE, '30d', false, 'Events')
    ).toBeNull()
    expect(
      await fresh.savedViewWhileCold(RANGE, '30d', true, 'Events', 'list')
    ).toBeNull()
    expect(
      await fresh.savedViewWhileCold(RANGE, '30d', true, 'Jobs')
    ).toBeNull()

    // A copy written by other code (another commit) is never shown.
    const key = [...strings.keys()].find(k => k.includes('saved-view'))!
    const saved = JSON.parse(
      gunzipSync(Buffer.from(strings.get(key)!, 'base64')).toString('utf8')
    )
    strings.set(
      key,
      gzipSync(JSON.stringify({ ...saved, build: 'another-commit' })).toString(
        'base64'
      )
    )
    expect(
      await fresh.savedViewWhileCold(RANGE, '30d', true, 'Events')
    ).toBeNull()

    // Once this server has read the months, it stops offering the copy.
    await fresh.readDashboard(RANGE, 'Events')
    expect(
      await fresh.savedViewWhileCold(RANGE, '30d', true, 'Events')
    ).toBeNull()
  })
})

describe('clicks on pages the live site does not have', () => {
  it('leaves the team’s test clicks out: no tab, no share of the counts', async () => {
    const SINCE = { startMs: Date.UTC(2026, 8, 1), endMs: null }
    const before = await readDashboard(SINCE)
    // The admin Queue's preview, and the unreleased /hire page on a preview
    // deployment, which writes to the same store.
    for (const page of ['admin-queue', 'Hire'])
      lists.get(KEY)!.unshift({ ...click(), page })

    const after = await readDashboard(SINCE)
    expect(after.byPage).toEqual(before.byPage)
    expect(after.topListings).toEqual(before.topListings)
    expect(after.recent).toEqual(before.recent)
  })
})

describe('events sent from a preview deployment or a laptop', () => {
  it('stay stored but count nowhere', async () => {
    const SINCE = { startMs: Date.UTC(2026, 8, 1), endMs: null }
    const before = await readDashboard(SINCE)
    n += 1
    const ts = new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString()
    const preview =
      'https://ai-safety-com-git-hire-page-alignmentdevs-projects.vercel.app'
    const view = { type: 'page_view', vid: 'p1', ts }
    lists
      .get(KEY)!
      .unshift(
        { ...view, page: '/hire', ref: `${preview}/hire` },
        { ...click(), vid: 'p1', ref: `${preview}/events` },
        { ...view, page: '/map', ref: 'http://localhost:3000/map' }
      )
    const stored = lists.get(KEY)!.length

    const after = await readDashboard(SINCE)
    expect(after.visits).toEqual(before.visits)
    expect(after.byPage).toEqual(before.byPage)
    expect(after.recent).toEqual(before.recent)
    expect(lists.get(KEY)!.length).toBe(stored)

    // A view on the live site still counts.
    lists.get(KEY)!.unshift({
      type: 'page_view',
      page: '/map',
      vid: 'live1',
      ts,
      ref: 'https://aisafety.com/map',
    })
    const live = await readDashboard(SINCE)
    expect(live.visits.totalViews).toBe(before.visits.totalViews + 1)
  })
})
