/*
  GET /api/nl/<list>/<n>   (public — every link in a newsletter email)

  Sends the reader to link <n> of the email's link list (saved by the
  pipeline on the site's Blob store, with a copy in Upstash, see
  src/lib/newsletter-clicks.ts) and counts the click for that campaign.
  Only links in our own lists can be followed. The count happens after the
  redirect (after()), and link checkers, prefetchers, scanner bursts, the
  admin preview (`?p=1`), anyone signed in to the admin (the team trying
  a test copy, or reading their own copy of an issue) and any click on an
  issue that has had a test copy but hasn't gone out yet aren't counted. A
  link that can't be found goes to the homepage rather than an error. The
  work is in ../../follow.ts, shared with the catch-all route next door.
*/

import { NextRequest } from 'next/server'
import { followLink } from '../../follow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The burst check waits 10 s after the redirect before counting.
export const maxDuration = 30

type Ctx = { params: Promise<{ list: string; n: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { list, n } = await params
  return followLink(req, list, n, true)
}

/** Link checkers often ask with HEAD first: answer, but don't count it. */
export async function HEAD(req: NextRequest, { params }: Ctx) {
  const { list, n } = await params
  return followLink(req, list, n, false)
}
