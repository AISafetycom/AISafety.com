import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ROOT_ADMINS } from '@/lib/admin/users'

// GET /api/admin/queue: which Fable chat each person's page mounts, and
// that only an owner's page is handed the Mac agent (nobody else's browser
// can reach his Mac, so theirs would only call their own computer).

const h = vi.hoisted(() => ({
  email: '',
  work: true,
  online: true as boolean | 'broken',
}))
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('@/lib/admin/auth', () => ({
  canViewQueue: async () => true,
  canWorkQueue: async () => h.work,
  queueMode: async () => (h.work ? 'suggest' : 'view'),
  currentAdmin: async () => ({ name: 'Someone', email: h.email }),
}))
vi.mock('@/lib/admin/queue-map', () => ({ mapForStrip: vi.fn() }))
vi.mock('@/lib/admin/queue', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/admin/queue')>()),
  listQueue: async () => [],
}))
vi.mock('@/lib/admin/queue-team-relay', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/admin/queue-team-relay')>()),
  teamRelay: () => ({
    online: async () => {
      if (h.online === 'broken') throw new Error('the store is down')
      return h.online
    },
  }),
}))

import { GET } from './route'

async function list() {
  const res = await GET(new NextRequest('http://localhost/api/admin/queue'))
  return (await res.json()) as {
    items?: unknown[]
    chat: string | null
    agent: { port: number; token: string } | null
    teamChat?: { online: boolean }
  }
}

const OWNER = ROOT_ADMINS[0].email
const ROB = 'rob.demo@example.org'

beforeEach(() => {
  vi.stubEnv('QUEUE_AGENT_SECRET', 'test-agent-secret')
  vi.stubEnv('QUEUE_TEAM_AGENT_SECRET', 'test-team-agent-secret')
  vi.stubEnv('QUEUE_CHAT_OWNERS', '')
  h.email = ROB
  h.work = true
  h.online = true
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('which chat the page mounts', () => {
  it('gives the owner the Mac chat and its agent, as before', async () => {
    h.email = OWNER
    const got = await list()
    expect(got.chat).toBe('mac')
    expect(got.agent).toMatchObject({ port: 8790 })
    expect(got.agent?.token).toEqual(expect.any(String))
    expect(got.teamChat).toBeUndefined()
  })
  it('keeps the owner on the Mac chat with the team chat off', async () => {
    vi.stubEnv('QUEUE_TEAM_AGENT_SECRET', '')
    h.email = OWNER
    expect(await list()).toMatchObject({ chat: 'mac', agent: { port: 8790 } })
  })
  it('gives someone else who works the Queue the team chat and no Mac agent', async () => {
    expect(await list()).toEqual({
      items: [],
      agent: null,
      chat: 'team',
      teamChat: { online: true },
    })
  })
  it('says when the team chat’s server has not been heard from', async () => {
    h.online = false
    expect((await list()).teamChat).toEqual({ online: false })
  })
  it('still lists the Queue when the relay cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.online = 'broken'
    expect(await list()).toMatchObject({
      items: [],
      chat: 'team',
      teamChat: { online: false },
    })
  })
  it('gives a viewer neither chat nor the Mac agent', async () => {
    h.work = false
    const got = await list()
    expect(got).toMatchObject({ chat: null, agent: null })
    expect(got.teamChat).toBeUndefined()
  })
  it('has no team chat without the team agent secret', async () => {
    vi.stubEnv('QUEUE_TEAM_AGENT_SECRET', '')
    const got = await list()
    expect(got).toMatchObject({ chat: null, agent: null })
    expect(got.teamChat).toBeUndefined()
  })
  it('follows QUEUE_CHAT_OWNERS when it is set', async () => {
    vi.stubEnv('QUEUE_CHAT_OWNERS', ` ${ROB.toUpperCase()} , other@example.org`)
    expect(await list()).toMatchObject({ chat: 'mac', agent: { port: 8790 } })
    h.email = OWNER
    expect(await list()).toMatchObject({ chat: 'team', agent: null })
  })
})
