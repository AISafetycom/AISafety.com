import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// A preview-mode view of a newsletter page lists the site's record alone,
// never waiting on ActiveCampaign, unless there's no record to list. Upstash
// is an in-memory stand-in and ActiveCampaign a counted fake.

const hashes = vi.hoisted(() => new Map<string, Record<string, string>>())
const failing = vi.hoisted(() => ({ reads: false }))
const ac = vi.hoisted(() => ({ calls: 0 }))

vi.mock('@upstash/redis', () => ({
  Redis: class {
    async hgetall(key: string) {
      if (failing.reads) throw new Error('Upstash unreachable')
      return hashes.get(key) ?? null
    }
    pipeline() {
      return { hsetnx: () => {}, exec: async () => [] }
    }
  },
}))

vi.mock('@/lib/admin/newsletter', () => ({
  sentIssuesOn: async () => {
    ac.calls++
    return [
      {
        name: 'Training · Week 43, 2026',
        sentAt: '2026-10-22T20:02:00.000Z',
        readers: 3084,
      },
    ]
  },
}))

let m: typeof import('./newsletter-archive-store')
beforeAll(async () => {
  vi.stubEnv('KV_REST_API_URL', 'https://fake.upstash.test')
  vi.stubEnv('KV_REST_API_TOKEN', 'fake')
  m = await import('./newsletter-archive-store')
})
afterAll(() => {
  vi.unstubAllEnvs()
})
beforeEach(() => {
  hashes.clear()
  failing.reads = false
  ac.calls = 0
})

describe('previewIssues', () => {
  it('lists the record alone, newest first, without asking ActiveCampaign', async () => {
    hashes.set('aisafety:newsletter:archive:training', {
      'week-41-2026': '2026-10-08T20:02:00.000Z',
      'week-43-2026': '2026-10-22T20:02:00.000Z',
      'week-42-2026': '',
    })
    expect(await m.previewIssues('training')).toEqual([
      { slug: 'week-43-2026', sentAt: '2026-10-22T20:02:00.000Z' },
      { slug: 'week-42-2026', sentAt: null },
      { slug: 'week-41-2026', sentAt: '2026-10-08T20:02:00.000Z' },
    ])
    expect(ac.calls).toBe(0)
  })

  it('asks ActiveCampaign after all when the record is empty', async () => {
    expect(await m.previewIssues('training')).toEqual([
      { slug: 'week-43-2026', sentAt: '2026-10-22T20:02:00.000Z' },
    ])
    expect(ac.calls).toBe(1)
  })

  it('asks ActiveCampaign after all when the record cannot be read', async () => {
    failing.reads = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await m.previewIssues('training')).toEqual([
      { slug: 'week-43-2026', sentAt: '2026-10-22T20:02:00.000Z' },
    ])
    expect(ac.calls).toBe(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("the record couldn't be read for a preview")
    )
    warn.mockRestore()
  })
})
