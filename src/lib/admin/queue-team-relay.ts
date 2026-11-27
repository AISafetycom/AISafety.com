// The relay behind the team's Fable chat (queue-team-chat.ts has the
// picture). The site holds a request from the page until the server's agent
// has it, then holds the pieces of the agent's answer until the page has
// read them. Nothing here runs the chat or keeps its history: that lives on
// the server's agent. Everything kept here is short-lived (a message's body
// a minute at most, the rest 15 minutes after the agent's last word and
// about 2 minutes once a request is done), and nothing here logs a body or
// a piece of a reply.
//
// Storage is Upstash Redis in production, the same database the admin's
// user list uses (users-store.ts), and files under .admin-dev/ on a laptop
// without it (dev and the Queue demo).
import { createHash, createHmac, randomBytes } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { Redis } from '@upstash/redis'
import { openToken } from './session'
import {
  byteLength,
  TEAM_BUSY,
  TEAM_BYTES_PER_MINUTE,
  TEAM_NOT_ANSWERING,
  TEAM_POLLS_PER_MINUTE,
  TEAM_READS_PER_MINUTE,
  TEAM_SENDS_PER_MINUTE,
  TEAM_STOPPED,
  TEAM_TOO_BIG,
  TEAM_TOO_MUCH,
  type TeamBudget,
  type TeamChatPath,
  type TeamChunk,
  type TeamPoll,
  type TeamWho,
} from './queue-team-chat'

// ─── The shared secret, and the agent's token ───────────────────────────────

export const AGENT_TOKEN_KIND = 'queue-team-agent'
/** A token may live this long at most (exp - iat). */
export const AGENT_TOKEN_MAX_LIFE_S = 120
/** How far ahead of the site's clock a token's iat may be. */
export const AGENT_TOKEN_MAX_AHEAD_S = 60
/** A token is taken only within this long of its end, so the whole time
 *  one token works for is two minutes, however the clocks differ. */
export const AGENT_TOKEN_WINDOW_S = 120
/** A secret shorter than this could be guessed: it counts as not set. */
export const SECRET_MIN_LENGTH = 32

let warnedShort = false

/** The secret both the site and the server's agent hold. Empty: the team
 *  chat is off. One too short to be safe is treated as not set, and the
 *  server's log says so. */
export function teamAgentSecret(): string {
  const secret = (process.env.QUEUE_TEAM_AGENT_SECRET ?? '').trim()
  if (!secret) return ''
  if (secret.length < SECRET_MIN_LENGTH) {
    if (!warnedShort) {
      warnedShort = true
      console.warn(
        `[queue-team-chat] QUEUE_TEAM_AGENT_SECRET is shorter than ${SECRET_MIN_LENGTH} characters, so the team chat stays off. Set a long random one.`
      )
    }
    return ''
  }
  return secret
}

/** Check the server agent's `Authorization: Bearer <token>`. The token is
 *  sealed the way the site seals its own (session.ts sealToken): base64url
 *  JSON {v: 1, kind: 'queue-team-agent', iat, exp}, a dot, and the
 *  HMAC-SHA256 of that first part under the shared secret. It is short-lived
 *  on purpose: the agent mints a fresh one for every call, and the site
 *  takes one only in the two minutes before it ends, so a captured one is
 *  useless two minutes later whatever its dates say. */
export function checkAgentToken(
  authorization: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): { ok: true } | { ok: false; why: string } {
  if (!secret) return { ok: false, why: 'no secret on the site' }
  const m = /^Bearer ([A-Za-z0-9_.-]{1,2000})$/.exec(authorization ?? '')
  if (!m) return { ok: false, why: 'no token' }
  const t = openToken<{
    v?: unknown
    kind?: unknown
    iat?: unknown
    exp?: unknown
  }>(m[1], secret)
  if (!t) return { ok: false, why: 'signature does not match' }
  if (t.v !== 1 || t.kind !== AGENT_TOKEN_KIND) {
    return { ok: false, why: 'not a team agent token' }
  }
  const { iat, exp } = t
  if (
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    !Number.isFinite(iat) ||
    !Number.isFinite(exp)
  ) {
    return { ok: false, why: 'malformed' }
  }
  if (exp <= nowSeconds) return { ok: false, why: 'expired' }
  if (exp - iat > AGENT_TOKEN_MAX_LIFE_S) {
    return { ok: false, why: 'lives too long' }
  }
  if (iat > nowSeconds + AGENT_TOKEN_MAX_AHEAD_S) {
    return { ok: false, why: 'issued in the future' }
  }
  if (exp > nowSeconds + AGENT_TOKEN_WINDOW_S) {
    return { ok: false, why: 'ends too far ahead (is a clock wrong?)' }
  }
  return { ok: true }
}

// ─── A request's signature ──────────────────────────────────────────────────

/** Sign a request as the site made it, so the agent can tell a request the
 *  site wrote from one somebody put straight into the store: whoever can
 *  write there but does not hold the secret can forge neither a request
 *  nor who it is from. The agent checks it and reads `bodyText`, never a
 *  body somebody else parsed.
 *
 *    bodySha = hex(SHA-256(UTF-8 of bodyText))
 *    sig     = base64url-nopad(HMAC-SHA256(secret, lines joined by "\n"))
 *    lines   = id, path, who.email, base64url-nopad(UTF-8 of who.name),
 *              who.mode, at, bodySha
 *
 *  A vector to check another implementation against (queue-team-relay
 *  .test.ts holds the same one):
 *
 *    secret    test-vector-secret-0123456789abcdef-not-a-real-one
 *    id        request-id-00000001
 *    path      /chat
 *    who       email rob@example.org · name Zoë O'Neil-Smith (ë is
 *              U+00EB) · mode suggest
 *    at        2026-11-30T03:00:00.000Z
 *    bodyText  {"id":"recA0000000000001","message":"Héllo – 你好"}
 *              (56 bytes as UTF-8; the dash is U+2013)
 *    name, base64url  Wm_DqyBPJ05laWwtU21pdGg
 *    bodySha   b9378c7c529aa2816ef92651e48fb97a5c4f04b79398579f9ee26459d98f450d
 *    sig       0ul07t6_ZveVaHocO30CbIoP-c8OSQE6_0kuAGC6L9I
 */
export function signRequest(
  secret: string,
  r: {
    id: string
    path: string
    who: TeamWho
    at: string
    bodyText: string
  }
): string {
  const bodySha = createHash('sha256').update(r.bodyText, 'utf8').digest('hex')
  const name = Buffer.from(r.who.name, 'utf8').toString('base64url')
  return createHmac('sha256', secret)
    .update(
      [r.id, r.path, r.who.email, name, r.who.mode, r.at, bodySha].join('\n')
    )
    .digest('base64url')
}

// ─── What may be said about an error in the log ─────────────────────────────

/** An error for the server's log: its kind and a short reason, never what
 *  was being stored. The Redis client ends its errors with ", command was:"
 *  and the whole command, which here would be somebody's message. */
export function relayErrorText(e: unknown): string {
  const name = e instanceof Error ? e.name : 'Error'
  const said = e instanceof Error ? e.message : String(e)
  return `${name}: ${said.split(', command was:')[0].slice(0, 200)}`
}

// ─── The store underneath ───────────────────────────────────────────────────

/** The few Redis commands the relay needs. Every write names how long the
 *  key lives, so nothing is ever kept for good. */
export interface RelayKv {
  get(key: string): Promise<string | null>
  mget(keys: string[]): Promise<(string | null)[]>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  /** Set only if the key is not there; true when this call set it. */
  claim(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(keys: string[]): Promise<void>
  /** Shorten or lengthen the life of keys that exist. */
  expire(keys: string[], ttlSeconds: number): Promise<void>
  /** Add to the end of a list. */
  rpush(key: string, value: string, ttlSeconds: number): Promise<void>
  /** Put back at the front of a list. */
  lpush(key: string, value: string, ttlSeconds: number): Promise<void>
  /** Take the first of a list; each value is taken by one caller only. */
  lpop(key: string): Promise<string | null>
  /** Add scored values to a sorted set. */
  zadd(
    key: string,
    items: { score: number; value: string }[],
    ttlSeconds: number
  ): Promise<void>
  /** The values scored above `score`, lowest first, `limit` at most. */
  zafter(key: string, score: number, limit: number): Promise<string[]>
  /** The highest score in a sorted set; null when it is empty. */
  zlast(key: string): Promise<number | null>
  /** Count `by` more under `key`; answers the count. */
  incr(key: string, ttlSeconds: number, by?: number): Promise<number>
}

export function redisKv(db: Redis): RelayKv {
  const text = (v: unknown) =>
    v === null || v === undefined ? null : String(v)
  return {
    async get(key) {
      return text(await db.get<string>(key))
    },
    async mget(keys) {
      return (await db.mget<(string | null)[]>(...keys)).map(text)
    },
    async set(key, value, ttlSeconds) {
      await db.set(key, value, { ex: ttlSeconds })
    },
    async claim(key, value, ttlSeconds) {
      return (await db.set(key, value, { nx: true, ex: ttlSeconds })) !== null
    },
    async del(keys) {
      if (keys.length) await db.del(...keys)
    },
    async expire(keys, ttlSeconds) {
      if (!keys.length) return
      const p = db.pipeline()
      for (const k of keys) p.expire(k, ttlSeconds)
      await p.exec()
    },
    async rpush(key, value, ttlSeconds) {
      const p = db.pipeline()
      p.rpush(key, value)
      p.expire(key, ttlSeconds)
      await p.exec()
    },
    async lpush(key, value, ttlSeconds) {
      const p = db.pipeline()
      p.lpush(key, value)
      p.expire(key, ttlSeconds)
      await p.exec()
    },
    async lpop(key) {
      return text(await db.lpop<string>(key))
    },
    async zadd(key, items, ttlSeconds) {
      if (!items.length) return
      const p = db.pipeline()
      const [first, ...rest] = items.map(i => ({
        score: i.score,
        member: i.value,
      }))
      p.zadd(key, first, ...rest)
      p.expire(key, ttlSeconds)
      await p.exec()
    },
    async zafter(key, score, limit) {
      const got = await db.zrange<string[]>(key, `(${score}`, '+inf', {
        byScore: true,
        offset: 0,
        count: limit,
      })
      return got.map(v => String(v))
    },
    async zlast(key) {
      // [member, score] of the highest, or nothing.
      const got = await db.zrange<unknown[]>(key, -1, -1, { withScores: true })
      const score = got.length >= 2 ? Number(got[1]) : NaN
      return Number.isFinite(score) ? score : null
    },
    async incr(key, ttlSeconds, by = 1) {
      const p = db.pipeline()
      p.incrby(key, by)
      p.expire(key, ttlSeconds)
      const [n] = await p.exec<[number, number]>()
      return Number(n)
    },
  }
}

/** The same commands over a folder of small files, for a laptop with no
 *  Redis. Files rather than memory, so every process `next dev` starts
 *  sees the same requests, and a list's values are claimed by renaming, so
 *  two processes can never take the same one. */
export function fileKv(dir: string, now: () => number = Date.now): RelayKv {
  let n = 0
  let swept = 0
  const safe = (key: string) =>
    key.replace(/[^A-Za-z0-9_-]/g, c => `.${c.charCodeAt(0).toString(16)}`)
  const at = (key: string, ext: string) => path.join(dir, `${safe(key)}${ext}`)
  const read = (file: string): string | null => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return null
    }
  }
  const names = (folder: string): string[] => {
    try {
      return readdirSync(folder).sort()
    } catch {
      return []
    }
  }
  /** Written whole or not at all: under another name first, then moved. */
  const write = (file: string, text: string) => {
    // The file's folder is `dir` or one inside it: this makes both.
    mkdirSync(path.dirname(file), { recursive: true })
    const tmp = path.join(
      dir,
      `tmp-${process.pid}-${now()}-${n++}-${randomBytes(4).toString('hex')}`
    )
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, file)
  }
  const drop = (key: string) => {
    for (const ext of ['.val', '.exp']) rmSync(at(key, ext), { force: true })
    for (const ext of ['.list', '.zset']) {
      rmSync(at(key, ext), { recursive: true, force: true })
    }
  }
  /** Whether the key is still within its life; one past it is removed. */
  const alive = (key: string): boolean => {
    const exp = Number(read(at(key, '.exp')))
    if (Number.isFinite(exp) && exp > now()) return true
    drop(key)
    return false
  }
  const live = (key: string, ttlSeconds: number) =>
    write(at(key, '.exp'), String(now() + ttlSeconds * 1000))
  /** Once a minute: remove what has expired and was never asked for again. */
  const sweep = () => {
    if (now() - swept < 60_000) return
    swept = now()
    for (const name of names(dir)) {
      if (!name.endsWith('.exp')) continue
      const exp = Number(read(path.join(dir, name)))
      if (Number.isFinite(exp) && exp > now()) continue
      const base = path.join(dir, name.slice(0, -4))
      rmSync(`${base}.val`, { force: true })
      rmSync(`${base}.exp`, { force: true })
      rmSync(`${base}.list`, { recursive: true, force: true })
      rmSync(`${base}.zset`, { recursive: true, force: true })
    }
  }
  const stamp = () => String(now()).padStart(15, '0')
  const entry = () =>
    `${String(n++).padStart(8, '0')}-${process.pid}-${randomBytes(4).toString('hex')}`
  const get = (key: string) => (alive(key) ? read(at(key, '.val')) : null)
  return {
    async get(key) {
      return get(key)
    },
    async mget(keys) {
      return keys.map(get)
    },
    async set(key, value, ttlSeconds) {
      sweep()
      write(at(key, '.val'), value)
      live(key, ttlSeconds)
    },
    async claim(key, value, ttlSeconds) {
      if (alive(key)) return false
      mkdirSync(dir, { recursive: true })
      try {
        // Made only if it is not there: one of two processes wins.
        writeFileSync(at(key, '.val'), value, { encoding: 'utf8', flag: 'wx' })
      } catch {
        return false
      }
      live(key, ttlSeconds)
      return true
    },
    async del(keys) {
      keys.forEach(drop)
    },
    async expire(keys, ttlSeconds) {
      for (const key of keys) if (alive(key)) live(key, ttlSeconds)
    },
    async rpush(key, value, ttlSeconds) {
      alive(key)
      write(path.join(at(key, '.list'), `${stamp()}-${entry()}`), value)
      live(key, ttlSeconds)
    },
    async lpush(key, value, ttlSeconds) {
      alive(key)
      write(path.join(at(key, '.list'), `${'0'.repeat(15)}-${entry()}`), value)
      live(key, ttlSeconds)
    },
    async lpop(key) {
      if (!alive(key)) return null
      const folder = at(key, '.list')
      for (const name of names(folder)) {
        const mine = path.join(dir, `tmp-taken-${process.pid}-${entry()}`)
        try {
          renameSync(path.join(folder, name), mine)
        } catch {
          continue // another process took this one
        }
        const value = read(mine)
        rmSync(mine, { force: true })
        if (value !== null) return value
      }
      return null
    },
    async zadd(key, items, ttlSeconds) {
      if (!items.length) return
      alive(key)
      for (const i of items) {
        write(
          path.join(at(key, '.zset'), String(i.score).padStart(15, '0')),
          i.value
        )
      }
      live(key, ttlSeconds)
    },
    async zafter(key, score, limit) {
      if (!alive(key)) return []
      const folder = at(key, '.zset')
      const out: string[] = []
      for (const name of names(folder)) {
        if (!(Number(name) > score)) continue
        const value = read(path.join(folder, name))
        if (value !== null) out.push(value)
        if (out.length >= limit) break
      }
      return out
    },
    async zlast(key) {
      if (!alive(key)) return null
      const all = names(at(key, '.zset'))
      return all.length ? Number(all[all.length - 1]) : null
    },
    async incr(key, ttlSeconds, by = 1) {
      const next = (alive(key) ? Number(read(at(key, '.val'))) || 0 : 0) + by
      write(at(key, '.val'), String(next))
      live(key, ttlSeconds)
      return next
    },
  }
}

// ─── The relay ──────────────────────────────────────────────────────────────

/** A request and its answer are kept this long after the agent's last word
 *  on it (each piece renews it, so a reply may take as long as it takes). */
export const REQUEST_TTL_S = 15 * 60
/** Once the agent says a request is done, what is left of it goes. */
export const DONE_TTL_S = 2 * 60
/** A request's body is kept this long at most: it goes the moment an agent
 *  says it has it, and nobody is told to wait longer than half of this. */
export const BODY_TTL_S = 60
/** The page is told nobody is answering after this long with no agent. */
export const PICKUP_MS = 30_000
/** An agent's first word on a request is taken up to here: a second short
 *  of the moment the page is told nobody answered, so the two never both
 *  happen. */
export const ACK_MS = 29_000
/** A request this old is no longer handed to an agent: the page is about
 *  to be told nobody answered, and would send it again. */
export const HANDOUT_MS = 25_000
/** A request handed to an agent that has said nothing about it for this
 *  long is offered again: the first hand-out may have gone to a connection
 *  that had already died. */
export const REOFFER_MS = 10_000
/** How often one waiting `next` call looks for requests to offer again. */
const OFFERED_LOOK_MS = 3_000
/** An agent that went quiet on a request for this long is refused when it
 *  speaks again (it was cut off), */
export const STALL_WRITE_MS = 90_000
/** and a little later the page is told the answer stopped. */
export const STALL_MS = 100_000
/** The agent counts as online for this long after it last asked for work. */
export const ONLINE_MS = 60_000
/** How long one read by the page waits for something new. */
export const POLL_MS = 20_000
/** The longest an agent may ask `next` to wait, in seconds. */
export const NEXT_MAX_WAIT_S = 20
/** One `chunks` call from the agent may be this big. */
export const CHUNKS_MAX_BYTES = 1024 * 1024
/** One `next` answer stays under this, in bytes (Vercel sends 4.5 MB). */
export const NEXT_MAX_BYTES = 4 * 1024 * 1024
/** A request with its signature, as kept and handed out, may be this big. */
const REQUEST_MAX_BYTES = NEXT_MAX_BYTES - 64 * 1024
/** `body` (the parsed copy) rides along only with a `bodyText` up to this
 *  size: both of a big message would not fit in one answer. The agent
 *  reads `bodyText`. */
export const BODY_COPY_MAX_BYTES = 1.5 * 1024 * 1024
/** One read by the page carries this many bytes of pieces at most; the
 *  page asks again for the rest. */
export const POLL_MAX_BYTES = 3 * 1024 * 1024
const POLL_MAX_CHUNKS = 200
/** How many reads of one request may wait at the same time. */
export const READERS_PER_ID = 2
const READER_TTL_S = Math.ceil(POLL_MS / 1000) + 5

const LIMITS: Record<TeamBudget, number> = {
  send: TEAM_SENDS_PER_MINUTE,
  read: TEAM_READS_PER_MINUTE,
  poll: TEAM_POLLS_PER_MINUTE,
}

const KEY = 'queue:team-chat:'
const K = {
  /** Requests no agent has been handed yet (a list of ids). */
  pending: `${KEY}pending`,
  /** Requests handed to an agent that has not answered for them yet. */
  offered: `${KEY}offered`,
  seen: `${KEY}agent-seen`,
  /** The request as handed out, signature included. Gone once an agent
   *  has said it has it. */
  req: (id: string) => `${KEY}req:${id}`,
  /** Who asked and when. */
  meta: (id: string) => `${KEY}meta:${id}`,
  /** When it was last handed out (ms). */
  taken: (id: string) => `${KEY}taken:${id}`,
  /** When the agent last said anything about it. There at all: an agent
   *  has it. */
  live: (id: string) => `${KEY}live:${id}`,
  /** The agent's HTTP status: set once. */
  status: (id: string) => `${KEY}status:${id}`,
  /** There: the answer is complete. Set once, never taken back. */
  done: (id: string) => `${KEY}done:${id}`,
  /** The pieces, scored by seq. */
  chunks: (id: string) => `${KEY}chunks:${id}`,
  reader: (id: string, slot: number) => `${KEY}reader:${id}:${slot}`,
  rate: (what: string, email: string, minute: number) =>
    `${KEY}rate:${what}:${email}:${minute}`,
}

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/

/** A request as kept: what the agent is handed, less the parsed body. */
interface Stored {
  id: string
  path: TeamChatPath
  who: TeamWho
  /** When the site took the request (ISO). */
  at: string
  /** The page's body as text, exactly as signed. */
  bodyText: string
  /** signRequest over all of the above. */
  sig: string
}

/** What the server's agent is handed for one request. `who` and `at` sit
 *  beside the body, never in it. The agent checks `sig` and reads
 *  `bodyText`; `body` is the same thing parsed, for a `bodyText` of up to
 *  1.5 MB only. */
export interface TeamRequest extends Stored {
  body?: Record<string, unknown>
}

/** Who asked and when: small, so a read by the page never loads the body. */
interface Meta {
  by: string
  at: number
}

/** A refusal with the status the route answers, and anything the caller
 *  should be told besides the words (a `code` the agent can act on). */
export class RelayError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    return v !== null && typeof v === 'object' ? (v as T) : null
  } catch {
    return null
  }
}

export interface RelayOptions {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  newId?: () => string
  /** The secret requests are signed with; the site's own by default. */
  secret?: () => string
}

export interface Relay {
  /** The page's request, signed and kept for the agent. `bodyText` is the
   *  page's body as text (teamBody). */
  create(
    path: TeamChatPath,
    bodyText: string,
    who: TeamWho
  ): Promise<{ id: string }>
  /** What has come for a request since piece `after`; waits up to `waitMs`
   *  for something new. Only the person who made the request may ask, and
   *  two reads of one request at a time at most. `started`: the page
   *  already has the status, so a status by itself is nothing new. */
  poll(
    id: string,
    email: string,
    opts?: {
      after?: number
      started?: boolean
      waitMs?: number
      aborted?: () => boolean
    }
  ): Promise<TeamPoll>
  /** The requests waiting for an agent; waits up to `waitSeconds` when
   *  there are none. A request is offered again, every ten seconds, until
   *  an agent's first `chunks` call says it has it. Marks the agent as
   *  seen. */
  next(waitSeconds: number, aborted?: () => boolean): Promise<TeamRequest[]>
  /** Pieces of the agent's answer to a request, in order. The first call
   *  for a request (it may carry no piece) says the agent has it. */
  chunks(
    id: string,
    input: { status?: unknown; chunks?: unknown; done?: unknown }
  ): Promise<void>
  /** An agent asked for work within the last minute. */
  online(): Promise<boolean>
  /** Count one request of this kind for this person, and its bytes. Null
   *  when it may go ahead, else the words to refuse it with. */
  limit(email: string, kind: TeamBudget, bytes?: number): Promise<string | null>
}

export function createRelay(kv: RelayKv, opts: RelayOptions = {}): Relay {
  const now = opts.now ?? Date.now
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const newId = opts.newId ?? (() => randomBytes(18).toString('base64url'))
  const secret = opts.secret ?? teamAgentSecret
  // This server handed a request out lately: a chat is under way, so the
  // next ones are looked for more often. Only a hint (another server may
  // answer the next call); the slower pace is the fallback.
  let handedAt = 0

  const seen = () => kv.set(K.seen, String(now()), 24 * 3600)

  /** The request as the agent gets it, and about how many bytes that is
   *  (`raw` is the kept JSON, which holds the body's text once; the parsed
   *  copy, when it goes too, is about that text again). */
  const forAgent = (stored: Stored, raw: string) => {
    const text = byteLength(stored.bodyText)
    const copy = text <= BODY_COPY_MAX_BYTES
    const request: TeamRequest = copy
      ? { ...stored, body: parse<Record<string, unknown>>(stored.bodyText)! }
      : stored
    return { request, bytes: byteLength(raw) + (copy ? text : 0) + 16 }
  }

  /** The requests an agent can still answer: first (with `again`) the ones
   *  handed out a while ago that no agent has spoken for, then the new
   *  ones, oldest first. */
  const take = async (again: boolean): Promise<TeamRequest[]> => {
    const out: TeamRequest[] = []
    let size = 0
    const fits = (bytes: number) =>
      out.length === 0 || size + bytes <= NEXT_MAX_BYTES
    const hand = async (id: string, request: TeamRequest, bytes: number) => {
      await kv.set(K.taken(id), String(now()), REQUEST_TTL_S)
      await kv.rpush(K.offered, id, REQUEST_TTL_S)
      out.push(request)
      size += bytes
    }

    const looked = new Set<string>()
    for (let i = 0; again && i < 50; i++) {
      const id = await kv.lpop(K.offered)
      if (!id) break
      if (looked.has(id)) {
        // Round the whole list once.
        await kv.rpush(K.offered, id, REQUEST_TTL_S)
        break
      }
      looked.add(id)
      const [metaRaw, takenRaw, liveRaw, reqRaw] = await kv.mget([
        K.meta(id),
        K.taken(id),
        K.live(id),
        K.req(id),
      ])
      const meta = parse<Meta>(metaRaw)
      const stored = parse<Stored>(reqRaw)
      // An agent has it, or it is gone: nothing left to offer.
      if (!meta || !stored || !reqRaw || liveRaw) continue
      if (now() - meta.at > HANDOUT_MS) {
        await kv.del([K.req(id)])
        continue
      }
      const due = !takenRaw || now() - Number(takenRaw) >= REOFFER_MS
      const { request, bytes } = forAgent(stored, reqRaw)
      if (!due || !fits(bytes)) {
        await kv.rpush(K.offered, id, REQUEST_TTL_S)
        continue
      }
      await hand(id, request, bytes)
    }

    for (let i = 0; i < 50; i++) {
      const id = await kv.lpop(K.pending)
      if (!id) break
      const [metaRaw, reqRaw] = await kv.mget([K.meta(id), K.req(id)])
      const meta = parse<Meta>(metaRaw)
      const stored = parse<Stored>(reqRaw)
      if (!meta || !stored || !reqRaw) continue
      // So old the page has given up on it, or is about to: never handed
      // out, and its body goes now.
      if (now() - meta.at > HANDOUT_MS) {
        await kv.del([K.req(id)])
        continue
      }
      const { request, bytes } = forAgent(stored, reqRaw)
      if (!fits(bytes)) {
        await kv.lpush(K.pending, id, REQUEST_TTL_S)
        break
      }
      await hand(id, request, bytes)
    }
    if (out.length) handedAt = now()
    return out
  }

  /** One of the places a read of `id` may wait in, or null when all are
   *  taken. A place frees itself if its read never ends. */
  const readerSlot = async (id: string): Promise<string | null> => {
    for (let slot = 0; slot < READERS_PER_ID; slot++) {
      const key = K.reader(id, slot)
      if (await kv.claim(key, '1', READER_TTL_S)) return key
    }
    return null
  }

  return {
    async create(path, bodyText, who) {
      const key = secret()
      if (!key) throw new RelayError(503, 'The team chat is not set up.')
      const id = newId()
      const at = now()
      const iso = new Date(at).toISOString()
      const stored: Stored = {
        id,
        path,
        who,
        at: iso,
        bodyText,
        sig: signRequest(key, { id, path, who, at: iso, bodyText }),
      }
      const raw = JSON.stringify(stored)
      // As kept, the body's text is quoted once more: one that is mostly
      // quote marks could double. It has to fit in one answer to the agent.
      if (byteLength(raw) > REQUEST_MAX_BYTES) {
        throw new RelayError(413, TEAM_TOO_BIG)
      }
      const meta: Meta = { by: who.email, at }
      await kv.set(K.req(id), raw, BODY_TTL_S)
      await kv.set(K.meta(id), JSON.stringify(meta), REQUEST_TTL_S)
      await kv.rpush(K.pending, id, REQUEST_TTL_S)
      return { id }
    },

    async poll(id, email, o = {}) {
      if (!ID_RE.test(id)) throw new RelayError(400, 'Which request?')
      const after = o.after ?? -1
      const meta = parse<Meta>(await kv.get(K.meta(id)))
      if (!meta) {
        throw new RelayError(404, 'That chat request is no longer kept.')
      }
      if (meta.by !== email) {
        throw new RelayError(403, 'That chat request is someone else’s.')
      }
      const slot = await readerSlot(id)
      if (!slot) throw new RelayError(429, TEAM_BUSY, { code: 'readers' })
      try {
        const started = now()
        const deadline = started + (o.waitMs ?? POLL_MS)
        for (;;) {
          const [liveRaw, statusRaw, doneRaw] = await kv.mget([
            K.live(id),
            K.status(id),
            K.done(id),
          ])
          const code = Number(statusRaw)
          const status =
            statusRaw && Number.isFinite(code) ? { status: code } : {}
          const done = Boolean(doneRaw)
          if (liveRaw) {
            // The flags were read first: if they say done, every piece was
            // already there to be read.
            const raws = await kv.zafter(K.chunks(id), after, POLL_MAX_CHUNKS)
            const chunks: TeamChunk[] = []
            let bytes = 0
            for (const raw of raws) {
              const c = parse<TeamChunk>(raw)
              if (!c) continue
              const size = byteLength(c.text)
              if (chunks.length && bytes + size > POLL_MAX_BYTES) break
              chunks.push(c)
              bytes += size
            }
            // Some were left for the next read.
            const more =
              chunks.length < raws.length || raws.length >= POLL_MAX_CHUNKS
            const news = 'status' in status && !o.started
            if (chunks.length || done || news) {
              return { ...status, chunks, done: done && !more }
            }
            if (now() - Number(liveRaw) > STALL_MS) {
              await kv.expire(
                [
                  K.meta(id),
                  K.taken(id),
                  K.live(id),
                  K.status(id),
                  K.chunks(id),
                ],
                DONE_TTL_S
              )
              return { ...status, chunks: [], done: true, error: TEAM_STOPPED }
            }
          } else if (now() - meta.at > PICKUP_MS) {
            // Nobody has it and nobody will: the body goes now.
            await kv.del([K.req(id)])
            return { chunks: [], done: true, error: TEAM_NOT_ANSWERING }
          }
          const left = deadline - now()
          if (left <= 0 || o.aborted?.()) {
            return { ...status, chunks: [], done: false }
          }
          await sleep(Math.min(left, now() - started < 3000 ? 250 : 500))
        }
      } finally {
        await kv.del([slot])
      }
    },

    async next(waitSeconds, aborted) {
      const wait = Math.min(Math.max(0, waitSeconds), NEXT_MAX_WAIT_S) * 1000
      const deadline = now() + wait
      await seen()
      let lookedAt = -Infinity
      for (;;) {
        // Before anything is taken: a call whose agent has gone must not
        // take a request with it.
        if (aborted?.()) return []
        // The ones to offer again are looked for every few seconds, not on
        // every round: a wait of ten seconds needs no finer clock, and an
        // idle agent asks all day.
        const again = now() - lookedAt >= OFFERED_LOOK_MS
        if (again) lookedAt = now()
        const got = await take(again)
        const left = deadline - now()
        if (got.length || left <= 0) {
          // Seen again as a long wait ends, so "online" never lapses
          // between two back-to-back calls.
          if (wait > 0) await seen()
          return got
        }
        await sleep(Math.min(left, now() - handedAt < 120_000 ? 250 : 1000))
      }
    },

    async chunks(id, input) {
      if (!ID_RE.test(id)) throw new RelayError(400, 'Which request?')
      const list = input.chunks === undefined ? [] : input.chunks
      if (!Array.isArray(list) || list.length > 2000) {
        throw new RelayError(400, 'chunks must be a list.')
      }
      const pieces: TeamChunk[] = []
      for (const c of list as unknown[]) {
        const seq = (c as { seq?: unknown } | null)?.seq
        const text = (c as { text?: unknown } | null)?.text
        if (
          typeof seq !== 'number' ||
          !Number.isSafeInteger(seq) ||
          seq < 0 ||
          typeof text !== 'string'
        ) {
          throw new RelayError(400, 'Each chunk is {seq, text}.')
        }
        pieces.push({ seq, text })
      }
      if (
        input.status !== undefined &&
        (typeof input.status !== 'number' ||
          !Number.isInteger(input.status) ||
          input.status < 100 ||
          input.status > 599)
      ) {
        throw new RelayError(400, 'status must be an HTTP status.')
      }
      if (input.done !== undefined && typeof input.done !== 'boolean') {
        throw new RelayError(400, 'done must be true or left out.')
      }
      const [metaRaw, takenRaw, liveRaw, doneRaw] = await kv.mget([
        K.meta(id),
        K.taken(id),
        K.live(id),
        K.done(id),
      ])
      const meta = parse<Meta>(metaRaw)
      // Unknown, expired, or never handed to an agent.
      if (!meta || !takenRaw) {
        throw new RelayError(404, 'No such request.', { code: 'unknown' })
      }
      if (doneRaw) {
        throw new RelayError(409, 'That request is finished.', {
          code: 'finished',
        })
      }
      if (!liveRaw) {
        // The agent's first word on it. Too late, and the page has been
        // told nobody answered: the agent must not start on it.
        if (now() - meta.at > ACK_MS) {
          throw new RelayError(
            409,
            'Too late: the page was told nobody answered. Do not run this request.',
            { code: 'expired' }
          )
        }
      } else if (now() - Number(liveRaw) > STALL_WRITE_MS) {
        throw new RelayError(
          409,
          'That request went quiet for too long and was ended.',
          { code: 'stalled' }
        )
      }
      // In seq order, and only what is new. A seq at or below the last one
      // kept is a call sent twice, so sending again is always safe; one
      // that skips ahead means a piece is missing, and is refused so the
      // agent sends from the gap.
      pieces.sort((a, b) => a.seq - b.seq)
      let last = pieces.length ? await kv.zlast(K.chunks(id)) : null
      const fresh: TeamChunk[] = []
      for (const p of pieces) {
        if (last !== null && p.seq <= last) continue
        if (last === null ? p.seq > 1 : p.seq > last + 1) {
          throw new RelayError(
            409,
            last === null
              ? 'A piece is missing: the first seq must be 0 or 1.'
              : `A piece is missing: send again from seq ${last + 1}.`,
            { code: 'seq_gap', last }
          )
        }
        fresh.push(p)
        last = p.seq
      }
      // An agent has it: the site keeps the body no longer.
      if (!liveRaw) await kv.del([K.req(id)])
      // The pieces first, then the flags that say they are there. Each
      // flag only ever goes one way (a status is set once, done is never
      // taken back, the pieces only grow), so two calls that overlap
      // cannot undo each other.
      await kv.zadd(
        K.chunks(id),
        fresh.map(p => ({ score: p.seq, value: JSON.stringify(p) })),
        REQUEST_TTL_S
      )
      if (typeof input.status === 'number') {
        await kv.claim(K.status(id), String(input.status), REQUEST_TTL_S)
      }
      await kv.set(K.live(id), String(now()), REQUEST_TTL_S)
      // The flag itself outlives the rest, so a request never looks
      // unfinished again while anything of it is left.
      if (input.done === true) await kv.set(K.done(id), '1', REQUEST_TTL_S)
      // Everything about the request lives on from this call (a reply may
      // take longer than any one life), or for two minutes once it is
      // done. Read again here: a call that overlapped the last one must
      // not give a finished request its long life back.
      const over = input.done === true || (await kv.get(K.done(id))) !== null
      await kv.expire(
        [K.meta(id), K.taken(id), K.live(id), K.status(id), K.chunks(id)],
        over ? DONE_TTL_S : REQUEST_TTL_S
      )
    },

    async online() {
      const at = Number(await kv.get(K.seen))
      return Number.isFinite(at) && at > 0 && now() - at < ONLINE_MS
    },

    async limit(email, kind, bytes = 0) {
      const minute = Math.floor(now() / 60_000)
      if ((await kv.incr(K.rate(kind, email, minute), 120)) > LIMITS[kind]) {
        return TEAM_BUSY
      }
      if (
        bytes > 0 &&
        (await kv.incr(K.rate('bytes', email, minute), 120, bytes)) >
          TEAM_BYTES_PER_MINUTE
      ) {
        return TEAM_TOO_MUCH
      }
      return null
    },
  }
}

// Same env fallback chain as the user list, the analytics store and the
// rate limiter, so this lands in the same database.
let shared: Relay | null = null

/** The site's relay: Redis when it is configured, files otherwise. */
export function teamRelay(): Relay {
  if (shared) return shared
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  shared = createRelay(
    url && token
      ? // Values are kept as the strings they are: no JSON guessing on read.
        redisKv(new Redis({ url, token, automaticDeserialization: false }))
      : fileKv(path.join(process.cwd(), '.admin-dev', 'queue-team-chat'))
  )
  return shared
}
