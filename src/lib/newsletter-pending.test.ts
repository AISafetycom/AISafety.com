import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The several-newsletters signups kept until their confirmation, and the
// cron run that finishes them, with a pretend Upstash and a pretend
// ActiveCampaign. Nothing touches the network.

const h = vi.hoisted(() => {
  process.env.KV_REST_API_URL = 'https://kv.test'
  process.env.KV_REST_API_TOKEN = 'kv-token'
  return {
    data: new Map<string, unknown>(),
    ttl: new Map<string, number>(),
    sets: new Map<string, Set<string>>(),
  }
})

vi.mock('@upstash/redis', () => ({
  Redis: class {
    async set(key: string, value: unknown, opts?: { ex?: number }) {
      h.data.set(key, value)
      if (opts?.ex) h.ttl.set(key, opts.ex)
      return 'OK'
    }
    async get(key: string) {
      return h.data.get(key) ?? null
    }
    async del(key: string) {
      return h.data.delete(key) ? 1 : 0
    }
    async sadd(key: string, member: string) {
      const s = h.sets.get(key) ?? new Set<string>()
      h.sets.set(key, s)
      s.add(member)
      return 1
    }
    async smembers(key: string) {
      return [...(h.sets.get(key) ?? [])]
    }
    async srem(key: string, member: string) {
      return h.sets.get(key)?.delete(member) ? 1 : 0
    }
  },
}))

import { finishPending, savePending } from './newsletter-pending'

const API = 'https://ac.test/api/3/'
const PREFIX = 'aisafety:newsletter:pending:local'

let statuses: Map<string, Record<string, string> | 'gone' | 'down'>
let writes: string[]

beforeEach(() => {
  h.data.clear()
  h.ttl.clear()
  h.sets.clear()
  vi.stubEnv('ACTIVECAMPAIGN_URL', 'https://ac.test')
  vi.stubEnv('ACTIVECAMPAIGN_KEY', 'test-api-key')
  statuses = new Map()
  writes = []
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const lists = /contacts\/(\d+)\/contactLists$/.exec(u)
    if (lists) {
      const s = statuses.get(lists[1])
      if (s === 'gone') return new Response('{}', { status: 404 })
      if (s === 'down') return new Response('down', { status: 503 })
      return Response.json({
        contactLists: Object.entries(s ?? {}).map(([list, status]) => ({
          list,
          status,
        })),
      })
    }
    if (u === `${API}contactLists` || u === `${API}fieldValues`) {
      writes.push(`${u.slice(API.length)} ${String(init?.body)}`)
      return Response.json({})
    }
    throw new Error(`unexpected request ${u}`)
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('savePending', () => {
  it('keeps the signup for 14 days, filed under this environment', async () => {
    await savePending('501', '6', ['7', '8'])
    expect(h.data.get(`${PREFIX}:501`)).toMatchObject({
      waitFor: '6',
      add: ['7', '8'],
    })
    expect(h.ttl.get(`${PREFIX}:501`)).toBe(14 * 86_400)
    expect([...(h.sets.get(`${PREFIX}:ids`) ?? [])]).toEqual(['501'])
  })
})

describe('finishPending', () => {
  it('leaves an unconfirmed signup waiting', async () => {
    await savePending('501', '6', ['8'])
    statuses.set('501', { '6': '0' })
    expect(await finishPending()).toEqual({
      finished: 0,
      waiting: 1,
      dropped: 0,
      failed: 0,
    })
    expect(h.data.has(`${PREFIX}:501`)).toBe(true)
    expect(writes).toEqual([])
  })

  it('adds a confirmed reader to the rest on the live site, then forgets the signup', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    await savePending('501', '6', ['7', '8'])
    // Already on Training some other way: only Funding is added.
    statuses.set('501', { '6': '1', '7': '1' })
    expect((await finishPending()).finished).toBe(1)
    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes[0].split(' ').slice(1).join(' '))).toEqual({
      contactList: { list: '8', contact: '501', status: 1, sourceid: 4 },
    })
    expect(writes[1]).toMatch(/^fieldValues /)
    expect(h.data.has(`${PREFIX}:501`)).toBe(false)
    expect(h.sets.get(`${PREFIX}:ids`)?.has('501')).toBe(false)
  })

  it('writes nothing outside the live site', async () => {
    await savePending('501', '6', ['8'])
    statuses.set('501', { '6': '1' })
    expect((await finishPending()).finished).toBe(1)
    expect(writes).toEqual([])
  })

  it('drops an expired signup and a deleted contact', async () => {
    await savePending('501', '6', ['8'])
    await savePending('502', '7', ['8'])
    h.data.delete(`${PREFIX}:501`)
    statuses.set('502', 'gone')
    expect(await finishPending()).toEqual({
      finished: 0,
      waiting: 0,
      dropped: 2,
      failed: 0,
    })
    expect(h.sets.get(`${PREFIX}:ids`)?.size).toBe(0)
  })

  it('keeps a signup it could not check, for the next run', async () => {
    await savePending('501', '6', ['8'])
    statuses.set('501', 'down')
    expect((await finishPending()).failed).toBe(1)
    expect(h.data.has(`${PREFIX}:501`)).toBe(true)
  })
})
