import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AnalyticsEvent, DashboardData } from './events'

// The tiles over time, read through the Redis store: their totals are the
// figures the panels below them show, a day's values add up to them, and the
// stretch before the range is read and counted only when the store has it.
// An in-memory stand-in for Upstash, as in month-cache.test.ts.
const lists = new Map<string, AnalyticsEvent[]>()

vi.mock('@upstash/redis', () => {
  const at = (list: unknown[], i: number) => (i < 0 ? list.length + i : i)
  class FakeRedis {
    async zrange() {
      return [...lists.keys()]
        .map(k => k.slice('aisafety:analytics:events:'.length))
        .sort()
    }
    async lrange(key: string, start: number, stop: number) {
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

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 14, 12)

/** Store events (any order) in their month lists, newest first. */
function store(events: AnalyticsEvent[]) {
  lists.clear()
  for (const e of [...events].sort((a, b) => (a.ts < b.ts ? 1 : -1))) {
    const key = `aisafety:analytics:events:${e.ts.slice(0, 7)}`
    const list = lists.get(key) ?? []
    list.push(e)
    lists.set(key, list)
  }
}

const ts = (daysAgo: number, hour = 10) =>
  new Date(NOW - daysAgo * DAY + (hour - 12) * 3_600_000).toISOString()

/** A visitor's day on the site: a page view of /events, a listing click,
 *  the chatbot opened and a search typed. */
function visit(vid: string, daysAgo: number): AnalyticsEvent[] {
  return [
    { type: 'page_view', page: '/events', vid, ts: ts(daysAgo, 9) },
    {
      type: 'listing_click',
      page: 'Events',
      label: 'An event',
      vid,
      ts: ts(daysAgo, 10),
    },
    { type: 'chatbot_open', page: '/events', vid, ts: ts(daysAgo, 11) },
    {
      type: 'search_query',
      query: 'fellowship',
      results: 3,
      vid,
      ts: ts(daysAgo, 12),
    },
    {
      type: 'newsletter_signup',
      page: 'Events',
      label: 'Newsletter signup',
      vid,
      ts: ts(daysAgo, 13),
    },
  ]
}

let readDashboard: typeof import('./events').readDashboard
beforeAll(async () => {
  process.env.KV_REST_API_URL = 'https://fake.upstash.test'
  process.env.KV_REST_API_TOKEN = 'fake'
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  ;({ readDashboard } = await import('./events'))
})

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const LAST_7 = { startMs: NOW - 7 * DAY, endMs: null }

describe('tiles over time', () => {
  it('total the figures the panels show, a day at a time', async () => {
    // Two visitors in the last 7 days, one of them twice, and a visitor
    // with no id; one visitor the week before, and the store's first event
    // in September.
    store([
      ...visit('a', 1),
      ...visit('a', 3),
      ...visit('b', 3),
      { type: 'page_view', page: '/funding', ts: ts(2) },
      ...visit('c', 10),
      {
        type: 'page_view',
        page: '/',
        vid: 'z',
        ts: '2026-09-20T08:00:00.000Z',
      },
    ])
    const d: DashboardData = await readDashboard(LAST_7, 'Events')
    const t = d.trends

    expect(t.frame.unit).toBe('day')
    expect(t.frame.starts).toHaveLength(8)
    expect(t.visitors.total).toBe(d.visits.uniqueVisitors)
    expect(t.visitors.total).toBe(3)
    expect(t.visits.total).toBe(d.visits.visitCount)
    expect(t.pageViews.total).toBe(d.visits.totalViews)
    expect(sum(t.pageViews.points)).toBe(t.pageViews.total)
    expect(sum(t.visits.points)).toBe(t.visits.total)
    expect(t.listingClicks.total).toBe(sum(d.byPage.map(p => p.count)))
    expect(sum(t.listingClicks.points)).toBe(t.listingClicks.total)
    expect(t.chatbotOpened.total).toBe(d.funnel.opened)
    expect(t.searchTyped.total).toBe(d.search.funnel.searched)
    expect(t.newsletterSubmits.total).toBe(
      sum(d.newsletterByPage.map(p => p.count))
    )
    // The day both a and b came: two visitors.
    expect(
      t.visitors.points[t.frame.starts.indexOf(NOW - 3 * DAY - 12 * 3_600_000)]
    ).toBe(2)

    // The page's own tiles.
    const p = d.pageTrends
    expect(p.pageViews.total).toBe(3)
    expect(p.visitors.total).toBe(2)
    expect(p.listingClicks.total).toBe(
      d.byPage.find(r => r.name === 'Events')!.count
    )
  })

  it('compare with the stretch before, counted the same way', async () => {
    const d = await readDashboard(LAST_7, 'Events')
    expect(d.trends.frame.previous).toEqual({
      startMs: NOW - 14 * DAY,
      endMs: NOW - 7 * DAY - 1,
    })
    expect(d.trends.visitors.previous).toBe(1)
    expect(d.trends.listingClicks.previous).toBe(1)
    expect(d.trends.chatbotOpened.previous).toBe(1)
    expect(d.pageTrends.pageViews.previous).toBe(1)
    // Nothing there for these, which isn't the same as not knowing.
    expect(d.trends.newsletterSignups.previous).toBe(0)
  })

  it('compare with nothing when the store doesn’t reach back that far', async () => {
    const d = await readDashboard(
      { startMs: NOW - 30 * DAY, endMs: null },
      'Events'
    )
    // The 30 days before begin in August; the store starts in September.
    expect(d.trends.frame.previous).toBeNull()
    expect(d.trends.visitors.previous).toBeNull()
    expect(d.pageTrends.visitors.previous).toBeNull()
    expect(d.trends.visitors.total).toBe(d.visits.uniqueVisitors)
  })

  it('compare All time with nothing and start it at the first event', async () => {
    const d = await readDashboard({ startMs: null, endMs: null })
    expect(d.trends.frame.previous).toBeNull()
    expect(d.trends.frame.starts[0]).toBe(Date.UTC(2026, 8, 20))
    expect(d.trends.visitors.total).toBe(d.visits.uniqueVisitors)
  })
})
