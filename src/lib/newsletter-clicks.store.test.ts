import { createHash } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// The parts of newsletter-clicks.ts that talk to the Blob store and Upstash:
// reading a list (Blob, then its Upstash copy, then nothing), keeping the
// copy, and the burst rule. fetch is stubbed per test; Upstash is an
// in-memory stand-in shared by every client, as the module's two clients
// share one database.

const strings = new Map<string, string>()
const zsets = new Map<string, Map<string, number>>()
const ttls = new Map<string, number>()
const hashes = new Map<string, Map<string, number>>()
const redis = vi.hoisted(() => ({ hang: false, down: false }))

vi.mock('@upstash/redis', () => {
  class FakeRedis {
    async set(key: string, value: string, opts?: { nx?: boolean }) {
      if (redis.down) throw new Error('store down')
      if (opts?.nx && strings.has(key)) return null
      strings.set(key, value)
      return 'OK'
    }
    async get(key: string) {
      if (redis.hang) return new Promise(() => {})
      if (redis.down) throw new Error('store down')
      return strings.get(key) ?? null
    }
    async zrange(
      key: string,
      min: number,
      max: number,
      opts: { byScore?: boolean; withScores?: boolean }
    ) {
      if (!opts.byScore || !opts.withScores) throw new Error('unexpected')
      return [...(zsets.get(key) ?? new Map<string, number>())]
        .filter(([, s]) => s >= min && s <= max)
        .sort((a, b) => a[1] - b[1])
        .flatMap(([m, s]) => [m, s])
    }
    pipeline() {
      const ops: (() => unknown)[] = []
      const p = {
        zadd(
          key: string,
          { score, member }: { score: number; member: string }
        ) {
          ops.push(() => {
            const z = zsets.get(key) ?? new Map<string, number>()
            z.set(member, score)
            zsets.set(key, z)
            return 1
          })
          return p
        },
        expire(key: string, seconds: number) {
          ops.push(() => ttls.set(key, seconds))
          return p
        },
        hincrby(key: string, field: string, by: number) {
          ops.push(() => {
            const h = hashes.get(key) ?? new Map<string, number>()
            h.set(field, (h.get(field) ?? 0) + by)
            hashes.set(key, h)
            return h.get(field)
          })
          return p
        },
        async exec() {
          if (redis.down) throw new Error('store down')
          return ops.map(op => op())
        },
      }
      return p
    }
  }
  return { Redis: FakeRedis }
})

type Mod = typeof import('./newsletter-clicks')
let m: Mod
const saved = {
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
}
beforeAll(async () => {
  process.env.KV_REST_API_URL = 'https://fake.upstash.test'
  process.env.KV_REST_API_TOKEN = 'fake'
  m = await import('./newsletter-clicks')
})
afterAll(() => {
  process.env.KV_REST_API_URL = saved.url
  process.env.KV_REST_API_TOKEN = saved.token
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  redis.hang = false
  redis.down = false
})

/** A list as the pipeline writes it, and the name it gets. Each test uses
 *  its own campaign name: lists are remembered per instance by name. */
function make(campaign: string) {
  const json = JSON.stringify({
    v: 1,
    c: campaign,
    links: [
      { u: 'https://www.aisafety.com/?utm_source=x', k: 'page', t: 'Home' },
      { u: 'https://lensacademy.org/', k: 'recfEPy5dMqKPzLAc', t: 'Lens' },
    ],
  })
  const id = createHash('sha256').update(json).digest('hex').slice(0, 16)
  return { json, id }
}

const blob = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status }))

/** Collects what the route would run after the redirect. */
function laterQueue() {
  const tasks: (() => Promise<void>)[] = []
  return {
    later: (task: () => Promise<void>) => void tasks.push(task),
    run: () => Promise.all(tasks.map(t => t())),
  }
}

describe('loadLinkList', () => {
  it('reads the Blob, with a time limit, and keeps a copy after the redirect', async () => {
    const { json, id } = make('Events · Week 41, 2026')
    const fetchMock = blob(json)
    vi.stubGlobal('fetch', fetchMock)
    const q = laterQueue()
    const list = await m.loadLinkList(id, q.later)
    expect(list?.links[1].u).toBe('https://lensacademy.org/')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).toBe(`${m.LINKS_BASE}${id}.json`)
    expect(init.signal).toBeInstanceOf(AbortSignal)
    // The copy waits for after(), never the reader.
    expect(strings.has(`aisafety:newsletter:links:${id}`)).toBe(false)
    await q.run()
    expect(strings.get(`aisafety:newsletter:links:${id}`)).toBe(json)
  })

  it('never overwrites a copy it already has', async () => {
    const { json, id } = make('Events · Week 42, 2026')
    strings.set(`aisafety:newsletter:links:${id}`, json)
    vi.stubGlobal('fetch', blob(json))
    const q = laterQueue()
    await m.loadLinkList(id, q.later)
    await q.run()
    expect(strings.get(`aisafety:newsletter:links:${id}`)).toBe(json)
  })

  it('uses the Upstash copy when the Blob answers 404', async () => {
    const { json, id } = make('Training · Week 41, 2026')
    strings.set(`aisafety:newsletter:links:${id}`, json)
    vi.stubGlobal('fetch', blob('not found', 404))
    const list = await m.loadLinkList(id)
    expect(list?.c).toBe('Training · Week 41, 2026')
  })

  it('never uses or copies a Blob list that no longer matches its name', async () => {
    const { json, id } = make('Training · Week 42, 2026')
    const tampered = json.replace('lensacademy.org', 'evil.example')
    vi.stubGlobal('fetch', blob(tampered))
    const q = laterQueue()
    expect(await m.loadLinkList(id, q.later)).toBeNull()
    await q.run()
    expect(strings.has(`aisafety:newsletter:links:${id}`)).toBe(false)
    // With a good copy in Upstash, the copy wins.
    strings.set(`aisafety:newsletter:links:${id}`, json)
    const list = await m.loadLinkList(id, q.later)
    expect(list?.links[1].u).toBe('https://lensacademy.org/')
  })

  it('refuses an Upstash copy that does not match its name either', async () => {
    const { json, id } = make('Funding · Issue #22, 2026')
    strings.set(
      `aisafety:newsletter:links:${id}`,
      json.replace('lensacademy.org', 'evil.example')
    )
    vi.stubGlobal('fetch', blob('', 404))
    expect(await m.loadLinkList(id)).toBeNull()
  })

  it('gives up on a hanging Blob after 2.5 s, then tries the copy, then the homepage', async () => {
    const hanging = vi.fn(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason)
          )
        )
    )
    vi.stubGlobal('fetch', hanging)

    // Blob hangs, copy there: the copy, just after the time limit.
    const a = make('Events · Week 43, 2026')
    strings.set(`aisafety:newsletter:links:${a.id}`, a.json)
    let t0 = Date.now()
    expect((await m.loadLinkList(a.id))?.c).toBe('Events · Week 43, 2026')
    let waited = Date.now() - t0
    expect(waited).toBeGreaterThanOrEqual(2400)
    expect(waited).toBeLessThan(3500)

    // Blob hangs and so does Upstash: nothing (the homepage) after 4 s.
    const b = make('Events · Week 44, 2026')
    redis.hang = true
    t0 = Date.now()
    expect(await m.loadLinkList(b.id)).toBeNull()
    waited = Date.now() - t0
    expect(waited).toBeGreaterThanOrEqual(3900)
    expect(waited).toBeLessThan(5000)
  }, 10_000)

  it('lands on the homepage when neither can be read, and tries again next time', async () => {
    const { json, id } = make('Events · Week 45, 2026')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      })
    )
    redis.down = true
    expect(await m.loadLinkList(id)).toBeNull()
    redis.down = false
    vi.stubGlobal('fetch', blob(json))
    expect((await m.loadLinkList(id))?.c).toBe('Events · Week 45, 2026')
  })

  it('refuses ids that are not a list name without reading anything', async () => {
    const fetchMock = blob('{}')
    vi.stubGlobal('fetch', fetchMock)
    expect(await m.loadLinkList('../../etc/passwd')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('isScannerBurst', () => {
  const LIST = '9f2508f0afd61145'
  const burstKeys = () =>
    [...zsets.keys()].filter(k => k.startsWith('aisafety:newsletter:burst:'))

  it('does not count a scanner opening every link at once, the first clicks included', async () => {
    vi.useFakeTimers()
    const ip = '203.0.113.7'
    const checks = [0, 1, 2, 3].map(n => m.isScannerBurst(LIST, n, ip))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await Promise.all(checks)).toEqual([true, true, true, true])
    // Only a hash of the address is kept, and only for 30 s.
    const keys = burstKeys()
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) {
      expect(k).not.toContain(ip)
      expect(ttls.get(k)).toBe(30)
    }
  })

  it('counts a reader opening a couple of links, or one link twice', async () => {
    vi.useFakeTimers()
    const checks = [
      m.isScannerBurst(LIST, 0, '198.51.100.1'),
      m.isScannerBurst(LIST, 1, '198.51.100.1'),
      m.isScannerBurst(LIST, 5, '198.51.100.2'),
      m.isScannerBurst(LIST, 5, '198.51.100.2'),
      m.isScannerBurst(LIST, 5, '198.51.100.2'),
    ]
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await Promise.all(checks)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('counts links opened ten seconds apart', async () => {
    vi.useFakeTimers()
    const ip = '198.51.100.3'
    const results: boolean[] = []
    for (const n of [0, 1, 2]) {
      const check = m.isScannerBurst(LIST, n, ip)
      await vi.advanceTimersByTimeAsync(10_000)
      results.push(await check)
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(results).toEqual([false, false, false])
  })

  it('counts the click when it can’t tell (no address, store down)', async () => {
    expect(await m.isScannerBurst(LIST, 0, null)).toBe(false)
    redis.down = true
    expect(await m.isScannerBurst(LIST, 0, '198.51.100.4')).toBe(false)
  })
})

describe('recordClick', () => {
  it('counts per campaign and link, with a total', async () => {
    const link = { u: 'https://lensacademy.org/', k: 'rec1', t: 'Lens' }
    await m.recordClick('Events · Week 46, 2026', link)
    await m.recordClick('Events · Week 46, 2026', link)
    const h = hashes.get('aisafety:newsletter:clicks:Events · Week 46, 2026')
    expect(h?.get('__total')).toBe(2)
    expect(h?.get(JSON.stringify({ t: 'Lens', u: link.u }))).toBe(2)
  })
})
