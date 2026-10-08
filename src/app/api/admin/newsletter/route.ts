/*
  Newsletter approval API. GET is open to anyone who may see the page
  (canViewNewsletter: approvers and view-only reviewers); POST needs an
  approver (canSendNewsletter) with a Google session under
  NEWSLETTER_FRESH_SECONDS old.

  GET  /api/admin/newsletter   → { fetchedAt, canSend, drafts, recent,
                                  lineup }
                                  canSend = this session may approve;
                                  drafts = pipeline-made draft campaigns with
                                  their verification result; recent = latest
                                  sends/scheduled campaigns; lineup = the
                                  listings each newsletter's next issue would
                                  pick up (newsletter-lineup.ts)
  POST /api/admin/newsletter   → body { campaign, list, confirmed?: [ids],
                                  waves?: { from, n, segments: [ids] },
                                  override? }
                                  re-verifies the draft under a lock and
                                  schedules it: to the whole list in 5
                                  minutes (2 on the test lists), or — approve
                                  once — every wave still to go, wave `from`
                                  to n (`segments` = their saved segments, as
                                  the page listed them), the first in 5
                                  minutes or once the gap after the previous
                                  wave is up, each later one 24 hours after
                                  the one before (10 minutes on the test
                                  lists). The draft shell is deleted after a
                                  whole-list send; waves keep it until the
                                  last one has gone. `confirmed` = the ids of
                                  the warnings ticked in the dialog;
                                  `override` = the reason typed to send held
                                  waves anyway. The old one-wave body
                                  ({ wave: { segment, k, n } }, from a page
                                  loaded before approve once) is refused:
                                  reload.
                               → 200 ScheduledSend (campaignId, sdate, name,
                                  wave, waves, expected, draftKept,
                                  scheduled: every wave with its time,
                                  notes…)
                                  409 { problems } refused (nothing sent)
                                  409 { needsConfirmation, warnings } tick
                                      these first (nothing sent)
                                  409 { needsOverride, holds } the first
                                      wave is held: type a reason (nothing
                                      sent)
                                  409 { locked } another approval of the
                                      issue (whole list or waves) holds the
                                      lock
                                  202 { maybeScheduled } an error at or after
                                      a create that can't be confirmed either
                                      way: something may be scheduled, so
                                      don't press again
                                  502 { notSent } failed before the create,
                                      or every campaign made was deleted
                                      again (one came back wrong, or
                                      ActiveCampaign was too slow)
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
  baseIssueName,
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
  type WaveRange,
} from '@/lib/admin/newsletter'
import {
  FUNDING_LIST_ID,
  readLineup,
  saveFundingBaseline,
  withoutWaiting,
} from '@/lib/admin/newsletter-lineup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Approving every wave still to go makes a campaign per wave, each read back
// (ActiveCampaign can take 10+ seconds a request); the approval stops
// making them after two minutes and takes them back instead (newsletter.ts
// PRESS_CREATE_BY_MS), which needs the rest of this.
export const maxDuration = 300

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
    const [drafts, recent, canSend, lineup] = await Promise.all([
      listDrafts(),
      listRecent(),
      canSendNewsletter(),
      readLineup(),
    ])
    return json({
      fetchedAt: new Date().toISOString(),
      canSend,
      drafts,
      recent,
      // The cards of the drafts waiting here are in an issue already.
      lineup: withoutWaiting(
        lineup,
        new Set(
          drafts
            .flatMap(d => d.cards ?? [])
            .flatMap(g => g.cards.map(c => c.key))
        )
      ),
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
  const { campaign, list, confirmed, wave, waves, override } = (body ?? {}) as {
    campaign?: unknown
    list?: unknown
    confirmed?: unknown
    wave?: unknown
    waves?: unknown
    override?: unknown
  }
  // A page loaded before approve once asks for one wave: what its dialog
  // showed is no longer what an approval does.
  if (wave !== undefined && wave !== null)
    return json(
      {
        error: 'this page is out of date',
        problems: [
          'this page is out of date – reload it, then approve the waves again',
        ],
      },
      409
    )
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
  const range = parseWaves(waves)
  if (
    !/^\d+$/.test(campaignId) ||
    !/^\d+$/.test(listId) ||
    ticks === null ||
    range === undefined ||
    (override !== undefined &&
      override !== null &&
      !(typeof override === 'string' && override.length <= 1000))
  ) {
    return json(
      {
        error:
          'body must be { campaign: id, list: id, confirmed?: [ids], waves?: { from, n, segments: [ids] }, override?: text }',
      },
      400
    )
  }
  try {
    const result = await approveAndSend(campaignId, listId, {
      approver: admin.name || admin.email,
      confirmed: ticks,
      waves: range,
      override: typeof override === 'string' ? override : null,
    })
    // Funding's lined-up count runs from the listings accepting
    // applications as an issue goes out (newsletter-lineup.ts).
    if (listId === FUNDING_LIST_ID)
      after(() =>
        saveFundingBaseline(baseIssueName(result.name)).catch(err =>
          console.error(
            `[newsletter] noting the open Funding listings failed: ${err instanceof Error ? err.message : String(err)}`
          )
        )
      )
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

/** The waves in a request: undefined when malformed, null when none (the
 *  whole list). approveAndSend checks the range against the list's waves. */
function parseWaves(waves: unknown): WaveRange | null | undefined {
  if (waves === undefined || waves === null) return null
  const w = waves as { from?: unknown; n?: unknown; segments?: unknown }
  if (
    typeof w !== 'object' ||
    !Number.isInteger(w.from) ||
    !Number.isInteger(w.n) ||
    !Array.isArray(w.segments) ||
    w.segments.length < 1 ||
    w.segments.length > 9 ||
    !w.segments.every(s => typeof s === 'string' && SEGMENT_ID_RE.test(s))
  )
    return undefined
  return {
    from: w.from as number,
    waves: w.n as number,
    segmentIds: w.segments as string[],
  }
}
