/*
  The one place a newsletter link is followed, for both /api/nl routes:
  [list]/[n] (every link as the pipeline writes it) and [[...rest]] (a link
  cut short or with extra bits on the end, which would otherwise be a 404).
  See src/lib/newsletter-clicks.ts for the lists and the counts.
*/

import { after, type NextRequest } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'
import {
  HOMEPAGE,
  isLikelyBot,
  isScannerBurst,
  LIST_ID_RE,
  loadLinkList,
  recordClick,
} from '@/lib/newsletter-clicks'

/** A link that can't be found (an old list, a mangled address) still lands
 *  somewhere useful: the site's homepage, which links everything the
 *  newsletters list. */
export function toHomepage(): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: HOMEPAGE, 'Cache-Control': 'no-store' },
  })
}

/** The reader's address, only ever used hashed (the burst rule). Vercel
 *  sets the first x-forwarded-for entry; null when there's none. */
function clientAddress(req: NextRequest): string | null {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first || req.headers.get('x-real-ip') || null
}

/** Send the reader to link <n> of list <list> and, when `count`, count the
 *  click after the redirect has gone. */
export async function followLink(
  req: NextRequest,
  list: string,
  n: string,
  count: boolean
): Promise<Response> {
  if (!LIST_ID_RE.test(list) || !/^\d{1,4}$/.test(n)) return toHomepage()
  const links = await loadLinkList(list, after)
  const link = links?.links[Number(n)]
  if (!links || !link) return toHomepage()
  const preview = req.nextUrl.searchParams.get('p') === '1'
  if (count && !preview && !isLikelyBot(req.headers.get('user-agent'))) {
    const ip = clientAddress(req)
    // The session check reads the cookie after the redirect has gone, and
    // the burst check waits out its window there too, so a reader never
    // waits on either.
    after(async () => {
      if (await isAdmin()) return
      if (await isScannerBurst(list, Number(n), ip)) return
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
