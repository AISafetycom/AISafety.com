/*
  POST /api/subscribe — the newsletter signup boxes on /events, /training and
  /funding. Body: { email, newsletter: 'events' | 'training' | 'funding', hp },
  where `hp` is the
  box's hidden honeypot field (empty for a person).

  Hands the address to the newsletter's double opt-in form in ActiveCampaign
  (src/lib/newsletter-signup.ts), which emails the reader a confirmation
  link. Bot protection (src/lib/newsletter-signup-limits.ts) never gets in a
  real person's way: no puzzles, generous limits, and every limit is skipped
  when Upstash is unavailable.

  The newsletters page (/newsletter) signs up to several at once: body
  { email, newsletters: [...], hp }. One confirmation email covers them all:
  only the first one picked that the reader doesn't get yet goes to its
  form, and the rest are kept until that one is confirmed
  (src/lib/newsletter-pending.ts).

  After a signup ActiveCampaign took, the live site also stores the new
  contact's settings key, so their first issue's "Manage subscriptions"
  link works (src/lib/newsletter-manage.ts).

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
  type SignupNewsletter,
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
import {
  contactsConfigured,
  findContact,
  liveWrites,
  readStatuses,
  storeManageKey,
  type Contact,
} from '@/lib/newsletter-contacts'
import { NEWSLETTER_LIST, parsePicks } from '@/lib/newsletter-manage'
import { savePending } from '@/lib/newsletter-pending'

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

/** After the answer, on the live site: store the settings key of the
 *  contact ActiveCampaign just made (or already had) for this address. */
function keepKey(email: string, known: Contact | null = null): void {
  if (!liveWrites() || !contactsConfigured()) return
  after(async () => {
    try {
      const contact = known ?? (await findContact(email))
      if (!contact) throw new Error("the contact isn't in ActiveCampaign yet")
      await storeManageKey(contact.id)
    } catch (err) {
      // ~/Newsletter/manage_keys.py fills in any key still missing before
      // the next issue is built.
      console.warn(
        `[subscribe] couldn't store the new contact's settings key: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  })
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

  if (b.newsletters !== undefined) return signUpToSeveral(req, b)

  // Only the newsletters that sign up through ActiveCampaign; Updates stays
  // on Substack.
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
  if (result.outcome === 'subscribed') {
    keepKey(email)
    return succeed()
  }
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

/** The newsletters page's signup: several newsletters, one confirmation. */
async function signUpToSeveral(
  req: NextRequest,
  b: Record<string, unknown>
): Promise<Response> {
  const picks = parsePicks(b.newsletters)
  if (!picks) return fail(400, 'unknown_newsletter', MESSAGES.unknownNewsletter)
  const tag = `[subscribe] ${picks.join('+')}:`

  if (honeypotFilled(b.hp)) {
    console.log(`${tag} honeypot filled; answered as usual, nothing sent`)
    return succeed()
  }

  const email = normalizeEmail(b.email)
  if (!email) return fail(400, 'invalid_email', MESSAGES.invalidEmail)

  // Finding out which of them the reader already gets, and keeping the
  // rest, both need ActiveCampaign's API.
  if (
    picks.some(n => !isFormConfigured(AC_FORMS[n])) ||
    !contactsConfigured()
  ) {
    console.warn(`${tag} not configured here; nothing sent`)
    return fail(503, 'not_configured', MESSAGES.notOpen)
  }

  if (!(await ipAllowed(getClientIp(req.headers)))) {
    console.warn(`${tag} network over its hourly limit`)
    return fail(429, 'rate_limited', MESSAGES.tooMany)
  }

  let contact: Contact | null = null
  let statuses: Record<string, string> = {}
  try {
    contact = await findContact(email)
    if (contact) statuses = await readStatuses(contact.id)
  } catch (err) {
    // The forms still say "already subscribed" for a list the reader is on.
    console.warn(
      `${tag} couldn't look the address up, so treating it as new: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  const todo = picks.filter(n => statuses[NEWSLETTER_LIST[n]] !== '1')
  if (todo.length === 0) {
    console.log(`${tag} already subscribed to all of them; nothing sent`)
    return Response.json({ ok: true, already: true })
  }

  const today = await countSignupToday()
  if (today && today.count > DAILY_CAP) {
    console.warn(
      `${tag} over ${DAILY_CAP} signups today (${today.day}); turned away until midnight UTC`
    )
    return fail(503, 'daily_cap', MESSAGES.wrong)
  }
  if (today?.alert) after(() => alertOwner(today))

  // The first newsletter ActiveCampaign takes sends the one confirmation.
  for (let i = 0; i < todo.length; i++) {
    const first = todo[i]
    if (!(await addressAllowed(first, email))) {
      console.log(
        `${tag} address already sent ${ADDRESS_SENDS_PER_DAY} times in 24 hours; answered as usual, not sent again`
      )
      return succeed()
    }
    const result = await postSignup(first, AC_FORMS[first], email)
    if (
      result.outcome === 'subscribed' ||
      (result.outcome === 'failed' && result.mayHaveSent)
    ) {
      await recordAddressSend(first, email)
    }
    // The lookup missed it (or couldn't run): on to the next one.
    if (result.outcome === 'already_subscribed') continue
    if (result.outcome === 'invalid_email') {
      return fail(400, 'invalid_email', MESSAGES.invalidEmail)
    }
    if (result.outcome === 'failed')
      return fail(502, 'upstream', MESSAGES.wrong)

    const rest = todo.slice(i + 1)
    if (rest.length) await keepRest(tag, contact, email, first, rest)
    keepKey(email, contact)
    // Which newsletter the confirmation email comes from, so the page can
    // say what to look for. It tells the visitor no more than the boxes'
    // "already subscribed" does.
    return Response.json({ ok: true, confirm: first })
  }
  return Response.json({ ok: true, already: true })
}

/** Keep the rest of a signup until its first newsletter is confirmed. */
async function keepRest(
  tag: string,
  known: Contact | null,
  email: string,
  first: SignupNewsletter,
  rest: SignupNewsletter[]
): Promise<void> {
  try {
    // A new reader's contact exists once the form has taken the signup.
    const contact = known ?? (await findContact(email))
    if (!contact) throw new Error("the new contact isn't in ActiveCampaign yet")
    await savePending(
      contact.id,
      NEWSLETTER_LIST[first],
      rest.map(n => NEWSLETTER_LIST[n])
    )
    console.log(
      `${tag} ${first}'s confirmation sent; ${rest.join(', ')} kept until it's confirmed`
    )
  } catch (err) {
    // The reader still gets the first one; the rest are lost, so say so
    // loudly enough to find in the log.
    console.error(
      `${tag} ${first}'s confirmation sent, but ${rest.join(', ')} couldn't be kept: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
