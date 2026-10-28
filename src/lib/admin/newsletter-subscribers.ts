// Newsletter subscribers over time, for the Newsletters tab's tiles: each
// moved newsletter's ActiveCampaign list at the end of every day since the
// move, worked out from every list membership (contactLists: who joined
// when, who left when), plus today's live count and the Substack histories
// added on the tab. Only ever reads ActiveCampaign.
//
// Reading every membership takes about 70 requests (over a minute: 73
// seconds for 6,340 memberships on 28 October 2026), so it isn't done while
// the page waits: the figures are kept in Upstash (in memory on a laptop)
// and worked out again every three hours by a cron
// (/api/admin/analytics/subscriber-history), and after a page load that
// finds them older than that. Page loads alone once left no figure for 23
// to 27 October 2026, since the load that starts the work still shows the
// old copy and nobody opened the tab for days. The live counts are one
// request per list.

import { Redis } from '@upstash/redis'
import {
  NEWSLETTERS,
  listDays,
  type ListDay,
  type ListRecord,
} from '@/lib/analytics/subscribers'
import {
  readSubstackHistories,
  type SavedSubstackHistory,
} from '@/lib/analytics/substack-history'

export interface ListHistory {
  v: 1
  /** When it was worked out, epoch ms. */
  builtAt: number
  /** By list id: the list's size at the end of each day since the move. */
  days: Record<string, ListDay[]>
  /** Memberships that had ended without a date for it, so couldn't be
   *  placed (none so far). */
  unplaced: number
}

export interface NewsletterSubscribers {
  history: ListHistory | null
  /** By list id: active subscribers right now. Null when ActiveCampaign
   *  couldn't be read. */
  live: Record<string, number> | null
  /** When `live` was read, epoch ms. */
  liveAt: number
  /** By Substack publication. */
  substack: Map<string, SavedSubstackHistory>
}

/** Worked out again after a page load once it's this old (the cron runs
 *  as often). */
const REFRESH_AFTER_MS = 3 * 3_600_000
/** One copy per environment, so a preview's code never replaces
 *  production's figures (they can share the database). */
const CACHE_KEY = `aisafety:analytics:subscriber-history:${process.env.VERCEL_ENV ?? 'local'}`
/** Held while one server works the figures out, so two don't do it at once:
 *  as long as a server may take (the routes allow 300 seconds), since the
 *  read already takes over a minute and grows with the lists. */
const LOCK_KEY = `${CACHE_KEY}:lock`
const LOCK_SECONDS = 300
const PAGE = 100
/** Pages read at once: about three requests a second, within the five a
 *  second ActiveCampaign allows, with room for the send watcher's. */
const IN_FLIGHT = 2
const READ_TIMEOUT_MS = 20_000
const RETRY_DELAYS_MS = [1000, 3000]
const TRANSIENT = new Set([429, 502, 503, 504, 511])

const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

/** A laptop's copy (no Upstash), and this server's own between loads. */
let memory: ListHistory | null = null
let refreshing: Promise<RefreshOutcome> | null = null

/** How a refresh went: worked out and kept, left to another server that
 *  holds the lock, failed (logged), or not set up here (no ActiveCampaign
 *  or no moved list). */
export type RefreshOutcome = 'refreshed' | 'busy' | 'failed' | 'off'

/** The lists that have moved to ActiveCampaign, and since when. */
function movedLists(): { list: string; since: number }[] {
  return NEWSLETTERS.filter(n => n.movedOn).map(n => ({
    list: n.list,
    since: Date.parse(`${n.movedOn}T00:00:00Z`),
  }))
}

function acConfigured(): boolean {
  return Boolean(
    process.env.ACTIVECAMPAIGN_URL && process.env.ACTIVECAMPAIGN_KEY
  )
}

/** One read-only call to ActiveCampaign's v3 API, retried through its
 *  passing gateway errors and rate limit. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function acGet<T = any>(path: string): Promise<T> {
  const base = (process.env.ACTIVECAMPAIGN_URL ?? '').replace(/\/+$/, '')
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/api/3/${path}`, {
      headers: { 'Api-Token': process.env.ACTIVECAMPAIGN_KEY ?? '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (res.ok) return res.json() as Promise<T>
    const delay = RETRY_DELAYS_MS[attempt]
    if (TRANSIENT.has(res.status) && delay !== undefined) {
      await new Promise(r => setTimeout(r, delay))
      continue
    }
    throw new Error(
      `ActiveCampaign ${path.split('?')[0]}: ${res.status}${TRANSIENT.has(res.status) ? '' : ` ${(await res.text()).slice(0, 200)}`}`
    )
  }
}

interface RawContactList {
  list?: string
  status?: string
  sdate?: string | null
  udate?: string | null
}

/** Every membership of the given lists. contactLists has no filter that
 *  works, so it's read whole, a page at a time. */
async function readRecords(lists: Set<string>): Promise<ListRecord[]> {
  const first = await acGet<{
    contactLists?: RawContactList[]
    meta?: { total?: string | number }
  }>(`contactLists?limit=${PAGE}&offset=0`)
  const total = Number(first.meta?.total ?? 0)
  const offsets: number[] = []
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o)
  const pages: RawContactList[][] = [first.contactLists ?? []]
  let next = 0
  await Promise.all(
    Array.from({ length: IN_FLIGHT }, async () => {
      while (next < offsets.length) {
        const offset = offsets[next++]
        const page = await acGet<{ contactLists?: RawContactList[] }>(
          `contactLists?limit=${PAGE}&offset=${offset}`
        )
        pages.push(page.contactLists ?? [])
      }
    })
  )
  return pages
    .flat()
    .filter(r => r.list && lists.has(r.list))
    .map(r => ({
      list: r.list as string,
      status: String(r.status ?? ''),
      sdate: r.sdate ?? null,
      udate: r.udate ?? null,
    }))
}

function parseHistory(raw: unknown): ListHistory | null {
  let v: unknown = raw
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw)
    } catch {
      return null
    }
  }
  const h = v as Partial<ListHistory> | null
  return h &&
    h.v === 1 &&
    typeof h.builtAt === 'number' &&
    h.days &&
    typeof h.days === 'object' &&
    typeof h.unplaced === 'number'
    ? (h as ListHistory)
    : null
}

/** The kept figures, or null when there are none yet. */
async function readHistory(): Promise<ListHistory | null> {
  if (!store) return memory
  const kept = parseHistory(await store.get<unknown>(CACHE_KEY))
  if (kept && (!memory || kept.builtAt > memory.builtAt)) memory = kept
  return memory
}

/** Work the figures out again and keep them, unless another server is
 *  already doing it. Never throws: on failure the kept figures stay, and the
 *  next cron run or page load tries again. */
export async function refreshSubscriberHistory(): Promise<RefreshOutcome> {
  if (refreshing) return refreshing
  const moved = movedLists()
  if (!acConfigured() || moved.length === 0) return 'off'
  refreshing = (async (): Promise<RefreshOutcome> => {
    let locked = false
    try {
      if (store) {
        const got = await store.set(LOCK_KEY, Date.now(), {
          nx: true,
          ex: LOCK_SECONDS,
        })
        if (got !== 'OK') return 'busy'
        locked = true
      }
      const t0 = Date.now()
      const records = await readRecords(new Set(moved.map(m => m.list)))
      const since = Math.min(...moved.map(m => m.since))
      const { days, unplaced } = listDays(
        records,
        moved.map(m => m.list),
        since,
        Date.now()
      )
      // Each list from its own move day.
      for (const m of moved)
        days[m.list] = days[m.list].filter(d => d.t >= m.since)
      if (unplaced > 0)
        console.warn(
          `[analytics] ${unplaced} ActiveCampaign memberships ended without a date; left out of the subscriber history`
        )
      const history: ListHistory = { v: 1, builtAt: Date.now(), days, unplaced }
      memory = history
      if (store) await store.set(CACHE_KEY, JSON.stringify(history))
      console.info(
        `[analytics] subscriber history from ${records.length} memberships in ${Date.now() - t0} ms`
      )
      return 'refreshed'
    } catch (err) {
      console.warn(
        `[analytics] subscriber history refresh failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return 'failed'
    } finally {
      // Only our own hold on it; analytics, so a failed release just waits
      // out the lock.
      if (store && locked) await store.del(LOCK_KEY).catch(() => {})
      refreshing = null
    }
  })()
  return refreshing
}

/** Whether the kept figures are missing, old enough to work out again, or
 *  without a list that has moved since they were worked out. */
export function historyStale(h: ListHistory | null): boolean {
  const moved = movedLists()
  return (
    acConfigured() &&
    moved.length > 0 &&
    (!h ||
      Date.now() - h.builtAt > REFRESH_AFTER_MS ||
      moved.some(m => !h.days[m.list]))
  )
}

/** Today's active subscribers on each moved list, or null when
 *  ActiveCampaign couldn't be read. */
async function readLive(): Promise<Record<string, number> | null> {
  const moved = movedLists()
  if (!acConfigured() || moved.length === 0) return null
  try {
    const counts = await Promise.all(
      moved.map(async m => {
        const r = await acGet<{ meta?: { total?: string | number } }>(
          `contacts?listid=${m.list}&status=1&limit=1`
        )
        return [m.list, Number(r.meta?.total ?? NaN)] as const
      })
    )
    if (counts.some(([, n]) => Number.isNaN(n))) return null
    return Object.fromEntries(counts)
  } catch (err) {
    console.warn(
      `[analytics] live subscriber counts unavailable: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

/** Everything the subscriber tiles draw from. Never rejects: what couldn't
 *  be read comes back empty, and the tab says so. */
export async function readNewsletterSubscribers(): Promise<NewsletterSubscribers> {
  const liveAt = Date.now()
  const [history, live, substack] = await Promise.all([
    readHistory().catch(err => {
      console.warn(
        `[analytics] kept subscriber history unavailable: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }),
    readLive(),
    readSubstackHistories().catch(err => {
      console.warn(
        `[analytics] Substack histories unavailable: ${err instanceof Error ? err.message : String(err)}`
      )
      return new Map<string, SavedSubstackHistory>()
    }),
  ])
  return { history, live, liveAt, substack }
}
