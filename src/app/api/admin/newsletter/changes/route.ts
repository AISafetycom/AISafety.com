/*
  GET  /api/admin/newsletter/changes?draft=ID&message=MID
       → { alerts: ListingAlert[] }
  POST /api/admin/newsletter/changes
       body { campaign, key, queue?, message? }
       → { cards, alerts, applied, cardUpdated, note }

  Listings in a waiting newsletter that changed since it was built (see
  src/lib/admin/newsletter-changes.ts): open Broom items from the Queue and
  card text that no longer matches the listing. Bryce rarely opens the
  Queue, so the approval page shows them before he sends (9 Oct 2026).

  GET is for anyone who can open Newsletters. POST fixes one listing: with
  `queue` it applies that open Broom item to the listing first – the Queue's
  own Apply, so it needs Queue editing as well as Newsletter sending – then
  rewrites the card in the draft from the listing. Without `queue` it only
  rewrites the card (Newsletter sending). Only from the admin page itself.
  409 with { problems } when the draft fails its checks, 409/4xx with
  { error } for a Queue problem (the item was decided meanwhile, say).
*/

import { NextRequest } from 'next/server'
import {
  canReviewQueue,
  canSendNewsletter,
  canViewNewsletter,
} from '@/lib/admin/auth'
import { isSameOriginRequest } from '@/lib/admin/origin'
import {
  DraftProblemError,
  isNewsletterConfigured,
} from '@/lib/admin/newsletter'
import { draftListingAlerts, fixListing } from '@/lib/admin/newsletter-changes'
import { QueueError } from '@/lib/admin/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ID_RE = /^\d+$/
const RECORD_RE = /^rec[A-Za-z0-9]{14}$/

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function failure(err: unknown, what: string): Response {
  if (err instanceof DraftProblemError)
    return json(
      { error: 'the draft failed its checks', problems: err.problems },
      409
    )
  if (err instanceof QueueError) return json({ error: err.message }, err.status)
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[newsletter] ${what} failed: ${message}`)
  return json({ error: `${what} failed; details are in the server log.` }, 502)
}

export async function GET(req: NextRequest) {
  if (!(await canViewNewsletter())) return json({ error: 'unauthorized' }, 401)
  if (!isNewsletterConfigured())
    return json({ error: 'ActiveCampaign is not configured' }, 503)
  const draft = req.nextUrl.searchParams.get('draft') ?? ''
  const message = req.nextUrl.searchParams.get('message') ?? undefined
  if (!ID_RE.test(draft) || (message !== undefined && !ID_RE.test(message)))
    return json({ error: 'draft (and message) must be ids' }, 400)
  try {
    return json({ alerts: await draftListingAlerts(draft, message) })
  } catch (err) {
    return failure(err, 'Checking the listings')
  }
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req))
    return json({ error: 'cross-site request refused' }, 403)
  if (!(await canSendNewsletter())) return json({ error: 'unauthorized' }, 401)
  if (!isNewsletterConfigured())
    return json({ error: 'ActiveCampaign is not configured' }, 503)
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object')
      body = parsed as Record<string, unknown>
  } catch {
    return json({ error: 'body must be JSON' }, 400)
  }
  const campaign = String(body.campaign ?? '')
  const key = String(body.key ?? '')
  const queue = body.queue == null ? null : String(body.queue)
  const message = body.message == null ? undefined : String(body.message)
  if (
    !ID_RE.test(campaign) ||
    !RECORD_RE.test(key) ||
    (queue !== null && !RECORD_RE.test(queue)) ||
    (message !== undefined && !ID_RE.test(message))
  )
    return json(
      {
        error:
          'body must be { campaign: id, key: rec…, queue?: rec…, message?: id }',
      },
      400
    )
  // Applying a Broom item is a Queue decision.
  if (queue && !(await canReviewQueue()))
    return json({ error: 'Fixing a listing needs Queue access.' }, 401)
  try {
    const result = await fixListing(campaign, key, queue, message)
    console.info(
      `[newsletter] draft ${campaign} listing ${key}: ${
        result.applied ? `Broom item ${queue} applied, ` : ''
      }card ${result.cardUpdated ? 'updated' : 'unchanged'}`
    )
    return json(result)
  } catch (err) {
    return failure(err, 'Fixing the listing')
  }
}
