import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkShareInput,
  isShareToken,
  parseShare,
  sameLeftOut,
  shareForQuery,
  type OrgShare,
} from './org-shares'

// An in-memory stand-in for Upstash: one hash per key, as the live site
// writes them. The client returns JSON values already parsed, like the real
// one does by default.
const hashes = new Map<string, Map<string, unknown>>()
const hash = (key: string) => {
  let h = hashes.get(key)
  if (!h) hashes.set(key, (h = new Map()))
  return h
}
const parsed = (v: unknown) => {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

vi.mock('@upstash/redis', () => {
  class FakeRedis {
    async hget(key: string, field: string) {
      return parsed(hash(key).get(field) ?? null)
    }
    async hset(key: string, values: Record<string, unknown>) {
      for (const [f, v] of Object.entries(values)) hash(key).set(f, v)
      return Object.keys(values).length
    }
    pipeline() {
      const ops: (() => unknown)[] = []
      const p = {
        hgetall(key: string) {
          ops.push(() => {
            const h = hashes.get(key)
            return h && h.size
              ? Object.fromEntries([...h].map(([f, v]) => [f, parsed(v)]))
              : null
          })
          return p
        },
        hdel(key: string, field: string) {
          ops.push(() => (hash(key).delete(field) ? 1 : 0))
          return p
        },
        hincrby(key: string, field: string, by: number) {
          ops.push(() => {
            const n = Number(hash(key).get(field) ?? 0) + by
            hash(key).set(field, n)
            return n
          })
          return p
        },
        hset(key: string, values: Record<string, unknown>) {
          ops.push(() => {
            for (const [f, v] of Object.entries(values)) hash(key).set(f, v)
            return Object.keys(values).length
          })
          return p
        },
        async exec() {
          return ops.map(op => op())
        },
      }
      return p
    }
  }
  return { Redis: FakeRedis }
})

const share = (over: Partial<OrgShare> = {}): OrgShare => ({
  token: 'AAAAAAAAAAAAAAAAAAAAAA',
  query: 'Lens',
  leftOut: [],
  orgName: 'Lens Academy',
  createdAt: '2026-10-13T10:00:00.000Z',
  createdBy: 'Bryce',
  updatedAt: '2026-10-13T10:00:00.000Z',
  ...over,
})

describe('isShareToken', () => {
  it('takes the 22-character base64url tokens links are made with', () => {
    expect(isShareToken('Ab3_-xYz0123456789ABCD')).toBe(true)
  })
  it('refuses anything else before any read', () => {
    expect(isShareToken('')).toBe(false)
    expect(isShareToken('short')).toBe(false)
    expect(isShareToken('Ab3_-xYz0123456789ABCDE')).toBe(false)
    expect(isShareToken('Ab3_-xYz0123456789ABC=')).toBe(false)
    expect(isShareToken('../../admin/analytics0')).toBe(false)
  })
})

describe('parseShare', () => {
  it('reads a stored link, as text or as the parsed object', () => {
    const { token, ...stored } = share({ leftOut: ['abc', 'def'] })
    expect(parseShare(token, JSON.stringify(stored))).toEqual(
      share({ leftOut: ['abc', 'def'] })
    )
    expect(parseShare(token, stored)).toEqual(
      share({ leftOut: ['abc', 'def'] })
    )
  })
  it('drops malformed left-out hashes, as ?x= does', () => {
    const { token, ...stored } = share({ leftOut: ['abc', 'NOT A HASH!', 'x'] })
    expect(parseShare(token, stored)?.leftOut).toEqual(['abc', 'x'])
  })
  it('is null for anything that is not a link', () => {
    expect(parseShare('t', '{not json')).toBeNull()
    expect(parseShare('t', null)).toBeNull()
    expect(parseShare('t', { query: 'Lens' })).toBeNull()
    expect(parseShare('t', 42)).toBeNull()
  })
})

describe('sameLeftOut', () => {
  it('compares the rows, not their order or repeats', () => {
    expect(sameLeftOut(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameLeftOut(['a', 'a'], ['a'])).toBe(true)
    expect(sameLeftOut([], [])).toBe(true)
    expect(sameLeftOut(['a'], ['a', 'b'])).toBe(false)
    expect(sameLeftOut(['a'], ['b'])).toBe(false)
  })
})

describe('checkShareInput', () => {
  it('takes the tab’s search, left-out rows, and org name', () => {
    expect(
      checkShareInput({
        query: '  Lens  ',
        leftOut: ['abc', 'def'],
        orgName: 'Lens Academy',
      })
    ).toEqual({
      query: 'Lens',
      leftOut: ['abc', 'def'],
      orgName: 'Lens Academy',
    })
  })
  it('refuses a search shorter than the tab allows', () => {
    expect(
      checkShareInput({ query: 'L', leftOut: [], orgName: 'Lens' })
    ).toBeNull()
    expect(
      checkShareInput({ query: '!!', leftOut: [], orgName: 'Lens' })
    ).toBeNull()
  })
  it('refuses a missing org name and a malformed or oversized left-out list', () => {
    expect(
      checkShareInput({ query: 'Lens', leftOut: [], orgName: ' ' })
    ).toBeNull()
    expect(checkShareInput({ query: 'Lens', orgName: 'Lens' })).toBeNull()
    expect(
      checkShareInput({ query: 'Lens', leftOut: [1], orgName: 'Lens' })
    ).toBeNull()
    expect(
      checkShareInput({
        query: 'Lens',
        leftOut: Array.from({ length: 51 }, (_, i) => `h${i}`),
        orgName: 'Lens',
      })
    ).toBeNull()
  })
  it('caps the search and the name', () => {
    const out = checkShareInput({
      query: 'L'.repeat(300),
      leftOut: [],
      orgName: 'N'.repeat(300),
    })
    expect(out?.query).toHaveLength(100)
    expect(out?.orgName).toHaveLength(120)
  })
})

describe('shareForQuery', () => {
  it('finds a search’s link by its words, whatever the case or spacing', () => {
    const list = [
      share({ query: 'Lens Academy' }),
      share({ token: 'B'.repeat(22), query: 'BlueDot' }),
    ]
    expect(shareForQuery(list, 'lens   academy')?.query).toBe('Lens Academy')
    expect(shareForQuery(list, 'bluedot')?.token).toBe('B'.repeat(22))
    expect(shareForQuery(list, 'Lens')).toBeUndefined()
  })
})

describe('the store', () => {
  let store: typeof import('./org-shares')

  beforeAll(async () => {
    process.env.KV_REST_API_URL = 'https://fake.upstash.example'
    process.env.KV_REST_API_TOKEN = 'fake'
    vi.resetModules()
    store = await import('./org-shares')
  })
  beforeEach(() => hashes.clear())

  it('makes a link with an unguessable token and reads it back', async () => {
    const made = await store.saveShare(
      { query: 'Lens', leftOut: ['abc'], orgName: 'Lens Academy' },
      'Bryce'
    )
    expect(store.isShareToken(made.token)).toBe(true)
    expect(await store.getShare(made.token)).toEqual(made)
    expect(await store.getShare('Z'.repeat(22))).toBeNull()
  })

  it('keeps one link per search: sharing again keeps the address and updates what it leaves out', async () => {
    const first = await store.saveShare(
      { query: 'Lens', leftOut: [], orgName: 'Lens Academy' },
      'Bryce'
    )
    const again = await store.saveShare(
      { query: 'LENS', leftOut: ['abc'], orgName: 'Lens Academy' },
      'plex'
    )
    expect(again.token).toBe(first.token)
    expect(again.leftOut).toEqual(['abc'])
    expect(again.query).toBe('Lens')
    expect(again.createdBy).toBe('Bryce')
    expect(await store.listShares()).toHaveLength(1)
  })

  it('stores only the link’s own fields when updating, never its view counts', async () => {
    const made = await store.saveShare(
      { query: 'Lens', leftOut: [], orgName: 'Lens Academy' },
      'Bryce'
    )
    await store.countShareView(made.token)
    await store.saveShare(
      { query: 'Lens', leftOut: ['abc'], orgName: 'Lens Academy' },
      'Bryce'
    )
    const stored = JSON.parse(
      String(hashes.get('aisafety:analytics:org-shares')?.get(made.token))
    )
    expect(Object.keys(stored).sort()).toEqual([
      'createdAt',
      'createdBy',
      'leftOut',
      'orgName',
      'query',
      'updatedAt',
    ])
  })

  it('counts openings and lists them with each link', async () => {
    const made = await store.saveShare(
      { query: 'Lens', leftOut: [], orgName: 'Lens Academy' },
      'Bryce'
    )
    await store.countShareView(made.token)
    await store.countShareView(made.token)
    const [listed] = await store.listShares()
    expect(listed.views).toBe(2)
    expect(listed.lastViewedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
  })

  it('switches a link off for good, with its counts', async () => {
    const made = await store.saveShare(
      { query: 'Lens', leftOut: [], orgName: 'Lens Academy' },
      'Bryce'
    )
    await store.countShareView(made.token)
    expect(await store.removeShare(made.token)).toBe(true)
    expect(await store.getShare(made.token)).toBeNull()
    expect(await store.listShares()).toEqual([])
    expect(await store.removeShare(made.token)).toBe(false)
    // Sharing the search again makes a new address; the old one stays dead.
    const remade = await store.saveShare(
      { query: 'Lens', leftOut: [], orgName: 'Lens Academy' },
      'Bryce'
    )
    expect(remade.token).not.toBe(made.token)
    expect(await store.getShare(made.token)).toBeNull()
  })

  it('never reads the store for a malformed token', async () => {
    expect(await store.getShare('nope')).toBeNull()
    expect(await store.removeShare('nope')).toBe(false)
  })
})
