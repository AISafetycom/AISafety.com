// Which jobs were on /jobs, and on which days: what makes the job board
// page's "jobs listed" exact (jobs-source.ts). The site keeps no history of
// its own here, since the Jobs table is an Airtable sync of the 80,000 Hours
// board and a job leaves it when it leaves theirs. So an hourly cron
// (/api/admin/analytics/jobs-seen) notes every job listed at the time, with
// the first and last UTC day it was seen. The days before the cron began
// were filled in once from the job lists in the production deploys Vercel
// still kept, back to 24 September 2026; SINCE_KEY holds the first whole day
// covered.
//
// Production and preview keep it in the same Upstash database as the
// events; a laptop without those keys keeps it in .analytics-dev/ instead.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Redis } from '@upstash/redis'
import type { LiveJob } from './jobs-source'

export interface SeenJob {
  title: string
  employer: string
  url: string | null
  logo: string | null
  datePublished: string | null
  /** The first and last UTC days it was listed, 'YYYY-MM-DD'. */
  first: string
  last: string
}

export interface JobsSeen {
  /** The first whole UTC day the record covers, or null before it began. */
  since: string | null
  jobs: Map<string, SeenJob>
}

const SEEN_KEY = 'aisafety:analytics:jobs-seen'
const SINCE_KEY = 'aisafety:analytics:jobs-seen:since'

/** Pure: the entries that change when `live` is seen on `day`. A job keeps
 *  the first day it was seen, and takes its name and address as they are
 *  now. */
export function seenUpdates(
  existing: Map<string, SeenJob>,
  live: LiveJob[],
  day: string
): Record<string, SeenJob> {
  const out: Record<string, SeenJob> = {}
  for (const j of live) {
    const was = existing.get(j.id)
    const next: SeenJob = {
      title: j.name,
      employer: j.organization,
      url: j.url && j.url !== '#' ? j.url : null,
      logo: j.logo,
      datePublished: j.datePublished,
      first: was && was.first < day ? was.first : day,
      last: was && was.last > day ? was.last : day,
    }
    if (!was || JSON.stringify(was) !== JSON.stringify(next)) out[j.id] = next
  }
  return out
}

/** Pure: a stored entry, or null when it isn't one. */
function parseSeen(raw: unknown): SeenJob | null {
  const v = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const day = (x: unknown) =>
    typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null
  const first = day(o.first)
  const last = day(o.last)
  if (!first || !last || typeof o.title !== 'string') return null
  return {
    title: o.title,
    employer: typeof o.employer === 'string' ? o.employer : '',
    url: typeof o.url === 'string' ? o.url : null,
    logo: typeof o.logo === 'string' ? o.logo : null,
    datePublished: day(o.datePublished),
    first,
    last,
  }
}

// ─── Storage ────────────────────────────────────────────────────────────────

const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

const DEV_FILE = path.join(process.cwd(), '.analytics-dev', 'jobs-seen.json')

interface DevDoc {
  since: string | null
  jobs: Record<string, SeenJob>
}

async function readDev(): Promise<DevDoc> {
  try {
    const d = JSON.parse(await fs.readFile(DEV_FILE, 'utf8')) as DevDoc
    return { since: d.since ?? null, jobs: d.jobs ?? {} }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { since: null, jobs: {} }
    throw err
  }
}

/** The record. Throws when the store can't be read. */
export async function readJobsSeen(): Promise<JobsSeen> {
  let since: string | null
  let raw: Record<string, unknown>
  if (store) {
    const [s, all] = await Promise.all([
      store.get<string>(SINCE_KEY),
      store.hgetall<Record<string, unknown>>(SEEN_KEY),
    ])
    since = s ?? null
    raw = all ?? {}
  } else {
    const doc = await readDev()
    since = doc.since
    raw = doc.jobs
  }
  const jobs = new Map<string, SeenJob>()
  for (const [id, v] of Object.entries(raw)) {
    const job = parseSeen(v)
    if (job) jobs.set(id, job)
    else console.warn(`[analytics] jobs seen: skipped a malformed entry ${id}`)
  }
  return { since: since ? String(since) : null, jobs }
}

/** Notes the jobs listed at `now`. The record's first run also marks the
 *  day after as the first it covers whole. Returns how many entries
 *  changed. */
export async function recordJobsSeen(
  live: LiveJob[],
  now: number
): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10)
  const nextDay = new Date(now + 86_400_000).toISOString().slice(0, 10)
  const { since, jobs } = await readJobsSeen()
  const updates = seenUpdates(jobs, live, day)
  const n = Object.keys(updates).length
  if (store) {
    if (n)
      await store.hset(
        SEEN_KEY,
        Object.fromEntries(
          Object.entries(updates).map(([id, j]) => [id, JSON.stringify(j)])
        )
      )
    if (!since) await store.set(SINCE_KEY, nextDay, { nx: true })
  } else {
    const doc = await readDev()
    Object.assign(doc.jobs, updates)
    doc.since ??= nextDay
    await fs.mkdir(path.dirname(DEV_FILE), { recursive: true })
    await fs.writeFile(DEV_FILE, JSON.stringify(doc, null, 2))
  }
  return n
}
