import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/subscribe from the newsletters page (/newsletter): several
// newsletters at once, one email, through the form for exactly the ones the
// reader doesn't get yet. And, for the page and the boxes alike, the live
// site subscribing a reader as they sign up (no second click since
// 12 November 2026). The limits are stubbed (as in route.test.ts) and
// ActiveCampaign's form endpoint and API are one pretend fetch. Nothing
// touches the network.

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
// The combinations' forms filled in, except Events + Training's.
vi.mock('@/lib/newsletter-signup', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/newsletter-signup')>()),
  COMBO_FORMS: {
    'events-training': { formId: 0, orKey: '' },
    'events-funding': { formId: 22, orKey: 'ef-or' },
    'training-funding': { formId: 23, orKey: 'tf-or' },
    'events-training-funding': { formId: 24, orKey: 'etf-or' },
  },
}))

import { DAILY_ALERT_AFTER } from '@/lib/newsletter-signup-limits'
import { POST } from './route'

const EMAIL = 'Ada.Lovelace@Example.ORG'
const LOWER = 'ada.lovelace@example.org'
const API = 'https://ac.test/api/3/'
const FORM_OF: Record<string, string> = {
  '4': 'events',
  '6': 'training',
  '8': 'funding',
  '22': 'events-funding',
  '23': 'training-funding',
  '24': 'events-training-funding',
}
const LIST_OF: Record<string, string> = {
  events: '6',
  training: '7',
  funding: '8',
}

/** The pretend account: contacts by address, their list statuses, and
 *  what each form answers. */
let contacts: Map<string, string>
let statuses: Map<string, Record<string, string>>
let formAnswer: Record<string, 'thanks' | 'already'>
let lookupFails: boolean
/** How many lookups of the address find nothing before the contact shows. */
let lookupsBeforeContact: number
/** What a change to a list membership answers (HTTP status). */
let writeStatus: number
/** The list memberships the site changed: "contact:list:status:source". */
let listWrites: string[]
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
  lookupFails = false
  lookupsBeforeContact = 0
  writeStatus = 201
  listWrites = []
  posted = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/proc.php')) {
      const body = init?.body as URLSearchParams
      const form = FORM_OF[body.get('f') ?? '']
      if (!form) throw new Error(`unknown form ${body.get('f')}`)
      posted.push(form)
      if (formAnswer[form] === 'already') {
        return new Response(
          `window.top.location.href = "https://aisafety.com/subscribed/${form}";`
        )
      }
      // The form makes the contact if there wasn't one, and leaves each of
      // its lists unconfirmed unless the contact is subscribed to it.
      if (!contacts.has(LOWER)) contacts.set(LOWER, '501')
      const id = contacts.get(LOWER) as string
      const now = { ...statuses.get(id) }
      for (const n of form.split('-')) {
        if (now[LIST_OF[n]] !== '1') now[LIST_OF[n]] = '0'
      }
      statuses.set(id, now)
      return new Response(
        `_show_thank_you("${body.get('f')}", "Thank you for subscribing!", "", "${LOWER}");`
      )
    }
    if (u.startsWith(`${API}contacts?`)) {
      if (lookupFails) return new Response('down', { status: 500 })
      const email = new URL(u).searchParams.get('email') ?? ''
      const id = lookupsBeforeContact-- > 0 ? undefined : contacts.get(email)
      return Response.json({ contacts: id ? [{ id, email }] : [] })
    }
    if (u === `${API}contactLists`) {
      if (writeStatus >= 400) return new Response('down', { status: 500 })
      const { contactList: c } = JSON.parse(String(init?.body)) as {
        contactList: {
          contact: string
          list: string
          status: number
          sourceid?: number
        }
      }
      listWrites.push(`${c.contact}:${c.list}:${c.status}:${c.sourceid}`)
      statuses.set(c.contact, {
        ...statuses.get(c.contact),
        [c.list]: String(c.status),
      })
      return Response.json({ contactList: c }, { status: writeStatus })
    }
    if (u === `${API}fieldValues`) {
      return Response.json({ fieldValue: {} }, { status: 201 })
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
  it('signs a new reader up through the one form for all their picks', async () => {
    const res = await post({
      email: EMAIL,
      newsletters: ['funding', 'events'],
      hp: '',
    })
    expect(res.status).toBe(200)
    // Not the live site here, so the reader's click in the email is what
    // subscribes them.
    expect(await res.json()).toEqual({
      ok: true,
      added: ['events', 'funding'],
      confirm: true,
    })
    expect(listWrites).toEqual([])
    expect(posted).toEqual(['events-funding'])
    // The address as the boxes send it: the domain lowercased.
    expect(h.addressAllowed).toHaveBeenCalledWith(
      'events-funding',
      'Ada.Lovelace@example.org'
    )
    expect(h.recordAddressSend).toHaveBeenCalledWith(
      'events-funding',
      'Ada.Lovelace@example.org'
    )
  })

  it('leaves out the newsletters the reader already gets', async () => {
    contacts.set(LOWER, '77')
    // On Events; unsubscribed from Training before.
    statuses.set('77', { '6': '1', '7': '2' })
    const res = await post({
      email: EMAIL,
      newsletters: ['events', 'training', 'funding'],
    })
    expect(await res.json()).toEqual({
      ok: true,
      added: ['training', 'funding'],
      confirm: true,
    })
    expect(posted).toEqual(['training-funding'])
  })

  it("uses a newsletter's own form when only it is left", async () => {
    contacts.set(LOWER, '77')
    statuses.set('77', { '6': '1' })
    const res = await post({ email: EMAIL, newsletters: ['events', 'funding'] })
    expect(await res.json()).toEqual({
      ok: true,
      added: ['funding'],
      confirm: true,
    })
    expect(posted).toEqual(['funding'])
  })

  it('sends nothing when the reader already gets every one picked', async () => {
    contacts.set(LOWER, '77')
    statuses.set('77', { '6': '1', '8': '1' })
    const res = await post({ email: EMAIL, newsletters: ['events', 'funding'] })
    expect(await res.json()).toEqual({ ok: true, already: true })
    expect(posted).toEqual([])
    expect(h.countSignupToday).not.toHaveBeenCalled()
  })

  it('tries the form for every pick when the lookup is down, and passes on its "already"', async () => {
    lookupFails = true
    formAnswer['events-training-funding'] = 'already'
    const res = await post({
      email: EMAIL,
      newsletters: ['events', 'training', 'funding'],
    })
    expect(await res.json()).toEqual({ ok: true, already: true })
    expect(posted).toEqual(['events-training-funding'])
    expect(h.recordAddressSend).not.toHaveBeenCalled()
  })

  it("answers 503 for a combination whose form isn't filled in, without sending", async () => {
    const res = await post({
      email: EMAIL,
      newsletters: ['events', 'training'],
    })
    expect(res.status).toBe(503)
    expect((await res.json()).reason).toBe('not_configured')
    expect(posted).toEqual([])
  })

  it('answers as usual without sending again once an address had its tries', async () => {
    h.addressAllowed.mockResolvedValueOnce(false)
    const res = await post({ email: EMAIL, newsletters: ['events', 'funding'] })
    expect(await res.json()).toEqual({ ok: true })
    expect(posted).toEqual([])
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
    await post({ email: EMAIL, newsletters: ['events', 'funding'] })
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

describe('POST /api/subscribe on the live site: subscribed at once', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production')
  })

  it('subscribes a new reader to every newsletter they picked, with no click', async () => {
    const res = await post({ email: EMAIL, newsletters: ['funding', 'events'] })
    expect(await res.json()).toEqual({ ok: true, added: ['events', 'funding'] })
    // Subscribed (1), marked as made through the API (source 4).
    expect(listWrites).toEqual(['501:6:1:4', '501:8:1:4'])
    expect(statuses.get('501')).toEqual({ '6': '1', '8': '1' })
  })

  it("subscribes a box's signup too", async () => {
    const res = await post({ email: EMAIL, newsletter: 'training', hp: '' })
    expect(await res.json()).toEqual({ ok: true })
    expect(posted).toEqual(['training'])
    expect(listWrites).toEqual(['501:7:1:4'])
  })

  it('changes only the lists the form left unconfirmed', async () => {
    contacts.set(LOWER, '77')
    // Already on Events; bounced on Funding, which the form can't undo.
    statuses.set('77', { '6': '1', '8': '3' })
    vi.stubGlobal(
      'fetch',
      (
        (inner: typeof fetch) =>
        async (url: string | URL, init?: RequestInit) => {
          const res = await inner(url, init)
          // The pretend form marks Funding unconfirmed; put the bounce back.
          if (String(url).includes('/proc.php')) {
            statuses.set('77', { ...statuses.get('77'), '8': '3' })
          }
          return res
        }
      )(globalThis.fetch)
    )
    const res = await post({
      email: EMAIL,
      newsletters: ['events', 'training', 'funding'],
    })
    expect(await res.json()).toEqual({
      ok: true,
      added: ['training', 'funding'],
    })
    expect(listWrites).toEqual(['77:7:1:4'])
    expect(statuses.get('77')).toEqual({ '6': '1', '7': '1', '8': '3' })
  })

  it("waits for the reader's click once the day passes the alert line", async () => {
    h.countSignupToday.mockResolvedValueOnce({
      day: '2026-11-12',
      count: DAILY_ALERT_AFTER + 1,
      alert: false,
    })
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(await res.json()).toEqual({ ok: true, confirm: true })
    expect(posted).toEqual(['events'])
    expect(listWrites).toEqual([])
    expect(statuses.get('501')).toEqual({ '6': '0' })
  })

  it('still subscribes at once on the last signup before the alert line', async () => {
    h.countSignupToday.mockResolvedValueOnce({
      day: '2026-11-12',
      count: DAILY_ALERT_AFTER,
      alert: false,
    })
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(await res.json()).toEqual({ ok: true })
    expect(listWrites).toEqual(['501:6:1:4'])
  })

  it('subscribes at once while Upstash cannot count the day', async () => {
    h.countSignupToday.mockResolvedValueOnce(null)
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(await res.json()).toEqual({ ok: true })
    expect(listWrites).toEqual(['501:6:1:4'])
  })

  it("tells the reader to press the email's button when ActiveCampaign won't take the change", async () => {
    writeStatus = 500
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, confirm: true })
    expect(statuses.get('501')).toEqual({ '6': '0' })
    expect(logs.join('\n')).toContain("couldn't subscribe the reader at once")
  })

  it("tries once more when the form's contact isn't there yet", async () => {
    vi.useFakeTimers()
    try {
      lookupsBeforeContact = 1
      const answer = post({ email: EMAIL, newsletter: 'events' })
      await vi.advanceTimersByTimeAsync(1500)
      expect(await (await answer).json()).toEqual({ ok: true })
      expect(listWrites).toEqual(['501:6:1:4'])
    } finally {
      vi.useRealTimers()
    }
  })

  it("answers that the email's button finishes it when the contact never shows", async () => {
    vi.useFakeTimers()
    try {
      lookupsBeforeContact = 5
      const answer = post({ email: EMAIL, newsletter: 'events' })
      await vi.advanceTimersByTimeAsync(1500)
      expect(await (await answer).json()).toEqual({ ok: true, confirm: true })
      expect(listWrites).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
