/*
  The web version of an issue, against the pretend ActiveCampaign
  (src/lib/admin/__fixtures__/fake-ac.ts): which campaigns may be shown,
  the kept copy, and what the page leaves out. Nothing touches the network.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildEmail,
  camp,
  makeAC,
  resetKv,
  type AcOptions,
} from '@/lib/admin/__fixtures__/fake-ac'

const h = vi.hoisted(() => ({
  put: vi.fn(async (...args: unknown[]) => ({
    url: `https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/${String(args[0])}`,
  })),
}))

vi.mock('@upstash/redis', async () => ({
  Redis: (await import('@/lib/admin/__fixtures__/fake-ac')).FakeRedis,
}))
vi.mock('@vercel/blob', () => ({ put: h.put }))

const ENV = { ...process.env }
const ISSUE = 'Events · Week 41, 2026'
// The pipeline's footer, marked for the web version.
const FOOTER =
  '<!--web:hide--><div class="divider"></div><div><a href="%UNSUBSCRIBELINK%">Unsubscribe</a> · ' +
  '<a href="https://aisafety.com/api/nl/0123456789abcdef/1">View in browser</a></div>' +
  '<div>%SENDER-INFO-SINGLELINE%</div><!--/web:hide-->'

let fetched: string[] = []

/** The route, fresh, over a pretend ActiveCampaign holding the draft of
 *  Week 41 (campaign 200, message 300) plus `extra` campaigns. */
async function route(opts: AcOptions = {}) {
  const ac = makeAC({ email: buildEmail({ footer: FOOTER }), ...opts })
  fetched = []
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    fetched.push(String(input))
    return ac.fetchMock(input, init)
  })
  vi.resetModules()
  process.env.ACTIVECAMPAIGN_URL = 'https://fake-ac.example'
  process.env.ACTIVECAMPAIGN_KEY = 'fake'
  process.env.BLOB_READ_WRITE_TOKEN = 'fake'
  const mod = await import('./route')
  return {
    ac,
    get: (key: string, issue: string) =>
      mod.GET(new Request(`https://aisafety.com/newsletter/${key}/${issue}`), {
        params: Promise.resolve({ key, issue }),
      }),
  }
}

const sent = (p: Parameters<typeof camp>[0]) => camp({ msg: '300', ...p })

beforeEach(() => {
  resetKv()
  h.put.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.env = { ...ENV }
})

describe('/newsletter/<key>/<issue>', () => {
  it('shows an issue that went out on its real list, without the email-only footer, and keeps it', async () => {
    const { get } = await route({
      extra: [
        sent({ id: '210', name: `${ISSUE} · wave 1/4`, send_amt: '700' }),
      ],
    })
    const res = await get('events', 'week-41-2026')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400')
    expect(res.headers.get('content-security-policy')).toContain(
      "default-src 'none'"
    )
    const html = await res.text()
    expect(html).toContain('<h1>Events</h1>')
    expect(html).toContain('noindex')
    expect(html).not.toMatch(/%[A-Z]/)
    expect(html).not.toContain('View in browser')
    expect(html).toContain(
      '<a href="/newsletter/events/week-41-2026/text" style="color:#aab2b3;text-decoration:underline;text-decoration-color:#325354;">Copy text version</a>'
    )
    expect(html).not.toContain('aisafety-issue')
    expect(html).not.toContain('aisafety-cards')
    expect(h.put).toHaveBeenCalledTimes(1)
    const [path, body, opts] = h.put.mock.calls[0]
    expect(path).toBe('newsletter/web/events/week-41-2026.html')
    expect(body).toContain('<!--aisafety-issue:')
    expect(body).toContain('%UNSUBSCRIBELINK%')
    expect(opts).toMatchObject({
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: false,
    })
  })

  it('shows a kept copy without asking ActiveCampaign', async () => {
    const { get } = await route({
      blob: { 'week-41-2026.html': buildEmail({ footer: FOOTER }).html },
    })
    const res = await get('events', 'week-41-2026')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<h1>Events</h1>')
    expect(fetched).toEqual([
      'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/newsletter/web/events/week-41-2026.html',
    ])
    expect(h.put).not.toHaveBeenCalled()
  })

  it('shows nothing that hasn’t reached readers on the real list', async () => {
    for (const extra of [
      [], // only the draft
      [sent({ id: '210', name: ISSUE, status: '1' })], // scheduled: can still be cancelled
      [sent({ id: '210', name: ISSUE, status: '4', send_amt: '0' })], // stopped in time
      [sent({ id: '210', name: ISSUE, status: '6', send_amt: '0' })], // disabled
      [sent({ id: '210', name: ISSUE, list: '5', send_amt: '2' })], // the test list
      [sent({ id: '210', name: 'Events · Week 40, 2026', send_amt: '700' })], // another issue
    ]) {
      const { get } = await route({ extra })
      const res = await get('events', 'week-41-2026')
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('public, s-maxage=30')
      expect(await res.text()).toContain('This issue isn’t online')
      expect(h.put).not.toHaveBeenCalled()
    }
  })

  it('shows an issue stopped or paused part-way: some readers have it', async () => {
    for (const status of ['3', '4']) {
      const { get } = await route({
        extra: [sent({ id: '210', name: ISSUE, status, send_amt: '40' })],
      })
      expect((await get('events', 'week-41-2026')).status).toBe(200)
    }
  })

  it('reads the right newsletter’s list', async () => {
    const { get } = await route({
      extra: [
        sent({
          id: '210',
          name: 'Training · Week 41, 2026',
          list: '6',
          send_amt: '700',
        }),
      ],
    })
    expect((await get('training', 'week-41-2026')).status).toBe(404)
  })

  it('answers made-up addresses without reading anything', async () => {
    const { get } = await route()
    for (const [key, issue] of [
      ['events', 'issue-41-2026'],
      ['updates', 'week-41-2026'],
      ['events', 'week-41-2026.json'],
    ]) {
      const res = await get(key, issue)
      expect(res.status).toBe(404)
    }
    expect(fetched).toEqual([])
  })

  it('says so, uncached, when ActiveCampaign can’t be read', async () => {
    const { ac, get } = await route()
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) =>
      String(input).includes('fake-ac.example')
        ? Promise.resolve(new Response('<html>502</html>', { status: 502 }))
        : ac.fetchMock(input, init)
    )
    const res = await get('events', 'week-41-2026')
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
