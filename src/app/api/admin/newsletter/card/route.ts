/*
  POST /api/admin/newsletter/card
       body { campaign, group, key, message?, fields?: { name: text },
              fit?: text, listing?: text }

  Edits text on one card inside a pipeline draft in ActiveCampaign: any of
  its fields (`title`, `m0`… lines under the title, `desc`, `b0`… rows at the
  bottom — plain text, not empty) and, on funding cards, the "Consider
  applying if" line (`fit`; empty removes it). Rebuilds the plain-text
  version and re-stamps the content marker so the draft still verifies.
  The page saves by itself as Bryce types (25 Sept 2026), one card at a
  time. `listing` writes that text to the listing's Description in Airtable
  instead — his "Use this description on the site too" button, a separate
  call so typing never touches the site. `message` (the id the page listed)
  lets the draft's message be read alongside the checks: one round trip
  less on every save.
  Approvers only (canSendNewsletter) — it edits the email but sends nothing,
  so no fresh-session requirement.
  → { cards } for a text edit, { listing: { ok, table } | { ok: false,
    reason } } for a listing update
    409 with { problems } when the draft fails verification (or sits on a
    real list, 6/7/8, and this isn't production), 400 for a bad card, field
    or body, 403 when not posted from the admin page itself.
*/

import { NextRequest } from 'next/server'
import { canSendNewsletter } from '@/lib/admin/auth'
import { isSameOriginRequest } from '@/lib/admin/origin'
import {
  DraftProblemError,
  editDraftCard,
  FieldError,
  FitError,
  isNewsletterConfigured,
} from '@/lib/admin/newsletter'
import { updateListingDescription } from '@/lib/admin/newsletter-listing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Longer than any text on a card; a guard, not a house style. */
const MAX_LENGTH = 2000
const FIELD_NAME_RE = /^(title|desc|[mb]\d{1,2})$/

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
  const { campaign, group, key, fields, fit, listing, message } = (body ??
    {}) as Record<string, unknown>
  const campaignId = String(campaign ?? '')
  const values: Record<string, string> = {}
  let fieldsOk = fields === undefined
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    fieldsOk = Object.entries(fields).every(
      ([name, value]) =>
        FIELD_NAME_RE.test(name) &&
        typeof value === 'string' &&
        value.length <= MAX_LENGTH
    )
    if (fieldsOk) Object.assign(values, fields)
  }
  const valid =
    /^\d+$/.test(campaignId) &&
    typeof group === 'string' &&
    /^g\d+$/.test(group) &&
    typeof key === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(key) &&
    fieldsOk &&
    (fit === undefined ||
      (typeof fit === 'string' && fit.length <= MAX_LENGTH)) &&
    (message === undefined ||
      (typeof message === 'string' && /^\d+$/.test(message))) &&
    (listing === undefined ||
      (typeof listing === 'string' &&
        listing.trim() !== '' &&
        listing.length <= MAX_LENGTH))
  if (!valid) {
    return json(
      {
        error:
          'body must be { campaign: id, group: gN, key, fields?: { name: text }, fit?: text } or { campaign, group, key, listing: text }',
      },
      400
    )
  }
  if (typeof listing === 'string') {
    const result = await updateListingDescription(
      key as string,
      listing.replace(/\s+/g, ' ').trim()
    )
    if (!result.ok)
      console.error(
        `[newsletter] listing update ${key} failed: ${result.reason}`
      )
    return json({ listing: result })
  }
  try {
    const result = await editDraftCard(
      campaignId,
      group as string,
      key as string,
      values,
      fit as string | undefined,
      message as string | undefined
    )
    return json(result)
  } catch (err) {
    if (err instanceof DraftProblemError) {
      return json(
        { error: 'the draft failed its checks', problems: err.problems },
        409
      )
    }
    if (err instanceof FieldError || err instanceof FitError) {
      return json({ error: err.detail }, 400)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter] card edit ${campaignId} failed: ${message}`)
    return json(
      { error: 'Saving the text failed; details are in the server log.' },
      502
    )
  }
}
