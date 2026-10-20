/*
  POST /api/subscribe — the newsletter signup boxes on /events and /training.
  Body: { email, newsletter: 'events' | 'training', hp }, where `hp` is the
  box's hidden honeypot field (empty for a person).

  Hands the address to the newsletter's double opt-in form in ActiveCampaign
  (src/lib/newsletter-signup.ts), which emails the reader a confirmation
  link. Bot protection (src/lib/newsletter-signup-limits.ts) never gets in a
  real person's way: no puzzles, generous limits, and every limit is skipped
  when Upstash is unavailable.

  Answers { ok: true } (plus `already: true` when the address was already
  subscribed), or { ok: false, error, reason } where `error` is a
  plain-English line for the reader and `reason` a short code for the
  dashboard and the logs. The address itself is never logged.
*/

import { NextRequest, after } from 'next/server'
import { getClientIp } from '@/lib/assistant/rate-limit'
import {
  AC_FORMS,
  isFormConfigured,
  isSignupNewsletter,
  normalizeEmail,
  postSignup,
} from '@/lib/newsletter-signup'
import {
  ADDRESS_SENDS_PER_DAY,
  DAILY_CAP,
  addressAllowed,
  alertOwner,
  countSignupToday,
  ipAllowed,
  recordAddressSend,
} from '@/lib/newsletter-signup-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Up to 8 seconds for ActiveCampaign plus a few short Upstash calls, and
// room after the answer for the owner's alert email (after()).
export const maxDuration = 30

/** The reader-facing lines. */
const MESSAGES = {
  wrong: 'Something went wrong. Please try again in a few minutes.',
  invalidEmail:
    "That email address doesn't look right. Please check it and try again.",
  unknownNewsletter: "That newsletter isn't available here.",
  notOpen:
    "Signups for this newsletter aren't open yet. Please check back soon.",
  tooMany:
    'Too many signups from your network in the last hour. Please try again later.',
}

/** Why a signup was refused, as the box records it in analytics. */
type SignupFailure =
  | 'bad_request'
  | 'unknown_newsletter'
  | 'invalid_email'
  | 'not_configured'
  | 'rate_limited'
  | 'daily_cap'
  | 'upstream'

function succeed(): Response {
  return Response.json({ ok: true })
}

function fail(status: number, reason: SignupFailure, error: string): Response {
  return Response.json({ ok: false, error, reason }, { status })
}

/** Anything in the honeypot: browsers never fill it (no label, no name any
 *  autofill knows, off-screen, out of the tab order), naive bots do. */
function honeypotFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false
  return typeof v === 'string' ? v.trim() !== '' : true
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

  // Only the newsletters that sign up through ActiveCampaign; Funding and
  // Updates stay on Substack.
  if (!isSignupNewsletter(b.newsletter)) {
    return fail(400, 'unknown_newsletter', MESSAGES.unknownNewsletter)
  }
  const newsletter = b.newsletter

  // A filled honeypot gets the normal answer, so a bot learns nothing, and
  // ActiveCampaign is never contacted.
  if (honeypotFilled(b.hp)) {
    console.log(
      `[subscribe] ${newsletter}: honeypot filled; answered as usual, nothing sent`
    )
    return succeed()
  }

  const email = normalizeEmail(b.email)
  if (!email) return fail(400, 'invalid_email', MESSAGES.invalidEmail)

  const form = AC_FORMS[newsletter]
  if (!isFormConfigured(form)) {
    console.warn(
      `[subscribe] ${newsletter}: not configured (fill in AC_FORMS in src/lib/newsletter-signup.ts); nothing sent`
    )
    return fail(503, 'not_configured', MESSAGES.notOpen)
  }

  if (!(await ipAllowed(getClientIp(req.headers)))) {
    console.warn(`[subscribe] ${newsletter}: network over its hourly limit`)
    return fail(429, 'rate_limited', MESSAGES.tooMany)
  }

  // This address already went to ActiveCampaign the most times a day allows:
  // answer as usual without sending it again, so retries never flood the
  // reader's inbox with confirmation emails.
  if (!(await addressAllowed(newsletter, email))) {
    console.log(
      `[subscribe] ${newsletter}: address already sent ${ADDRESS_SENDS_PER_DAY} times in 24 hours; answered as usual, not sent again`
    )
    return succeed()
  }

  const today = await countSignupToday()
  if (today && today.count > DAILY_CAP) {
    console.warn(
      `[subscribe] ${newsletter}: over ${DAILY_CAP} signups today (${today.day}); turned away until midnight UTC`
    )
    return fail(503, 'daily_cap', MESSAGES.wrong)
  }
  if (today?.alert) after(() => alertOwner(today))

  const result = await postSignup(newsletter, form, email)
  // Count the send against the address only when a confirmation email may
  // have gone out; a refusal or an outage doesn't use up a reader's tries.
  if (
    result.outcome === 'subscribed' ||
    (result.outcome === 'failed' && result.mayHaveSent)
  ) {
    await recordAddressSend(newsletter, email)
  }
  if (result.outcome === 'subscribed') return succeed()
  // Already confirmed on the list: say so, so the box doesn't promise an
  // email that isn't coming.
  if (result.outcome === 'already_subscribed') {
    return Response.json({ ok: true, already: true })
  }
  if (result.outcome === 'invalid_email') {
    return fail(400, 'invalid_email', MESSAGES.invalidEmail)
  }
  return fail(502, 'upstream', MESSAGES.wrong)
}
