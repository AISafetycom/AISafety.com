/*
  GET /newsletter/<key>/<issue>   (public — every issue's "View in browser" link)

  The web version of a sent issue: "/newsletter/events/week-41-2026",
  "/newsletter/funding/issue-21-2026". The address and the page itself are
  in src/lib/newsletter-web.ts; the read (a kept copy in the Blob store,
  else ActiveCampaign) is in src/lib/newsletter-web-copy.ts. The answer is
  the email's own HTML document, outside the site's layout, so it looks
  exactly as it did in the inbox; its footer links the text version
  (…/text) instead.

  The email is our own pipeline's HTML, but the page still gets a policy
  that allows no scripts, forms or framing at all.
*/

import {
  FOUND_CACHE,
  MISSING_CACHE,
  htmlResponse,
  sentEmail,
} from '@/lib/newsletter-web-copy'
import { missingPage, webPage } from '@/lib/newsletter-web'
import { textVersion } from '@/lib/newsletter-text'

export const runtime = 'nodejs'
export const maxDuration = 30

type Ctx = { params: Promise<{ key: string; issue: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { key, issue } = await params
  let email: string | null
  try {
    email = await sentEmail(key, issue)
  } catch (err) {
    console.error(
      `[newsletter-web] /newsletter/${key}/${issue} failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return htmlResponse(missingPage(key), 503, 'no-store')
  }
  if (!email) return htmlResponse(missingPage(key), 404, MISSING_CACHE)
  const text = textVersion(email)
    ? `/newsletter/${key}/${issue}/text`
    : undefined
  return htmlResponse(webPage(email, text), 200, FOUND_CACHE)
}
