/*
  GET /api/admin/newsletter/alerts → { fetchedAt, lastRunAt, stale, alerts }

  The send watcher's open alerts (see src/lib/admin/newsletter-watch.ts),
  for the red banner on /admin/newsletter. Approvers and view-only reviewers
  (canViewNewsletter), like the page itself. Reads Upstash only, never
  ActiveCampaign, so it answers fast. Never cached.
*/

import { canViewNewsletter } from '@/lib/admin/auth'
import { readAlerts } from '@/lib/admin/newsletter-watch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET() {
  if (!(await canViewNewsletter())) return json({ error: 'unauthorized' }, 401)
  try {
    return json(await readAlerts())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter-watch] reading alerts failed: ${message}`)
    return json({ error: 'Reading the send watcher’s alerts failed.' }, 502)
  }
}
