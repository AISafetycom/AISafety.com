/*
  POST /api/subscribe — the newsletter signup boxes on /events, /training and
  /funding. Body: { email, newsletter: 'events' | 'training' | 'funding', hp },
  where `hp` is the
  box's hidden honeypot field (empty for a person).

  Hands the address to the newsletter's form in ActiveCampaign
  (src/lib/newsletter-signup.ts), which emails the reader a welcome, and
  then subscribes them at once (`subscribeNow` below). No second click is
  needed since 12 November 2026: about one signup in six never pressed the
  confirmation link. The form itself is still a double opt-in form, so
  whenever the site doesn't subscribe the reader itself (a copy that isn't
  the live site, ActiveCampaign's API not answering, or a day with more
  signups than the alert line, when a bot is the likeliest cause), the
  button in that email still does it, and the answer says so
  (`confirm: true`). Bot protection (src/lib/newsletter-signup-limits.ts)
  never gets in a real person's way: no puzzles, generous limits, and every
  limit is skipped when Upstash is unavailable.

  The newsletters page (/newsletter) signs up to several at once: body
  { email, newsletters: [...], hp }. One email covers them all: the address
  goes to the form for exactly the ones picked that the reader doesn't get
  yet (a combination has a form of its own), and its email names every one
  of them.

  After a signup ActiveCampaign took, the live site also stores the new
  contact's settings key, so their first issue's "Manage subscriptions"
  link works (src/lib/newsletter-manage.ts).

  Answers { ok: true } (plus `already: true` when the address was already
  subscribed, `confirm: true` when the reader still has to press the
  button in the email, and from /newsletter `added`, the newsletters the
  email names), or { ok: false, error, reason } where `error` is a
  plain-English line for the reader and `reason` a short code for the
  dashboard and the logs. The address itself is never logged.
*/

import { NextRequest, after } from 'next/server'
import { getClientIp } from '@/lib/assistant/rate-limit'
import {
  AC_FORMS,
  COMBO_FORMS,
  formKeyFor,
  isFormConfigured,
  isSignupNewsletter,
  normalizeEmail,
  postSignup,
} from '@/lib/newsletter-signup'
import {
  ADDRESS_SENDS_PER_DAY,
  DAILY_ALERT_AFTER,
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
  subscribeUnconfirmed,
  type Contact,
} from '@/lib/newsletter-contacts'
import { NEWSLETTER_LIST, parsePicks } from '@/lib/newsletter-manage'
import type { SignupNewsletter } from '@/lib/newsletter-signup'

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

/** Whether today's signups have passed the owner's alert line: from there
 *  on a signup waits for the reader's click in the email, as every signup
 *  did before 12 November 2026. Never when Upstash can't say. */
function overAlertLine(today: { count: number } | null): boolean {
  return today !== null && today.count > DAILY_ALERT_AFTER
}

/** Anything in the honeypot: browsers never fill it (no label, no name any
 *  autofill knows, off-screen, out of the tab order), naive bots do. */
function honeypotFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false
  return typeof v === 'string' ? v.trim() !== '' : true
}

/** How long subscribing the reader may hold up the answer, and the pause
 *  before its second try (the form can take a moment to write the contact). */
const SUBSCRIBE_NOW_MS = 6000
const SUBSCRIBE_RETRY_MS = 1200

/** Subscribe the reader the form just took, so no second click is needed:
 *  each of the newsletters' lists the form left unconfirmed becomes
 *  subscribed. `subscribed` is false, and nothing is lost, whenever that
 *  didn't happen: the button in the email the form sent still does it.
 *  That is so on any copy but the live site (only it writes), when `hold`
 *  is set (more signups today than the alert line, so a bot's addresses
 *  stay off the lists), and when ActiveCampaign's API fails or takes too
 *  long. */
async function subscribeNow(
  tag: string,
  email: string,
  newsletters: SignupNewsletter[],
  hold: boolean,
  known: Contact | null = null
): Promise<{ subscribed: boolean; contact: Contact | null }> {
  if (!liveWrites() || !contactsConfigured()) {
    return { subscribed: false, contact: known }
  }
  if (hold) {
    console.warn(
      `${tag} more than ${DAILY_ALERT_AFTER} signups today, so this one waits for the reader's click in the email`
    )
    return { subscribed: false, contact: known }
  }
  const lists = newsletters.map(n => NEWSLETTER_LIST[n])
  let contact = known
  const work = (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, SUBSCRIBE_RETRY_MS))
        }
        const result = await subscribeUnconfirmed(email, lists, contact)
        contact = result.contact
        if (result.contact && result.waiting.length === 0) return true
      }
      console.warn(
        `${tag} the form's signup isn't in ActiveCampaign yet, so the reader's click in the email will subscribe them`
      )
    } catch (err) {
      console.warn(
        `${tag} couldn't subscribe the reader at once, so their click in the email will: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    return false
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const tooSlow = new Promise<false>(resolve => {
    timer = setTimeout(() => {
      console.warn(
        `${tag} subscribing the reader took over ${SUBSCRIBE_NOW_MS / 1000} seconds; answered that the email's button finishes it`
      )
      resolve(false)
    }, SUBSCRIBE_NOW_MS)
  })
  const subscribed = await Promise.race([work, tooSlow])
  clearTimeout(timer)
  return { subscribed, contact }
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
  // reader's inbox with emails.
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
  // Count the send against the address only when an email may have gone
  // out; a refusal or an outage doesn't use up a reader's tries.
  if (
    result.outcome === 'subscribed' ||
    (result.outcome === 'failed' && result.mayHaveSent)
  ) {
    await recordAddressSend(newsletter, email)
  }
  if (result.outcome === 'subscribed') {
    const now = await subscribeNow(
      `[subscribe] ${newsletter}:`,
      email,
      [newsletter],
      overAlertLine(today)
    )
    keepKey(email, now.contact)
    return now.subscribed
      ? succeed()
      : Response.json({ ok: true, confirm: true })
  }
  // Already subscribed to the list: say so, so the box doesn't promise an
  // email that isn't coming.
  if (result.outcome === 'already_subscribed') {
    return Response.json({ ok: true, already: true })
  }
  if (result.outcome === 'invalid_email') {
    return fail(400, 'invalid_email', MESSAGES.invalidEmail)
  }
  return fail(502, 'upstream', MESSAGES.wrong)
}

/** The newsletters page's signup: several newsletters, one email. The
 *  reader's lists are looked up first, so the form posted is the one for
 *  exactly the newsletters they don't get yet (one newsletter's own form, or
 *  a combination's, COMBO_FORMS): its email names them all, and when a click
 *  is needed, one click there confirms every one of its lists. */
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

  // Finding out which of them the reader already gets needs ActiveCampaign's
  // API.
  if (!contactsConfigured()) {
    console.warn(
      `${tag} ActiveCampaign's API isn't configured here; nothing sent`
    )
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
    // Signed up for every one picked, then: a form still says "already
    // subscribed" for an address confirmed on all of its lists.
    console.warn(
      `${tag} couldn't look the address up, so treating it as new: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  const todo = picks.filter(n => statuses[NEWSLETTER_LIST[n]] !== '1')
  if (todo.length === 0) {
    console.log(`${tag} already subscribed to all of them; nothing sent`)
    return Response.json({ ok: true, already: true })
  }

  const key = formKeyFor(todo)
  const form = isSignupNewsletter(key) ? AC_FORMS[key] : COMBO_FORMS[key]
  if (!isFormConfigured(form)) {
    console.warn(
      `${tag} the form for ${key} isn't filled in (COMBO_FORMS in src/lib/newsletter-signup.ts); nothing sent`
    )
    return fail(503, 'not_configured', MESSAGES.notOpen)
  }

  if (!(await addressAllowed(key, email))) {
    console.log(
      `${tag} address already sent to ${key} ${ADDRESS_SENDS_PER_DAY} times in 24 hours; answered as usual, not sent again`
    )
    return succeed()
  }

  const today = await countSignupToday()
  if (today && today.count > DAILY_CAP) {
    console.warn(
      `${tag} over ${DAILY_CAP} signups today (${today.day}); turned away until midnight UTC`
    )
    return fail(503, 'daily_cap', MESSAGES.wrong)
  }
  if (today?.alert) after(() => alertOwner(today))

  const result = await postSignup(key, form, email)
  if (
    result.outcome === 'subscribed' ||
    (result.outcome === 'failed' && result.mayHaveSent)
  ) {
    await recordAddressSend(key, email)
  }
  if (result.outcome === 'subscribed') {
    const now = await subscribeNow(
      tag,
      email,
      todo,
      overAlertLine(today),
      contact
    )
    keepKey(email, now.contact)
    // The newsletters the email names, so the page can say who it comes
    // from. It tells the visitor no more than the boxes' "already
    // subscribed" does.
    return Response.json({
      ok: true,
      added: todo,
      ...(!now.subscribed && { confirm: true }),
    })
  }
  if (result.outcome === 'already_subscribed') {
    return Response.json({ ok: true, already: true })
  }
  if (result.outcome === 'invalid_email') {
    return fail(400, 'invalid_email', MESSAGES.invalidEmail)
  }
  return fail(502, 'upstream', MESSAGES.wrong)
}
