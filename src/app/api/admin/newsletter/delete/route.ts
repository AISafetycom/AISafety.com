/*
  POST /api/admin/newsletter/delete   body { campaign }

  Deletes a pipeline draft waiting for approval (deleteDraft: still a draft,
  carrying the pipeline's marker, no approval of it running). Nothing is
  sent; the pipeline's next build of the issue makes a new draft. Approvers
  only (canSendNewsletter). No fresh-session requirement: it can only take
  away a draft, never send one.
  → { deleted }  (false = it was already gone)   409 with { problems } when
  the draft can't be deleted, 502 with { error } when ActiveCampaign
  refuses, 403 when not posted from the admin page itself.
*/

import { NextRequest } from 'next/server'
import { canSendNewsletter, currentAdmin } from '@/lib/admin/auth'
import { isSameOriginRequest } from '@/lib/admin/origin'
import {
  deleteDraft,
  DraftDeleteError,
  DraftProblemError,
  isNewsletterConfigured,
} from '@/lib/admin/newsletter'

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
  // Only the admin page itself may post here (see isSameOriginRequest).
  if (!isSameOriginRequest(req))
    return json({ error: 'cross-site request refused' }, 403)
  const admin = await currentAdmin()
  if (!admin || !(await canSendNewsletter()))
    return json({ error: 'unauthorized' }, 401)
  if (!isNewsletterConfigured()) {
    return json(
      { error: 'ACTIVECAMPAIGN_URL / ACTIVECAMPAIGN_KEY not set' },
      503
    )
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'body must be JSON' }, 400)
  }
  const campaignId = String((body as { campaign?: unknown })?.campaign ?? '')
  if (!/^\d+$/.test(campaignId)) {
    return json({ error: 'body must be { campaign: id }' }, 400)
  }
  try {
    return json(await deleteDraft(campaignId, admin.name || admin.email))
  } catch (err) {
    if (err instanceof DraftProblemError) {
      return json({ error: err.message, problems: err.problems }, 409)
    }
    if (err instanceof DraftDeleteError) {
      return json({ error: err.detail }, 502)
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] deleting draft ${campaignId} failed: ${detail}`)
    return json(
      {
        error:
          'Deleting the draft failed; details are in the server log. The list above shows whether it went.',
      },
      502
    )
  }
}
