/*
  POST /api/admin/newsletter/fit   body { campaign, group, key, fit }

  Sets one funding card's "Consider applying if" line inside a pipeline draft
  in ActiveCampaign (`group`/`key` are the card's ids from the draft's
  `cards`; `fit` is plain text, empty removes the line), rebuilds the
  plain-text version and re-stamps the content marker so the draft still
  verifies. Approvers only (canSendNewsletter) — it edits the email, but
  sends nothing, so no fresh-session requirement.
  → { cards } (the cards, with the new text)   409 with { problems } when the
  draft fails verification, 400 for a bad card or body.
*/

import { NextRequest } from 'next/server'
import { canSendNewsletter } from '@/lib/admin/auth'
import {
  DraftProblemError,
  editDraftFit,
  FitError,
  isNewsletterConfigured,
} from '@/lib/admin/newsletter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Longer than any line Pen writes; a guard, not a house style. */
const MAX_FIT_LENGTH = 1000

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
  const { campaign, group, key, fit } = (body ?? {}) as {
    campaign?: unknown
    group?: unknown
    key?: unknown
    fit?: unknown
  }
  const campaignId = String(campaign ?? '')
  const valid =
    /^\d+$/.test(campaignId) &&
    typeof group === 'string' &&
    /^g\d+$/.test(group) &&
    typeof key === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(key) &&
    typeof fit === 'string' &&
    fit.length <= MAX_FIT_LENGTH
  if (!valid) {
    return json(
      { error: 'body must be { campaign: id, group: gN, key, fit: text }' },
      400
    )
  }
  try {
    const result = await editDraftFit(
      campaignId,
      group as string,
      key as string,
      fit as string
    )
    return json(result)
  } catch (err) {
    if (err instanceof DraftProblemError) {
      return json({ error: err.message, problems: err.problems }, 409)
    }
    if (err instanceof FitError) {
      return json({ error: err.message }, 400)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] fit edit ${campaignId} failed: ${message}`)
    return json(
      { error: 'Saving the text failed; details are in the server log.' },
      502
    )
  }
}
