import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accessFrom, type AccessFlags } from './access'
import { cronAuthorized, requireAccess } from './auth'
import { sealToken } from './session'

// requireAccess reads the session cookie and the user list; both are faked
// here, and redirect() throws the way Next's does, so a test can see where
// a session was sent.
const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  users: new Map<string, AccessFlags>(),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'aisafety_admin_session' && h.cookie
        ? { value: h.cookie }
        : undefined,
  }),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`)
  },
}))
vi.mock('./users', () => ({
  findAdminUser: async (email: string) => {
    const access = h.users.get(email)
    return access ? { name: 'Tester', email, access } : null
  },
}))

const SECRET = 'test-secret'

function signIn(email: string, secret = SECRET, expiresIn = 3600) {
  const now = Math.floor(Date.now() / 1000)
  h.cookie = sealToken({ v: 1, email, iat: now, exp: now + expiresIn }, secret)
}

describe('requireAccess', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_SESSION_SECRET', SECRET)
    h.cookie = undefined
    h.users.clear()
    h.users.set('viewer@example.com', accessFrom(['analytics', 'queue']))
    h.users.set('preview@example.com', accessFrom(['preview']))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends a signed-out request to the login page', async () => {
    await expect(requireAccess('analytics')).rejects.toThrow(
      'redirect /admin/login'
    )
  })

  it('treats a cookie sealed with another secret as signed out', async () => {
    signIn('viewer@example.com', 'some-other-secret')
    await expect(requireAccess('analytics')).rejects.toThrow(
      'redirect /admin/login'
    )
  })

  it('treats an expired session as signed out', async () => {
    signIn('viewer@example.com', SECRET, -1)
    await expect(requireAccess('analytics')).rejects.toThrow(
      'redirect /admin/login'
    )
  })

  it('treats someone removed from the list as signed out', async () => {
    signIn('removed@example.com')
    await expect(requireAccess('queue')).rejects.toThrow(
      'redirect /admin/login'
    )
  })

  it('sends a session without the area to the first area it has', async () => {
    signIn('preview@example.com')
    await expect(requireAccess('analytics')).rejects.toThrow(
      'redirect /admin/preview'
    )
  })

  it('lets a view grant through and returns the access', async () => {
    signIn('viewer@example.com')
    const access = await requireAccess('analytics')
    expect(access.analytics).toBe('view')
    expect(access.manageUsers).toBe(false)
  })
})

describe('cronAuthorized', () => {
  it('refuses without CRON_SECRET, with a wrong one and without a header', () => {
    expect(cronAuthorized('Bearer x', undefined)).toBe(false)
    expect(cronAuthorized('Bearer ', '')).toBe(false)
    expect(cronAuthorized(null, 's3cret')).toBe(false)
    expect(cronAuthorized('Bearer s3cre', 's3cret')).toBe(false)
    expect(cronAuthorized('Bearer s3cret!', 's3cret')).toBe(false)
    expect(cronAuthorized('s3cret', 's3cret')).toBe(false)
    expect(cronAuthorized('Bearer s3cret', 's3cret')).toBe(true)
  })
})
