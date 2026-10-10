/*
  GET /newsletter/<key>/feed   (public — the newsletter's RSS feed)

  Every issue sent through ActiveCampaign, newest first, each with its text
  version as the content (src/lib/newsletter-archive.ts says what's in it;
  src/lib/newsletter-archive-store.ts where the list comes from). 404 for a
  newsletter with no issue sent that way yet.

  Each fetch is counted as a reader (after the answer has gone), so the CDN
  doesn't keep the feed: every poll reaches the function. What's kept
  instead is the built feed, on this server instance, for ten minutes, and
  a reader asking again for the copy it has gets a 304 without the body.
*/

import { after } from 'next/server'
import { getClientIp } from '@/lib/assistant/rate-limit'
import { isWebKey, type WebKey } from '@/lib/newsletter-web'
import { sentEmail } from '@/lib/newsletter-web-copy'
import { textVersion } from '@/lib/newsletter-text'
import {
  FEED_ITEMS,
  etagMatches,
  feedEtag,
  feedReader,
  feedXml,
  type FeedEntry,
} from '@/lib/newsletter-archive'
import { archiveIssues, countFeedFetch } from '@/lib/newsletter-archive-store'

export const runtime = 'nodejs'
export const maxDuration = 30

type Ctx = { params: Promise<{ key: string }> }

const BUILD_TTL_MS = 10 * 60_000
/** Issues read at a time: a first build after the move reads up to
 *  FEED_ITEMS emails, and ActiveCampaign allows five requests a second. */
const READS_AT_ONCE = 3

const built = new Map<WebKey, { at: number; feed: Promise<Built | null> }>()

interface Built {
  body: string
  etag: string
}

/** The feed, built at most every ten minutes on this instance; null when
 *  the newsletter has no issue to show. A failed build isn't kept. */
function feedFor(key: WebKey): Promise<Built | null> {
  const hit = built.get(key)
  if (hit && Date.now() - hit.at < BUILD_TTL_MS) return hit.feed
  const feed = build(key)
  built.set(key, { at: Date.now(), feed })
  feed.catch(() => built.delete(key))
  return feed
}

async function build(key: WebKey): Promise<Built | null> {
  const issues = (await archiveIssues(key)).slice(0, FEED_ITEMS)
  if (!issues.length) return null
  const entries: FeedEntry[] = new Array(issues.length)
  let next = 0
  const worker = async () => {
    while (next < issues.length) {
      const i = next++
      const issue = issues[i]
      let email: string | null = null
      try {
        email = await sentEmail(key, issue.slug)
      } catch (err) {
        // The item still goes in, linking the issue's page.
        console.warn(
          `[newsletter-feed] ${key}/${issue.slug}: the email couldn't be read: ${err instanceof Error ? err.message : String(err)}`
        )
      }
      if (!email)
        console.warn(
          `[newsletter-feed] ${key}/${issue.slug}: no email to show, the item links the issue's page`
        )
      entries[i] = { issue, text: email ? textVersion(email) : null }
    }
  }
  await Promise.all(Array.from({ length: READS_AT_ONCE }, worker))
  const body = feedXml(key, entries)
  return { body, etag: feedEtag(body) }
}

function text(body: string, status: number, cache: string): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': cache,
    },
  })
}

export async function GET(req: Request, { params }: Ctx) {
  const { key } = await params
  if (!isWebKey(key)) return text('Not found', 404, 'public, s-maxage=3600')
  let feed: Built | null
  try {
    feed = await feedFor(key)
  } catch (err) {
    console.error(
      `[newsletter-feed] /newsletter/${key}/feed failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return text(
      'The feed couldn’t be built just now. Try again in a few minutes.',
      503,
      'no-store'
    )
  }
  if (!feed)
    return text('This newsletter has no issues here yet.', 404, 'no-store')

  const reader =
    req.method === 'GET' ? feedReader(req.headers.get('user-agent')) : null
  if (reader) {
    const fetcher = `${getClientIp(req.headers)}|${req.headers.get('user-agent') ?? ''}`
    after(() => countFeedFetch(key, reader, fetcher, new Date()))
  }

  // `private`: browsers and feed readers may keep it; the CDN may not, or
  // the polls it answered would go uncounted.
  const headers = {
    ETag: feed.etag,
    'Cache-Control': 'private, max-age=300',
  }
  if (etagMatches(req.headers.get('if-none-match'), feed.etag))
    return new Response(null, { status: 304, headers })
  return new Response(feed.body, {
    status: 200,
    headers: {
      ...headers,
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
