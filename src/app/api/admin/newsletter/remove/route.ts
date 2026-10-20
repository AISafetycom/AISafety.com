/*
  POST /api/admin/newsletter/remove   body { campaign, group, key, message? }

  Takes one card out of a pipeline draft in ActiveCampaign (Bryce, 9 Oct
  2026: "put a delete button in the UI so I can remove them myself"): its
  block, its plain-text segment and its manifest entry go, the text is
  rebuilt and the content marker re-stamped so the draft still verifies, and
  the manifest remembers the card so a rebuild on the owner's machine leaves
  it out too. Then the listing's Newsletter tick in Airtable is cleared —
  Pen's rule for an item dropped during review — so Pen can put it in a later
  issue. The last card of a section can't be removed. `message` (the id the
  page listed) lets the draft's message be read alongside the checks.
  Approvers only (canSendNewsletter) — it edits the email but sends nothing,
  so no fresh-session requirement.
  → { cards, tick: { status: 'unticked' } | { status: 'none', why } |
      { status: 'failed', reason } }
    409 with { problems } when the draft fails verification (or sits on a
    real list, 6/7/8, and this isn't production, or waves of the issue are on
    their way), 400 for a bad body or a card that can't be removed, 403 when
    not posted from the admin page itself.
*/

import { NextRequest } from 'next/server'
import { canSendNewsletter } from '@/lib/admin/auth'
import { isSameOriginRequest } from '@/lib/admin/origin'
import {
  DraftProblemError,
  isNewsletterConfigured,
  RemoveCardError,
  removeDraftCard,
} from '@/lib/admin/newsletter'
import { untickNewsletter } from '@/lib/admin/newsletter-listing'

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
  const { campaign, group, key, message } = (body ?? {}) as Record<
    string,
    unknown
  >
  const campaignId = String(campaign ?? '')
  const valid =
    /^\d+$/.test(campaignId) &&
    typeof group === 'string' &&
    /^g\d+$/.test(group) &&
    typeof key === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(key) &&
    (message === undefined ||
      (typeof message === 'string' && /^\d+$/.test(message)))
  if (!valid) {
    return json(
      { error: 'body must be { campaign: id, group: gN, key, message?: id }' },
      400
    )
  }
  let removed: Awaited<ReturnType<typeof removeDraftCard>>
  try {
    removed = await removeDraftCard(
      campaignId,
      group as string,
      key as string,
      message as string | undefined
    )
  } catch (err) {
    if (err instanceof DraftProblemError) {
      return json(
        { error: 'the draft failed its checks', problems: err.problems },
        409
      )
    }
    if (err instanceof RemoveCardError) {
      return json({ error: err.detail }, 400)
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] remove card ${campaignId} failed: ${detail}`)
    return json(
      { error: 'Removing the card failed; details are in the server log.' },
      502
    )
  }
  // The card is out of the email now; the tick is reported beside that.
  const tick = await untickNewsletter(key as string)
  if (tick.status === 'failed')
    console.error(`[newsletter] untick ${key} failed: ${tick.reason}`)
  return json({ cards: removed.cards, tick })
}
