/*
  GET /newsletter/<key>/<issue>/text   (public — the email's "Copy text version" link)

  A sent issue as simple text with links, and a button that copies it, for
  pasting into a chat or a doc (src/lib/newsletter-text.ts). Read from the
  same kept copy as the web version (src/lib/newsletter-web-copy.ts) and
  cached the same way. The page runs one script, the button's, allowed by
  its hash.
*/

import {
  FOUND_CACHE,
  MISSING_CACHE,
  htmlResponse,
  sentEmail,
} from '@/lib/newsletter-web-copy'
import { isWebKey, missingPage } from '@/lib/newsletter-web'
import { TEXT_SCRIPT_HASH, textPage, textVersion } from '@/lib/newsletter-text'

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
      `[newsletter-web] /newsletter/${key}/${issue}/text failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return htmlResponse(missingPage(key), 503, 'no-store')
  }
  if (!email || !isWebKey(key))
    return htmlResponse(missingPage(key), 404, MISSING_CACHE)
  const tv = textVersion(email)
  if (!tv) {
    // An email without the cards' manifest (none has been sent since the
    // web version began, but say so if one is): the email itself instead.
    console.warn(`[newsletter-web] ${key}/${issue} has no text version`)
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/newsletter/${key}/${issue}`,
        'Cache-Control': MISSING_CACHE,
      },
    })
  }
  const subject = /<title>([^<]*)<\/title>/.exec(email)?.[1]?.trim() || issue
  return htmlResponse(
    textPage(tv, key, decodeTitle(subject), `/newsletter/${key}/${issue}`),
    200,
    FOUND_CACHE,
    TEXT_SCRIPT_HASH
  )
}

/** The <title> is HTML-escaped by the pipeline; textPage() escapes again. */
function decodeTitle(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
