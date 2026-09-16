/*
  POST /api/admin/newsletter/reorder   body { campaign, order: { g0: [keys…], … } }

  Moves the cards of a pipeline draft into the given order inside
  ActiveCampaign (per section; keys are the card keys from the draft's
  `cards`), rebuilds the plain-text version and re-stamps the content marker
  so the draft still verifies. Approvers only (canSendNewsletter) — it edits
  the email, but sends nothing, so no fresh-session requirement.
  → { cards } (the new order)   409 with { problems } when the draft fails
  verification, 400 for a bad order.
*/

import { NextRequest } from 'next/server'
import { canSendNewsletter } from '@/lib/admin/auth'
import {
  DraftProblemError,
  isNewsletterConfigured,
  ReorderError,
  reorderDraft,
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
  if (!(await canSendNewsletter())) return json({ error: 'unauthorized' }, 401)
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
  const { campaign, order } = (body ?? {}) as {
    campaign?: unknown
    order?: unknown
  }
  const campaignId = String(campaign ?? '')
  const valid =
    /^\d+$/.test(campaignId) &&
    order != null &&
    typeof order === 'object' &&
    !Array.isArray(order) &&
    Object.entries(order as Record<string, unknown>).every(
      ([g, keys]) =>
        /^g\d+$/.test(g) &&
        Array.isArray(keys) &&
        keys.length > 0 &&
        keys.every(k => typeof k === 'string' && /^[A-Za-z0-9_-]+$/.test(k))
    )
  if (!valid) {
    return json(
      { error: 'body must be { campaign: id, order: { g0: [keys…] } }' },
      400
    )
  }
  try {
    const result = await reorderDraft(
      campaignId,
      order as Record<string, string[]>
    )
    return json(result)
  } catch (err) {
    if (err instanceof DraftProblemError) {
      return json({ error: err.message, problems: err.problems }, 409)
    }
    if (err instanceof ReorderError) {
      return json({ error: err.message }, 400)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] reorder ${campaignId} failed: ${message}`)
    return json(
      { error: 'Saving the order failed; details are in the server log.' },
      502
    )
  }
}
