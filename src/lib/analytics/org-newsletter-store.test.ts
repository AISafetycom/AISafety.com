import { beforeAll, describe, expect, it, vi } from 'vitest'

// An in-memory stand-in for Upstash holding the sent-issues record and the
// click counts, under the keys the live site writes.
const hashes = new Map<string, Record<string, unknown>>()
const reads: string[] = []
let failCounts = false

vi.mock('@upstash/redis', () => {
  class FakeRedis {
    async hgetall(key: string) {
      reads.push(key)
      return hashes.get(key) ?? null
    }
    pipeline() {
      const keys: string[] = []
      const p = {
        hgetall(key: string) {
          keys.push(key)
          return p
        },
        async exec() {
          if (failCounts) throw new Error('Upstash down')
          reads.push(...keys)
          return keys.map(k => hashes.get(k) ?? null)
        },
      }
      return p
    }
  }
  return { Redis: FakeRedis }
})

let readIssueClicks: typeof import('./org-newsletter').readIssueClicks

beforeAll(async () => {
  process.env.KV_REST_API_URL = 'https://fake.upstash.example'
  process.env.KV_REST_API_TOKEN = 'fake'
  ;({ readIssueClicks } = await import('./org-newsletter'))
  hashes.set('aisafety:newsletter:archive:training', {
    'week-41-2026': '2026-10-08T07:00:00.000Z',
    'week-40-2026': '2026-10-01T07:00:00.000Z',
  })
  hashes.set('aisafety:newsletter:archive:events', {
    'week-41-2026': '2026-10-08T07:30:00.000Z',
  })
  hashes.set('aisafety:newsletter:clicks:Training · Week 41, 2026', {
    [JSON.stringify({
      t: 'Lens Academy: AI Control',
      u: 'https://lensacademy.org/courses/ai-control',
    })]: 12,
    __total: 12,
  })
})

const OCTOBER = {
  startMs: Date.parse('2026-10-05T00:00:00Z'),
  endMs: Date.parse('2026-10-13T23:59:59.999Z'),
}

describe('readIssueClicks', () => {
  it('reads the issues sent in the range and their link counts', async () => {
    const r = await readIssueClicks(OCTOBER)
    expect(r).toEqual({
      status: 'ok',
      issues: [
        {
          name: 'Events · Week 41, 2026',
          sentAt: '2026-10-08T07:30:00.000Z',
          links: [],
        },
        {
          name: 'Training · Week 41, 2026',
          sentAt: '2026-10-08T07:00:00.000Z',
          links: [
            {
              label: 'Lens Academy: AI Control',
              url: 'https://lensacademy.org/courses/ai-control',
              clicks: 12,
            },
          ],
        },
      ],
    })
    // Week 40 went out before the range, so its counts aren't read.
    expect(reads).not.toContain(
      'aisafety:newsletter:clicks:Training · Week 40, 2026'
    )
  })

  it('says so when the counts can’t be read, rather than showing zero', async () => {
    failCounts = true
    expect(await readIssueClicks(OCTOBER)).toEqual({ status: 'error' })
    failCounts = false
  })
})
