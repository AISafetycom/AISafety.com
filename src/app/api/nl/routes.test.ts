import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The two /api/nl routes with the click counter's store parts stubbed out:
// where the reader is sent, and which clicks get counted (after the
// redirect, via after()).

const h = vi.hoisted(() => ({
  tasks: [] as (() => Promise<void>)[],
  isAdmin: vi.fn(async () => false),
  isScannerBurst: vi.fn(async () => false),
  recordClick: vi.fn(async () => {}),
  loadLinkList: vi.fn(),
}))

vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => void h.tasks.push(task),
}))
vi.mock('@/lib/admin/auth', () => ({ isAdmin: h.isAdmin }))
vi.mock('@/lib/newsletter-clicks', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/newsletter-clicks')>()),
  loadLinkList: h.loadLinkList,
  isScannerBurst: h.isScannerBurst,
  recordClick: h.recordClick,
}))

import * as linkRoute from './[list]/[n]/route'
import * as restRoute from './[[...rest]]/route'

const LIST = '778fcac87193fec9'
const links = {
  c: 'Training · Week 39, 2026',
  links: [
    { u: 'https://www.aisafety.com/?utm_source=x', k: 'page', t: 'Home' },
    { u: 'https://lensacademy.org/', k: 'recfEPy5dMqKPzLAc', t: 'Lens' },
  ],
}
const BROWSER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'

function req(path: string, ua: string | null = BROWSER) {
  const headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.9' }
  if (ua) headers['user-agent'] = ua
  return new NextRequest(`https://aisafety.com${path}`, { headers })
}
const link = (list: string, n: string) => ({
  params: Promise.resolve({ list, n }),
})
const rest = (...segments: string[]) => ({
  params: Promise.resolve({ rest: segments }),
})
const runAfter = () => Promise.all(h.tasks.map(t => t()))

beforeEach(() => {
  h.tasks.length = 0
  h.isAdmin.mockReset().mockResolvedValue(false)
  h.isScannerBurst.mockReset().mockResolvedValue(false)
  h.recordClick.mockReset()
  h.loadLinkList.mockReset().mockResolvedValue(links)
})

describe('GET /api/nl/<list>/<n>', () => {
  it('sends the reader on, then counts the click', async () => {
    const res = await linkRoute.GET(req(`/api/nl/${LIST}/1`), link(LIST, '1'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://lensacademy.org/')
    expect(res.headers.get('cache-control')).toBe('no-store')
    // Nothing counted before the redirect has gone.
    expect(h.recordClick).not.toHaveBeenCalled()
    await runAfter()
    expect(h.isScannerBurst).toHaveBeenCalledWith(LIST, 1, '203.0.113.9')
    expect(h.recordClick).toHaveBeenCalledWith(links.c, links.links[1])
  })

  it('keeps the list copy for after the redirect too', async () => {
    await linkRoute.GET(req(`/api/nl/${LIST}/0`), link(LIST, '0'))
    const later = h.loadLinkList.mock.calls[0][1]
    expect(typeof later).toBe('function')
    later(async () => {})
    expect(h.tasks).toHaveLength(2)
  })

  it('does not count anyone signed in to the admin', async () => {
    h.isAdmin.mockResolvedValue(true)
    const res = await linkRoute.GET(req(`/api/nl/${LIST}/1`), link(LIST, '1'))
    expect(res.headers.get('location')).toBe('https://lensacademy.org/')
    await runAfter()
    expect(h.recordClick).not.toHaveBeenCalled()
  })

  it('does not count a scanner burst', async () => {
    h.isScannerBurst.mockResolvedValue(true)
    const res = await linkRoute.GET(req(`/api/nl/${LIST}/1`), link(LIST, '1'))
    expect(res.headers.get('location')).toBe('https://lensacademy.org/')
    await runAfter()
    expect(h.recordClick).not.toHaveBeenCalled()
  })

  it('does not count link checkers, the admin preview or HEAD', async () => {
    for (const ua of ['facebookexternalhit/1.1', 'Outlook-Android/2.0', null]) {
      const res = await linkRoute.GET(
        req(`/api/nl/${LIST}/1`, ua),
        link(LIST, '1')
      )
      expect(res.headers.get('location')).toBe('https://lensacademy.org/')
    }
    await linkRoute.GET(req(`/api/nl/${LIST}/1?p=1`), link(LIST, '1'))
    const head = await linkRoute.HEAD(req(`/api/nl/${LIST}/1`), link(LIST, '1'))
    expect(head.headers.get('location')).toBe('https://lensacademy.org/')
    expect(h.tasks).toHaveLength(0)
  })

  it('sends unknown or mangled links to the homepage', async () => {
    for (const [list, n] of [
      [LIST, '2'],
      [LIST, '-1'],
      [LIST, '1.5'],
      [LIST, '99999'],
      ['778FCAC87193FEC9', '1'],
      ['..', '1'],
    ]) {
      const res = await linkRoute.GET(req('/api/nl/x/y'), link(list, n))
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('https://aisafety.com/')
    }
    h.loadLinkList.mockResolvedValue(null)
    const res = await linkRoute.GET(req(`/api/nl/${LIST}/1`), link(LIST, '1'))
    expect(res.headers.get('location')).toBe('https://aisafety.com/')
    expect(h.tasks).toHaveLength(0)
  })
})

describe('GET /api/nl/… (anything else)', () => {
  it('sends a link cut short to the homepage, not a 404', async () => {
    for (const segments of [['778fcac8'], [LIST], ['x']]) {
      const res = await restRoute.GET(req('/api/nl/x'), rest(...segments))
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('https://aisafety.com/')
    }
    // A bare /api/nl: Next passes no segments at all.
    const bare = await restRoute.GET(req('/api/nl'), {
      params: Promise.resolve({}),
    })
    expect(bare.headers.get('location')).toBe('https://aisafety.com/')
    expect(h.loadLinkList).not.toHaveBeenCalled()
  })

  it('still follows a real link with extra bits on the end, counted the same way', async () => {
    const res = await restRoute.GET(
      req(`/api/nl/${LIST}/1/extra`),
      rest(LIST, '1', 'extra')
    )
    expect(res.headers.get('location')).toBe('https://lensacademy.org/')
    await runAfter()
    expect(h.recordClick).toHaveBeenCalledWith(links.c, links.links[1])

    const head = await restRoute.HEAD(
      req(`/api/nl/${LIST}/0/x/y`),
      rest(LIST, '0', 'x', 'y')
    )
    expect(head.headers.get('location')).toBe(
      'https://www.aisafety.com/?utm_source=x'
    )
  })

  it('sends extra bits after something that is not a link to the homepage', async () => {
    for (const segments of [
      ['x', 'y', 'z'],
      [LIST, 'x', 'y'],
      ['..', '..', 'etc'],
    ]) {
      const res = await restRoute.GET(req('/api/nl/x'), rest(...segments))
      expect(res.headers.get('location')).toBe('https://aisafety.com/')
    }
  })
})
