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
  POST /api/admin/newsletter   → body { campaign, list, confirmed?: [ids],
                                  wave?: { segment, k, n }, override? }
                                  re-verifies the draft under a lock and
                                  schedules it — to the whole list, or to
                                  wave k of n (the saved segment `segment`)
                                  — to send in 5 minutes (2 on the test
                                  lists). The draft shell is deleted after a
                                  whole-list send or the last wave, and kept
                                  for the next wave otherwise. `confirmed` =
                                  the ids of the warnings ticked in the
                                  dialog; `override` = the reason typed to
                                  send a held wave anyway.
                               → 200 ScheduledSend (campaignId, sdate, name,
                                  wave, waves, expected, draftKept, notes…)
                                  409 { problems } refused (nothing sent)
                                  409 { needsConfirmation, warnings } tick
                                      these first (nothing sent)
                                  409 { needsOverride, holds } the wave is
                                      held: type a reason (nothing sent)
                                  409 { locked } another approval of the
                                      issue (whole list or any wave) holds
                                      the lock
                                  202 { maybeScheduled } an error at or after
                                      the create: it may be scheduled, so
                                      don't press again
                                  502 { notSent } failed before the create,
                                      or the new campaign came back wrong
                                      and was deleted at once
                                  403 not posted from this page (another
                                      site or subdomain; nothing sent)
  A 202 on a real list emails the owner, after the answer has gone
  (notifyApproval); an ordinary approval sends no email (Bryce, 2 Oct 2026).
*/

import { after, NextRequest } from 'next/server'
import {
  canSendNewsletter,
  canViewNewsletter,
  currentAdmin,
  hasFreshSession,
  NEWSLETTER_FRESH_SECONDS,
} from '@/lib/admin/auth'
import { isSameOriginRequest } from '@/lib/admin/origin'
import {
  ApprovalLockedError,
  approveAndSend,
  DraftProblemError,
  isNewsletterConfigured,
  isRealList,
  listDrafts,
  listRecent,
  MaybeScheduledError,
  NeedsConfirmationError,
  NeedsOverrideError,
  notifyApproval,
  SEGMENT_ID_RE,
  SendDeletedError,
  type WaveChoice,
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
  // Only the admin page itself may post here (see isSameOriginRequest).
  if (!isSameOriginRequest(req))
    return json({ error: 'cross-site request refused' }, 403)
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
  const { campaign, list, confirmed, wave, override } = (body ?? {}) as {
    campaign?: unknown
    list?: unknown
    confirmed?: unknown
    wave?: unknown
    override?: unknown
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
  const choice = parseWave(wave)
  if (
    !/^\d+$/.test(campaignId) ||
    !/^\d+$/.test(listId) ||
    ticks === null ||
    choice === undefined ||
    (override !== undefined &&
      override !== null &&
      !(typeof override === 'string' && override.length <= 1000))
  ) {
    return json(
      {
        error:
          'body must be { campaign: id, list: id, confirmed?: [ids], wave?: { segment, k, n }, override?: text }',
      },
      400
    )
  }
  try {
    const result = await approveAndSend(campaignId, listId, {
      approver: admin.name || admin.email,
      confirmed: ticks,
      wave: choice,
      override: typeof override === 'string' ? override : null,
    })
    // No email for an ordinary approval (Bryce, 2 Oct 2026: "Let's not do
    // these emails"); the owner still hears about a 202 below.
    return json(result)
  } catch (err) {
    if (err instanceof DraftProblemError) {
      return json({ error: err.message, problems: err.problems }, 409)
    }
    if (err instanceof NeedsOverrideError) {
      return json(
        { error: err.message, needsOverride: true, holds: err.holds },
        409
      )
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
      // approver not to press again and rereads the lists; the owner hears.
      const facts = err.facts
      if (facts && isRealList(facts.listId))
        after(() =>
          notifyApproval({ ...facts, campaignId: err.campaignId }, true)
        )
      return json(
        {
          error: err.detail,
          maybeScheduled: true,
          campaignId: err.campaignId,
        },
        202
      )
    }
    if (err instanceof SendDeletedError) {
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

/** The wave in a request: undefined when malformed, null when none. */
function parseWave(wave: unknown): WaveChoice | null | undefined {
  if (wave === undefined || wave === null) return null
  const w = wave as { segment?: unknown; k?: unknown; n?: unknown }
  if (
    typeof w !== 'object' ||
    typeof w.segment !== 'string' ||
    !SEGMENT_ID_RE.test(w.segment) ||
    !Number.isInteger(w.k) ||
    !Number.isInteger(w.n)
  )
    return undefined
  return { segmentId: w.segment, wave: w.k as number, waves: w.n as number }
}
