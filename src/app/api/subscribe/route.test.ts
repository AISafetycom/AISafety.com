import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/subscribe with the limits stubbed (their own Upstash behavior is
// tested in newsletter-signup-limits.test.ts) and ActiveCampaign replaced by
// a pretend fetch: which requests reach ActiveCampaign, what the box is told,
// and that the address never reaches the log.

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
    day: '2026-10-08',
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
// Events' form filled in, Training's still at its placeholders.
vi.mock('@/lib/newsletter-signup', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/newsletter-signup')>()),
  AC_FORMS: {
    events: { formId: 12, orKey: 'a1b2c3d4e5f6' },
    training: { formId: 0, orKey: '' },
  },
}))

import { DAILY_CAP } from '@/lib/newsletter-signup-limits'
import { POST } from './route'

const EMAIL = 'Ada.Lovelace@Example.ORG'
const THANK_YOU = `_show_thank_you("12", "Thank you for subscribing!", "", "ada.lovelace@example.org");`

let acCalls: { url: string; body: URLSearchParams }[] = []
let acAnswer: () => Promise<Response>
let logs: string[] = []

function post(body: unknown, raw = false) {
  return POST(
    new NextRequest('https://aisafety.com/api/subscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: raw ? (body as string) : JSON.stringify(body),
    })
  )
}

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; error?: string; reason?: string }
}

beforeEach(() => {
  h.tasks.length = 0
  for (const fn of [
    h.ipAllowed,
    h.addressAllowed,
    h.recordAddressSend,
    h.countSignupToday,
    h.alertOwner,
  ]) {
    fn.mockClear()
  }
  h.ipAllowed.mockResolvedValue(true)
  h.addressAllowed.mockResolvedValue(true)
  h.countSignupToday.mockResolvedValue({
    day: '2026-10-08',
    count: 1,
    alert: false,
  })
  acCalls = []
  acAnswer = async () => new Response(THANK_YOU, { status: 200 })
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    acCalls.push({ url: String(url), body: init?.body as URLSearchParams })
    return acAnswer()
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
  vi.restoreAllMocks()
})

describe('POST /api/subscribe', () => {
  it('says so when the address is already subscribed, and counts no send', async () => {
    acAnswer = async () =>
      new Response(
        'window.top.location.href = "https://aisafety.com/subscribed/events";',
        { status: 200 }
      )
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, already: true })
    expect(acCalls).toHaveLength(1)
    expect(h.recordAddressSend).not.toHaveBeenCalled()
  })

  it('signs a reader up through the Events form', async () => {
    const res = await post({
      email: ` ${EMAIL} `,
      newsletter: 'events',
      hp: '',
    })
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true })
    expect(acCalls).toHaveLength(1)
    expect(acCalls[0].url).toContain('alignment23684.activehosted.com/proc.php')
    // Trimmed, with the domain lowercased.
    expect(acCalls[0].body.get('email')).toBe('Ada.Lovelace@example.org')
    expect(acCalls[0].body.get('f')).toBe('12')
    expect(acCalls[0].body.get('or')).toBe('a1b2c3d4e5f6')
    expect(h.ipAllowed).toHaveBeenCalledWith('203.0.113.9')
    expect(h.recordAddressSend).toHaveBeenCalledWith(
      'events',
      'Ada.Lovelace@example.org'
    )
  })

  it('only takes Events and Training', async () => {
    for (const newsletter of ['funding', 'updates', '', undefined, 7]) {
      const res = await post({ email: EMAIL, newsletter })
      expect(res.status).toBe(400)
      expect((await json(res)).reason).toBe('unknown_newsletter')
    }
    expect(acCalls).toHaveLength(0)
  })

  it('refuses a body that is not a JSON object', async () => {
    for (const [body, raw] of [
      ['not json', true],
      ['[]', true],
      ['null', true],
    ] as const) {
      const res = await post(body, raw)
      expect(res.status).toBe(400)
      expect(await json(res)).toEqual({
        ok: false,
        error: 'Something went wrong. Please try again in a few minutes.',
        reason: 'bad_request',
      })
    }
    expect(acCalls).toHaveLength(0)
  })

  it('tells the reader when the address cannot be one', async () => {
    const res = await post({ email: 'ada@example', newsletter: 'events' })
    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({
      ok: false,
      error:
        "That email address doesn't look right. Please check it and try again.",
      reason: 'invalid_email',
    })
    expect(acCalls).toHaveLength(0)
    expect(h.ipAllowed).not.toHaveBeenCalled()
  })

  it('answers a filled honeypot as usual, without contacting anyone', async () => {
    for (const hp of ['https://spam.example', 'x', 1]) {
      const res = await post({ email: EMAIL, newsletter: 'events', hp })
      expect(res.status).toBe(200)
      expect(await json(res)).toEqual({ ok: true })
    }
    expect(acCalls).toHaveLength(0)
    expect(h.ipAllowed).not.toHaveBeenCalled()
    expect(h.countSignupToday).not.toHaveBeenCalled()
  })

  it('answers 503 for a form that is not filled in, without sending', async () => {
    const res = await post({ email: EMAIL, newsletter: 'training', hp: '' })
    expect(res.status).toBe(503)
    expect(await json(res)).toEqual({
      ok: false,
      error:
        "Signups for this newsletter aren't open yet. Please check back soon.",
      reason: 'not_configured',
    })
    expect(acCalls).toHaveLength(0)
    expect(h.ipAllowed).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('not configured')
  })

  it('stops a network over its hourly limit', async () => {
    h.ipAllowed.mockResolvedValue(false)
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(429)
    expect(await json(res)).toEqual({
      ok: false,
      error:
        'Too many signups from your network in the last hour. Please try again later.',
      reason: 'rate_limited',
    })
    expect(acCalls).toHaveLength(0)
  })

  it('answers as usual without sending again once an address had its tries', async () => {
    h.addressAllowed.mockResolvedValue(false)
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ ok: true })
    expect(acCalls).toHaveLength(0)
    expect(h.countSignupToday).not.toHaveBeenCalled()
    expect(h.recordAddressSend).not.toHaveBeenCalled()
  })

  it('turns signups away above the daily cap', async () => {
    h.countSignupToday.mockResolvedValue({
      day: '2026-10-08',
      count: DAILY_CAP + 1,
      alert: false,
    })
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(503)
    expect(await json(res)).toEqual({
      ok: false,
      error: 'Something went wrong. Please try again in a few minutes.',
      reason: 'daily_cap',
    })
    expect(acCalls).toHaveLength(0)
  })

  it('still signs up the last one the daily cap allows', async () => {
    h.countSignupToday.mockResolvedValue({
      day: '2026-10-08',
      count: DAILY_CAP,
      alert: false,
    })
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(200)
    expect(acCalls).toHaveLength(1)
  })

  it("emails the owner after the response when the day's alert is due", async () => {
    const day = { day: '2026-10-08', count: 101, alert: true }
    h.countSignupToday.mockResolvedValue(day)
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(200)
    expect(h.alertOwner).not.toHaveBeenCalled()
    expect(h.tasks).toHaveLength(1)
    await h.tasks[0]()
    expect(h.alertOwner).toHaveBeenCalledWith(day)
  })

  it('keeps signing people up while Upstash is unavailable', async () => {
    // The limits module answers "allowed" and "no count" when it can't ask.
    h.countSignupToday.mockResolvedValue(null)
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(200)
    expect(acCalls).toHaveLength(1)
  })

  it("passes on ActiveCampaign's word that the address is invalid", async () => {
    acAnswer = async () =>
      new Response(
        '_show_error("12", "Please enter a valid email address.", "");',
        { status: 200 }
      )
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(400)
    expect((await json(res)).reason).toBe('invalid_email')
    // No confirmation went out, so the reader's tries aren't used up.
    expect(h.recordAddressSend).not.toHaveBeenCalled()
  })

  it('says something went wrong when Cloudflare turns the request away', async () => {
    acAnswer = async () =>
      new Response(
        '<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>',
        { status: 403 }
      )
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(502)
    expect(await json(res)).toEqual({
      ok: false,
      error: 'Something went wrong. Please try again in a few minutes.',
      reason: 'upstream',
    })
    expect(h.recordAddressSend).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('HTTP 403')
  })

  it('says something went wrong on a timeout, counting the send', async () => {
    acAnswer = async () => {
      throw Object.assign(new Error('The operation timed out.'), {
        name: 'TimeoutError',
      })
    }
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(502)
    expect((await json(res)).reason).toBe('upstream')
    // ActiveCampaign may have mailed a confirmation before the time ran out.
    expect(h.recordAddressSend).toHaveBeenCalledTimes(1)
  })

  it('says something went wrong on any other answer', async () => {
    acAnswer = async () =>
      new Response('<html>Maintenance</html>', { status: 200 })
    const res = await post({ email: EMAIL, newsletter: 'events' })
    expect(res.status).toBe(502)
    expect((await json(res)).reason).toBe('upstream')
  })
})
