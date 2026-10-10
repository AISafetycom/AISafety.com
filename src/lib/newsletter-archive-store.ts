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

   Each feed fetch is also counted here, per newsletter per day (see
   feedReader()): a feed service's own subscriber count, and the reader apps
   that fetch for one person, as an approximate distinct count that keeps no
   address. /admin/analytics' Newsletters tab shows them. */

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
 *  (their User-Agent → subscriber count, the day's latest) and a
 *  HyperLogLog of reader apps. No expiry: they're tiny, and the history is
 *  the point. */
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

/** Counts one fetch of the feed, on the live site only (a laptop's or a
 *  preview's fetches would land in the same counts). Never throws: it runs
 *  after the reader has had the feed, and a count must never break it. */
export async function countFeedFetch(
  key: WebKey,
  reader: FeedReader,
  fetcher: string,
  at: Date
): Promise<void> {
  if (!store || !writesRecord()) return
  const base = `${FEED_PREFIX}${key}:${utcDay(at)}`
  try {
    if (reader.kind === 'service')
      await store.hset(`${base}:services`, {
        [reader.service]: reader.readers,
      })
    else await store.pfadd(`${base}:direct`, fetcher)
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
