import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The signup boxes' bot protection with Upstash replaced by an in-memory
// stand-in (both the Redis client and the rate limiter): the per-network and
// per-address limits, the daily count and its one alert a day, and failing
// open, with one log line, whenever Upstash is missing, failing, or slow.

const h = vi.hoisted(() => ({
  /** Every Upstash call throws. */
  down: false,
  /** Every Upstash call never answers. */
  hang: false,
  counters: new Map<string, number>(),
  strings: new Map<string, string>(),
  ttls: new Map<string, number>(),
  /** Rate-limit uses per `${prefix}:${identifier}`. */
  uses: new Map<string, number>(),
  sendAdminMail: vi.fn(async () => true),
}))

/** What every stand-in call does first. */
async function gate(): Promise<void> {
  if (h.hang) await new Promise(() => {})
  if (h.down) throw new Error('store down')
}

vi.mock('@upstash/redis', () => {
  class FakeRedis {
    pipeline() {
      const ops: (() => unknown)[] = []
      const p = {
        incr(key: string) {
          ops.push(() => {
            const n = (h.counters.get(key) ?? 0) + 1
            h.counters.set(key, n)
            return n
          })
          return p
        },
        expire(key: string, seconds: number) {
          ops.push(() => {
            h.ttls.set(key, seconds)
            return 1
          })
          return p
        },
        async exec() {
          await gate()
          return ops.map(op => op())
        },
      }
      return p
    }
    async set(
      key: string,
      value: string,
      opts?: { nx?: boolean; ex?: number }
    ) {
      await gate()
      if (opts?.nx && h.strings.has(key)) return null
      h.strings.set(key, value)
      if (opts?.ex) h.ttls.set(key, opts.ex)
      return 'OK'
    }
  }
  return { Redis: FakeRedis }
})

vi.mock('@upstash/ratelimit', () => {
  class FakeRatelimit {
    prefix: string
    tokens: number
    constructor(config: {
      prefix: string
      limiter: { tokens: number }
      timeout?: number
    }) {
      this.prefix = config.prefix
      this.tokens = config.limiter.tokens
    }
    static slidingWindow(tokens: number, window: string) {
      return { tokens, window }
    }
    async limit(id: string) {
      await gate()
      const key = `${this.prefix}:${id}`
      const used = (h.uses.get(key) ?? 0) + 1
      h.uses.set(key, used)
      return {
        success: used <= this.tokens,
        limit: this.tokens,
        remaining: Math.max(0, this.tokens - used),
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
      }
    }
    async getRemaining(id: string) {
      await gate()
      const used = h.uses.get(`${this.prefix}:${id}`) ?? 0
      return {
        remaining: Math.max(0, this.tokens - used),
        reset: Date.now() + 60_000,
        limit: this.tokens,
      }
    }
  }
  return { Ratelimit: FakeRatelimit }
})

vi.mock('@/lib/admin/mail', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/admin/mail')>()),
  sendAdminMail: h.sendAdminMail,
}))

const ENV = { ...process.env }
const EMAIL = 'Ada@Example.org'
let warn: ReturnType<typeof vi.spyOn>

/** The module, fresh, with Upstash configured (or not). */
async function limits({ store = true, mail = true } = {}) {
  vi.resetModules()
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  if (store) {
    process.env.KV_REST_API_URL = 'https://fake-upstash.example'
    process.env.KV_REST_API_TOKEN = 'fake'
  } else {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
  }
  if (mail) {
    process.env.ADMIN_MAIL_SCRIPT_URL = 'https://script.example/exec'
    process.env.ADMIN_MAIL_SECRET = 'fake'
  } else {
    delete process.env.ADMIN_MAIL_SCRIPT_URL
    delete process.env.ADMIN_MAIL_SECRET
  }
  return import('./newsletter-signup-limits')
}

beforeEach(() => {
  h.down = false
  h.hang = false
  h.counters.clear()
  h.strings.clear()
  h.ttls.clear()
  h.uses.clear()
  h.sendAdminMail.mockClear()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  process.env = { ...ENV }
})

describe('per network', () => {
  it('lets 30 signups an hour through from one IP, then stops it', async () => {
    const { ipAllowed, IP_SIGNUPS_PER_HOUR } = await limits()
    expect(IP_SIGNUPS_PER_HOUR).toBe(30)
    for (let i = 0; i < 30; i++)
      expect(await ipAllowed('203.0.113.9')).toBe(true)
    expect(await ipAllowed('203.0.113.9')).toBe(false)
    // Another network is unaffected.
    expect(await ipAllowed('198.51.100.7')).toBe(true)
  })
})

describe('per address', () => {
  it('allows 3 sends per address and newsletter in a day', async () => {
    const { addressAllowed, recordAddressSend } = await limits()
    for (let i = 0; i < 3; i++) {
      expect(await addressAllowed('events', EMAIL)).toBe(true)
      await recordAddressSend('events', EMAIL)
    }
    expect(await addressAllowed('events', EMAIL)).toBe(false)
    // The same address in another case is the same reader.
    expect(await addressAllowed('events', 'ada@example.org')).toBe(false)
    // The other newsletter and other readers keep their own counts.
    expect(await addressAllowed('training', EMAIL)).toBe(true)
    expect(await addressAllowed('events', 'bob@example.org')).toBe(true)
  })

  it('only counts what recordAddressSend records', async () => {
    const { addressAllowed } = await limits()
    for (let i = 0; i < 10; i++) {
      expect(await addressAllowed('training', EMAIL)).toBe(true)
    }
  })

  it('never stores the address itself', async () => {
    const { addressKey, recordAddressSend } = await limits()
    await recordAddressSend('events', EMAIL)
    const keys = [...h.uses.keys()]
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBe(
      `aisafety:newsletter:signup:address:${addressKey('events', EMAIL)}`
    )
    expect(keys[0]).not.toMatch(/@|ada|example/i)
    expect(addressKey('events', EMAIL)).toMatch(/^events:[0-9a-f]{32}$/)
    expect(addressKey('events', EMAIL)).toBe(
      addressKey('events', 'ada@example.org')
    )
  })
})

describe('per day', () => {
  const at = new Date('2026-10-08T15:00:00Z')

  it('counts the day in UTC, with keys that expire', async () => {
    const { countSignupToday } = await limits()
    expect(await countSignupToday(at)).toEqual({
      day: '2026-10-08',
      count: 1,
      alert: false,
    })
    expect((await countSignupToday(at))?.count).toBe(2)
    expect(
      (await countSignupToday(new Date('2026-10-09T00:00:01Z')))?.count
    ).toBe(1)
    expect(h.ttls.get('aisafety:newsletter:signup:day:2026-10-08')).toBe(
      2 * 24 * 60 * 60
    )
  })

  it('alerts exactly once a day, after 100', async () => {
    const { countSignupToday, DAILY_ALERT_AFTER } = await limits()
    expect(DAILY_ALERT_AFTER).toBe(100)
    const alerts: number[] = []
    for (let i = 1; i <= 150; i++) {
      const day = await countSignupToday(at)
      if (day?.alert) alerts.push(day.count)
    }
    expect(alerts).toEqual([101])
    // A new day can alert again.
    for (let i = 1; i <= 101; i++) {
      const day = await countSignupToday(new Date('2026-10-09T12:00:00Z'))
      if (day?.alert) alerts.push(day.count)
    }
    expect(alerts).toEqual([101, 101])
  })

  it("leaves the day's alert for a server that can send it", async () => {
    let mod = await limits({ mail: false })
    for (let i = 1; i <= 120; i++) {
      expect((await mod.countSignupToday(at))?.alert).toBe(false)
    }
    mod = await limits({ mail: true })
    expect(await mod.countSignupToday(at)).toEqual({
      day: '2026-10-08',
      count: 121,
      alert: true,
    })
  })

  it('emails the owner, owner-only', async () => {
    const { alertOwner } = await limits()
    await alertOwner({ day: '2026-10-08', count: 101, alert: true })
    expect(h.sendAdminMail).toHaveBeenCalledTimes(1)
    const [kind, to, mail] = h.sendAdminMail.mock.calls[0] as unknown as [
      string,
      string,
      { subject: string; text: string },
    ]
    expect(kind).toBe('digest')
    expect(to).toBe('bryceerobertson@gmail.com')
    expect(mail.subject).toBe('Newsletter signups passed 100 today')
    expect(mail.text).toContain('8 October 2026')
    expect(mail.text).toContain('500')
    expect(mail.text).toContain(
      'https://aisafety.com/admin/analytics?tab=newsletters'
    )
  })
})

describe('failing open', () => {
  it('skips every limit when Upstash is not configured, saying so once', async () => {
    const m = await limits({ store: false })
    for (let i = 0; i < 40; i++)
      expect(await m.ipAllowed('203.0.113.9')).toBe(true)
    await m.recordAddressSend('events', EMAIL)
    expect(await m.addressAllowed('events', EMAIL)).toBe(true)
    expect(await m.countSignupToday()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("isn't configured")
  })

  it('skips every limit while Upstash fails, logging once per outage', async () => {
    const m = await limits()
    h.down = true
    expect(await m.ipAllowed('203.0.113.9')).toBe(true)
    expect(await m.addressAllowed('events', EMAIL)).toBe(true)
    await m.recordAddressSend('events', EMAIL)
    expect(await m.countSignupToday()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('store down')
    // Back up: limits apply again; the next outage is logged again.
    h.down = false
    expect(await m.ipAllowed('203.0.113.9')).toBe(true)
    h.down = true
    expect(await m.ipAllowed('203.0.113.9')).toBe(true)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("doesn't keep a person waiting on a slow Upstash", async () => {
    vi.useFakeTimers()
    const m = await limits()
    h.hang = true
    const allowed = m.ipAllowed('203.0.113.9')
    const left = m.addressAllowed('events', EMAIL)
    const day = m.countSignupToday()
    await vi.advanceTimersByTimeAsync(1500)
    expect(await allowed).toBe(true)
    expect(await left).toBe(true)
    expect(await day).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('no answer within 1500 ms')
  })
})
