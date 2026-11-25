// Where session recordings are kept (see shared.ts for the whole story).
//
// Each chunk's events go to Vercel Blob, gzipped, under recordings/<day>/<id>/
// with a random suffix on the file name: the store serves files publicly, so
// the unguessable address is the access control, as for the chatbot's full
// transcripts (src/lib/admin/transcript-blob.ts). Only the admin reads it,
// through /api/admin/recordings. The analytics database (Upstash) holds just
// an index: when each recording began, whose browser it was, and a few
// hundred bytes per chunk. Recordings never go in the database itself: a
// single request there is capped at 10 MB.
//
// On a laptop (next dev) everything goes to files under .analytics-dev/
// recordings instead, like the event store's own dev file. A preview
// deployment keeps nothing.
//
// Nothing deletes recordings automatically.

import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import { put } from '@vercel/blob'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { writesSharedStore } from '@/lib/analytics/events'
import { MAX_CHUNKS, summarizeChunk, type ChunkSummary } from './shared'

const gzipAsync = promisify(gzip)

const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

// Recording id → when it began (epoch ms, the server's clock).
const INDEX_KEY = 'aisafety:recordings:by-start'
// Recording id → JSON RecordingInfo.
const INFO_KEY = 'aisafety:recordings:info'
// + id: the recording's chunks, one JSON ChunkRecord each, in arrival order.
const CHUNKS_PREFIX = 'aisafety:recordings:chunks:'
// + 'YYYY-MM-DD': how many recordings began that day (UTC), for the cap.
const DAY_PREFIX = 'aisafety:recordings:day:'

/** New recordings accepted per day. About 250 a day are expected (a quarter
 *  of ~1,000 daily visitors to the start pages); this only stops a flood of
 *  made-up ones from filling the Blob store. */
const DAILY_CAP = 2_000

const chunkLimiter = store
  ? new Ratelimit({
      redis: store,
      // A real recording sends one chunk every ~15 seconds, a few more when
      // tabs are switched; a whole office on one address stays well under.
      limiter: Ratelimit.slidingWindow(30, '60 s'),
      analytics: false,
      prefix: 'aisafety:recordings:rl',
    })
  : null

export interface RecordingInfo {
  /** The browser's anonymous analytics id (aisafety_vid). */
  vid?: string
  /** The browser window's width at the start. */
  width?: number
}

export interface ChunkRecord extends ChunkSummary {
  seq: number
  /** Where the gzipped events are: a Blob address, or a dev file name. */
  url: string
  /** Gzipped size. */
  bytes: number
  /** Add to the visitor's clock to get the server's (0 unless their clock
   *  was more than two minutes out). */
  off: number
  /** When the server got it (epoch ms). */
  at: number
}

export interface RecordingSummary extends RecordingInfo {
  id: string
  /** Server-clock epoch ms. */
  start: number
  end: number
  /** Pages in the order they were seen, no repeats in a row. */
  pages: string[]
  clicks: number
  chunks: number
  bytes: number
  /** The visitor's clock offset (ChunkRecord.off) of the first chunk. */
  off: number
}

export type SaveResult = 'saved' | 'rate-limited' | 'full' | 'capped'

/** The visitor's clock is trusted unless it's more than this far out. */
const CLOCK_SLACK_MS = 2 * 60_000

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Keep one chunk. `events` must already have passed summarizeChunk. */
export async function saveChunk({
  id,
  seq,
  vid,
  events,
  ip,
}: {
  id: string
  seq: number
  vid?: string
  events: unknown[]
  ip: string
}): Promise<SaveResult> {
  const summary = summarizeChunk(events)
  if (!summary) throw new Error('saveChunk: not a list of recording events')
  const now = Date.now()
  const off = Math.abs(now - summary.t1) > CLOCK_SLACK_MS ? now - summary.t1 : 0
  const start = summary.t0 + off
  const body = await gzipAsync(JSON.stringify(events))
  const info: RecordingInfo = { vid, width: summary.width }

  // A preview deployment keeps nothing (its disk is read-only, too).
  if (process.env.VERCEL_ENV === 'preview') return 'saved'
  if (store && writesSharedStore()) {
    if (chunkLimiter && !(await chunkLimiter.limit(ip)).success)
      return 'rate-limited'
    const day = dayOf(now)
    const [known, held, today] = (await store
      .pipeline()
      .zscore(INDEX_KEY, id)
      .llen(CHUNKS_PREFIX + id)
      .get<number>(DAY_PREFIX + day)
      .exec()) as [number | null, number, number | null]
    if (held >= MAX_CHUNKS) return 'full'
    const isNew = known == null
    if (isNew && (today ?? 0) >= DAILY_CAP) return 'capped'
    const blob = await put(`recordings/${day}/${id}/${seq}.json.gz`, body, {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'application/gzip',
    })
    const record: ChunkRecord = {
      seq,
      ...summary,
      url: blob.url,
      bytes: body.length,
      off,
      at: now,
    }
    const p = store.pipeline()
    // lt: the earliest start wins, whichever chunk arrives first.
    p.zadd(INDEX_KEY, { lt: true }, { score: start, member: id })
    p.hsetnx(INFO_KEY, id, JSON.stringify(info))
    p.rpush(CHUNKS_PREFIX + id, JSON.stringify(record))
    if (isNew) {
      p.incr(DAY_PREFIX + day)
      p.expire(DAY_PREFIX + day, 3 * 86_400)
    }
    await p.exec()
    return 'saved'
  }

  // Local dev: files.
  const dir = path.join(DEV_DIR, id)
  await fs.mkdir(dir, { recursive: true })
  const file = `${seq}-${now}.json.gz`
  await fs.writeFile(path.join(dir, file), body)
  const record: ChunkRecord = {
    seq,
    ...summary,
    url: file,
    bytes: body.length,
    off,
    at: now,
  }
  const index = await readDevIndex()
  const had = index.get(id)
  if (!had || start < had.start) {
    await fs.appendFile(
      DEV_INDEX,
      JSON.stringify({ id, ...(had ?? info), start }) + '\n',
      'utf8'
    )
  }
  await fs.appendFile(
    path.join(dir, 'chunks.ndjson'),
    JSON.stringify(record) + '\n',
    'utf8'
  )
  return 'saved'
}

// ─── Local-file backend (dev only) ───────────────────────────────────────────

const DEV_DIR = path.join(process.cwd(), '.analytics-dev', 'recordings')
const DEV_INDEX = path.join(DEV_DIR, 'index.ndjson')

async function readLines<T>(file: string): Promise<T[]> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return [] // nothing recorded yet
  }
  const out: T[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line) as T)
    } catch {
      console.warn(`[recordings] skipping malformed line in ${file}`)
    }
  }
  return out
}

/** Dev index: id → its info and earliest start (later lines win). */
async function readDevIndex(): Promise<
  Map<string, RecordingInfo & { start: number }>
> {
  const rows = await readLines<RecordingInfo & { id: string; start: number }>(
    DEV_INDEX
  )
  return new Map(rows.map(({ id, ...rest }) => [id, rest]))
}

// ─── Reading (admin) ─────────────────────────────────────────────────────────

/** A recording's summary from its index entry and chunks. */
export function summarize(
  id: string,
  start: number,
  info: RecordingInfo,
  chunks: ChunkRecord[]
): RecordingSummary {
  const sorted = [...chunks].sort((a, b) => a.seq - b.seq)
  const pages: string[] = []
  let end = start
  let clicks = 0
  let bytes = 0
  for (const c of sorted) {
    for (const p of c.pages) if (pages[pages.length - 1] !== p) pages.push(p)
    end = Math.max(end, c.t1 + c.off)
    clicks += c.clicks
    bytes += c.bytes
  }
  return {
    id,
    start,
    end,
    pages,
    clicks,
    chunks: sorted.length,
    bytes,
    off: sorted[0]?.off ?? 0,
    vid: info.vid,
    width: info.width ?? sorted.find(c => c.width != null)?.width,
  }
}

function parseJson<T>(raw: unknown): T | null {
  if (raw == null) return null
  if (typeof raw !== 'string') return raw as T // the client parsed it
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Recordings read per database request. */
const READ_BATCH = 200

/** Recordings that began in the range, newest first, at most `limit`. */
export async function listRecordings(
  range: { startMs: number | null; endMs: number | null },
  limit = 1000
): Promise<RecordingSummary[]> {
  const lo = range.startMs ?? 0
  const hi = range.endMs ?? Number.MAX_SAFE_INTEGER
  if (store) {
    const flat = (await store.zrange(INDEX_KEY, hi, lo, {
      byScore: true,
      rev: true,
      withScores: true,
      offset: 0,
      count: limit,
    })) as (string | number)[]
    const entries: { id: string; start: number }[] = []
    for (let i = 0; i + 1 < flat.length; i += 2)
      entries.push({ id: String(flat[i]), start: Number(flat[i + 1]) })
    const out: RecordingSummary[] = []
    for (let i = 0; i < entries.length; i += READ_BATCH) {
      const batch = entries.slice(i, i + READ_BATCH)
      const p = store.pipeline()
      p.hmget(INFO_KEY, ...batch.map(e => e.id))
      for (const e of batch) p.lrange(CHUNKS_PREFIX + e.id, 0, -1)
      const [infos, ...lists] = (await p.exec()) as [
        Record<string, unknown> | null,
        ...unknown[][],
      ]
      batch.forEach((e, j) => {
        const info = parseJson<RecordingInfo>(infos?.[e.id]) ?? {}
        const chunks = (lists[j] ?? [])
          .map(c => parseJson<ChunkRecord>(c))
          .filter((c): c is ChunkRecord => c != null)
        out.push(summarize(e.id, e.start, info, chunks))
      })
    }
    return out
  }
  const index = await readDevIndex()
  const picked = [...index.entries()]
    .filter(([, v]) => v.start >= lo && v.start <= hi)
    .sort((a, b) => b[1].start - a[1].start)
    .slice(0, limit)
  return Promise.all(
    picked.map(async ([id, v]) =>
      summarize(id, v.start, v, await readDevChunks(id))
    )
  )
}

async function readDevChunks(id: string): Promise<ChunkRecord[]> {
  return readLines<ChunkRecord>(path.join(DEV_DIR, id, 'chunks.ndjson'))
}

/** One recording's summary and its chunks in order, or null. */
export async function readRecording(
  id: string
): Promise<{ summary: RecordingSummary; chunks: ChunkRecord[] } | null> {
  let start: number | null
  let info: RecordingInfo
  let chunks: ChunkRecord[]
  if (store) {
    const [score, rawInfo, list] = (await store
      .pipeline()
      .zscore(INDEX_KEY, id)
      .hget(INFO_KEY, id)
      .lrange(CHUNKS_PREFIX + id, 0, -1)
      .exec()) as [number | null, unknown, unknown[]]
    start = score == null ? null : Number(score)
    info = parseJson<RecordingInfo>(rawInfo) ?? {}
    chunks = list
      .map(c => parseJson<ChunkRecord>(c))
      .filter((c): c is ChunkRecord => c != null)
  } else {
    const entry = (await readDevIndex()).get(id)
    start = entry?.start ?? null
    info = entry ?? {}
    chunks = await readDevChunks(id)
  }
  if (start == null) return null
  chunks.sort((a, b) => a.seq - b.seq || a.at - b.at)
  return { summary: summarize(id, start, info, chunks), chunks }
}

/** A chunk's gzipped events. Throws when it can't be read. */
export async function readChunkBytes(chunk: ChunkRecord, id: string) {
  if (/^https:\/\//.test(chunk.url)) {
    const res = await fetch(chunk.url, { cache: 'no-store' })
    if (!res.ok)
      throw new Error(`recording chunk fetch failed: HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  if (!/^[\w.-]+$/.test(chunk.url))
    throw new Error(`bad dev chunk file name: ${chunk.url}`)
  return new Uint8Array(await fs.readFile(path.join(DEV_DIR, id, chunk.url)))
}
