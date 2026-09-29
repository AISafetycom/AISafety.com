/*
  GET /api/nl/<list>/<n>   (public — every link in a newsletter email)

  Sends the reader to link <n> of the email's link list (saved by the
  pipeline on the site's Blob store, see src/lib/newsletter-clicks.ts) and
  counts the click for that campaign. Only links in our own lists can be
  followed. The count happens after the redirect (after()), and link
  checkers, prefetchers, the admin preview (`?p=1`) and anyone signed in to
  the admin (the team trying a test copy, or reading their own copy of an
  issue) aren't counted. A link that can't be found goes to the homepage
  rather than an error.
*/

import { after, NextRequest } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'
import {
  isLikelyBot,
  LIST_ID_RE,
  loadLinkList,
  recordClick,
} from '@/lib/newsletter-clicks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A link that can't be found (an old list, a mangled address) still lands
 *  somewhere useful: the site's homepage, which links everything the
 *  newsletters list. */
function notFound(): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: 'https://aisafety.com/', 'Cache-Control': 'no-store' },
  })
}

async function resolve(
  req: NextRequest,
  list: string,
  n: string,
  count: boolean
) {
  if (!LIST_ID_RE.test(list) || !/^\d{1,4}$/.test(n)) return notFound()
  const links = await loadLinkList(list)
  const link = links?.links[Number(n)]
  if (!links || !link) return notFound()
  const preview = req.nextUrl.searchParams.get('p') === '1'
  if (count && !preview && !isLikelyBot(req.headers.get('user-agent'))) {
    // The session check reads the cookie after the redirect has gone, so a
    // reader never waits on it.
    after(async () => {
      if (await isAdmin()) return
      await recordClick(links.c, link)
    })
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: link.u,
      // Every click must reach this function to be counted.
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  })
}

type Ctx = { params: Promise<{ list: string; n: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { list, n } = await params
  return resolve(req, list, n, true)
}

/** Link checkers often ask with HEAD first: answer, but don't count it. */
export async function HEAD(req: NextRequest, { params }: Ctx) {
  const { list, n } = await params
  return resolve(req, list, n, false)
}
