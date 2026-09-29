/*
  Newsletter approval API. GET is open to anyone who may see the page
  (canViewNewsletter: approvers and view-only reviewers); POST needs an
  approver (canSendNewsletter) with a Google session under
  NEWSLETTER_FRESH_SECONDS old.

  GET  /api/admin/newsletter   → { fetchedAt, canSend, drafts, recent }
                                  canSend = this session may approve;
                                  drafts = pipeline-made draft campaigns with
                                  their verification result; recent = latest
                                  sends/scheduled campaigns
  POST /api/admin/newsletter   → body { campaign, list, confirmed?: [ids] }
                                  re-verifies the draft under a lock,
                                  schedules it to send in ~2 minutes,
                                  deletes the draft shell. `confirmed` = the
                                  ids of the warnings ticked in the dialog.
                               → 200 { campaignId, sdate, listName,
                                  activeContacts, approver, notes }
                                  409 { problems } refused (nothing sent)
                                  409 { needsConfirmation, warnings } tick
                                      these first (nothing sent)
                                  409 { locked } another approval of the
                                      issue holds the lock (nothing sent)
                                  202 { maybeScheduled } an error at or after
                                      the create: it may be scheduled, so
                                      don't press again
                                  502 { notSent } failed before the create
*/

import { NextRequest } from 'next/server'
import {
  canSendNewsletter,
  canViewNewsletter,
  currentAdmin,
  hasFreshSession,
  NEWSLETTER_FRESH_SECONDS,
} from '@/lib/admin/auth'
import {
  ApprovalLockedError,
  approveAndSend,
  DraftProblemError,
  isNewsletterConfigured,
  LinkTrackingError,
  listDrafts,
  listRecent,
  MaybeScheduledError,
  NeedsConfirmationError,
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

async function ensureAuth(send = false): Promise<Response | null> {
  if (send) {
    // Approving sends real email: an approver's session, and one that came
    // through Google recently. The page reacts to 'reauth' by sending the
    // browser back through Google and returning here. Preview-only sessions
    // get a plain 401 — the page never offers them the button.
    if (!(await canSendNewsletter()))
      return json({ error: 'unauthorized' }, 401)
    if (!(await hasFreshSession(NEWSLETTER_FRESH_SECONDS))) {
      return json({ error: 'reauth' }, 401)
    }
  } else if (!(await canViewNewsletter())) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (!isNewsletterConfigured()) {
    return json(
      { error: 'ACTIVECAMPAIGN_URL / ACTIVECAMPAIGN_KEY not set' },
      503
    )
  }
  return null
}

export async function GET() {
  const auth = await ensureAuth()
  if (auth) return auth
  try {
    const [drafts, recent, canSend] = await Promise.all([
      listDrafts(),
      listRecent(),
      canSendNewsletter(),
    ])
    return json({
      fetchedAt: new Date().toISOString(),
      canSend,
      drafts,
      recent,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] list failed: ${message}`)
    return json(
      { error: 'Loading drafts failed; details are in the server log.' },
      502
    )
  }
}

export async function POST(req: NextRequest) {
  const auth = await ensureAuth(true)
  if (auth) return auth
  const admin = await currentAdmin()
  if (!admin) return json({ error: 'unauthorized' }, 401)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'body must be JSON' }, 400)
  }
  const { campaign, list, confirmed } = (body ?? {}) as {
    campaign?: unknown
    list?: unknown
    confirmed?: unknown
  }
  const campaignId = String(campaign ?? '')
  const listId = String(list ?? '')
  const ticks =
    confirmed === undefined
      ? []
      : Array.isArray(confirmed) &&
          confirmed.length <= 200 &&
          confirmed.every(c => typeof c === 'string' && c.length <= 200)
        ? (confirmed as string[])
        : null
  if (!/^\d+$/.test(campaignId) || !/^\d+$/.test(listId) || ticks === null) {
    return json(
      { error: 'body must be { campaign: id, list: id, confirmed?: [ids] }' },
      400
    )
  }
  try {
    const result = await approveAndSend(campaignId, listId, {
      approver: admin.name || admin.email,
      confirmed: ticks,
    })
    return json(result)
  } catch (err) {
    if (err instanceof DraftProblemError) {
      return json({ error: err.message, problems: err.problems }, 409)
    }
    if (err instanceof NeedsConfirmationError) {
      return json(
        {
          error: err.message,
          needsConfirmation: true,
          warnings: err.warnings,
        },
        409
      )
    }
    if (err instanceof ApprovalLockedError) {
      return json({ error: err.detail, locked: true }, 409)
    }
    if (err instanceof MaybeScheduledError) {
      // 202: the send may well be on its way. The page says so, tells the
      // approver not to press again and rereads the lists.
      return json(
        {
          error: err.detail,
          maybeScheduled: true,
          campaignId: err.campaignId,
        },
        202
      )
    }
    if (err instanceof LinkTrackingError) {
      return json({ error: err.detail, notSent: true }, 502)
    }
    // Everything else failed before ActiveCampaign was asked to schedule
    // anything (approveAndSend turns every later error into one of the
    // above), so this is a definite "not sent".
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] approve ${campaignId} failed: ${message}`)
    return json(
      {
        error:
          'Approving failed before anything was scheduled; details are in the server log.',
        notSent: true,
      },
      502
    )
  }
}
