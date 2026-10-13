/* The reads and writes behind each newsletter's past issues page and feed
   (src/lib/newsletter-archive.ts says what they are).

   Which issues have gone out comes from two places, merged:
   - ActiveCampaign, which only hands over its newest 100 campaigns. With
     two weekly newsletters, their warm-up waves and test sends, an issue
     drops out of those within months.
   - The site's own record: one Upstash hash per newsletter, issue address →
     when it first went out. Every issue seen in ActiveCampaign is added on
     the production site, written once and never changed; a daily cron
     (/api/admin/newsletter/archive) makes sure none is missed even when
     nobody opens the pages. Elsewhere (a laptop, a preview) the record is
     only read: every copy of the site shares the one Upstash database.

   Each feed fetch by a reader is also counted here, per newsletter per day
   (see feedReader()): a known feed service's own subscriber count, and the
   reader apps that fetch for one person, as an approximate distinct count
   of salted hashes that keeps no address. /admin/analytics' Newsletters
   tab shows them. */

import { createHmac, randomBytes } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { sentIssuesOn } from '@/lib/admin/newsletter'
import { WEB_NEWSLETTERS, type WebKey } from '@/lib/newsletter-web'
import {
  MIN_READERS,
  issueSlug,
  mergeIssues,
  type ArchiveIssue,
  type FeedReader,
} from '@/lib/newsletter-archive'

// The same Upstash database the newsletter's other records use.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

/** The record of sent issues: one hash per newsletter, field = the issue's
 *  address ("week-41-2026"), value = when it first went out (ISO, or "" if
 *  ActiveCampaign gave no date). No expiry. */
const ISSUES_PREFIX = 'aisafety:newsletter:archive:'

/** The feed's readers, per newsletter per UTC day: a hash of feed services
 *  (service name → subscriber count, the day's latest) and a HyperLogLog
 *  of reader apps. No expiry: they're tiny (the hash has a field per known
 *  service, the HyperLogLog at most 12 KB), and the history is the point.
 *  The day's salt (`salt:<day>`) expires after two days. */
const FEED_PREFIX = 'aisafety:newsletter:feed:'

/** Only the live site writes the record and the feed counts, the way only
 *  it keeps copies of sent emails: a dev server never counts, even with
 *  VERCEL_ENV pulled into its .env.local. */
function writesRecord(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' &&
    process.env.NODE_ENV !== 'development'
  )
}

async function recorded(key: WebKey): Promise<ArchiveIssue[]> {
  if (!store) return []
  const hash = await store.hgetall<Record<string, unknown>>(ISSUES_PREFIX + key)
  return Object.entries(hash ?? {}).map(([slug, sentAt]) => ({
    slug,
    sentAt: typeof sentAt === 'string' && sentAt !== '' ? sentAt : null,
  }))
}

/** The site's record of this newsletter's sent issues alone, with no
 *  ActiveCampaign read: what /admin/analytics' Org lookup reads to find the
 *  issues whose link clicks to count. Null when there's no store (a laptop
 *  without the Upstash keys); throws when the store can't be read. */
export async function recordedIssues(
  key: WebKey
): Promise<ArchiveIssue[] | null> {
  return store ? recorded(key) : null
}

/** ActiveCampaign's sent issues of this newsletter, as addresses: those
 *  that have gone to at least MIN_READERS people. */
async function live(key: WebKey): Promise<ArchiveIssue[]> {
  const sent = await sentIssuesOn(WEB_NEWSLETTERS[key].list)
  return sent.flatMap(s => {
    const slug = issueSlug(key, s.name)
    return slug && s.readers >= MIN_READERS ? [{ slug, sentAt: s.sentAt }] : []
  })
}

/** Every issue of the newsletter that has gone out through ActiveCampaign,
 *  newest first. On the live site, any not yet in the record is added.
 *  When one source can't be read the other answers alone, and the failure
 *  is logged; when neither can, it throws. */
export async function archiveIssues(key: WebKey): Promise<ArchiveIssue[]> {
  const [fromRecord, fromAc] = await Promise.allSettled([
    recorded(key),
    live(key),
  ])
  if (fromRecord.status === 'rejected' && fromAc.status === 'rejected') {
    throw new Error(
      `${key}: neither the record (${reason(fromRecord.reason)}) nor ActiveCampaign (${reason(fromAc.reason)}) could be read`
    )
  }
  if (fromRecord.status === 'rejected')
    console.warn(
      `[newsletter-archive] ${key}: the record couldn't be read: ${reason(fromRecord.reason)}`
    )
  if (fromAc.status === 'rejected')
    console.warn(
      `[newsletter-archive] ${key}: ActiveCampaign couldn't be read: ${reason(fromAc.reason)}`
    )
  const kept = fromRecord.status === 'fulfilled' ? fromRecord.value : []
  const seen = fromAc.status === 'fulfilled' ? fromAc.value : []
  // Only after a good read of the record: otherwise every issue would look
  // new. hsetnx leaves one already there alone.
  if (store && writesRecord() && fromRecord.status === 'fulfilled') {
    const have = new Set(kept.map(i => i.slug))
    const fresh = mergeIssues(key, seen).filter(i => !have.has(i.slug))
    if (fresh.length) {
      try {
        const pipe = store.pipeline()
        for (const i of fresh)
          pipe.hsetnx(ISSUES_PREFIX + key, i.slug, i.sentAt ?? '')
        await pipe.exec()
      } catch (err) {
        console.warn(
          `[newsletter-archive] ${key}: recording ${fresh.map(i => i.slug).join(', ')} failed: ${reason(err)}`
        )
      }
    }
  }
  return mergeIssues(key, kept, seen)
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The UTC day, "2026-10-10". */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/** The day's random salt for the reader apps' count, made by whichever
 *  fetch comes first and gone two days later: until then the day's fetches
 *  share it, so one app counts once; after, nobody can test whether a given
 *  address and app fetched the feed that day. Kept in memory for the day
 *  on this instance. */
const salts = new Map<string, string>()

async function daySalt(redis: Redis, day: string): Promise<string> {
  const known = salts.get(day)
  if (known) return known
  const key = `${FEED_PREFIX}salt:${day}`
  // "s" first: Upstash would read an all-digit value back as a number.
  await redis.set(key, `s${randomBytes(16).toString('hex')}`, {
    nx: true,
    ex: 2 * 86_400,
  })
  const salt = await redis.get<string>(key)
  if (typeof salt !== 'string') throw new Error(`no salt for ${day}`)
  salts.clear()
  salts.set(day, salt)
  return salt
}

/** Counts one fetch of the feed, on the live site only (a laptop's or a
 *  preview's fetches would land in the same counts). A reader app goes in
 *  as a salted hash of its address and User-Agent, so the count keeps
 *  neither. Never throws: it runs after the reader has had the feed, and a
 *  count must never break it. */
export async function countFeedFetch(
  key: WebKey,
  reader: FeedReader,
  fetcher: string,
  at: Date
): Promise<void> {
  if (!store || !writesRecord()) return
  const day = utcDay(at)
  const base = `${FEED_PREFIX}${key}:${day}`
  try {
    if (reader.kind === 'service')
      await store.hset(`${base}:services`, {
        [reader.service]: reader.readers,
      })
    else {
      const salt = await daySalt(store, day)
      const id = createHmac('sha256', salt).update(fetcher).digest('base64url')
      await store.pfadd(`${base}:direct`, id)
    }
  } catch (err) {
    // Analytics only: the feed has already gone out.
    console.warn(
      `[newsletter-archive] counting a ${key} feed fetch failed: ${reason(err)}`
    )
  }
}

export interface FeedReaders {
  newsletter: WebKey
  /** The UTC day these are for. */
  day: string
  /** Users of feed services, as the services report them. */
  services: number
  /** Reader apps fetching for one person each (approximate). */
  direct: number
}

/** Each newsletter's feed readers on the UTC day `day`. */
export async function readFeedReaders(day: string): Promise<FeedReaders[]> {
  const keys = Object.keys(WEB_NEWSLETTERS) as WebKey[]
  if (!store)
    return keys.map(newsletter => ({ newsletter, day, services: 0, direct: 0 }))
  const pipe = store.pipeline()
  for (const k of keys) {
    pipe.hgetall(`${FEED_PREFIX}${k}:${day}:services`)
    pipe.pfcount(`${FEED_PREFIX}${k}:${day}:direct`)
  }
  const out = (await pipe.exec()) as unknown[]
  return keys.map((newsletter, i) => {
    const services = (out[i * 2] ?? {}) as Record<string, unknown>
    return {
      newsletter,
      day,
      services: Object.values(services).reduce<number>(
        (n, v) => n + (Number(v) || 0),
        0
      ),
      direct: Number(out[i * 2 + 1]) || 0,
    }
  })
}
