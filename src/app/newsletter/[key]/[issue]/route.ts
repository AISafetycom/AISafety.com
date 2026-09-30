/*
  GET /newsletter/<key>/<issue>   (public — every issue's "View in browser" link)

  The web version of a sent issue: "/newsletter/events/week-41-2026",
  "/newsletter/funding/issue-21-2026". The address and the page itself are
  in src/lib/newsletter-web.ts; this file does the reads. A kept copy in the
  Blob store answers first; otherwise ActiveCampaign, once a campaign of the
  issue has reached readers on its real list, and that email is kept for
  next time. The answer is the email's own HTML document, outside the site's
  layout, so it looks exactly as it did in the inbox.

  The CDN keeps a found issue for a day (it never changes once sent) and a
  missing one for half a minute, so a busy send costs ActiveCampaign almost
  nothing. The email is our own pipeline's HTML, but the page still gets a
  policy that allows no scripts, forms or framing at all.
*/

import { put } from '@vercel/blob'
import { sentIssueHtml } from '@/lib/admin/newsletter'
import {
  WEB_BASE,
  WEB_NEWSLETTERS,
  issueName,
  isWebKey,
  missingPage,
  webPage,
} from '@/lib/newsletter-web'

export const runtime = 'nodejs'
export const maxDuration = 30

type Ctx = { params: Promise<{ key: string; issue: string }> }

const POLICY = [
  "default-src 'none'",
  'img-src https: data:',
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

function page(html: string, status: number, cache: string): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cache,
      'Content-Security-Policy': POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  })
}

export async function GET(_req: Request, { params }: Ctx) {
  const { key, issue } = await params
  let html: string | null
  try {
    html = await webCopy(key, issue)
  } catch (err) {
    console.error(
      `[newsletter-web] /newsletter/${key}/${issue} failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return page(missingPage(key), 503, 'no-store')
  }
  if (!html) return page(missingPage(key), 404, 'public, s-maxage=30')
  return page(
    html,
    200,
    'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
  )
}

/** The page of an issue, or null when there's none to show. */
async function webCopy(key: string, slug: string): Promise<string | null> {
  const name = issueName(key, slug)
  if (!name || !isWebKey(key)) return null
  const file = `${key}/${slug}.html`
  const kept = await fetch(WEB_BASE + file, { cache: 'no-store' })
  if (kept.ok) return webPage(await kept.text())
  if (kept.status !== 404)
    console.warn(
      `[newsletter-web] reading the kept copy of ${file} failed: HTTP ${kept.status}`
    )
  const email = await sentIssueHtml(name, WEB_NEWSLETTERS[key].list)
  if (!email) return null
  await keep(`newsletter/web/${file}`, email)
  return webPage(email)
}

/** Keeps the email as sent. Written once and never changed or deleted
 *  (nothing under newsletter/ in the Blob store ever is). Without it the
 *  page still shows, from ActiveCampaign, so a failure is only logged. */
async function keep(pathname: string, email: string): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn(
      `[newsletter-web] BLOB_READ_WRITE_TOKEN not set – ${pathname} not kept`
    )
    return
  }
  try {
    await put(pathname, email, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'text/html; charset=utf-8',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Two first views at the same moment: the other one kept it.
    if (!/already exists/i.test(msg))
      console.warn(`[newsletter-web] keeping ${pathname} failed: ${msg}`)
  }
}
