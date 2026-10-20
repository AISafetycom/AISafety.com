/*
  GET /api/nl/…   (public — a newsletter link that isn't /api/nl/<list>/<n>)

  A link cut short (a mail app wrapping a long line, a reader copying half
  of it, down to a bare /api/nl) or with extra bits on the end would
  otherwise be a 404. Every
  well-formed link is answered by [list]/[n], which Next matches first; this
  catches the rest. With extra bits after a real <list>/<n> the reader still
  goes where the link pointed (counted the same way); anything else goes to
  the homepage.
*/

import { NextRequest } from 'next/server'
import { followLink, toHomepage } from '../follow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The burst check waits 10 s after the redirect before counting.
export const maxDuration = 30

type Ctx = { params: Promise<{ rest?: string[] }> }

async function answer(req: NextRequest, { params }: Ctx, count: boolean) {
  const { rest = [] } = await params
  if (rest.length > 2) return followLink(req, rest[0], rest[1], count)
  return toHomepage()
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return answer(req, ctx, true)
}

/** Link checkers often ask with HEAD first: answer, but don't count it. */
export async function HEAD(req: NextRequest, ctx: Ctx) {
  return answer(req, ctx, false)
}
