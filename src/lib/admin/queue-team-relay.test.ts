import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sealToken } from './session'
import {
  TEAM_BUSY,
  TEAM_BYTES_PER_MINUTE,
  TEAM_NOT_ANSWERING,
  TEAM_POLLS_PER_MINUTE,
  TEAM_READS_PER_MINUTE,
  TEAM_SENDS_PER_MINUTE,
  TEAM_STOPPED,
  TEAM_TOO_MUCH,
  type TeamChatPath,
  type TeamWho,
} from './queue-team-chat'
import {
  AGENT_TOKEN_KIND,
  BODY_COPY_MAX_BYTES,
  BODY_TTL_S,
  checkAgentToken,
  createRelay,
  DONE_TTL_S,
  fileKv,
  POLL_MAX_BYTES,
  type Relay,
  RelayError,
  relayErrorText,
  REQUEST_TTL_S,
  signRequest,
  teamAgentSecret,
} from './queue-team-relay'

// The relay over its file store in a temp folder, on a clock the test
// moves: no network, no real waiting.

const SECRET = 'test-team-agent-secret-0123456789abcdef'
const NOW_S = 1_800_000_000

function bearer(payload: object, secret = SECRET): string {
  return `Bearer ${sealToken(payload, secret)}`
}
const good = (over: object = {}) => ({
  v: 1,
  kind: AGENT_TOKEN_KIND,
  iat: NOW_S - 5,
  exp: NOW_S + 60,
  ...over,
})

describe('checkAgentToken', () => {
  const check = (header: string | null, secret = SECRET) =>
    checkAgentToken(header, secret, NOW_S).ok
  it('takes a token sealed with the shared secret', () => {
    expect(check(bearer(good()))).toBe(true)
  })
  it('refuses one sealed with another secret, or changed afterwards', () => {
    expect(check(bearer(good(), 'another-secret-0123456789abcdef-xyz'))).toBe(
      false
    )
    const token = bearer(good())
    const forged = Buffer.from(
      JSON.stringify(good({ exp: NOW_S + 100 }))
    ).toString('base64url')
    expect(check(`Bearer ${forged}.${token.split('.')[1]}`)).toBe(false)
  })
  it('refuses everything while the site has no secret', () => {
    expect(check(bearer(good(), ''), '')).toBe(false)
    expect(check(bearer(good()), '')).toBe(false)
  })
  it('refuses another kind of token, the Mac agent’s included', () => {
    expect(check(bearer(good({ kind: 'queue-agent' })))).toBe(false)
    expect(check(bearer(good({ v: 2 })))).toBe(false)
    expect(check(bearer({ email: 'a@b.c', iat: NOW_S, exp: NOW_S + 60 }))).toBe(
      false
    )
  })
  it('refuses one past its time', () => {
    expect(check(bearer(good({ iat: NOW_S - 100, exp: NOW_S })))).toBe(false)
    expect(check(bearer(good({ iat: NOW_S - 100, exp: NOW_S + 1 })))).toBe(true)
  })
  it('refuses one that lives longer than two minutes', () => {
    expect(check(bearer(good({ iat: NOW_S - 1, exp: NOW_S + 120 })))).toBe(
      false
    )
    expect(check(bearer(good({ iat: NOW_S, exp: NOW_S + 120 })))).toBe(true)
  })
  it('refuses one issued more than a minute ahead of the site’s clock', () => {
    expect(check(bearer(good({ iat: NOW_S + 61, exp: NOW_S + 100 })))).toBe(
      false
    )
    expect(check(bearer(good({ iat: NOW_S + 60, exp: NOW_S + 100 })))).toBe(
      true
    )
  })
  it('works for two minutes in all, however the clocks differ', () => {
    // Issued by a clock a minute fast, to live two minutes: by the old
    // rules good from now for three minutes. It is not taken until its
    // last two.
    const token = bearer(good({ iat: NOW_S + 60, exp: NOW_S + 180 }))
    const at = (s: number) => checkAgentToken(token, SECRET, NOW_S + s).ok
    expect(at(0)).toBe(false)
    expect(at(59)).toBe(false)
    expect(at(60)).toBe(true)
    expect(at(179)).toBe(true)
    expect(at(180)).toBe(false)
    // The one an agent should mint, a minute long: fine with a clock up to
    // a minute fast, or nearly a minute slow.
    for (const skew of [-55, 0, 60]) {
      expect(
        check(bearer(good({ iat: NOW_S + skew, exp: NOW_S + skew + 60 })))
      ).toBe(true)
    }
  })
  it('refuses a missing or malformed header', () => {
    const token = bearer(good()).slice('Bearer '.length)
    for (const bad of [
      null,
      '',
      token,
      `Basic ${token}`,
      'Bearer ',
      'Bearer x',
    ])
      expect(check(bad)).toBe(false)
    expect(check(bearer(good({ iat: 'now' })))).toBe(false)
    expect(check(bearer(good({ exp: undefined })))).toBe(false)
  })
})

describe('teamAgentSecret', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })
  it('is the secret, trimmed', () => {
    vi.stubEnv('QUEUE_TEAM_AGENT_SECRET', `  ${SECRET}\n`)
    expect(teamAgentSecret()).toBe(SECRET)
  })
  it('is off when unset', () => {
    vi.stubEnv('QUEUE_TEAM_AGENT_SECRET', '')
    expect(teamAgentSecret()).toBe('')
  })
  it('treats one shorter than 32 characters as unset, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('QUEUE_TEAM_AGENT_SECRET', 'a'.repeat(31))
    expect(teamAgentSecret()).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('shorter than 32')
    // The value itself is never printed.
    expect(String(warn.mock.calls[0][0])).not.toContain('aaaa')
    vi.stubEnv('QUEUE_TEAM_AGENT_SECRET', 'a'.repeat(32))
    expect(teamAgentSecret()).toBe('a'.repeat(32))
  })
})

describe('signRequest', () => {
  // The same vector is in the comment on signRequest, for the agent's side.
  const VECTOR = {
    secret: 'test-vector-secret-0123456789abcdef-not-a-real-one',
    id: 'request-id-00000001',
    path: '/chat',
    who: {
      email: 'rob@example.org',
      name: "Zoë O'Neil-Smith",
      mode: 'suggest' as const,
    },
    at: '2026-11-30T03:00:00.000Z',
    bodyText: '{"id":"recA0000000000001","message":"Héllo – 你好"}',
    sig: '0ul07t6_ZveVaHocO30CbIoP-c8OSQE6_0kuAGC6L9I',
  }
  it('matches the vector the agent’s side is given', () => {
    expect(Buffer.byteLength(VECTOR.bodyText)).toBe(56)
    expect(Buffer.from(VECTOR.who.name).toString('base64url')).toBe(
      'Wm_DqyBPJ05laWwtU21pdGg'
    )
    expect(signRequest(VECTOR.secret, VECTOR)).toBe(VECTOR.sig)
  })
  it('changes with every part it covers', () => {
    const sign = (over: object) =>
      signRequest(VECTOR.secret, { ...VECTOR, ...over })
    for (const over of [
      { id: 'request-id-00000002' },
      { path: '/chat/clear' },
      { who: { ...VECTOR.who, email: 'owner@example.org' } },
      { who: { ...VECTOR.who, name: "Zoe O'Neil-Smith" } },
      { who: { ...VECTOR.who, mode: 'edit' as const } },
      { at: '2026-11-30T03:00:00.001Z' },
      { bodyText: VECTOR.bodyText.replace('Héllo', 'Hello') },
    ]) {
      expect(sign(over)).not.toBe(VECTOR.sig)
    }
    expect(signRequest(`${VECTOR.secret}x`, VECTOR)).not.toBe(VECTOR.sig)
  })
  it('cannot be shifted from one part into the next', () => {
    // A name is carried in base64url, so no name can hold a line break
    // that would pass for the next line.
    const a = signRequest(VECTOR.secret, {
      ...VECTOR,
      who: { ...VECTOR.who, name: 'A\nsuggest' },
    })
    const b = signRequest(VECTOR.secret, {
      ...VECTOR,
      who: { ...VECTOR.who, name: 'A' },
    })
    expect(a).not.toBe(b)
  })
})

describe('relayErrorText', () => {
  it('never carries the command a store error quotes', () => {
    const e = new Error(
      'ERR max request size exceeded, command was: ["SET","queue:team-chat:req:abc","{\\"message\\":\\"a private message\\"}"]'
    )
    e.name = 'UpstashError'
    expect(relayErrorText(e)).toBe(
      'UpstashError: ERR max request size exceeded'
    )
    expect(relayErrorText(e)).not.toContain('private')
  })
  it('is short whatever the error says', () => {
    expect(relayErrorText(new Error('x'.repeat(5000))).length).toBeLessThan(220)
    expect(relayErrorText('just text')).toBe('Error: just text')
  })
})

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup() {
  let t = NOW_S * 1000
  let n = 0
  const dir = mkdtempSync(path.join(os.tmpdir(), 'team-relay-'))
  dirs.push(dir)
  const now = () => t
  const kv = fileKv(dir, now)
  const hooks: { onSleep: (() => Promise<void> | void) | null } = {
    onSleep: null,
  }
  const relay = createRelay(kv, {
    now,
    // Waiting moves the clock, and lets a test do something meanwhile.
    sleep: async ms => {
      t += ms
      await hooks.onSleep?.()
    },
    newId: () => `request-id-${String(++n).padStart(8, '0')}`,
    secret: () => SECRET,
  })
  return {
    relay,
    kv,
    dir,
    hooks,
    advance: (ms: number) => {
      t += ms
    },
  }
}

const ROB: TeamWho = { email: 'rob@example.org', name: 'Rob', mode: 'suggest' }
const MEL: TeamWho = { email: 'mel@example.org', name: 'Mel', mode: 'edit' }

/** A request as the route makes it: the body as text. */
const ask = (
  relay: Relay,
  path: TeamChatPath,
  body: Record<string, unknown>,
  who: TeamWho = ROB
) => relay.create(path, JSON.stringify(body), who)

/** "I have it": the agent's first, empty call. */
const ack = (relay: Relay, id: string) => relay.chunks(id, { chunks: [] })

async function refusal(
  p: Promise<unknown>
): Promise<{ status: number; code?: unknown; last?: unknown } | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof RelayError) {
      return { status: e.status, ...(e.extra as object) }
    }
    throw e
  }
}
const status = async (p: Promise<unknown>) => (await refusal(p))?.status ?? null

/** The files the store keeps for one kind of key (its colons are written
 *  ".3a" in a file name). */
const kept = (dir: string, kind: string) =>
  readdirSync(dir).filter(
    n => n.includes(`.3a${kind}.3a`) && !n.endsWith('.exp')
  )

describe('handing requests to the agent', () => {
  it('hands a request out signed, with who and the body’s text beside it', async () => {
    const { relay, advance } = setup()
    const a = await ask(relay, '/chat/history', { id: 'recA' })
    advance(10)
    const b = await ask(relay, '/chat', { id: 'recB', message: 'hi' }, MEL)
    const got = await relay.next(0)
    expect(got.map(r => r.id)).toEqual([a.id, b.id])
    const at = new Date(NOW_S * 1000).toISOString()
    expect(got[0]).toEqual({
      id: a.id,
      path: '/chat/history',
      who: ROB,
      at,
      bodyText: '{"id":"recA"}',
      body: { id: 'recA' },
      sig: signRequest(SECRET, {
        id: a.id,
        path: '/chat/history',
        who: ROB,
        at,
        bodyText: '{"id":"recA"}',
      }),
    })
    expect(got[1].who).toEqual(MEL)
    expect(await relay.next(0)).toEqual([])
  })

  it('cannot make a request without the secret to sign it', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'team-relay-'))
    dirs.push(dir)
    const relay = createRelay(fileKv(dir), { secret: () => '' })
    expect(await status(relay.create('/chat', '{}', ROB))).toBe(503)
  })

  it('waits for a request when there is none', async () => {
    const { relay, hooks } = setup()
    let made = ''
    let sleeps = 0
    hooks.onSleep = async () => {
      if (++sleeps === 3) made = (await ask(relay, '/chat/clear', {})).id
    }
    const got = await relay.next(20)
    expect(got.map(r => r.id)).toEqual([made])
  })

  it('answers empty once the wait is over, and never waits past 20 s', async () => {
    const { relay, hooks } = setup()
    let slept = 0
    hooks.onSleep = () => {
      slept++
    }
    expect(await relay.next(500)).toEqual([])
    // A second each: 20 of them, not 500.
    expect(slept).toBe(20)
  })

  it('takes nothing for a call whose agent has gone', async () => {
    const { relay } = setup()
    const { id } = await ask(relay, '/chat', { message: 'hi' })
    // Gone before it could be handed anything.
    expect(await relay.next(20, () => true)).toEqual([])
    // Still there for a call that is alive.
    expect((await relay.next(0)).map(r => r.id)).toEqual([id])
  })

  it('takes nothing once its agent goes partway through a wait', async () => {
    const { relay, hooks } = setup()
    let gone = false
    let made = ''
    hooks.onSleep = async () => {
      // A request arrives just as the agent's connection drops.
      if (!made) made = (await ask(relay, '/chat', { message: 'x' })).id
      gone = true
    }
    expect(await relay.next(20, () => gone)).toEqual([])
    expect((await relay.next(0)).map(r => r.id)).toEqual([made])
  })

  it('never hands out a request the page is about to give up on', async () => {
    const { relay, advance, dir } = setup()
    await ask(relay, '/chat', { id: 'recA', message: 'hi' })
    advance(26_000)
    expect(await relay.next(0)).toEqual([])
    // And its body is gone the moment it was passed over.
    expect(kept(dir, 'req')).toEqual([])
  })

  it('keeps one answer under 4 MB, counted in bytes', async () => {
    const { relay } = setup()
    // Two bytes a character: 1.4 MB each as text, sent twice over (the
    // text and its parsed copy) with its quoting.
    const big = 'é'.repeat(0.7 * 1024 * 1024)
    const a = await ask(relay, '/chat', { id: 'recA', data: big })
    const b = await ask(relay, '/chat', { id: 'recB', data: big })
    const first = await relay.next(0)
    expect(first.map(r => r.id)).toEqual([a.id])
    expect(Buffer.byteLength(JSON.stringify({ requests: first }))).toBeLessThan(
      4 * 1024 * 1024
    )
    expect((await relay.next(0)).map(r => r.id)).toEqual([b.id])
  })

  it('leaves the parsed copy out of a big request, which still fits', async () => {
    const { relay } = setup()
    const data = 'A'.repeat(3.4 * 1024 * 1024)
    await ask(relay, '/chat', { id: 'recA', data })
    const [r] = await relay.next(0)
    expect(Buffer.byteLength(r.bodyText)).toBeGreaterThan(BODY_COPY_MAX_BYTES)
    expect(r.body).toBeUndefined()
    expect(JSON.parse(r.bodyText)).toEqual({ id: 'recA', data })
    expect(Buffer.byteLength(JSON.stringify({ requests: [r] }))).toBeLessThan(
      4 * 1024 * 1024
    )
  })

  it('refuses a body whose text would not fit in one answer once quoted', async () => {
    const { relay } = setup()
    // Mostly quote marks: within the page's cap as sent, double as kept.
    const data = '"'.repeat(1.2 * 1024 * 1024)
    expect(await status(ask(relay, '/chat', { data }))).toBe(413)
  })
})

describe('an agent saying it has a request', () => {
  it('keeps the body until then, and no longer', async () => {
    const { relay, dir } = setup()
    const { id } = await ask(relay, '/chat', { message: 'private words' })
    expect(kept(dir, 'req')).toHaveLength(1)
    await relay.next(0)
    // Handed out, but nobody has said they have it.
    expect(kept(dir, 'req')).toHaveLength(1)
    await ack(relay, id)
    expect(kept(dir, 'req')).toHaveLength(0)
  })

  it('offers a request again after 10 seconds of silence, to another call', async () => {
    const { relay, advance } = setup()
    const { id } = await ask(relay, '/chat', { message: 'hi' })
    const first = await relay.next(0)
    expect(first.map(r => r.id)).toEqual([id])
    // Not yet.
    advance(9_000)
    expect(await relay.next(0)).toEqual([])
    advance(1_000)
    const again = await relay.next(0)
    // The same request, to the letter: the agent tells it by its id.
    expect(again).toEqual(first)
    // And once more ten seconds on, but never past 25 seconds.
    advance(10_000)
    expect((await relay.next(0)).map(r => r.id)).toEqual([id])
    advance(10_000)
    expect(await relay.next(0)).toEqual([])
  })

  it('stops offering once the agent has spoken, empty call or not', async () => {
    const { relay, advance } = setup()
    const { id } = await ask(relay, '/chat', {})
    await relay.next(0)
    await ack(relay, id)
    advance(11_000)
    expect(await relay.next(0)).toEqual([])
  })

  it('refuses a first word that comes after the page was told nobody answered', async () => {
    const { relay, advance } = setup()
    const { id } = await ask(relay, '/chat', {})
    await relay.next(0)
    advance(29_500)
    expect(await refusal(ack(relay, id))).toEqual({
      status: 409,
      code: 'expired',
    })
    advance(1_000)
    expect(await relay.poll(id, ROB.email, { waitMs: 0 })).toEqual({
      chunks: [],
      done: true,
      error: TEAM_NOT_ANSWERING,
    })
  })

  it('takes a first word just in time, and the page is then not told otherwise', async () => {
    const { relay, advance } = setup()
    const { id } = await ask(relay, '/chat', {})
    await relay.next(0)
    advance(28_500)
    await ack(relay, id)
    advance(5_000)
    expect(await relay.poll(id, ROB.email, { waitMs: 0 })).toEqual({
      chunks: [],
      done: false,
    })
  })
})

describe('the pieces of an answer', () => {
  async function taken() {
    const s = setup()
    const { id } = await ask(s.relay, '/chat', { id: 'recA' })
    await s.relay.next(0)
    return { ...s, id }
  }

  it('reaches the page in seq order, with the agent’s status', async () => {
    const { relay, id } = await taken()
    await relay.chunks(id, {
      status: 200,
      chunks: [
        { seq: 2, text: 'c' },
        { seq: 0, text: 'a' },
        { seq: 1, text: 'b' },
      ],
    })
    await relay.chunks(id, { chunks: [{ seq: 3, text: 'd' }] })
    expect(await relay.poll(id, ROB.email, { waitMs: 0 })).toEqual({
      status: 200,
      chunks: [
        { seq: 0, text: 'a' },
        { seq: 1, text: 'b' },
        { seq: 2, text: 'c' },
        { seq: 3, text: 'd' },
      ],
      done: false,
    })
    expect(
      await relay.poll(id, ROB.email, { after: 1, started: true, waitMs: 0 })
    ).toEqual({
      status: 200,
      chunks: [
        { seq: 2, text: 'c' },
        { seq: 3, text: 'd' },
      ],
      done: false,
    })
  })

  it('drops a piece sent twice, so the agent can always send again', async () => {
    const { relay, id } = await taken()
    await relay.chunks(id, { status: 200, chunks: [{ seq: 1, text: 'one' }] })
    await relay.chunks(id, {
      chunks: [
        { seq: 1, text: 'one again' },
        { seq: 2, text: 'two' },
      ],
    })
    await relay.chunks(id, { chunks: [{ seq: 1, text: 'and again' }] })
    const got = await relay.poll(id, ROB.email, { waitMs: 0 })
    expect(got.chunks).toEqual([
      { seq: 1, text: 'one' },
      { seq: 2, text: 'two' },
    ])
  })

  it('refuses a piece that skips ahead, and says where to send from', async () => {
    const { relay, id } = await taken()
    // Nothing yet: the first is 0 or 1.
    expect(
      await refusal(relay.chunks(id, { chunks: [{ seq: 2, text: 'c' }] }))
    ).toEqual({ status: 409, code: 'seq_gap', last: null })
    await relay.chunks(id, { status: 200, chunks: [{ seq: 0, text: 'a' }] })
    expect(
      await refusal(relay.chunks(id, { chunks: [{ seq: 2, text: 'c' }] }))
    ).toEqual({ status: 409, code: 'seq_gap', last: 0 })
    // A gap inside one call is refused whole: nothing of it is kept.
    expect(
      await refusal(
        relay.chunks(id, {
          chunks: [
            { seq: 1, text: 'b' },
            { seq: 3, text: 'd' },
          ],
        })
      )
    ).toEqual({ status: 409, code: 'seq_gap', last: 1 })
    expect((await relay.poll(id, ROB.email, { waitMs: 0 })).chunks).toEqual([
      { seq: 0, text: 'a' },
    ])
    // Sent again from the gap, it all lands.
    await relay.chunks(id, {
      chunks: [
        { seq: 1, text: 'b' },
        { seq: 2, text: 'c' },
      ],
      done: true,
    })
    expect(await relay.poll(id, ROB.email, { waitMs: 0 })).toEqual({
      status: 200,
      chunks: [
        { seq: 0, text: 'a' },
        { seq: 1, text: 'b' },
        { seq: 2, text: 'c' },
      ],
      done: true,
    })
  })

  it('keeps the first status it was given', async () => {
    const { relay, id } = await taken()
    await ack(relay, id)
    await relay.chunks(id, { status: 202, chunks: [] })
    await relay.chunks(id, { status: 500, chunks: [{ seq: 0, text: '{}' }] })
    expect((await relay.poll(id, ROB.email, { waitMs: 0 })).status).toBe(202)
  })

  it('never lets an overlapping call undo "done" or the pieces kept', async () => {
    const { relay, id, kv, advance } = await taken()
    await relay.chunks(id, { status: 200, chunks: [{ seq: 0, text: 'a' }] })
    // Two calls that both read the request before either wrote: the last
    // piece with done, and a retry of the piece before it without.
    const real = kv.mget.bind(kv)
    let hold: (() => void) | null = null
    let held = 0
    kv.mget = async keys => {
      const got = await real(keys)
      if (keys.some(k => k.includes(':done:')) && held++ === 0) {
        await new Promise<void>(r => (hold = r))
      }
      return got
    }
    const late = relay.chunks(id, { chunks: [{ seq: 0, text: 'a' }] })
    await new Promise(r => setTimeout(r, 5))
    await relay.chunks(id, { chunks: [{ seq: 1, text: 'b' }], done: true })
    hold!()
    // The late one read "not done" before the other finished; whether it is
    // refused or lands, it changes nothing.
    await late.catch(() => {})
    kv.mget = real
    expect(await relay.poll(id, ROB.email, { waitMs: 0 })).toEqual({
      status: 200,
      chunks: [
        { seq: 0, text: 'a' },
        { seq: 1, text: 'b' },
      ],
      done: true,
    })
    expect(await status(relay.chunks(id, { chunks: [] }))).toBe(409)
    // Nor did the late call give the finished request its long life back.
    advance(DONE_TTL_S * 1000 + 1000)
    expect(await status(relay.poll(id, ROB.email, { waitMs: 0 }))).toBe(404)
  })

  it('tells the page the status as soon as it is known, once', async () => {
    const { relay, id } = await taken()
    await relay.chunks(id, { status: 200, chunks: [] })
    expect(await relay.poll(id, ROB.email, { waitMs: 0 })).toEqual({
      status: 200,
      chunks: [],
      done: false,
    })
    // The page has it now: nothing new until a piece comes.
    let waited = false
    const got = await relay.poll(id, ROB.email, {
      started: true,
      waitMs: 500,
      aborted: () => {
        waited = true
        return true
      },
    })
    expect(waited).toBe(true)
    expect(got).toEqual({ status: 200, chunks: [], done: false })
  })

  it('waits for the next piece, then answers with it', async () => {
    const { relay, id, hooks } = await taken()
    await relay.chunks(id, { status: 200, chunks: [{ seq: 0, text: 'a' }] })
    let sleeps = 0
    hooks.onSleep = async () => {
      if (++sleeps === 4) {
        await relay.chunks(id, { chunks: [{ seq: 1, text: 'b' }], done: true })
      }
    }
    expect(
      await relay.poll(id, ROB.email, { after: 0, started: true })
    ).toEqual({ status: 200, chunks: [{ seq: 1, text: 'b' }], done: true })
    expect(sleeps).toBe(4)
  })

  it('answers "nothing yet" after about 20 seconds', async () => {
    const { relay, id, hooks } = await taken()
    await relay.chunks(id, { status: 200, chunks: [{ seq: 0, text: 'a' }] })
    let slept = 0
    hooks.onSleep = async () => {
      slept++
      // The agent is alive: a keep-alive call now and then.
      if (slept % 20 === 0) await relay.chunks(id, { chunks: [] })
    }
    expect(
      await relay.poll(id, ROB.email, { after: 0, started: true })
    ).toEqual({ status: 200, chunks: [], done: false })
    // 3 s at four a second, then 17 s at two a second.
    expect(slept).toBe(12 + 34)
  })

  it('hands the page 3 MB at a time, and "done" with the last of it', async () => {
    const { relay, id } = await taken()
    const piece = 'x'.repeat(900 * 1024)
    for (let seq = 0; seq < 5; seq++) {
      await relay.chunks(id, {
        ...(seq === 0 ? { status: 200 } : {}),
        chunks: [{ seq, text: piece }],
        ...(seq === 4 ? { done: true } : {}),
      })
    }
    const first = await relay.poll(id, ROB.email, { waitMs: 0 })
    expect(first.chunks.map(c => c.seq)).toEqual([0, 1, 2])
    expect(first.done).toBe(false)
    expect(
      first.chunks.reduce((n, c) => n + c.text.length, 0)
    ).toBeLessThanOrEqual(POLL_MAX_BYTES)
    const rest = await relay.poll(id, ROB.email, {
      after: 2,
      started: true,
      waitMs: 0,
    })
    expect(rest.chunks.map(c => c.seq)).toEqual([3, 4])
    expect(rest.done).toBe(true)
  })

  it('refuses malformed pieces', async () => {
    const { relay, id } = await taken()
    for (const bad of [
      { chunks: 'text' },
      { chunks: [{ seq: '1', text: 'a' }] },
      { chunks: [{ seq: 1.5, text: 'a' }] },
      { chunks: [{ seq: -1, text: 'a' }] },
      { chunks: [{ seq: 1 }] },
      { chunks: [null] },
      { chunks: [], status: 99 },
      { chunks: [], status: '200' },
      { chunks: [], done: 'yes' },
    ]) {
      expect(await status(relay.chunks(id, bad))).toBe(400)
    }
    expect(await status(relay.chunks('short', { chunks: [] }))).toBe(400)
  })

  it('refuses pieces for an unknown id, or one no agent was handed', async () => {
    const { relay } = setup()
    expect(
      await refusal(relay.chunks('request-id-99999999', { chunks: [] }))
    ).toEqual({ status: 404, code: 'unknown' })
    const { id } = await ask(relay, '/chat', { id: 'recA' })
    expect(await status(relay.chunks(id, { status: 200, chunks: [] }))).toBe(
      404
    )
  })

  it('refuses pieces for a finished id', async () => {
    const { relay, id } = await taken()
    await relay.chunks(id, {
      status: 200,
      chunks: [{ seq: 0, text: 'all of it' }],
      done: true,
    })
    expect(
      await refusal(relay.chunks(id, { chunks: [{ seq: 1, text: 'more' }] }))
    ).toEqual({ status: 409, code: 'finished' })
    expect(await relay.poll(id, ROB.email, { waitMs: 0 })).toEqual({
      status: 200,
      chunks: [{ seq: 0, text: 'all of it' }],
      done: true,
    })
  })
})

describe('who may read an answer', () => {
  it('is only the person who made the request', async () => {
    const { relay } = setup()
    const { id } = await ask(relay, '/chat/history', { id: 'recA' })
    await relay.next(0)
    await relay.chunks(id, {
      status: 200,
      chunks: [{ seq: 0, text: '{"ok":true}' }],
      done: true,
    })
    expect(await status(relay.poll(id, MEL.email, { waitMs: 0 }))).toBe(403)
    expect(await status(relay.poll(id, '', { waitMs: 0 }))).toBe(403)
    expect((await relay.poll(id, ROB.email, { waitMs: 0 })).done).toBe(true)
  })

  it('answers 404 for an id it does not keep', async () => {
    const { relay } = setup()
    expect(
      await status(relay.poll('request-id-99999999', ROB.email, { waitMs: 0 }))
    ).toBe(404)
    expect(await status(relay.poll('../etc', ROB.email, { waitMs: 0 }))).toBe(
      400
    )
  })

  it('lets two reads of one request wait at a time, no more', async () => {
    const { relay, kv, hooks } = setup()
    const { id } = await ask(relay, '/chat', {})
    await relay.next(0)
    await ack(relay, id)
    // One read is already waiting (its place is held); while a second
    // waits too, a third is turned away.
    await kv.claim(`queue:team-chat:reader:${id}:0`, '1', 25)
    let third: Awaited<ReturnType<typeof refusal>> = null
    let asked = false
    hooks.onSleep = async () => {
      if (asked) return
      asked = true
      third = await refusal(relay.poll(id, ROB.email, { waitMs: 0 }))
    }
    expect(await relay.poll(id, ROB.email, { waitMs: 300 })).toEqual({
      chunks: [],
      done: false,
    })
    expect(third).toEqual({ status: 429, code: 'readers' })
    // The second gave its place back when it ended.
    expect(await status(relay.poll(id, ROB.email, { waitMs: 0 }))).toBeNull()
    expect(await status(relay.poll(id, ROB.email, { waitMs: 0 }))).toBeNull()
  })

  it('frees a place whose read never ended', async () => {
    const { relay, kv, advance } = setup()
    const { id } = await ask(relay, '/chat', {})
    // Two reads that died with their server: their places are still held.
    await kv.claim(`queue:team-chat:reader:${id}:0`, '1', 25)
    await kv.claim(`queue:team-chat:reader:${id}:1`, '1', 25)
    expect(await status(relay.poll(id, ROB.email, { waitMs: 0 }))).toBe(429)
    advance(26_000)
    expect(await status(relay.poll(id, ROB.email, { waitMs: 0 }))).toBeNull()
  })
})

describe('when nobody answers', () => {
  it('tells the page after 30 seconds with no agent, and drops the body', async () => {
    const { relay, dir } = setup()
    const { id } = await ask(relay, '/chat', { message: 'private words' })
    // The first read waits its 20 seconds and has nothing.
    expect(await relay.poll(id, ROB.email)).toEqual({ chunks: [], done: false })
    expect(kept(dir, 'req')).toHaveLength(1)
    // The second gives up as the 30 seconds pass.
    expect(await relay.poll(id, ROB.email)).toEqual({
      chunks: [],
      done: true,
      error: TEAM_NOT_ANSWERING,
    })
    expect(kept(dir, 'req')).toHaveLength(0)
    // And an agent that turns up now is not handed it.
    expect(await relay.next(0)).toEqual([])
  })

  it('tells the page the same when an agent was handed it but never spoke', async () => {
    const { relay, advance } = setup()
    const { id } = await ask(relay, '/chat', {})
    await relay.next(0)
    advance(31_000)
    expect(await relay.poll(id, ROB.email, { waitMs: 0 })).toEqual({
      chunks: [],
      done: true,
      error: TEAM_NOT_ANSWERING,
    })
  })

  it('tells the page when an agent had the request and went quiet', async () => {
    const { relay, advance } = setup()
    const { id } = await ask(relay, '/chat', { id: 'recA' })
    await relay.next(0)
    await relay.chunks(id, { status: 200, chunks: [{ seq: 0, text: 'a' }] })
    advance(89_000)
    // Still within its time: a late piece is taken.
    await relay.chunks(id, { chunks: [{ seq: 1, text: 'b' }] })
    advance(91_000)
    expect(
      await refusal(relay.chunks(id, { chunks: [{ seq: 2, text: 'c' }] }))
    ).toEqual({ status: 409, code: 'stalled' })
    advance(10_000)
    expect(
      await relay.poll(id, ROB.email, { after: 1, started: true, waitMs: 0 })
    ).toEqual({ status: 200, chunks: [], done: true, error: TEAM_STOPPED })
  })
})

describe('how long things are kept', () => {
  it('keeps a body a minute at most, taken or not', async () => {
    const { relay, advance, dir, kv } = setup()
    await ask(relay, '/chat', { message: 'private words' })
    advance(BODY_TTL_S * 1000 - 1000)
    expect(kept(dir, 'req')).toHaveLength(1)
    advance(2000)
    // Past its life: gone to every reader, and off the disk.
    expect(await kv.get('queue:team-chat:req:request-id-00000001')).toBeNull()
    expect(kept(dir, 'req')).toHaveLength(0)
  })

  it('keeps a reply alive for as long as the agent keeps speaking', async () => {
    const { relay, advance } = setup()
    const { id } = await ask(relay, '/chat', { id: 'recA' })
    await relay.next(0)
    await relay.chunks(id, { status: 200, chunks: [{ seq: 0, text: 'a' }] })
    // Half an hour of a quiet reply: an empty call every 20 seconds.
    for (let i = 0; i < 90; i++) {
      advance(20_000)
      await relay.chunks(id, { chunks: [] })
    }
    await relay.chunks(id, { chunks: [{ seq: 1, text: 'b' }], done: true })
    // The page can still read all of it, and only its asker.
    expect(await status(relay.poll(id, MEL.email, { waitMs: 0 }))).toBe(403)
    expect(await relay.poll(id, ROB.email, { waitMs: 0 })).toEqual({
      status: 200,
      chunks: [
        { seq: 0, text: 'a' },
        { seq: 1, text: 'b' },
      ],
      done: true,
    })
  })

  it('forgets a request 15 minutes after the agent’s last word', async () => {
    const { relay, advance } = setup()
    const { id } = await ask(relay, '/chat', { id: 'recA' })
    await relay.next(0)
    await relay.chunks(id, { status: 200, chunks: [{ seq: 0, text: 'a' }] })
    advance(REQUEST_TTL_S * 1000 - 1000)
    expect(
      (await relay.poll(id, ROB.email, { waitMs: 0 })).chunks
    ).toHaveLength(1)
    advance(2000)
    expect(await status(relay.poll(id, ROB.email, { waitMs: 0 }))).toBe(404)
    expect(
      await status(relay.chunks(id, { chunks: [{ seq: 1, text: 'b' }] }))
    ).toBe(404)
  })

  it('forgets a finished request about 2 minutes after it is done', async () => {
    const { relay, advance, dir } = setup()
    const { id } = await ask(relay, '/chat', { id: 'recA' })
    await relay.next(0)
    await relay.chunks(id, {
      status: 200,
      chunks: [{ seq: 0, text: 'the reply' }],
      done: true,
    })
    advance(DONE_TTL_S * 1000 - 1000)
    expect((await relay.poll(id, ROB.email, { waitMs: 0 })).done).toBe(true)
    advance(2000)
    expect(await status(relay.poll(id, ROB.email, { waitMs: 0 }))).toBe(404)
    // A later write sweeps what expired off the disk. Only the bare
    // "done" flag stays its 15 minutes, so the request can never look
    // unfinished again; it says nothing of what was asked or answered.
    advance(61_000)
    await ask(relay, '/chat', { id: 'recB' })
    expect(
      readdirSync(dir).filter(n => n.includes(id) && !n.includes('.3adone.3a'))
    ).toEqual([])
    advance(REQUEST_TTL_S * 1000)
    await ask(relay, '/chat', { id: 'recC' })
    expect(readdirSync(dir).filter(n => n.includes(id))).toEqual([])
  })

  it('forgets a request nobody picked up', async () => {
    const { relay, advance } = setup()
    const { id } = await ask(relay, '/chat', { id: 'recA' })
    advance(REQUEST_TTL_S * 1000 + 1000)
    expect(await status(relay.poll(id, ROB.email, { waitMs: 0 }))).toBe(404)
    expect(await relay.next(0)).toEqual([])
  })
})

describe('whether the chat’s server is online', () => {
  it('is online for a minute after the agent last asked for work', async () => {
    const { relay, advance } = setup()
    expect(await relay.online()).toBe(false)
    await relay.next(0)
    expect(await relay.online()).toBe(true)
    advance(59_000)
    expect(await relay.online()).toBe(true)
    advance(2000)
    expect(await relay.online()).toBe(false)
  })

  it('stays online across back-to-back long waits', async () => {
    const { relay } = setup()
    await relay.next(20)
    await relay.next(20)
    expect(await relay.online()).toBe(true)
  })
})

describe('what one person may ask in a minute', () => {
  it('counts messages, other requests and reads each by themselves', async () => {
    const { relay, advance } = setup()
    for (const [kind, most] of [
      ['send', TEAM_SENDS_PER_MINUTE],
      ['read', TEAM_READS_PER_MINUTE],
      ['poll', TEAM_POLLS_PER_MINUTE],
    ] as const) {
      for (let i = 0; i < most; i++) {
        expect(await relay.limit(ROB.email, kind)).toBeNull()
      }
      expect(await relay.limit(ROB.email, kind)).toBe(TEAM_BUSY)
    }
    // Someone else is counted by themselves, and a new minute starts again.
    expect(await relay.limit(MEL.email, 'send')).toBeNull()
    advance(60_000)
    expect(await relay.limit(ROB.email, 'send')).toBeNull()
  })

  it('counts the bytes they send, 30 MB a minute', async () => {
    const { relay, advance } = setup()
    const three = 3 * 1024 * 1024
    for (let sent = three; sent <= TEAM_BYTES_PER_MINUTE; sent += three) {
      expect(await relay.limit(ROB.email, 'send', three)).toBeNull()
    }
    expect(await relay.limit(ROB.email, 'send', three)).toBe(TEAM_TOO_MUCH)
    expect(await relay.limit(MEL.email, 'send', three)).toBeNull()
    advance(60_000)
    expect(await relay.limit(ROB.email, 'send', three)).toBeNull()
  })
})

describe('the file store', () => {
  it('hands each value of a list to one taker only', async () => {
    const { kv } = setup()
    for (const v of ['a', 'b', 'c']) await kv.rpush('list', v, 60)
    await kv.lpush('list', 'first', 60)
    const got = await Promise.all([1, 2, 3, 4, 5].map(() => kv.lpop('list')))
    expect(got).toEqual(['first', 'a', 'b', 'c', null])
  })

  it('answers scored values above a score, lowest first, up to a limit', async () => {
    const { kv } = setup()
    await kv.zadd(
      'set',
      [10, 2, 33, 1].map(n => ({ score: n, value: `v${n}` })),
      60
    )
    expect(await kv.zafter('set', -1, 10)).toEqual(['v1', 'v2', 'v10', 'v33'])
    expect(await kv.zafter('set', 2, 10)).toEqual(['v10', 'v33'])
    expect(await kv.zafter('set', -1, 2)).toEqual(['v1', 'v2'])
    expect(await kv.zafter('set', 33, 10)).toEqual([])
    expect(await kv.zlast('set')).toBe(33)
    expect(await kv.zlast('no-such-set')).toBeNull()
  })

  it('sets a key only once with claim, until it is gone again', async () => {
    const { kv, advance } = setup()
    expect(await kv.claim('k', 'first', 10)).toBe(true)
    expect(await kv.claim('k', 'second', 10)).toBe(false)
    expect(await kv.get('k')).toBe('first')
    advance(11_000)
    expect(await kv.claim('k', 'third', 10)).toBe(true)
    expect(await kv.get('k')).toBe('third')
    await kv.del(['k'])
    expect(await kv.claim('k', 'fourth', 10)).toBe(true)
  })

  it('drops a key at the end of its life, and expire moves that', async () => {
    const { kv, advance } = setup()
    await kv.set('a', '1', 10)
    await kv.set('b', '2', 10)
    await kv.expire(['b', 'never-set'], 100)
    advance(11_000)
    expect(await kv.mget(['a', 'b', 'never-set'])).toEqual([null, '2', null])
    expect(await kv.incr('n', 10)).toBe(1)
    expect(await kv.incr('n', 10, 5)).toBe(6)
    advance(11_000)
    expect(await kv.incr('n', 10)).toBe(1)
    await kv.del(['b'])
    expect(await kv.get('b')).toBeNull()
  })

  it('keeps keys with awkward characters apart', async () => {
    const { kv } = setup()
    await kv.set('rate:a.b+c@example.org:1', 'one', 60)
    await kv.set('rate:a_b+c@example.org:1', 'two', 60)
    expect(await kv.get('rate:a.b+c@example.org:1')).toBe('one')
    expect(await kv.get('rate:a_b+c@example.org:1')).toBe('two')
  })
})
