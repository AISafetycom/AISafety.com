/*
  The sent email behind an issue's web version and text version
  (/newsletter/<key>/<issue> and …/text), and the way both pages answer.
  Moved out of the web version's route on 10 Oct 2026 so the text version
  reads the same copy; what each page makes of the email is in
  src/lib/newsletter-web.ts and src/lib/newsletter-text.ts.

  A kept copy in the Blob store answers first; otherwise ActiveCampaign,
  once a campaign of the issue has reached readers on its real list, and
  that email is kept for next time.
*/

import { put } from '@vercel/blob'
import { sentIssueHtml } from '@/lib/admin/newsletter'
import {
  WEB_BASE,
  WEB_NEWSLETTERS,
  issueName,
  isWebKey,
} from '@/lib/newsletter-web'

/** The email as sent, or null when the issue isn't online. Throws when
 *  ActiveCampaign can't be read. */
export async function sentEmail(
  key: string,
  slug: string
): Promise<string | null> {
  const name = issueName(key, slug)
  if (!name || !isWebKey(key)) return null
  const file = `${key}/${slug}.html`
  const kept = await fetch(WEB_BASE + file, { cache: 'no-store' })
  if (kept.ok) return kept.text()
  if (kept.status !== 404)
    console.warn(
      `[newsletter-web] reading the kept copy of ${file} failed: HTTP ${kept.status}`
    )
  const email = await sentIssueHtml(name, WEB_NEWSLETTERS[key].list)
  if (!email) return null
  await keep(`newsletter/web/${file}`, email)
  return email
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

/** The CDN keeps a found issue for a day (it never changes once sent) and a
 *  missing one for half a minute, so a busy send costs ActiveCampaign
 *  almost nothing. */
export const FOUND_CACHE =
  'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
export const MISSING_CACHE = 'public, s-maxage=30'

/** A page's answer. `script` is the hash of the one inline script the page
 *  may run; without it, none. */
export function htmlResponse(
  html: string,
  status: number,
  cache: string,
  script?: string
): Response {
  const policy = [
    "default-src 'none'",
    'img-src https: data:',
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    ...(script ? [`script-src '${script}'`] : []),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': cache,
      'Content-Security-Policy': policy,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  })
}
