import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In preview, the nav badges come from the public /api/counts. A
// force-static page (the newsletter pages) sees empty request headers, so
// the address must come from the deployment itself; reading Airtable live
// is the last resort. Every Airtable read here is a counted fake.

const request = vi.hoisted(() => ({ headers: new Headers() }))
const airtable = vi.hoisted(() => ({ reads: 0 }))

vi.mock('next/headers', () => ({
  headers: async () => request.headers,
}))
vi.mock('@/lib/preview', () => ({ isPreviewRequest: async () => true }))
vi.mock('./public-api', () => ({ hasAirtableCredentials: () => true }))
vi.mock('./airtable', () => ({
  fetchAirtableRecords: async () => {
    airtable.reads++
    return []
  },
}))
const none = async () => {
  airtable.reads++
  return []
}
vi.mock('./advisors', () => ({ getAdvisors: none }))
vi.mock('./communities', () => ({ getCommunities: none }))
vi.mock('./events', () => ({ getEvents: none }))
vi.mock('./founders', () => ({ getFounderResources: none }))
vi.mock('./funding', () => ({ getFunders: none }))
vi.mock('./jobs', () => ({ getJobs: none }))
vi.mock('./map', () => ({ getMapData: none }))
vi.mock('./media-channels', () => ({ getMediaChannels: none }))
vi.mock('./self-study', () => ({ getCourses: none }))
vi.mock('./training', () => ({
  getTrainingPrograms: none,
  getRecurringPrograms: none,
}))

const PUBLIC = { '/events': 41, '/training': 87 }
const fetched: string[] = []

beforeEach(() => {
  // A fresh module each time: the preview memo would otherwise carry over.
  vi.resetModules()
  request.headers = new Headers()
  airtable.reads = 0
  fetched.length = 0
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url)
    return new Response(JSON.stringify(PUBLIC))
  })
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '')
  vi.stubEnv('VERCEL_URL', '')
  vi.stubEnv('PORT', '')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function counts() {
  const { fetchAllCounts } = await import('./counts')
  return fetchAllCounts()
}

describe('preview nav counts', () => {
  it("reads them from the request's own host when it has one", async () => {
    request.headers = new Headers({
      host: 'ai-safety-com-git-branch.vercel.app',
    })
    expect(await counts()).toEqual(PUBLIC)
    expect(fetched).toEqual([
      'https://ai-safety-com-git-branch.vercel.app/api/counts',
    ])
    expect(airtable.reads).toBe(0)
  })

  it('reads them from the production domain when the headers are hidden', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'aisafety.com')
    vi.stubEnv('VERCEL_URL', 'ai-safety-com-abc123.vercel.app')
    expect(await counts()).toEqual(PUBLIC)
    expect(fetched).toEqual(['https://aisafety.com/api/counts'])
    expect(airtable.reads).toBe(0)
  })

  it("reads them from a Vercel preview's own address when the headers are hidden", async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_URL', 'ai-safety-com-abc123.vercel.app')
    expect(await counts()).toEqual(PUBLIC)
    expect(fetched).toEqual([
      'https://ai-safety-com-abc123.vercel.app/api/counts',
    ])
  })

  it('reads them from the local server when the headers are hidden', async () => {
    vi.stubEnv('PORT', '3512')
    expect(await counts()).toEqual(PUBLIC)
    expect(fetched).toEqual(['http://localhost:3512/api/counts'])
    expect(airtable.reads).toBe(0)
  })

  it('reads Airtable live only when no address is known', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await counts()
    expect(fetched).toEqual([])
    expect(airtable.reads).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('request has no host header')
    )
    warn.mockRestore()
  })
})
