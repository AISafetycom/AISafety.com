import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// Funding's lined-up count runs from the listings that were accepting
// applications when the last Funding issue was approved. Pen's snapshot
// after Issue #22 stood in until Issue #23 noted the first one (14 Oct
// 2026); now nothing does. Upstash is an in-memory stand-in and the funders
// are fixed.

const strings = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@upstash/redis', () => ({
  Redis: class {
    async get(key: string) {
      return strings.get(key) ?? null
    }
    async set(key: string, value: unknown) {
      strings.set(key, value)
      return 'OK'
    }
  },
}))

vi.mock('@/lib/data/funding', () => ({
  getFunders: async () => [
    {
      id: 'recRolling',
      name: 'Rolling',
      applicationStatus: 'Applications open',
      deadline: null,
    },
    {
      id: 'recDated',
      name: 'Dated',
      applicationStatus: 'Applications open',
      deadline: '2099-12-01',
    },
    {
      id: 'recPassed',
      name: 'Deadline passed',
      applicationStatus: 'Applications open',
      deadline: '2020-01-31',
    },
    {
      id: 'recClosed',
      name: 'Closed',
      applicationStatus: 'Not currently accepting applications',
      deadline: null,
    },
    {
      id: 'recInvite',
      name: 'Invite only',
      applicationStatus: 'Invite only, no applications',
      deadline: null,
    },
  ],
}))

let m: typeof import('./newsletter-lineup')
beforeAll(async () => {
  vi.stubEnv('KV_REST_API_URL', 'https://fake.upstash.test')
  vi.stubEnv('KV_REST_API_TOKEN', 'fake')
  m = await import('./newsletter-lineup')
})
afterAll(() => {
  vi.unstubAllEnvs()
})
beforeEach(() => {
  strings.clear()
})

describe('Funding baseline', () => {
  it('has no stand-in before an approval notes one', async () => {
    await expect(m.readFundingBaseline()).rejects.toThrow(
      'aisafety:newsletter:funding-baseline'
    )
  })
  it('counts from the listings accepting when the issue was approved', async () => {
    await m.saveFundingBaseline('Funding · Issue #23, 2026')
    expect(await m.readFundingBaseline()).toMatchObject({
      issue: 'Funding · Issue #23, 2026',
      accepting: ['recRolling', 'recDated'],
    })
  })
})
