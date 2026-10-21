/*
  Substack histories for the Newsletters tab's subscriber tiles
  (src/lib/analytics/substack-history.ts). The tab reads a newsletter's
  Substack export in the browser and sends only the counts: how many
  people each issue was emailed to. Adding one needs the Analytics tab and
  Newsletters' edit grant (the people who send the newsletters); anyone
  else gets 401.

  POST /api/admin/analytics/substack-history  body SubstackHistory
       → { saved: 'saved' } | 409 { error: 'older' }

  Must come from the admin page itself (isSameOriginRequest).
*/

import type { NextRequest } from 'next/server'
import {
  canSendNewsletter,
  canViewAnalytics,
  currentAdmin,
} from '@/lib/admin/auth'
import { isSameOriginRequest } from '@/lib/admin/origin'
import { parseSubstackHistory } from '@/lib/analytics/substack-export'
import { saveSubstackHistory } from '@/lib/analytics/substack-history'

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

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req)) return json({ error: 'forbidden' }, 403)
  if (!(await canSendNewsletter()) || !(await canViewAnalytics()))
    return json({ error: 'unauthorized' }, 401)
  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const history = parseSubstackHistory(body)
  if (!history) return json({ error: 'invalid' }, 400)
  const me = await currentAdmin()
  try {
    const saved = await saveSubstackHistory(
      history,
      me?.name ?? me?.email ?? 'unknown'
    )
    if (saved === 'older') return json({ error: 'older' }, 409)
    console.info(
      `[analytics] ${me?.email ?? 'unknown'} added the ${history.publication} Substack history (${history.issues.length} issues)`
    )
    return json({ saved })
  } catch (err) {
    console.error(
      `[analytics] couldn't save the Substack history: ${err instanceof Error ? err.message : String(err)}`
    )
    return json({ error: 'store' }, 503)
  }
}
