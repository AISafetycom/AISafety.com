import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/site-feedback with Airtable replaced by a pretend fetch and the
// admin mail stubbed: what reaches Airtable, what the form is told, and that
// the owner is emailed the row only once it is saved.

const h = vi.hoisted(() => ({
  tasks: [] as (() => unknown)[],
  sendAdminMail: vi.fn(async () => true),
}))

vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => void h.tasks.push(task),
}))
vi.mock('@/lib/admin/mail', () => ({ sendAdminMail: h.sendAdminMail }))

import { SITE_CORRECTIONS } from '@/lib/site-feedback'
import { POST } from './route'

const correction = {
  kind: 'correction',
  text: 'The deadline moved.',
  path: '/events',
  listingName: 'AI Safety Camp',
  resource: 'Events',
}

function post(body: unknown) {
  return POST(
    new NextRequest('https://aisafety.com/api/site-feedback', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  )
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  h.tasks = []
  h.sendAdminMail.mockClear()
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ id: 'recNEWNEWNEWNEWNE' }), {
        status: 200,
      })
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('AIRTABLE_TOKEN', 'test-token')
  vi.stubEnv('AIRTABLE_BASE_ID', 'appTEST')
  vi.stubEnv('VERCEL_ENV', 'production')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('POST /api/site-feedback', () => {
  it('saves a correction to Site corrections by field id, then emails the owner the row', async () => {
    const res = await post(correction)
    expect(res.status).toBe(204)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `https://api.airtable.com/v0/appTEST/${SITE_CORRECTIONS.table}`
    )
    expect(JSON.parse(init.body as string)).toEqual({
      fields: {
        [SITE_CORRECTIONS.correction]: 'The deadline moved.',
        [SITE_CORRECTIONS.page]: 'events',
        [SITE_CORRECTIONS.resource]: 'Events',
        [SITE_CORRECTIONS.listingName]: 'AI Safety Camp',
      },
    })

    // The email goes after the answer.
    expect(h.sendAdminMail).not.toHaveBeenCalled()
    await Promise.all(h.tasks.map(task => task()))
    expect(h.sendAdminMail).toHaveBeenCalledTimes(1)
    const [kind, , mail] = h.sendAdminMail.mock.calls[0] as unknown as [
      string,
      string,
      { text: string },
    ]
    expect(kind).toBe('digest')
    expect(mail.text).toContain(
      `https://airtable.com/appTEST/${SITE_CORRECTIONS.table}/recNEWNEWNEWNEWNE`
    )
  })

  it('pretends to take a bot’s honeypot submission and saves nothing', async () => {
    const res = await post({ ...correction, website: 'http://spam.example' })
    expect(res.status).toBe(204)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.tasks).toHaveLength(0)
  })

  it('refuses a malformed submission', async () => {
    const res = await post({ ...correction, path: 'https://evil.example' })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('only logs off the live site, so dev servers and previews never reach the real tables', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await post(correction)
    expect(res.status).toBe(204)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.tasks).toHaveLength(0)
    log.mockRestore()
  })

  it('tells the form when Airtable refuses the row, and emails nobody', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 422 }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(correction)
    expect(res.status).toBe(502)
    expect(h.tasks).toHaveLength(0)
    error.mockRestore()
  })
})
