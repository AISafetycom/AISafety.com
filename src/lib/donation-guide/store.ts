// Where the donation guide lives once it has been published from the admin:
// the same Upstash Redis as the admin user list (users-store.ts). A laptop
// without the Redis env vars gets a JSON file under .admin-dev/, and tests
// use an in-memory backend. Nothing here touches any other key.
//
//   donation-guide:live         { version, guide, publishedAt, publishedBy }
//   donation-guide:draft        { guide, savedAt, savedBy, basedOn } or absent
//   donation-guide:versions     [ { version, publishedAt, publishedBy, note } ]
//                               newest first, the last 100 publishes
//   donation-guide:version:<n>  the full snapshot of one publish
//   donation-guide:digest       { lastSentAt, pending: [...] }
//
// Every write is read-modify-write on small documents; the routes send the
// version or timestamp the editor last saw so a stale write is refused
// rather than silently winning. Two people saving in the same second is the
// same accepted simplification as the user list.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Redis } from '@upstash/redis'
import type { Actor, DraftDoc, Guide, LiveDoc, VersionMeta } from './types'

export const MAX_VERSIONS = 100
/** At most one digest email a day. */
export const DIGEST_GAP_MS = 24 * 60 * 60 * 1000
const MAX_PENDING = 50

export interface DigestEntry {
  version: number
  by: Actor
  at: string
  /** "Changed: $1–1,000 › 1–50 hours" lines. */
  changes: string[]
}

interface DigestDoc {
  lastSentAt: string | null
  pending: DigestEntry[]
}

export type SaveDraftResult =
  | { ok: true; draft: DraftDoc }
  | { ok: false; conflict: DraftDoc }

export type PublishResult =
  | { ok: true; live: LiveDoc }
  | { ok: false; current: LiveDoc | null }

export interface GuideStore {
  getLive(): Promise<LiveDoc | null>
  getDraft(): Promise<DraftDoc | null>
  /** Refused (with the newer draft) when the stored draft was saved at a
   *  time the caller hasn't seen: someone else saved since they loaded. */
  saveDraft(
    guide: Guide,
    by: Actor,
    seenSavedAt: string | null,
    basedOn: number,
    now?: string
  ): Promise<SaveDraftResult>
  discardDraft(): Promise<void>
  /** Make `guide` the live version and clear the draft. Refused when the
   *  live version is not `expectedVersion` (someone published since). */
  publish(
    guide: Guide,
    by: Actor,
    expectedVersion: number,
    opts?: { note?: string; now?: string }
  ): Promise<PublishResult>
  listVersions(): Promise<VersionMeta[]>
  getVersion(n: number): Promise<LiveDoc | null>
  queueDigest(entry: DigestEntry): Promise<void>
  /** The pending entries if an email is due now (none sent yet, or the
   *  last one more than a day ago), marking them sent; else empty. */
  takeDigestIfDue(now?: string): Promise<DigestEntry[]>
}

interface Backend {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}

const LIVE = 'donation-guide:live'
const DRAFT = 'donation-guide:draft'
const VERSIONS = 'donation-guide:versions'
const DIGEST = 'donation-guide:digest'
const versionKey = (n: number) => `donation-guide:version:${n}`

function isoNow(): string {
  return new Date().toISOString()
}

function makeStore(b: Backend): GuideStore {
  return {
    async getLive() {
      return b.get<LiveDoc>(LIVE)
    },
    async getDraft() {
      return b.get<DraftDoc>(DRAFT)
    },
    async saveDraft(guide, by, seenSavedAt, basedOn, now = isoNow()) {
      const current = await b.get<DraftDoc>(DRAFT)
      if (current && current.savedAt !== seenSavedAt) {
        return { ok: false, conflict: current }
      }
      const draft: DraftDoc = { guide, savedAt: now, savedBy: by, basedOn }
      await b.set(DRAFT, draft)
      return { ok: true, draft }
    },
    async discardDraft() {
      await b.del(DRAFT)
    },
    async publish(guide, by, expectedVersion, opts = {}) {
      const current = await b.get<LiveDoc>(LIVE)
      if ((current?.version ?? 0) !== expectedVersion) {
        return { ok: false, current }
      }
      const live: LiveDoc = {
        version: expectedVersion + 1,
        guide,
        publishedAt: opts.now ?? isoNow(),
        publishedBy: by,
      }
      if (opts.note) live.note = opts.note
      // Snapshot first, then the pointer, so a crash in between leaves the
      // old version live and nothing dangling.
      await b.set(versionKey(live.version), live)
      await b.set(LIVE, live)
      const metas = (await b.get<VersionMeta[]>(VERSIONS)) ?? []
      const meta: VersionMeta = {
        version: live.version,
        publishedAt: live.publishedAt,
        publishedBy: live.publishedBy,
      }
      if (live.note) meta.note = live.note
      const kept = [meta, ...metas.filter(m => m.version !== meta.version)]
      const evicted = kept.splice(MAX_VERSIONS)
      await b.set(VERSIONS, kept)
      for (const m of evicted) await b.del(versionKey(m.version))
      await b.del(DRAFT)
      return { ok: true, live }
    },
    async listVersions() {
      return (await b.get<VersionMeta[]>(VERSIONS)) ?? []
    },
    async getVersion(n) {
      if (!Number.isInteger(n) || n < 1) return null
      return b.get<LiveDoc>(versionKey(n))
    },
    async queueDigest(entry) {
      const doc = (await b.get<DigestDoc>(DIGEST)) ?? {
        lastSentAt: null,
        pending: [],
      }
      doc.pending = [...doc.pending, entry].slice(-MAX_PENDING)
      await b.set(DIGEST, doc)
    },
    async takeDigestIfDue(now = isoNow()) {
      const doc = (await b.get<DigestDoc>(DIGEST)) ?? {
        lastSentAt: null,
        pending: [],
      }
      if (doc.pending.length === 0) return []
      if (
        doc.lastSentAt &&
        Date.parse(now) - Date.parse(doc.lastSentAt) < DIGEST_GAP_MS
      ) {
        return []
      }
      const due = doc.pending
      await b.set(DIGEST, { lastSentAt: now, pending: [] })
      return due
    },
  }
}

function redisBackend(db: Redis): Backend {
  return {
    async get<T>(key: string) {
      return (await db.get<T>(key)) ?? null
    },
    async set(key, value) {
      await db.set(key, value)
    },
    async del(key) {
      await db.del(key)
    },
  }
}

function memoryBackend(): Backend {
  const m = new Map<string, string>()
  return {
    async get<T>(key: string) {
      const v = m.get(key)
      return v === undefined ? null : (JSON.parse(v) as T)
    },
    async set(key, value) {
      m.set(key, JSON.stringify(value))
    },
    async del(key) {
      m.delete(key)
    },
  }
}

function fileBackend(file: string): Backend {
  const read = async (): Promise<Record<string, unknown>> => {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  const write = async (doc: Record<string, unknown>) => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(doc, null, 2), 'utf8')
  }
  return {
    async get<T>(key: string) {
      const doc = await read()
      return key in doc ? (doc[key] as T) : null
    },
    async set(key, value) {
      const doc = await read()
      doc[key] = value
      await write(doc)
    },
    async del(key) {
      const doc = await read()
      delete doc[key]
      await write(doc)
    },
  }
}

/** Build a store explicitly: tests use `memory`, a laptop gets a file. */
export function createGuideStore(opts: {
  redis?: Redis | null
  memory?: boolean
  file?: string
}): GuideStore {
  if (opts.redis) return makeStore(redisBackend(opts.redis))
  if (opts.memory) return makeStore(memoryBackend())
  return makeStore(
    fileBackend(
      opts.file ?? path.join(process.cwd(), '.admin-dev', 'donation-guide.json')
    )
  )
}

// Same env fallback chain as users-store.ts, so this lands in the same
// database as the admin user list.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

export const guideStoreIsShared = Boolean(restUrl && restToken)

export const guideStore: GuideStore = createGuideStore({
  redis: guideStoreIsShared
    ? new Redis({ url: restUrl!, token: restToken! })
    : null,
})
