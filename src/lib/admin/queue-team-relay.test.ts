import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sealToken } from './session'
import { TEAM_NOT_ANSWERING, TEAM_STOPPED } from './queue-team-chat'
import {
  AGENT_TOKEN_KIND,
  checkAgentToken,
  createRelay,
  DONE_TTL_S,
  fileKv,
  RATE_PER_MINUTE,
  RelayError,
  REQUEST_TTL_S,
} from './queue-team-relay'

// The relay over its file store in a temp folder, on a clock the test
// moves: no network, no real waiting.

const SECRET = 'test-team-agent-secret'
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
    expect(check(bearer(good(), 'another-secret'))).toBe(false)
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
    expect(check(bearer(good({ iat: NOW_S, exp: NOW_S + 121 })))).toBe(false)
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

const ROB = {
  email: 'rob@example.org',
  name: 'Rob',
  mode: 'suggest' as const,
}
const MEL = { email: 'mel@example.org', name: 'Mel', mode: 'edit' as const }

async function refusal(p: Promise<unknown>): Promise<number | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof RelayError) return e.status
    throw e
  }
}

describe('handing requests to the agent', () => {
  it('hands each request out once, oldest first, with who beside the body', async () => {
    const { relay, advance } = setup()
    const a = await relay.create('/chat/history', { id: 'recA' }, ROB)
    advance(10)
    const b = await relay.create('/chat', { id: 'recB', message: 'hi' }, MEL)
    const got = await relay.next(0)
    expect(got.map(r => r.id)).toEqual([a.id, b.id])
    expect(got[0]).toEqual({
      id: a.id,
      path: '/chat/history',
      body: { id: 'recA' },
      who: ROB,
      at: new Date(NOW_S * 1000).toISOString(),
    })
    expect(got[1].who).toEqual(MEL)
    expect(await relay.next(0)).toEqual([])
  })

  it('waits for a request when there is none', async () => {
    const { relay, hooks } = setup()
    let made = ''
    let sleeps = 0
    hooks.onSleep = async () => {
      if (++sleeps === 3) {
        made = (await relay.create('/chat/clear', { id: 'recA' }, ROB)).id
      }
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

  it('never hands out a request the page is about to give up on', async () => {
    const { relay, advance } = setup()
    await relay.create('/chat', { id: 'recA', message: 'hi' }, ROB)
    advance(26_000)
    expect(await relay.next(0)).toEqual([])
  })

  it('keeps one answer under what a response may carry', async () => {
    const { relay } = setup()
    const big = 'x'.repeat(2.5 * 1024 * 1024)
    const a = await relay.create('/chat', { id: 'recA', data: big }, ROB)
    const b = await relay.create('/chat', { id: 'recB', data: big }, ROB)
    expect((await relay.next(0)).map(r => r.id)).toEqual([a.id])
    expect((await relay.next(0)).map(r => r.id)).toEqual([b.id])
    expect(await relay.next(0)).toEqual([])
  })

  it('no longer keeps a body once the agent has it', async () => {
    const { relay, dir } = setup()
    await relay.create('/chat', { id: 'recA', message: 'private words' }, ROB)
    // The key's colons are written ".3a" in a file name.
    const kept = () =>
      readdirSync(dir).filter(n => /\.3areq\.3a.*\.val$/.test(n))
    expect(kept()).toHaveLength(1)
    await relay.next(0)
    expect(kept()).toHaveLength(0)
  })
})

describe('the pieces of an answer', () => {
  async function taken() {
    const s = setup()
    const { id } = await s.relay.create('/chat', { id: 'recA' }, ROB)
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

  it('keeps the first status it was given', async () => {
    const { relay, id } = await taken()
    await relay.chunks(id, { status: 202, chunks: [] })
    await relay.chunks(id, { status: 500, chunks: [{ seq: 0, text: '{}' }] })
    expect((await relay.poll(id, ROB.email, { waitMs: 0 })).status).toBe(202)
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
      // The agent is alive: a keep-alive piece now and then.
      if (slept % 20 === 0) await relay.chunks(id, { chunks: [] })
    }
    expect(
      await relay.poll(id, ROB.email, { after: 0, started: true })
    ).toEqual({ status: 200, chunks: [], done: false })
    // 3 s at four a second, then 17 s at two a second.
    expect(slept).toBe(12 + 34)
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
      expect(await refusal(relay.chunks(id, bad))).toBe(400)
    }
    expect(await refusal(relay.chunks('short', { chunks: [] }))).toBe(400)
  })

  it('refuses pieces for an unknown id, or one no agent was handed', async () => {
    const { relay } = setup()
    expect(
      await refusal(relay.chunks('request-id-99999999', { chunks: [] }))
    ).toBe(404)
    const { id } = await relay.create('/chat', { id: 'recA' }, ROB)
    expect(await refusal(relay.chunks(id, { status: 200, chunks: [] }))).toBe(
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
    ).toBe(409)
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
    const { id } = await relay.create('/chat/history', { id: 'recA' }, ROB)
    await relay.next(0)
    await relay.chunks(id, {
      status: 200,
      chunks: [{ seq: 0, text: '{"ok":true}' }],
      done: true,
    })
    expect(await refusal(relay.poll(id, MEL.email, { waitMs: 0 }))).toBe(403)
    expect(await refusal(relay.poll(id, '', { waitMs: 0 }))).toBe(403)
    expect((await relay.poll(id, ROB.email, { waitMs: 0 })).done).toBe(true)
  })

  it('answers 404 for an id it does not keep', async () => {
    const { relay } = setup()
    expect(
      await refusal(relay.poll('request-id-99999999', ROB.email, { waitMs: 0 }))
    ).toBe(404)
    expect(await refusal(relay.poll('../etc', ROB.email, { waitMs: 0 }))).toBe(
      400
    )
  })
})

describe('when nobody answers', () => {
  it('tells the page after 30 seconds with no agent', async () => {
    const { relay } = setup()
    const { id } = await relay.create('/chat', { id: 'recA' }, ROB)
    // The first read waits its 20 seconds and has nothing.
    expect(await relay.poll(id, ROB.email)).toEqual({ chunks: [], done: false })
    // The second gives up as the 30 seconds pass.
    expect(await relay.poll(id, ROB.email)).toEqual({
      chunks: [],
      done: true,
      error: TEAM_NOT_ANSWERING,
    })
    // And an agent that turns up now is not handed it.
    expect(await relay.next(0)).toEqual([])
  })

  it('tells the page when an agent took the request and went quiet', async () => {
    const { relay, advance } = setup()
    const { id } = await relay.create('/chat', { id: 'recA' }, ROB)
    await relay.next(0)
    await relay.chunks(id, { status: 200, chunks: [{ seq: 0, text: 'a' }] })
    advance(89_000)
    // Still within its time: a late piece is taken.
    await relay.chunks(id, { chunks: [{ seq: 1, text: 'b' }] })
    advance(91_000)
    expect(
      await refusal(relay.chunks(id, { chunks: [{ seq: 2, text: 'c' }] }))
    ).toBe(409)
    advance(10_000)
    expect(
      await relay.poll(id, ROB.email, { after: 1, started: true, waitMs: 0 })
    ).toEqual({ status: 200, chunks: [], done: true, error: TEAM_STOPPED })
  })

  it('counts an empty call as the agent still being there', async () => {
    const { relay, advance } = setup()
    const { id } = await relay.create('/chat', { id: 'recA' }, ROB)
    await relay.next(0)
    for (let i = 0; i < 6; i++) {
      advance(60_000)
      await relay.chunks(id, i ? { chunks: [] } : { status: 200, chunks: [] })
    }
    expect(
      await relay.poll(id, ROB.email, { started: true, waitMs: 0 })
    ).toEqual({ status: 200, chunks: [], done: false })
  })
})

describe('how long things are kept', () => {
  it('forgets a request after 15 minutes', async () => {
    const { relay, advance } = setup()
    const { id } = await relay.create('/chat', { id: 'recA' }, ROB)
    await relay.next(0)
    await relay.chunks(id, { status: 200, chunks: [{ seq: 0, text: 'a' }] })
    advance(REQUEST_TTL_S * 1000 - 1000)
    expect(
      (await relay.poll(id, ROB.email, { waitMs: 0 })).chunks
    ).toHaveLength(1)
    // The last write was the piece: 15 minutes from then, the lot is gone.
    advance(2000)
    expect(await refusal(relay.poll(id, ROB.email, { waitMs: 0 }))).toBe(404)
    expect(
      await refusal(relay.chunks(id, { chunks: [{ seq: 1, text: 'b' }] }))
    ).toBe(404)
  })

  it('forgets a finished request about 2 minutes after it is done', async () => {
    const { relay, advance, dir } = setup()
    const { id } = await relay.create('/chat', { id: 'recA' }, ROB)
    await relay.next(0)
    await relay.chunks(id, {
      status: 200,
      chunks: [{ seq: 0, text: 'the reply' }],
      done: true,
    })
    advance(DONE_TTL_S * 1000 - 1000)
    expect((await relay.poll(id, ROB.email, { waitMs: 0 })).done).toBe(true)
    advance(2000)
    expect(await refusal(relay.poll(id, ROB.email, { waitMs: 0 }))).toBe(404)
    // A later write sweeps what expired off the disk.
    advance(61_000)
    await relay.create('/chat', { id: 'recB' }, ROB)
    expect(readdirSync(dir).filter(n => n.includes(id))).toEqual([])
  })

  it('forgets a request nobody picked up', async () => {
    const { relay, advance } = setup()
    const { id } = await relay.create('/chat', { id: 'recA' }, ROB)
    advance(REQUEST_TTL_S * 1000 + 1000)
    expect(await refusal(relay.poll(id, ROB.email, { waitMs: 0 }))).toBe(404)
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

describe('the limit on requests', () => {
  it('lets one person start 60 a minute', async () => {
    const { relay, advance } = setup()
    for (let i = 0; i < RATE_PER_MINUTE; i++) {
      expect(await relay.allow(ROB.email)).toBe(true)
    }
    expect(await relay.allow(ROB.email)).toBe(false)
    // Someone else is counted by themselves.
    expect(await relay.allow(MEL.email)).toBe(true)
    advance(60_000)
    expect(await relay.allow(ROB.email)).toBe(true)
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

  it('answers scored values above a score, lowest first', async () => {
    const { kv } = setup()
    await kv.zadd(
      'set',
      [10, 2, 33, 1].map(n => ({ score: n, value: `v${n}` })),
      60
    )
    expect(await kv.zafter('set', -1)).toEqual(['v1', 'v2', 'v10', 'v33'])
    expect(await kv.zafter('set', 2)).toEqual(['v10', 'v33'])
    expect(await kv.zafter('set', 33)).toEqual([])
  })

  it('drops a key at the end of its life, and expire moves that', async () => {
    const { kv, advance } = setup()
    await kv.set('a', '1', 10)
    await kv.set('b', '2', 10)
    await kv.expire(['b', 'never-set'], 100)
    advance(11_000)
    expect(await kv.mget(['a', 'b', 'never-set'])).toEqual([null, '2', null])
    expect(await kv.incr('n', 10)).toBe(1)
    expect(await kv.incr('n', 10)).toBe(2)
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
