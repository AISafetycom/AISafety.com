import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/subscribe from the newsletters page (/newsletter): several
// newsletters at once, one confirmation email. The limits are stubbed (as in
// route.test.ts), the kept signups too, and ActiveCampaign's form endpoint
// and API are one pretend fetch. Nothing touches the network.

type Day = { day: string; count: number; alert: boolean }

const h = vi.hoisted(() => ({
  tasks: [] as (() => unknown)[],
  ipAllowed: vi.fn<(ip: string) => Promise<boolean>>(async () => true),
  addressAllowed: vi.fn<(n: string, e: string) => Promise<boolean>>(
    async () => true
  ),
  recordAddressSend: vi.fn<(n: string, e: string) => Promise<void>>(
    async () => {}
  ),
  countSignupToday: vi.fn<() => Promise<Day | null>>(async () => ({
    day: '2026-10-26',
    count: 1,
    alert: false,
  })),
  alertOwner: vi.fn<(day: Day) => Promise<void>>(async () => {}),
  savePending: vi.fn<
    (id: string, waitFor: string, add: string[]) => Promise<void>
  >(async () => {}),
}))

vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => void h.tasks.push(task),
}))
vi.mock('@/lib/newsletter-signup-limits', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/newsletter-signup-limits')>()),
  ipAllowed: h.ipAllowed,
  addressAllowed: h.addressAllowed,
  recordAddressSend: h.recordAddressSend,
  countSignupToday: h.countSignupToday,
  alertOwner: h.alertOwner,
}))
vi.mock('@/lib/newsletter-pending', () => ({ savePending: h.savePending }))

import { AC_FORMS } from '@/lib/newsletter-signup'
import { POST } from './route'

const EMAIL = 'Ada.Lovelace@Example.ORG'
const LOWER = 'ada.lovelace@example.org'
const API = 'https://ac.test/api/3/'
const THANK_YOU = `_show_thank_you("4", "Thank you for subscribing!", "", "${LOWER}");`
const formOf = (f: string) =>
  Object.entries(AC_FORMS).find(([, form]) => String(form.formId) === f)?.[0]

/** The pretend account: contacts by address, their list statuses, and
 *  what each form answers. */
let contacts: Map<string, string>
let statuses: Map<string, Record<string, string>>
let formAnswer: Record<string, 'thanks' | 'already'>
let lookupFails: number
let posted: string[]
let logs: string[] = []

function post(body: unknown) {
  return POST(
    new NextRequest('https://aisafety.com/api/subscribe', {
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
  h.tasks.length = 0
  for (const fn of Object.values(h))
    if (typeof fn === 'function') fn.mockClear()
  vi.stubEnv('ACTIVECAMPAIGN_URL', 'https://ac.test')
  vi.stubEnv('ACTIVECAMPAIGN_KEY', 'test-api-key')
  contacts = new Map()
  statuses = new Map()
  formAnswer = {}
  lookupFails = 0
  posted = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/proc.php')) {
      const body = init?.body as URLSearchParams
      const newsletter = formOf(body.get('f') ?? '') as string
      posted.push(newsletter)
      if (formAnswer[newsletter] === 'already') {
        return new Response(
          `window.top.location.href = "https://aisafety.com/subscribed/${newsletter}";`
        )
      }
      // The form makes the contact (unconfirmed) if there wasn't one.
      if (!contacts.has(LOWER)) contacts.set(LOWER, '501')
      return new Response(THANK_YOU)
    }
    if (u.startsWith(`${API}contacts?`)) {
      if (lookupFails > 0) {
        lookupFails--
        return new Response('down', { status: 500 })
      }
      const email = new URL(u).searchParams.get('email') ?? ''
      const id = contacts.get(email)
      return Response.json({ contacts: id ? [{ id, email }] : [] })
    }
    const lists = /contacts\/(\d+)\/contactLists$/.exec(u)
    if (lists) {
      const s = statuses.get(lists[1]) ?? {}
      return Response.json({
        contactLists: Object.entries(s).map(([list, status]) => ({
          list,
          status,
        })),
      })
    }
    throw new Error(`unexpected request ${u}`)
  })
  logs = []
  const keep = (...args: unknown[]) =>
    void logs.push(args.map(String).join(' '))
  vi.spyOn(console, 'log').mockImplementation(keep)
  vi.spyOn(console, 'warn').mockImplementation(keep)
  vi.spyOn(console, 'error').mockImplementation(keep)
})

afterEach(() => {
  for (const line of logs) {
    expect(line.toLowerCase()).not.toContain('lovelace')
  }
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/subscribe with several newsletters', () => {
  it('sends a new reader one confirmation and keeps the rest until it is confirmed', async () => {
    const res = await post({
      email: EMAIL,
      newsletters: ['funding', 'events'],
      hp: '',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, confirm: 'events' })
    expect(posted).toEqual(['events'])
    expect(h.savePending).toHaveBeenCalledWith('501', '6', ['8'])
    // The address as the boxes send it: the domain lowercased.
    expect(h.recordAddressSend).toHaveBeenCalledWith(
      'events',
      'Ada.Lovelace@example.org'
    )
  })

  it('skips the newsletters the reader already gets', async () => {
    contacts.set(LOWER, '77')
    statuses.set('77', { '6': '1', '7': '2' })
    const res = await post({
      email: EMAIL,
      newsletters: ['events', 'training', 'funding'],
    })
    expect(await res.json()).toEqual({ ok: true, confirm: 'training' })
    // Training (unsubscribed before) gets the confirmation; Funding waits.
    expect(posted).toEqual(['training'])
    expect(h.savePending).toHaveBeenCalledWith('77', '7', ['8'])
  })

  it('sends nothing when the reader already gets every one picked', async () => {
    contacts.set(LOWER, '77')
    statuses.set('77', { '6': '1', '8': '1' })
    const res = await post({ email: EMAIL, newsletters: ['events', 'funding'] })
    expect(await res.json()).toEqual({ ok: true, already: true })
    expect(posted).toEqual([])
    expect(h.savePending).not.toHaveBeenCalled()
    expect(h.countSignupToday).not.toHaveBeenCalled()
  })

  it('keeps nothing when only one newsletter is left to confirm', async () => {
    contacts.set(LOWER, '77')
    statuses.set('77', { '6': '1' })
    const res = await post({ email: EMAIL, newsletters: ['events', 'funding'] })
    expect(await res.json()).toEqual({ ok: true, confirm: 'funding' })
    expect(posted).toEqual(['funding'])
    expect(h.savePending).not.toHaveBeenCalled()
  })

  it('moves on when a form says the reader is already on its list', async () => {
    // The lookup is down, so every pick is tried; Events' form knows better.
    lookupFails = 1
    formAnswer.events = 'already'
    const res = await post({
      email: EMAIL,
      newsletters: ['events', 'training', 'funding'],
    })
    expect(await res.json()).toEqual({ ok: true, confirm: 'training' })
    expect(posted).toEqual(['events', 'training'])
    expect(h.savePending).toHaveBeenCalledWith('501', '7', ['8'])
  })

  it('still answers yes when the rest could not be kept, and says so in the log', async () => {
    h.savePending.mockRejectedValueOnce(new Error('Upstash is down'))
    const res = await post({ email: EMAIL, newsletters: ['events', 'funding'] })
    expect(await res.json()).toEqual({ ok: true, confirm: 'events' })
    expect(logs.some(l => /funding couldn't be kept/.test(l))).toBe(true)
  })

  it('refuses an empty or unknown list of newsletters', async () => {
    for (const newsletters of [[], ['updates'], 'events', [7]]) {
      const res = await post({ email: EMAIL, newsletters })
      expect(res.status).toBe(400)
      expect((await res.json()).reason).toBe('unknown_newsletter')
    }
    expect(posted).toEqual([])
  })

  it('answers a filled honeypot as usual, without contacting anyone', async () => {
    const res = await post({
      email: EMAIL,
      newsletters: ['events', 'funding'],
      hp: 'x',
    })
    expect(await res.json()).toEqual({ ok: true })
    expect(posted).toEqual([])
  })

  it('needs the ActiveCampaign API, which a copy without its key lacks', async () => {
    vi.stubEnv('ACTIVECAMPAIGN_KEY', '')
    const res = await post({ email: EMAIL, newsletters: ['events', 'funding'] })
    expect(res.status).toBe(503)
    expect((await res.json()).reason).toBe('not_configured')
    expect(posted).toEqual([])
  })

  it('stores no settings key outside the live site', async () => {
    await post({ email: EMAIL, newsletters: ['events'] })
    expect(h.tasks).toHaveLength(0)
  })

  it('stores the new contact’s settings key after the answer on the live site', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const writes: string[] = []
    const fake = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      if (String(url) === `${API}fieldValues`) {
        writes.push(String(init?.body))
        return Response.json({ fieldValue: {} }, { status: 201 })
      }
      return fake(url, init)
    })
    await post({ email: EMAIL, newsletters: ['events'] })
    expect(h.tasks).toHaveLength(1)
    await h.tasks[0]()
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0])).toEqual({
      fieldValue: {
        contact: '501',
        field: '2',
        value: expect.stringMatching(/^501\.[A-Za-z0-9_-]{22}$/),
      },
    })
  })
})
