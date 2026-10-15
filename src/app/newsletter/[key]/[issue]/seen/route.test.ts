/*
  The image an issue's web and text versions load to count their views:
  what counts, what doesn't, and that the image always comes back uncached.
*/

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  admin: false,
  allowed: true,
  later: [] as Array<() => unknown>,
  recorded: [] as Array<{ event: unknown; opts: unknown }>,
}))

vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => unknown) => {
    h.later.push(fn)
  },
}))
vi.mock('@/lib/admin/auth', () => ({ isAdmin: async () => h.admin }))
vi.mock('@/lib/analytics/events', () => ({
  NEWSLETTER_COPY_VIEW: 'newsletter_copy_view',
  allowTrack: async () => h.allowed,
  recordEvent: async (event: unknown, opts: unknown) => {
    h.recorded.push({ event, opts })
  },
}))
vi.mock('@/lib/newsletter-archive-store', () => ({
  dailyReaderId: async (fetcher: string) => `d:${fetcher}`,
}))

const { GET } = await import('./route')

const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

async function load(
  key: string,
  issue: string,
  query = '?as=web',
  headers: Record<string, string> = {}
) {
  const res = await GET(
    new NextRequest(
      `https://aisafety.com/newsletter/${key}/${issue}/seen${query}`,
      {
        headers: {
          'user-agent': BROWSER,
          'sec-fetch-dest': 'image',
          'x-forwarded-for': '203.0.113.7',
          ...headers,
        },
      }
    ),
    { params: Promise.resolve({ key, issue }) }
  )
  for (const fn of h.later.splice(0)) await fn()
  return res
}

beforeEach(() => {
  h.admin = false
  h.allowed = true
  h.later.length = 0
  h.recorded.length = 0
})

describe('/newsletter/<key>/<issue>/seen', () => {
  it('counts a view of the web or text version under the day’s reader id, and sends an uncached pixel', async () => {
    const res = await load('events', 'week-41-2026')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/gif')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(30)
    await load('funding', 'issue-21-2026', '?as=text')
    expect(h.recorded).toEqual([
      {
        event: expect.objectContaining({
          type: 'newsletter_copy_view',
          page: 'Events',
          label: 'week-41-2026',
          source: 'web',
          vid: `d:203.0.113.7|${BROWSER}`,
        }),
        opts: { firstSeen: false },
      },
      {
        event: expect.objectContaining({
          page: 'Funding',
          label: 'issue-21-2026',
          source: 'text',
        }),
        opts: { firstSeen: false },
      },
    ])
  })

  it('counts nothing for bots, a page load, or an address that isn’t an issue’s', async () => {
    await load('events', 'week-41-2026', '?as=web', {
      'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
    })
    await load('events', 'week-41-2026', '?as=web', {
      'sec-fetch-dest': 'document',
    })
    await load('events', 'week-41-2026', '?as=pdf')
    await load('events', 'week-41-2026', '')
    await load('updates', 'week-41-2026')
    await load('events', 'issue-41-2026')
    await load('events', 'week-041-2026')
    expect(h.recorded).toEqual([])
  })

  it('counts nothing for someone signed in to the admin, or past the rate limit, but still answers', async () => {
    h.admin = true
    expect((await load('events', 'week-41-2026')).status).toBe(200)
    h.admin = false
    h.allowed = false
    expect((await load('events', 'week-41-2026')).status).toBe(200)
    expect(h.recorded).toEqual([])
  })
})
