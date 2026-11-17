import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/check-rebuild with Airtable, Upstash and the deploy hook replaced:
// when a changed listing starts a rebuild, and when the check waits because
// the rebuild it started a moment ago isn't live yet. The route keeps a
// cooldown in module memory too, so every test loads a fresh copy of it.

const h = vi.hoisted(() => ({
  changed: vi.fn<() => Promise<boolean>>(async () => true),
  revalidateTag: vi.fn(),
  get: vi.fn<(key: string) => Promise<unknown>>(async () => null),
  set: vi.fn<(key: string, value: unknown, opts: unknown) => Promise<string>>(
    async () => 'OK'
  ),
}))

vi.mock('@/lib/data/changed-since', () => ({ hasChangesSince: h.changed }))
vi.mock('next/cache', () => ({ revalidateTag: h.revalidateTag }))
vi.mock('@upstash/redis', () => ({
  Redis: class {
    get = h.get
    set = h.set
  },
}))

const HOOK = 'https://hook.example/deploy'
const KEY = 'aisafety:check-rebuild:last-trigger'
const BUILD_TIME = '2026-11-17T06:17:50.000Z'
const BUILT = Date.parse(BUILD_TIME)
const MINUTE = 60_000

let hookCalls = 0
let hookAnswer: () => Response
let warnings: string[] = []

async function check(now: number) {
  vi.setSystemTime(now)
  const { GET } = await import('./route')
  const res = await GET(new Request('https://aisafety.com/api/check-rebuild'))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubEnv('CRON_SECRET', '')
  vi.stubEnv('AIRTABLE_TOKEN', 'token')
  vi.stubEnv('AIRTABLE_BASE_ID', 'base')
  vi.stubEnv('VERCEL_DEPLOY_HOOK_URL', HOOK)
  vi.stubEnv('BUILD_TIME', BUILD_TIME)
  vi.stubEnv('KV_REST_API_URL', 'https://fake.upstash.test')
  vi.stubEnv('KV_REST_API_TOKEN', 'fake')
  h.changed.mockReset().mockResolvedValue(true)
  h.revalidateTag.mockReset()
  h.get.mockReset().mockResolvedValue(null)
  h.set.mockReset().mockResolvedValue('OK')
  hookCalls = 0
  hookAnswer = () => new Response('{}', { status: 201 })
  vi.stubGlobal('fetch', async (url: string) => {
    if (url !== HOOK) throw new Error(`unexpected fetch: ${url}`)
    hookCalls++
    return hookAnswer()
  })
  warnings = []
  vi.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.join(' '))
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('check-rebuild', () => {
  it('does nothing when no published listing changed since the build', async () => {
    h.changed.mockResolvedValue(false)
    const { body } = await check(BUILT + 5 * MINUTE)
    expect(body.triggered).toBe(false)
    expect(hookCalls).toBe(0)
    expect(h.revalidateTag).not.toHaveBeenCalled()
    expect(h.get).not.toHaveBeenCalled()
    expect(h.set).not.toHaveBeenCalled()
  })

  it('starts a rebuild on a change, and notes when for every other instance', async () => {
    const now = BUILT + 5 * MINUTE
    const { body } = await check(now)
    expect(body.triggered).toBe(true)
    expect(hookCalls).toBe(1)
    expect(h.revalidateTag).toHaveBeenCalledWith('airtable-records', 'max')
    expect(h.set).toHaveBeenCalledWith(KEY, now, { px: 6 * MINUTE })
  })

  it('waits while the rebuild another instance just started is not live yet', async () => {
    // Triggered a minute ago, after this deployment was built.
    const now = BUILT + 5 * MINUTE
    h.get.mockResolvedValue(now - MINUTE)
    const { status, body } = await check(now)
    expect(status).toBe(200)
    expect(body).toMatchObject({ triggered: false, reason: 'build-in-flight' })
    expect(hookCalls).toBe(0)
    expect(h.set).not.toHaveBeenCalled()
    // Runtime readers still get told their data is out of date.
    expect(h.revalidateTag).toHaveBeenCalledWith('airtable-records', 'max')
  })

  it('reads the trigger time whether Upstash hands it back as a number or as text', async () => {
    const now = BUILT + 5 * MINUTE
    h.get.mockResolvedValue(String(now - MINUTE))
    const { body } = await check(now)
    expect(body.reason).toBe('build-in-flight')
    expect(hookCalls).toBe(0)
  })

  it('starts the next rebuild once the one it was waiting for is live', async () => {
    // The trigger on record is older than this deployment's own build: this
    // deployment is the build it started, and something changed since.
    h.get.mockResolvedValue(BUILT - 20_000)
    const { body } = await check(BUILT + 2 * MINUTE)
    expect(body.triggered).toBe(true)
    expect(hookCalls).toBe(1)
  })

  it('tries again when a triggered build never went live', async () => {
    // Six minutes on and still the old deployment: the build failed.
    const now = BUILT + 10 * MINUTE
    h.get.mockResolvedValue(now - 6 * MINUTE)
    const { body } = await check(now)
    expect(body.triggered).toBe(true)
    expect(hookCalls).toBe(1)
  })

  it('rebuilds anyway when the store cannot be read, and says so', async () => {
    h.get.mockRejectedValue(new Error('Upstash 503'))
    const { body } = await check(BUILT + 5 * MINUTE)
    expect(body.triggered).toBe(true)
    expect(hookCalls).toBe(1)
    expect(warnings.join('\n')).toContain('last trigger unreadable')
  })

  it('still reports the rebuild when the trigger time cannot be saved', async () => {
    h.set.mockRejectedValue(new Error('Upstash 503'))
    const { status, body } = await check(BUILT + 5 * MINUTE)
    expect(status).toBe(200)
    expect(body.triggered).toBe(true)
    expect(warnings.join('\n')).toContain('last trigger not saved')
  })

  it('records nothing when the deploy hook turns the request down', async () => {
    hookAnswer = () => new Response('', { status: 429 })
    const { body } = await check(BUILT + 5 * MINUTE)
    expect(body).toMatchObject({ triggered: false, reason: 'rate-limited' })
    expect(h.set).not.toHaveBeenCalled()
  })

  it('works without Upstash, on the in-memory cooldown alone', async () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    const now = BUILT + 5 * MINUTE
    const first = await check(now)
    expect(first.body.triggered).toBe(true)
    // Same instance a minute later: the module's own cooldown holds.
    const second = await check(now + MINUTE)
    expect(second.body).toMatchObject({
      triggered: false,
      reason: 'recent-trigger-cooldown',
    })
    expect(hookCalls).toBe(1)
    expect(h.get).not.toHaveBeenCalled()
    expect(h.set).not.toHaveBeenCalled()
  })
})
