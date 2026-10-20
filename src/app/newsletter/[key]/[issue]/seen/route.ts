/*
  GET /newsletter/<key>/<issue>/seen?as=web|text   (public — loaded by the
  issue's own pages)

  Counts a view of an issue's web or text version. Those pages are the
  email's own HTML outside the site's layout, run no site scripts, and are
  kept by the CDN for a day, so they can't count themselves: each loads this
  one-pixel image (seenImage in src/lib/newsletter-web.ts), which is never
  cached. The view goes into the analytics store as a newsletter_copy_view
  (NEWSLETTER_COPY_VIEW in src/lib/analytics/events.ts) under the day's
  anonymous id for the reader (dailyReaderId), and the Analytics
  Newsletters tab shows them.

  Not counted: anything that says it's a bot or a link checker (the same
  rule as the emails' link clicks), a request that isn't an image load,
  anyone signed in to the admin (the team checking an issue), and more
  requests from one address than the tracking beacon allows. The image goes
  back the same either way.
*/

import { after, type NextRequest } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'
import { getClientIp } from '@/lib/assistant/rate-limit'
import {
  allowTrack,
  NEWSLETTER_COPY_VIEW,
  recordEvent,
} from '@/lib/analytics/events'
import { dailyReaderId } from '@/lib/newsletter-archive-store'
import { isLikelyBot } from '@/lib/newsletter-clicks'
import { WEB_NEWSLETTERS, isWebKey, issueName } from '@/lib/newsletter-web'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A transparent 1×1 GIF. */
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

type Ctx = { params: Promise<{ key: string; issue: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { key, issue } = await params
  const copy = req.nextUrl.searchParams.get('as')
  const ua = req.headers.get('user-agent')
  const dest = req.headers.get('sec-fetch-dest')
  if (
    isWebKey(key) &&
    issueName(key, issue) != null &&
    (copy === 'web' || copy === 'text') &&
    !isLikelyBot(ua) &&
    (dest == null || dest === 'image')
  ) {
    const ip = getClientIp(req.headers)
    const at = new Date()
    // After the image has gone, so a reader never waits on the count.
    // Analytics only: a failed count is logged by recordEvent and never
    // reaches the page.
    after(async () => {
      try {
        if (await isAdmin()) return
        if (!(await allowTrack(ip))) return
        await recordEvent(
          {
            type: NEWSLETTER_COPY_VIEW,
            page: WEB_NEWSLETTERS[key].prefix,
            label: issue,
            source: copy,
            vid: await dailyReaderId(`${ip}|${ua ?? ''}`, at),
            ts: at.toISOString(),
          },
          { firstSeen: false }
        )
      } catch (err) {
        console.warn(
          `[newsletter-web] counting a view of ${key}/${issue} failed: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    })
  }
  return new Response(PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL.length),
      // Every view must reach this function to be counted.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
