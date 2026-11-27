// The relay behind the team's Fable chat (queue-team-chat.ts has the
// picture). The site holds a request from the page until the server's agent
// asks for it, then holds the pieces of the agent's answer until the page
// has read them. Nothing here runs the chat or keeps its history: that
// lives on the server's agent. Everything kept here is short-lived (15
// minutes at most, about 2 minutes once a request is done), and nothing
// here logs a body or a piece of a reply.
//
// Storage is Upstash Redis in production, the same database the admin's
// user list uses (users-store.ts), and files under .admin-dev/ on a laptop
// without it (dev and the Queue demo).
import { randomBytes } from 'node:crypto'
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
  TEAM_NOT_ANSWERING,
  TEAM_STOPPED,
  type TeamChatPath,
  type TeamChunk,
  type TeamPoll,
  type TeamWho,
} from './queue-team-chat'

// ─── The agent's token ──────────────────────────────────────────────────────

export const AGENT_TOKEN_KIND = 'queue-team-agent'
/** A token may live this long at most (exp - iat). */
export const AGENT_TOKEN_MAX_LIFE_S = 120
/** How far ahead of the site's clock a token's iat may be. */
export const AGENT_TOKEN_MAX_AHEAD_S = 60

/** The secret both the site and the server's agent hold. Empty: the team
 *  chat is off. */
export function teamAgentSecret(): string {
  return (process.env.QUEUE_TEAM_AGENT_SECRET ?? '').trim()
}

/** Check the server agent's `Authorization: Bearer <token>`. The token is
 *  sealed the way the site seals its own (session.ts sealToken): base64url
 *  JSON {v: 1, kind: 'queue-team-agent', iat, exp}, a dot, and the
 *  HMAC-SHA256 of that first part under the shared secret. It is short-lived
 *  on purpose: the agent mints a fresh one for every call, so a captured
 *  one is useless two minutes later. */
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
  return { ok: true }
}

// ─── The store underneath ───────────────────────────────────────────────────

/** The few Redis commands the relay needs. Every write names how long the
 *  key lives, so nothing is ever kept for good. */
export interface RelayKv {
  get(key: string): Promise<string | null>
  mget(keys: string[]): Promise<(string | null)[]>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
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
  /** The values scored above `score`, lowest first. */
  zafter(key: string, score: number): Promise<string[]>
  /** Count one more under `key`; answers the count. */
  incr(key: string, ttlSeconds: number): Promise<number>
}

export function redisKv(db: Redis): RelayKv {
  return {
    async get(key) {
      const v = await db.get<string>(key)
      return v === null || v === undefined ? null : String(v)
    },
    async mget(keys) {
      const got = await db.mget<(string | null)[]>(...keys)
      return got.map(v => (v === null || v === undefined ? null : String(v)))
    },
    async set(key, value, ttlSeconds) {
      await db.set(key, value, { ex: ttlSeconds })
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
      const v = await db.lpop<string>(key)
      return v === null || v === undefined ? null : String(v)
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
    async zafter(key, score) {
      const got = await db.zrange<string[]>(key, `(${score}`, '+inf', {
        byScore: true,
      })
      return got.map(v => String(v))
    },
    async incr(key, ttlSeconds) {
      const p = db.pipeline()
      p.incr(key)
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
    async zafter(key, score) {
      if (!alive(key)) return []
      const folder = at(key, '.zset')
      const out: string[] = []
      for (const name of names(folder)) {
        if (!(Number(name) > score)) continue
        const value = read(path.join(folder, name))
        if (value !== null) out.push(value)
      }
      return out
    },
    async incr(key, ttlSeconds) {
      const next = (alive(key) ? Number(read(at(key, '.val'))) || 0 : 0) + 1
      write(at(key, '.val'), String(next))
      live(key, ttlSeconds)
      return next
    },
  }
}

// ─── The relay ──────────────────────────────────────────────────────────────

/** A request and its answer are kept this long at most. */
export const REQUEST_TTL_S = 15 * 60
/** Once the agent says a request is done, what is left of it goes. */
export const DONE_TTL_S = 2 * 60
/** The page is told nobody is answering after this long with no agent. */
export const PICKUP_MS = 30_000
/** A request this old is no longer handed to an agent: the page is about
 *  to be told (or has been) that nobody answered, and would send it again. */
export const HANDOUT_MS = 25_000
/** An agent that took a request and then sent nothing for this long is
 *  refused when it finally does (it was cut off), */
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
/** One `next` answer stays under this (Vercel sends 4.5 MB at most). */
const NEXT_MAX_BYTES = 4 * 1024 * 1024
/** How many requests one person may start in a minute. */
export const RATE_PER_MINUTE = 60

const KEY = 'queue:team-chat:'
const K = {
  pending: `${KEY}pending`,
  seen: `${KEY}agent-seen`,
  req: (id: string) => `${KEY}req:${id}`,
  meta: (id: string) => `${KEY}meta:${id}`,
  taken: (id: string) => `${KEY}taken:${id}`,
  state: (id: string) => `${KEY}state:${id}`,
  chunks: (id: string) => `${KEY}chunks:${id}`,
  rate: (email: string, minute: number) => `${KEY}rate:${email}:${minute}`,
}

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/

/** What the server's agent is handed for one request. `who` and `at` sit
 *  beside the body, never in it. */
export interface TeamRequest {
  id: string
  path: TeamChatPath
  body: Record<string, unknown>
  who: TeamWho
  /** When the site took the request (ISO). */
  at: string
}

/** Who asked and when: small, so a read by the page never loads the body. */
interface Meta {
  by: string
  at: number
}

/** How far the agent's answer has come. Only the agent's calls write it. */
interface State {
  status?: number
  /** The highest seq kept; null before any piece. */
  last: number | null
  done: boolean
  /** When the agent last sent anything (ms). */
  at: number
}

/** A refusal with the status the route answers. */
export class RelayError extends Error {
  constructor(
    public status: number,
    message: string
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
}

export interface Relay {
  /** The page's request, kept for the agent. */
  create(
    path: TeamChatPath,
    body: Record<string, unknown>,
    who: TeamWho
  ): Promise<{ id: string }>
  /** What has come for a request since piece `after`; waits up to `waitMs`
   *  for something new. Only the person who made the request may ask.
   *  `started`: the page already has the status, so a status by itself is
   *  nothing new. */
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
  /** The requests waiting for an agent, each handed out once; waits up to
   *  `waitSeconds` when there are none. Marks the agent as seen. */
  next(waitSeconds: number, aborted?: () => boolean): Promise<TeamRequest[]>
  /** Pieces of the agent's answer to a request, in order. */
  chunks(
    id: string,
    input: { status?: unknown; chunks?: unknown; done?: unknown }
  ): Promise<void>
  /** An agent asked for work within the last minute. */
  online(): Promise<boolean>
  /** Count one request for this person; false once over the limit. */
  allow(email: string): Promise<boolean>
}

export function createRelay(kv: RelayKv, opts: RelayOptions = {}): Relay {
  const now = opts.now ?? Date.now
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const newId = opts.newId ?? (() => randomBytes(18).toString('base64url'))
  // This server handed a request out lately: a chat is under way, so the
  // next ones are looked for more often. Only a hint (another server may
  // answer the next call); the slower pace is the fallback.
  let handedAt = 0

  const seen = () => kv.set(K.seen, String(now()), 24 * 3600)

  /** The waiting requests an agent can still answer, oldest first. */
  const take = async (): Promise<TeamRequest[]> => {
    const out: TeamRequest[] = []
    let size = 0
    for (let i = 0; i < 50; i++) {
      const id = await kv.lpop(K.pending)
      if (!id) break
      const [metaRaw, reqRaw] = await kv.mget([K.meta(id), K.req(id)])
      const meta = parse<Meta>(metaRaw)
      const req = parse<TeamRequest>(reqRaw)
      // Expired, or so old the page has given up on it: never handed out.
      if (!meta || !req || !reqRaw || now() - meta.at > HANDOUT_MS) continue
      if (out.length && size + reqRaw.length > NEXT_MAX_BYTES) {
        await kv.lpush(K.pending, id, REQUEST_TTL_S)
        break
      }
      await kv.set(K.taken(id), String(now()), REQUEST_TTL_S)
      // The body has gone to the agent; the site keeps it no longer.
      await kv.del([K.req(id)])
      out.push(req)
      size += reqRaw.length
    }
    if (out.length) handedAt = now()
    return out
  }

  return {
    async create(path, body, who) {
      const id = newId()
      const at = now()
      const req: TeamRequest = {
        id,
        path,
        body,
        who,
        at: new Date(at).toISOString(),
      }
      const meta: Meta = { by: who.email, at }
      await kv.set(K.req(id), JSON.stringify(req), REQUEST_TTL_S)
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
      const started = now()
      const deadline = started + (o.waitMs ?? POLL_MS)
      for (;;) {
        const [takenRaw, stateRaw] = await kv.mget([K.taken(id), K.state(id)])
        const state = parse<State>(stateRaw)
        const status =
          state?.status === undefined ? {} : { status: state.status }
        if (state) {
          const more = state.last !== null && state.last > after
          const newStatus = state.status !== undefined && !o.started
          if (more || state.done || newStatus) {
            const chunks = more
              ? (await kv.zafter(K.chunks(id), after))
                  .map(raw => parse<TeamChunk>(raw))
                  .filter((c): c is TeamChunk => c !== null)
              : []
            return { ...status, chunks, done: state.done }
          }
        }
        const taken = Number(takenRaw)
        if (!takenRaw) {
          if (now() - meta.at > PICKUP_MS) {
            return { chunks: [], done: true, error: TEAM_NOT_ANSWERING }
          }
        } else if (now() - Math.max(taken, state?.at ?? 0) > STALL_MS) {
          await kv.expire(
            [K.meta(id), K.taken(id), K.state(id), K.chunks(id)],
            DONE_TTL_S
          )
          return { ...status, chunks: [], done: true, error: TEAM_STOPPED }
        }
        const left = deadline - now()
        if (left <= 0 || o.aborted?.()) {
          return { ...status, chunks: [], done: false }
        }
        await sleep(Math.min(left, now() - started < 3000 ? 250 : 500))
      }
    },

    async next(waitSeconds, aborted) {
      const wait = Math.min(Math.max(0, waitSeconds), NEXT_MAX_WAIT_S) * 1000
      const deadline = now() + wait
      await seen()
      for (;;) {
        const got = await take()
        const left = deadline - now()
        if (got.length || left <= 0 || aborted?.()) {
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
      const [metaRaw, takenRaw, stateRaw] = await kv.mget([
        K.meta(id),
        K.taken(id),
        K.state(id),
      ])
      // Unknown, expired, or never handed to an agent.
      if (!parse<Meta>(metaRaw) || !takenRaw) {
        throw new RelayError(404, 'No such request.')
      }
      const state: State = parse<State>(stateRaw) ?? {
        last: null,
        done: false,
        at: Number(takenRaw),
      }
      if (state.done) throw new RelayError(409, 'That request is finished.')
      if (now() - state.at > STALL_WRITE_MS) {
        throw new RelayError(
          409,
          'That request went quiet for too long and was ended.'
        )
      }
      // In seq order, and only what is new: a seq at or below the last one
      // kept is a call sent twice, so sending again is always safe.
      pieces.sort((a, b) => a.seq - b.seq)
      let last = state.last
      const fresh: TeamChunk[] = []
      for (const p of pieces) {
        if (last !== null && p.seq <= last) continue
        fresh.push(p)
        last = p.seq
      }
      const done = input.done === true
      const ttl = done ? DONE_TTL_S : REQUEST_TTL_S
      // The pieces first, then the state that says they are there.
      await kv.zadd(
        K.chunks(id),
        fresh.map(p => ({ score: p.seq, value: JSON.stringify(p) })),
        ttl
      )
      const next: State = {
        ...(state.status !== undefined
          ? { status: state.status }
          : typeof input.status === 'number'
            ? { status: input.status }
            : {}),
        last,
        done,
        at: now(),
      }
      await kv.set(K.state(id), JSON.stringify(next), ttl)
      if (done) {
        await kv.expire([K.meta(id), K.taken(id), K.chunks(id)], DONE_TTL_S)
      }
    },

    async online() {
      const at = Number(await kv.get(K.seen))
      return Number.isFinite(at) && at > 0 && now() - at < ONLINE_MS
    },

    async allow(email) {
      const minute = Math.floor(now() / 60_000)
      return (await kv.incr(K.rate(email, minute), 120)) <= RATE_PER_MINUTE
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
