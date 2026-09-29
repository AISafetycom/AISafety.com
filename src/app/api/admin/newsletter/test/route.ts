/*
  POST /api/admin/newsletter/test   body { campaign, message? }

  Mails one copy of a pipeline draft to the signed-in approver's own address
  (the one Google vouched for; the body can't name another), through
  ActiveCampaign's test send: "TEST: " before the subject, nothing to the
  list, the draft left as it is. Approvers only (canSendNewsletter). No
  fresh-session requirement, since the email can only reach the person
  asking for it.
  → { to }   409 with { problems } when the draft fails the approval checks,
  502 with { error } when ActiveCampaign won't send it.
*/

import { NextRequest } from 'next/server'
import { canSendNewsletter, currentAdmin } from '@/lib/admin/auth'
import {
  DraftProblemError,
  isNewsletterConfigured,
  sendTestCopy,
  TestSendError,
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
  const { campaign, message } = (body ?? {}) as {
    campaign?: unknown
    /** The message id the page listed: read alongside the checks. */
    message?: unknown
  }
  const campaignId = String(campaign ?? '')
  if (
    !/^\d+$/.test(campaignId) ||
    (message !== undefined &&
      !(typeof message === 'string' && /^\d+$/.test(message)))
  ) {
    return json({ error: 'body must be { campaign: id }' }, 400)
  }
  try {
    const result = await sendTestCopy(
      campaignId,
      admin.email,
      message as string | undefined
    )
    return json(result)
  } catch (err) {
    if (err instanceof DraftProblemError) {
      return json({ error: err.message, problems: err.problems }, 409)
    }
    if (err instanceof TestSendError) {
      return json({ error: err.detail }, 502)
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] test copy of ${campaignId} failed: ${detail}`)
    return json(
      { error: 'Sending the test failed; details are in the server log.' },
      502
    )
  }
}
