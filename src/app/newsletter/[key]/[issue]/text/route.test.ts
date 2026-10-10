/*
  The text version of an issue, against the pretend ActiveCampaign
  (src/lib/admin/__fixtures__/fake-ac.ts): it shows only what the web
  version shows, reads the same kept copy, and runs only its own script.
  Nothing touches the network.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildEmail,
  camp,
  makeAC,
  resetKv,
  type AcOptions,
} from '@/lib/admin/__fixtures__/fake-ac'
import { TEXT_SCRIPT_HASH } from '@/lib/newsletter-text'

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

let fetched: string[] = []

async function route(opts: AcOptions = {}) {
  const ac = makeAC(opts)
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
  return (key: string, issue: string) =>
    mod.GET(
      new Request(`https://aisafety.com/newsletter/${key}/${issue}/text`),
      {
        params: Promise.resolve({ key, issue }),
      }
    )
}

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

describe('/newsletter/<key>/<issue>/text', () => {
  it('shows a sent issue’s text version, with only its own script allowed, and keeps the email', async () => {
    const get = await route({
      extra: [camp({ id: '210', name: ISSUE, msg: '300', send_amt: '700' })],
    })
    const res = await get('events', 'week-41-2026')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400')
    const policy = res.headers.get('content-security-policy')!
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain(`script-src '${TEXT_SCRIPT_HASH}'`)
    const html = await res.text()
    expect(html).toContain('<h1>Week 41, 2026</h1>')
    expect(html).toContain('AI Safety Events · Text version')
    expect(html).toContain('<strong>New events</strong>')
    expect(html).toContain('• The Big Tent<br>')
    expect(html).toContain('Copy text version')
    expect(html).toContain(
      '<a href="/newsletter/events/week-41-2026">View the email</a>'
    )
    expect(html).not.toMatch(/%[A-Z]/)
    expect(h.put).toHaveBeenCalledTimes(1)
    expect(h.put.mock.calls[0][0]).toBe(
      'newsletter/web/events/week-41-2026.html'
    )
  })

  it('reads the kept copy, like the web version', async () => {
    const get = await route({
      blob: { 'week-41-2026.html': buildEmail().html },
    })
    expect((await get('events', 'week-41-2026')).status).toBe(200)
    expect(fetched).toEqual([
      'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/newsletter/web/events/week-41-2026.html',
    ])
  })

  it('shows nothing for an issue that hasn’t reached readers', async () => {
    const get = await route()
    const res = await get('events', 'week-41-2026')
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('This issue isn’t online')
  })

  it('sends an email without a manifest to the email itself', async () => {
    const plain =
      '<!DOCTYPE html><html><head><title>Week 41, 2026</title></head><body><p>Old</p></body></html>'
    const get = await route({ blob: { 'week-41-2026.html': plain } })
    const res = await get('events', 'week-41-2026')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/newsletter/events/week-41-2026')
  })

  it('answers made-up addresses without reading anything', async () => {
    const get = await route()
    for (const [key, issue] of [
      ['events', 'issue-41-2026'],
      ['updates', 'week-41-2026'],
    ])
      expect((await get(key, issue)).status).toBe(404)
    expect(fetched).toEqual([])
  })
})
