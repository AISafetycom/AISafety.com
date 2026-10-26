import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/newsletter/settings: the newsletters page opened from an issue's
// "Manage subscriptions" link. The network limit is stubbed and
// ActiveCampaign's API is a pretend fetch. Nothing touches the network.

const h = vi.hoisted(() => ({
  settingsAllowed: vi.fn<(ip: string) => Promise<boolean>>(async () => true),
}))
vi.mock('@/lib/newsletter-signup-limits', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/newsletter-signup-limits')>()),
  settingsAllowed: h.settingsAllowed,
}))

import { manageKey } from '@/lib/newsletter-manage'
import { POST } from './route'

const API = 'https://ac.test/api/3/'
const AC_KEY = 'test-api-key'
const ID = '3034'
const KEY = manageKey(ID, AC_KEY)

let statuses: Record<string, string>
let contactStatus: number
let failWriteTo: string | null
let writes: { list: string; status: number; sourceid?: number }[]
let logs: string[] = []

function post(body: unknown) {
  return POST(
    new NextRequest('https://aisafety.com/api/newsletter/settings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  h.settingsAllowed.mockClear()
  h.settingsAllowed.mockResolvedValue(true)
  vi.stubEnv('ACTIVECAMPAIGN_URL', 'https://ac.test')
  vi.stubEnv('ACTIVECAMPAIGN_KEY', AC_KEY)
  statuses = { '6': '1', '7': '1', '8': '2', '5': '1' }
  contactStatus = 200
  failWriteTo = null
  writes = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    expect((init?.headers as Record<string, string>)['Api-Token']).toBe(AC_KEY)
    if (u === `${API}contacts/${ID}`) {
      return contactStatus === 200
        ? Response.json({
            contact: { id: ID, email: 'ada.lovelace@example.org' },
          })
        : new Response('{}', { status: contactStatus })
    }
    if (u === `${API}contacts/${ID}/contactLists`) {
      return Response.json({
        contactLists: Object.entries(statuses).map(([list, status]) => ({
          list,
          status,
        })),
      })
    }
    if (u === `${API}contactLists` && init?.method === 'POST') {
      const { contactList } = JSON.parse(String(init.body))
      if (contactList.list === failWriteTo)
        return new Response('nope', { status: 500 })
      expect(contactList.contact).toBe(ID)
      writes.push({
        list: contactList.list,
        status: contactList.status,
        sourceid: contactList.sourceid,
      })
      statuses[contactList.list] = String(contactList.status)
      return Response.json({ contactList })
    }
    throw new Error(`unexpected request ${init?.method ?? 'GET'} ${u}`)
  })
  logs = []
  const keep = (...args: unknown[]) =>
    void logs.push(args.map(String).join(' '))
  vi.spyOn(console, 'log').mockImplementation(keep)
  vi.spyOn(console, 'warn').mockImplementation(keep)
})

afterEach(() => {
  for (const line of logs) {
    expect(line.toLowerCase()).not.toContain('lovelace')
    expect(line).not.toContain(KEY)
  }
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/newsletter/settings', () => {
  it('says which newsletters the reader gets, with the address masked', async () => {
    const res = await post({ k: KEY })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      email: 'a•••@example.org',
      subscribed: { events: true, training: true, funding: false },
    })
    expect(writes).toEqual([])
  })

  it('refuses a key that is not genuine, before asking ActiveCampaign anything', async () => {
    for (const k of [
      undefined,
      '',
      '3034',
      manageKey(ID, 'other-key'),
      `${KEY}x`,
    ]) {
      const res = await post({ k })
      expect(res.status).toBe(403)
      expect((await res.json()).reason).toBe('link_invalid')
    }
  })

  it('changes the lists on the live site and answers with what is true now', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await post({
      k: KEY,
      set: { events: true, training: false, funding: true },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      email: 'a•••@example.org',
      subscribed: { events: true, training: false, funding: true },
    })
    // Source 4 only on a subscribe: it lets ActiveCampaign take back someone
    // who unsubscribed before.
    expect(writes).toEqual([
      { list: '7', status: 2, sourceid: undefined },
      { list: '8', status: 1, sourceid: 4 },
    ])
  })

  it('only pretends outside the live site', async () => {
    const res = await post({ k: KEY, set: { training: false } })
    expect(await res.json()).toEqual({
      ok: true,
      email: 'a•••@example.org',
      subscribed: { events: true, training: false, funding: false },
      dryRun: true,
    })
    expect(writes).toEqual([])
    expect(logs.some(l => /would set contact 3034 on list 7/.test(l))).toBe(
      true
    )
  })

  it('stops at a failed change and says what did change', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    failWriteTo = '8'
    const res = await post({
      k: KEY,
      set: { events: false, funding: true },
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.reason).toBe('upstream')
    expect(body.subscribed).toEqual({
      events: false,
      training: true,
      funding: false,
    })
  })

  it('says so when the contact is gone', async () => {
    contactStatus = 404
    const res = await post({ k: KEY })
    expect(res.status).toBe(404)
    expect((await res.json()).reason).toBe('not_found')
  })

  it('says something went wrong when ActiveCampaign does not answer', async () => {
    contactStatus = 503
    const res = await post({ k: KEY })
    expect(res.status).toBe(502)
    expect((await res.json()).reason).toBe('upstream')
  })

  it('refuses anything but true or false for the three newsletters', async () => {
    for (const set of [{ updates: true }, { events: 'no' }, [true]]) {
      const res = await post({ k: KEY, set })
      expect(res.status).toBe(400)
    }
    expect(writes).toEqual([])
  })

  it('stops a network over its hourly limit before looking at the key', async () => {
    h.settingsAllowed.mockResolvedValueOnce(false)
    const res = await post({ k: 'not-a-key' })
    expect(res.status).toBe(429)
    expect((await res.json()).reason).toBe('rate_limited')
    expect(h.settingsAllowed).toHaveBeenCalledWith('203.0.113.9')
  })

  it('answers 503 on a copy without the ActiveCampaign key', async () => {
    vi.stubEnv('ACTIVECAMPAIGN_KEY', '')
    const res = await post({ k: KEY })
    expect(res.status).toBe(503)
    expect((await res.json()).reason).toBe('not_configured')
  })
})
