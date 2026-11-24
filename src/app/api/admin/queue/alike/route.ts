/*
  Which listings already in its area of the Field map a new one is most
  like, for the Queue's map strip: it suggests a spot beside them.

  POST /api/admin/queue/alike
    body { area, listing: { name, description, category },
           among: [{ id, name, description, category }] }
    → { like: [id, …] }  up to three of `among`, most alike first (none
      when nothing there is really alike)
    → 400 for a body it can't read, 502 when Claude can't be asked
      (with a fixed reason; the error itself goes to the server log)

  Claude does the judging (map-alike-claude.ts). The strip sends the
  listings it has already read, so this makes no Airtable read of its own.
*/

import { canViewQueue } from '@/lib/admin/auth'
import { askAlike } from '@/lib/admin/map-alike-claude'
import { readAlikeRequest } from '@/lib/admin/map-alike'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(req: Request) {
  if (!(await canViewQueue())) return json({ error: 'unauthorized' }, 401)
  const read = readAlikeRequest(await req.json().catch(() => null))
  if (!read.ok) return json({ error: read.error }, 400)
  const { area, listing, among } = read.request
  try {
    return json({ like: await askAlike(listing, among, area) })
  } catch (e) {
    // The full error goes to the server log only: the page gets a fixed
    // reason, never the error's own text (CodeQL, information exposure).
    console.error('[queue/alike]', e)
    const error = process.env.ANTHROPIC_API_KEY
      ? 'see the server log'
      : 'no ANTHROPIC_API_KEY on the server'
    return json({ error }, 502)
  }
}
