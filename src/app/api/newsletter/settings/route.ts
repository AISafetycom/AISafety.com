/*
  POST /api/newsletter/settings — the newsletters page (/newsletter) opened
  from the "Manage subscriptions" link at the bottom of an issue.

  Body: { k, set? }. `k` is the reader's settings key from the link
  (src/lib/newsletter-manage.ts); without `set` the answer says which
  newsletters they get, with `set` ({ events?, training?, funding? }, each
  true or false) it also subscribes or unsubscribes them first. A POST, so
  the key never sits in an address, and nothing changes on a plain page
  load: mail scanners that open every link in an email can't change anyone's
  subscriptions.

  Answers { ok: true, email, subscribed } (email masked: "a•••@example.org";
  `dryRun: true` when a copy other than the live site only logged the
  changes), or { ok: false, error, reason } with a plain-English line for the
  page and a short code for the dashboard and the logs. Never logs the
  address; never emails anyone.
*/

import { NextRequest } from 'next/server'
import { getClientIp } from '@/lib/assistant/rate-limit'
import {
  acKey,
  contactsConfigured,
  liveWrites,
  readContact,
  readStatuses,
  setListStatus,
} from '@/lib/newsletter-contacts'
import {
  changesFor,
  contactOfKey,
  maskEmail,
  parseWanted,
  subscriptionsFrom,
} from '@/lib/newsletter-manage'
import { settingsAllowed } from '@/lib/newsletter-signup-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MESSAGES = {
  wrong:
    "Your newsletters couldn't be loaded just now. Please try again in a few minutes.",
  saveFailed:
    "Your changes couldn't all be saved. Please check the boxes and try again in a few minutes.",
  // The page shows the same line for a link with no key at all.
  link: "This link doesn't work anymore. To change your newsletters, use the Manage subscriptions link at the bottom of a recent email, or sign up below.",
  gone: "There's no subscription for this link anymore. You can sign up again below.",
  tooMany:
    'Too many requests from your network in the last hour. Please try again later.',
}

type Reason =
  | 'bad_request'
  | 'link_invalid'
  | 'not_found'
  | 'rate_limited'
  | 'not_configured'
  | 'upstream'

function fail(status: number, reason: Reason, error: string): Response {
  return Response.json({ ok: false, error, reason }, { status })
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail(400, 'bad_request', MESSAGES.wrong)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'bad_request', MESSAGES.wrong)
  }
  const b = body as Record<string, unknown>

  if (!contactsConfigured()) {
    console.warn(
      "[newsletter-settings] ActiveCampaign isn't configured here; nothing read"
    )
    return fail(503, 'not_configured', MESSAGES.wrong)
  }

  if (!(await settingsAllowed(getClientIp(req.headers)))) {
    console.warn('[newsletter-settings] network over its hourly limit')
    return fail(429, 'rate_limited', MESSAGES.tooMany)
  }

  const id = contactOfKey(b.k, acKey())
  if (!id) return fail(403, 'link_invalid', MESSAGES.link)

  const wanted = b.set === undefined ? {} : parseWanted(b.set)
  if (!wanted) return fail(400, 'bad_request', MESSAGES.wrong)

  let email: string
  let statuses: Record<string, string>
  try {
    const contact = await readContact(id)
    if (!contact) return fail(404, 'not_found', MESSAGES.gone)
    email = contact.email
    statuses = await readStatuses(id)
  } catch (err) {
    console.warn(
      `[newsletter-settings] contact ${id}: couldn't read it: ${err instanceof Error ? err.message : String(err)}`
    )
    return fail(502, 'upstream', MESSAGES.wrong)
  }

  const subscribed = subscriptionsFrom(statuses)
  const changes = changesFor(subscribed, wanted)
  // One at a time, stopping at the first failure: the answer then says what
  // is true now, so the page never shows a change that didn't happen.
  for (const change of changes) {
    try {
      await setListStatus(id, change.list, change.status)
      if (liveWrites()) subscribed[change.newsletter] = change.status === 1
    } catch (err) {
      console.warn(
        `[newsletter-settings] contact ${id}: couldn't ${change.status === 1 ? 'subscribe to' : 'unsubscribe from'} ${change.newsletter}: ${err instanceof Error ? err.message : String(err)}`
      )
      return Response.json(
        {
          ok: false,
          error: MESSAGES.saveFailed,
          reason: 'upstream',
          email: maskEmail(email),
          subscribed,
        },
        { status: 502 }
      )
    }
  }
  if (changes.length) {
    console.log(
      `[newsletter-settings] contact ${id}: ${changes
        .map(c => `${c.status === 1 ? '+' : '-'}${c.newsletter}`)
        .join(' ')}${liveWrites() ? '' : ' (not the live site: only logged)'}`
    )
  }

  // Outside the live site nothing was written: answer with what the reader
  // asked for, marked as a dry run, so the page can still be tried out.
  const shown = liveWrites() ? subscribed : { ...subscribed, ...wanted }
  return Response.json({
    ok: true,
    email: maskEmail(email),
    subscribed: shown,
    ...(!liveWrites() && changes.length > 0 && { dryRun: true }),
  })
}
