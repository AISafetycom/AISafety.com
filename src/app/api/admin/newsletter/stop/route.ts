/*
  POST /api/admin/newsletter/stop   body { campaign, action }

  The Stop buttons on Recent sends. `action` is one of
    cancel  a scheduled or held send: ActiveCampaign deletes it, nobody gets it
    pause   a send that is going out: it stops partway, and can be resumed
    stop    a sending or paused send, for good
    resume  a paused send carries on
  Same checks as Approve & send: an approver (canSendNewsletter) with a
  Google session under NEWSLETTER_FRESH_SECONDS old; the page confirms first.
  The campaign is read fresh and must be a newsletter send (lists 5–8) in a
  state that allows the action.
  → 200 StopResult
    409 { refused } the action doesn't fit the send as it is now, or another
        press on it is still being carried out (nothing changed)
    502 { failed, uncertain } ActiveCampaign refused, or no clear answer came
        back (uncertain: it may have worked)
    403 not posted from the admin page itself (nothing changed)
*/

import { NextRequest } from 'next/server'
import {
  canSendNewsletter,
  currentAdmin,
  hasFreshSession,
  NEWSLETTER_FRESH_SECONDS,
} from '@/lib/admin/auth'
import { isSameOriginRequest } from '@/lib/admin/origin'
import {
  isNewsletterConfigured,
  StopFailedError,
  StopLockedError,
  StopRefusedError,
  stopSend,
  type StopAction,
} from '@/lib/admin/newsletter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACTIONS = new Set<StopAction>(['cancel', 'pause', 'stop', 'resume'])

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
  // As for approving: an approver, signed in through Google recently. The
  // page reacts to 'reauth' by going through Google and coming back.
  if (!(await canSendNewsletter())) return json({ error: 'unauthorized' }, 401)
  if (!(await hasFreshSession(NEWSLETTER_FRESH_SECONDS)))
    return json({ error: 'reauth' }, 401)
  const admin = await currentAdmin()
  if (!admin) return json({ error: 'unauthorized' }, 401)
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
  const { campaign, action } = (body ?? {}) as {
    campaign?: unknown
    action?: unknown
  }
  const campaignId = String(campaign ?? '')
  if (
    !/^\d{1,12}$/.test(campaignId) ||
    typeof action !== 'string' ||
    !ACTIONS.has(action as StopAction)
  ) {
    return json(
      {
        error:
          'body must be { campaign: id, action: cancel | pause | stop | resume }',
      },
      400
    )
  }
  try {
    const result = await stopSend(campaignId, action as StopAction, {
      by: admin.name || admin.email,
    })
    return json(result)
  } catch (err) {
    if (err instanceof StopRefusedError || err instanceof StopLockedError) {
      return json({ error: err.detail, refused: true }, 409)
    }
    if (err instanceof StopFailedError) {
      return json(
        { error: err.detail, failed: true, uncertain: err.uncertain },
        502
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `[newsletter] ${action} of campaign ${campaignId} failed: ${message}`
    )
    return json(
      {
        error:
          'That didn’t go through before ActiveCampaign was asked; details are in the server log. Try again, or do it in ActiveCampaign.',
        failed: true,
        uncertain: false,
      },
      502
    )
  }
}
