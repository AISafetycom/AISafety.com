import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AnalyticsEvent } from './events'

// What reached the shared store, the rate limiter and the laptop's file.
const h = vi.hoisted(() => ({
  writes: [] as string[],
  limits: 0,
  appendFile: vi.fn(async () => {}),
}))

vi.mock('@upstash/redis', () => {
  class FakeRedis {
    pipeline() {
      const p = {
        lpush(key: string) {
          h.writes.push(`lpush ${key}`)
          return p
        },
        zadd() {
          h.writes.push('zadd')
          return p
        },
        hsetnx() {
          h.writes.push('hsetnx')
          return p
        },
        async exec() {
          return []
        },
      }
      return p
    }
  }
  return { Redis: FakeRedis }
})

vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow() {
      return {}
    }
    async limit() {
      h.limits += 1
      return { success: true }
    }
  }
  return { Ratelimit }
})

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(async () => undefined),
      appendFile: h.appendFile,
    },
  }
})

let events: typeof import('./events')
beforeAll(async () => {
  // The Upstash keys are set everywhere, as Vercel sets them for every
  // environment.
  process.env.KV_REST_API_URL = 'https://fake.upstash.test'
  process.env.KV_REST_API_TOKEN = 'fake'
  events = await import('./events')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const view: AnalyticsEvent = {
  type: 'page_view',
  page: '/events',
  vid: 'v1',
  ts: '2026-10-13T12:00:00.000Z',
}

async function track(env: { VERCEL_ENV?: string; NODE_ENV?: string }) {
  h.writes.length = 0
  h.limits = 0
  h.appendFile.mockClear()
  if (env.VERCEL_ENV) vi.stubEnv('VERCEL_ENV', env.VERCEL_ENV)
  else delete process.env.VERCEL_ENV
  if (env.NODE_ENV) vi.stubEnv('NODE_ENV', env.NODE_ENV)
  if (await events.allowTrack('203.0.113.7')) await events.recordEvent(view)
  return {
    store: [...h.writes],
    limited: h.limits,
    file: h.appendFile.mock.calls.length,
  }
}

describe('where an event is recorded', () => {
  it('the live site writes it to the shared store', async () => {
    expect(
      await track({ VERCEL_ENV: 'production', NODE_ENV: 'production' })
    ).toEqual({
      store: ['lpush aisafety:analytics:events:2026-10', 'zadd', 'hsetnx'],
      limited: 1,
      file: 0,
    })
  })

  it('a preview deployment records nothing, and leaves the store alone', async () => {
    expect(
      await track({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })
    ).toEqual({ store: [], limited: 0, file: 0 })
  })

  it('a dev server keeps to its own file, even with the keys pulled in', async () => {
    expect(
      await track({ VERCEL_ENV: 'development', NODE_ENV: 'development' })
    ).toEqual({ store: [], limited: 0, file: 1 })
    expect(await track({ NODE_ENV: 'development' })).toEqual({
      store: [],
      limited: 0,
      file: 1,
    })
    // `vercel env pull --environment=production` writes VERCEL_ENV too.
    expect(
      await track({ VERCEL_ENV: 'production', NODE_ENV: 'development' })
    ).toEqual({ store: [], limited: 0, file: 1 })
  })

  it('a production server without VERCEL_ENV still records: real visits are never dropped', async () => {
    // The month and the visitor were registered by the first test's write,
    // so only the event itself is sent this time.
    expect(await track({ NODE_ENV: 'production' })).toEqual({
      store: ['lpush aisafety:analytics:events:2026-10'],
      limited: 1,
      file: 0,
    })
  })
})

describe('fromTestCopy', () => {
  it('picks out events sent from a preview deployment or a laptop', () => {
    for (const ref of [
      'https://ai-safety-com-git-hire-page-alignmentdevs-projects.vercel.app/hire',
      'https://ai-safety-cswbtd3ri-alignmentdevs-projects.vercel.app/',
      'https://ai-safety-com.vercel.app/events',
      'http://localhost:3000/map',
      'http://LOCALHOST:3400',
      'http://app.localhost:3000/',
      'http://127.0.0.1:3437/jobs?x=1',
      'http://[::1]:3000/',
    ])
      expect(events.fromTestCopy(ref), ref).toBe(true)
  })

  it('keeps the live site, events without an address, and anything else', () => {
    for (const ref of [
      undefined,
      '',
      'https://aisafety.com/events',
      'https://www.aisafety.com/',
      // Bots that fake the page address aren't the team testing.
      'https://www.google.com/',
      'https://vercel.app.example.com/',
      'not a url',
    ])
      expect(events.fromTestCopy(ref), String(ref)).toBe(false)
  })
})
