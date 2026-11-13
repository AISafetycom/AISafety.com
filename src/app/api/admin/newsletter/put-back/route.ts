/*
  POST /api/admin/newsletter/put-back   body { campaign, group, key, message?, from? }

  Brings a card removed from a pipeline draft back where it was (Bryce, 29
  Oct 2026, after removing the AI x Epistemics sprint by mistake: an undo
  button, so he doesn't have to ask for a rebuild). The card's block, its
  manifest entry and its plain-text segment come back from the removal copy
  Remove stored on the Blob store (newsletter-removed.ts), it leaves the
  manifest's `removed` list, the text is rebuilt and the content marker
  re-stamped so the draft still verifies. Then the listing's Newsletter tick
  in Airtable is set again (Events/Training; Funding has none). The same edit
  locks as every card edit apply: not once waves of the issue are scheduled
  or going out, nor while it is being approved. `message` (the id the page
  listed) lets the draft's message be read alongside the checks; `from` says
  which button was pressed ('undo' = the Undo link in the Removed line,
  'list' = Put back in the list of removed cards), for the count on
  /admin/analytics. Approvers only (canSendNewsletter) — it edits the email
  but sends nothing.
  → { cards, removed, tick: { status: 'ticked' } | { status: 'none', why } |
      { status: 'failed', reason } }
    409 with { problems } when the draft fails verification (or sits on a
    real list, 6/7/8, and this isn't production, or waves of the issue are on
    their way), 400 for a bad body or a card that can't be put back, 502 when
    its copy can't be read, 403 when not posted from the admin page itself.
*/

import { NextRequest } from 'next/server'
import { canSendNewsletter } from '@/lib/admin/auth'
import { isSameOriginRequest } from '@/lib/admin/origin'
import {
  DraftProblemError,
  isNewsletterConfigured,
  PutBackError,
  putBackDraftCard,
} from '@/lib/admin/newsletter'
import { countCardEdit } from '@/lib/admin/newsletter-edit-counts'
import { retickNewsletter } from '@/lib/admin/newsletter-listing'
import { RemovalCopyError } from '@/lib/admin/newsletter-removed'

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
  const { campaign, group, key, message, from } = (body ?? {}) as Record<
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
      (typeof message === 'string' && /^\d+$/.test(message))) &&
    (from === undefined || from === 'undo' || from === 'list')
  if (!valid) {
    return json(
      {
        error:
          'body must be { campaign: id, group: gN, key, message?: id, from?: "undo" | "list" }',
      },
      400
    )
  }
  let back: Awaited<ReturnType<typeof putBackDraftCard>>
  try {
    back = await putBackDraftCard(
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
    if (err instanceof PutBackError) return json({ error: err.detail }, 400)
    if (err instanceof RemovalCopyError) return json({ error: err.detail }, 502)
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] put back card ${campaignId} failed: ${detail}`)
    return json(
      { error: 'Putting the card back failed; details are in the server log.' },
      502
    )
  }
  // The card is back in the email now; the tick and the count come after.
  const [tick] = await Promise.all([
    retickNewsletter(key as string),
    countCardEdit(from === 'undo' ? 'put-back-undo' : 'put-back'),
  ])
  if (tick.status === 'failed')
    console.error(`[newsletter] retick ${key} failed: ${tick.reason}`)
  return json({ cards: back.cards, removed: back.removed, tick })
}
