import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The two routes of the team's Fable chat, end to end: the page's
// (/api/admin/queue/chat) and the server agent's (…/chat/agent), with the
// session replaced and the relay on its file store in a temp folder, on a
// clock that waiting moves. No network, no real waiting.

const h = vi.hoisted(() => ({
  me: null as { email: string; name: string } | null,
  mode: null as 'edit' | 'suggest' | 'view' | null,
  relay: null as unknown,
}))
vi.mock('@/lib/admin/auth', () => ({
  currentAdmin: async () => h.me,
  queueMode: async () => (h.me ? h.mode : null),
}))
vi.mock('@/lib/admin/queue-team-relay', async importOriginal => {
  const real =
    await importOriginal<typeof import('@/lib/admin/queue-team-relay')>()
  return { ...real, teamRelay: () => h.relay }
})

import { sealToken } from '@/lib/admin/session'
import {
  TEAM_BODY_MAX_BYTES,
  TEAM_NOT_ANSWERING,
} from '@/lib/admin/queue-team-chat'
import {
  createRelay,
  fileKv,
  RATE_PER_MINUTE,
} from '@/lib/admin/queue-team-relay'
import { GET, POST } from './route'
import { POST as AGENT } from './agent/route'

const SECRET = 'test-team-agent-secret'
const URL = 'http://localhost/api/admin/queue/chat'
const ROB = { email: 'rob@example.org', name: 'Rob Demo' }
const MEL = { email: 'mel@example.org', name: 'Mel' }

let dir = ''
beforeEach(() => {
  vi.stubEnv('QUEUE_TEAM_AGENT_SECRET', SECRET)
  dir = mkdtempSync(path.join(os.tmpdir(), 'team-chat-route-'))
  let t = Date.now()
  h.relay = createRelay(
    fileKv(dir, () => t),
    {
      now: () => t,
      sleep: async ms => {
        t += ms
      },
    }
  )
  h.me = ROB
  h.mode = 'suggest'
  // A refused agent call is logged; not into the test's output.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

async function send(body: unknown) {
  const res = await POST(
    new NextRequest(URL, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
  return {
    status: res.status,
    body: (await res.json()) as { id?: string; error?: string },
  }
}

async function read(id: string, query = '') {
  const res = await GET(new NextRequest(`${URL}?id=${id}${query}`))
  return {
    status: res.status,
    body: (await res.json()) as {
      status?: number
      chunks?: { seq: number; text: string }[]
      done?: boolean
      error?: string
    },
  }
}

function token(over: object = {}, secret = SECRET): string {
  const now = Math.floor(Date.now() / 1000)
  return sealToken(
    { v: 1, kind: 'queue-team-agent', iat: now, exp: now + 60, ...over },
    secret
  )
}

async function agent(body: unknown, auth: string | null = token()) {
  const res = await AGENT(
    new NextRequest(`${URL}/agent`, {
      method: 'POST',
      headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
  return {
    status: res.status,
    body: (await res.json()) as {
      requests?: {
        id: string
        path: string
        body: Record<string, unknown>
        who: { email: string; name: string; mode: string }
        at: string
      }[]
      ok?: boolean
      error?: string
    },
  }
}

describe('who may use the team chat', () => {
  it('refuses someone signed out', async () => {
    h.me = null
    expect((await send({ path: '/chat/history', body: {} })).status).toBe(401)
    expect((await read('request-id-00000001')).status).toBe(401)
  })
  it('refuses a viewer', async () => {
    h.mode = 'view'
    expect((await send({ path: '/chat/history', body: {} })).status).toBe(403)
    expect((await read('request-id-00000001')).status).toBe(403)
  })
  it('takes anyone who works the Queue: full edit, or checked first', async () => {
    for (const mode of ['edit', 'suggest'] as const) {
      h.mode = mode
      const got = await send({ path: '/chat/history', body: { id: 'recA' } })
      expect(got.status).toBe(200)
      expect(got.body.id).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    }
  })
  it('is off while the site has no secret', async () => {
    vi.stubEnv('QUEUE_TEAM_AGENT_SECRET', '')
    expect((await send({ path: '/chat/history', body: {} })).status).toBe(503)
    expect((await read('request-id-00000001')).status).toBe(503)
    expect((await agent({ op: 'next', wait: 0 })).status).toBe(503)
  })
})

describe('what the page may ask for', () => {
  it('takes only the chat panel’s own paths', async () => {
    for (const p of [
      '/chat',
      '/chat/history',
      '/chat/interrupt',
      '/chat/unqueue',
      '/chat/clear',
      '/chat/file',
    ]) {
      expect((await send({ path: p, body: { id: 'recA' } })).status).toBe(200)
    }
    for (const p of [
      '/act',
      '/ping',
      '/chat/dictate',
      '/chat/status',
      '/rule/draft',
      '/rule/status',
      '/chat/history?x=1',
      '',
      undefined,
    ]) {
      expect((await send({ path: p, body: { id: 'recA' } })).status).toBe(400)
    }
    // None of the refused ones reached the agent.
    const got = await agent({ op: 'next', wait: 0 })
    expect(got.body.requests).toHaveLength(6)
  })
  it('refuses a body that is not an object, or not JSON', async () => {
    expect((await send({ path: '/chat', body: 'hello' })).status).toBe(400)
    expect((await send({ path: '/chat' })).status).toBe(400)
    expect((await send('not json')).status).toBe(400)
  })
  it('refuses a body over 3.5 MB', async () => {
    const big = { id: 'recA', data: 'a'.repeat(TEAM_BODY_MAX_BYTES) }
    const got = await send({ path: '/chat', body: big })
    expect(got.status).toBe(413)
    expect(got.body.error).toContain('3.5 MB')
    const fits = { id: 'recA', data: 'a'.repeat(TEAM_BODY_MAX_BYTES - 200) }
    expect((await send({ path: '/chat', body: fits })).status).toBe(200)
  })
  it('lets one person start 60 requests a minute', async () => {
    for (let i = 0; i < RATE_PER_MINUTE; i++) {
      expect((await send({ path: '/chat/history', body: {} })).status).toBe(200)
    }
    expect((await send({ path: '/chat/history', body: {} })).status).toBe(429)
    h.me = MEL
    expect((await send({ path: '/chat/history', body: {} })).status).toBe(200)
  })
})

describe('who the agent is told is asking', () => {
  it('comes from the session, never from the browser', async () => {
    await send({
      path: '/chat',
      body: {
        id: 'recA',
        message: 'publish it',
        token: 'a-token-the-page-made-up',
        who: { email: 'owner@example.org', name: 'Owner', mode: 'edit' },
      },
      // Beside the body is no better.
      who: { email: 'owner@example.org', name: 'Owner', mode: 'edit' },
      at: '2020-01-01T00:00:00.000Z',
    })
    const got = await agent({ op: 'next', wait: 0 })
    expect(got.status).toBe(200)
    const [r] = got.body.requests ?? []
    expect(r.who).toEqual({ ...ROB, mode: 'suggest' })
    expect(r.body).toEqual({ id: 'recA', message: 'publish it' })
    expect(r.path).toBe('/chat')
    expect(Date.parse(r.at)).toBeGreaterThan(Date.parse('2026-01-01'))
  })
  it('says edit for someone who decides for themselves', async () => {
    h.me = MEL
    h.mode = 'edit'
    await send({ path: '/chat/history', body: { id: 'recA' } })
    const got = await agent({ op: 'next', wait: 0 })
    expect(got.body.requests?.[0].who).toEqual({ ...MEL, mode: 'edit' })
  })
})

describe('the agent’s calls', () => {
  it('need a token sealed with the shared secret', async () => {
    await send({ path: '/chat/history', body: { id: 'recA' } })
    for (const bad of [
      null,
      'nonsense',
      token({}, 'another-secret'),
      token({ kind: 'queue-agent' }),
      token({ exp: Math.floor(Date.now() / 1000) - 1 }),
      token({ exp: Math.floor(Date.now() / 1000) + 600 }),
    ]) {
      const got = await agent({ op: 'next', wait: 0 }, bad)
      expect(got.status).toBe(401)
      expect(got.body.requests).toBeUndefined()
    }
    // The request is still there for the real agent.
    expect((await agent({ op: 'next', wait: 0 })).body.requests).toHaveLength(1)
  })
  it('get each request once', async () => {
    const a = await send({ path: '/chat/history', body: { id: 'recA' } })
    const b = await send({ path: '/chat/clear', body: { id: 'recA' } })
    const first = await agent({ op: 'next', wait: 20 })
    expect(first.body.requests?.map(r => r.id)).toEqual([a.body.id, b.body.id])
    expect((await agent({ op: 'next', wait: 20 })).body.requests).toEqual([])
  })
  it('may be 1 MB at most', async () => {
    const { body } = await send({ path: '/chat', body: { id: 'recA' } })
    await agent({ op: 'next', wait: 0 })
    const got = await agent({
      op: 'chunks',
      id: body.id,
      status: 200,
      chunks: [{ seq: 0, text: 'x'.repeat(1024 * 1024) }],
    })
    expect(got.status).toBe(413)
  })
  it('are refused for an unknown op, id or finished request', async () => {
    expect((await agent({ op: 'act' })).status).toBe(400)
    expect((await agent('not json')).status).toBe(400)
    expect(
      (await agent({ op: 'chunks', id: 'request-id-00000001', chunks: [] }))
        .status
    ).toBe(404)
    const { body } = await send({ path: '/chat', body: { id: 'recA' } })
    await agent({ op: 'next', wait: 0 })
    const done = {
      op: 'chunks',
      id: body.id,
      status: 200,
      chunks: [],
      done: true,
    }
    expect((await agent(done)).body).toEqual({ ok: true })
    expect((await agent(done)).status).toBe(409)
  })
})

describe('an answer on its way back', () => {
  it('reaches the page as the agent sent it', async () => {
    const { body } = await send({ path: '/chat', body: { id: 'recA' } })
    const id = body.id ?? ''
    await agent({ op: 'next', wait: 0 })
    await agent({
      op: 'chunks',
      id,
      status: 200,
      chunks: [{ seq: 0, text: 'data: {"type":"start"}\n\n' }],
    })
    expect((await read(id)).body).toEqual({
      status: 200,
      chunks: [{ seq: 0, text: 'data: {"type":"start"}\n\n' }],
      done: false,
    })
    await agent({
      op: 'chunks',
      id,
      chunks: [
        { seq: 2, text: 'data: {"type":"done"}\n\n' },
        { seq: 1, text: 'data: {"type":"text","text":"Hello – ünï"}\n\n' },
      ],
      done: true,
    })
    expect((await read(id, '&after=0&started=1')).body).toEqual({
      status: 200,
      chunks: [
        { seq: 1, text: 'data: {"type":"text","text":"Hello – ünï"}\n\n' },
        { seq: 2, text: 'data: {"type":"done"}\n\n' },
      ],
      done: true,
    })
  })
  it('can be read only by the person who asked', async () => {
    const { body } = await send({ path: '/chat/history', body: { id: 'recA' } })
    await agent({ op: 'next', wait: 0 })
    await agent({
      op: 'chunks',
      id: body.id,
      status: 200,
      chunks: [{ seq: 0, text: '{"ok":true,"messages":[]}' }],
      done: true,
    })
    h.me = MEL
    h.mode = 'edit'
    const got = await read(body.id ?? '')
    expect(got.status).toBe(403)
    expect(got.body.chunks).toBeUndefined()
    h.me = ROB
    expect((await read(body.id ?? '')).body.done).toBe(true)
  })
  it('ends with a plain error when no agent picks the request up', async () => {
    const { body } = await send({ path: '/chat', body: { id: 'recA' } })
    expect((await read(body.id ?? '')).body).toEqual({
      chunks: [],
      done: false,
    })
    expect((await read(body.id ?? '')).body).toEqual({
      chunks: [],
      done: true,
      error: TEAM_NOT_ANSWERING,
    })
  })
  it('refuses an id it does not keep, or a cursor that is not a number', async () => {
    expect((await read('request-id-00000001')).status).toBe(404)
    expect((await read('')).status).toBe(400)
    const { body } = await send({ path: '/chat', body: { id: 'recA' } })
    expect((await read(body.id ?? '', '&after=soon')).status).toBe(400)
  })
})
