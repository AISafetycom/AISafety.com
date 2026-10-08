/*
  Bot protection for the newsletter signup boxes (/api/subscribe), kept in
  Upstash, the database the analytics and the chatbot's rate limit use. Every
  limit here is generous on purpose: the owner's rule is that it must never
  get in a real person's way, so

  - per network (IP): 30 signups an hour, since a room of people at a talk
    can share one connection;
  - per address and newsletter: at most 3 sends to ActiveCampaign in 24
    hours, counting only sends that may have mailed a confirmation, so
    retries never flood someone's inbox and an ActiveCampaign outage never
    uses up a real reader's tries; past that the route answers as usual
    without sending again;
  - per UTC day, across both newsletters: the owner gets one email once 100
    signups have gone through, and above 500 the boxes turn signups away
    until midnight UTC (a flood of unconfirmed contacts would otherwise eat
    into the account's contact limit).

  If Upstash isn't configured or doesn't answer, every limit is skipped (one
  log line, not one per request): a broken check must never block a person.
  All environments share the one database, so these counts are shared too,
  just as the ActiveCampaign forms are.
*/

import { createHash } from 'node:crypto'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import {
  mailConfigured,
  sendAdminMail,
  signupAlertMail,
} from '@/lib/admin/mail'
import { ROOT_ADMINS } from '@/lib/admin/users'
import type { SignupNewsletter } from '@/lib/newsletter-signup'

export const IP_SIGNUPS_PER_HOUR = 30
export const ADDRESS_SENDS_PER_DAY = 3
export const DAILY_ALERT_AFTER = 100
export const DAILY_CAP = 500

/** How long an Upstash call may take before the limit is skipped. */
const STORE_TIMEOUT_MS = 1500
const PREFIX = 'aisafety:newsletter:signup'
/** Day counters and alert marks outlive their UTC day by a day. */
const DAY_KEY_TTL_SECONDS = 2 * 24 * 60 * 60

// Same env fallbacks as lib/assistant/rate-limit.ts (Vercel-Upstash naming
// first, upstream Upstash naming second).
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const redis =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

// `timeout: 0` turns off the library's own let-through timer: `guarded`
// below times every call the same way and logs the failure.
const ipLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(IP_SIGNUPS_PER_HOUR, '1 h'),
      analytics: false,
      prefix: `${PREFIX}:ip`,
      timeout: 0,
    })
  : null

const addressLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(ADDRESS_SENDS_PER_DAY, '1 d'),
      analytics: false,
      prefix: `${PREFIX}:address`,
      timeout: 0,
    })
  : null

// ─── Failing open, logged once ──────────────────────────────────────────────

let notConfiguredLogged = false
let outageLogged = false

/** True when the limits can run; logs once (per server instance) when they
 *  can't because Upstash isn't configured. */
function storeReady(): boolean {
  if (redis) return true
  if (!notConfiguredLogged) {
    notConfiguredLogged = true
    console.warn(
      "[subscribe] Upstash isn't configured, so the signup limits are off"
    )
  }
  return false
}

/** Run one Upstash call with a time limit. On an error or a timeout, logs
 *  the first failure of an outage (not every request) and returns null so
 *  the caller skips its limit. */
async function guarded<T>(
  what: string,
  run: () => Promise<T>
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no answer within ${STORE_TIMEOUT_MS} ms`)),
        STORE_TIMEOUT_MS
      )
    })
    const value = await Promise.race([run(), timeout])
    outageLogged = false
    return value
  } catch (err) {
    if (!outageLogged) {
      outageLogged = true
      console.warn(
        `[subscribe] Upstash ${what} failed, so the signup limits are skipped until it answers again: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Per network ────────────────────────────────────────────────────────────

/** Whether this IP may sign up again now. Takes one of its hourly signups. */
export async function ipAllowed(ip: string): Promise<boolean> {
  if (!storeReady() || !ipLimiter) return true
  const result = await guarded('IP limit', () => ipLimiter.limit(ip))
  return result ? result.success : true
}

// ─── Per address ────────────────────────────────────────────────────────────

/** The address as its limit key: newsletter plus a hash of the lowercased
 *  address, so the database never holds the address itself. */
export function addressKey(
  newsletter: SignupNewsletter,
  email: string
): string {
  const hash = createHash('sha256').update(email.toLowerCase()).digest('hex')
  return `${newsletter}:${hash.slice(0, 32)}`
}

/** Whether this address may be sent to ActiveCampaign again for this
 *  newsletter. Only looks; `recordAddressSend` counts a send. */
export async function addressAllowed(
  newsletter: SignupNewsletter,
  email: string
): Promise<boolean> {
  if (!storeReady() || !addressLimiter) return true
  const left = await guarded('address limit', () =>
    addressLimiter.getRemaining(addressKey(newsletter, email))
  )
  return left ? left.remaining > 0 : true
}

/** Count a send that may have mailed this address a confirmation. */
export async function recordAddressSend(
  newsletter: SignupNewsletter,
  email: string
): Promise<void> {
  if (!storeReady() || !addressLimiter) return
  await guarded('address limit', () =>
    addressLimiter.limit(addressKey(newsletter, email))
  )
}

// ─── Per day ────────────────────────────────────────────────────────────────

export interface SignupDay {
  /** 'YYYY-MM-DD', UTC. */
  day: string
  /** Signups sent on to ActiveCampaign today, this one included. */
  count: number
  /** True for exactly one signup a day once `count` passes the alert line,
   *  and only where the admin mail can go out: email the owner. */
  alert: boolean
}

/** Count one more signup for today (UTC). Null when Upstash can't say, in
 *  which case neither the alert nor the cap applies. */
export async function countSignupToday(
  now = new Date()
): Promise<SignupDay | null> {
  if (!storeReady() || !redis) return null
  const day = now.toISOString().slice(0, 10)
  const counted = await guarded('day count', () =>
    redis
      .pipeline()
      .incr(`${PREFIX}:day:${day}`)
      .expire(`${PREFIX}:day:${day}`, DAY_KEY_TTL_SECONDS)
      .exec<[number, number]>()
  )
  if (!counted) return null
  const count = Number(counted[0])
  if (!Number.isFinite(count)) return null
  let alert = false
  // Claimed only where the mail can actually be sent, so a preview or a
  // laptop without the mail settings never uses up the day's one alert.
  if (count > DAILY_ALERT_AFTER && mailConfigured()) {
    const claimed = await guarded('day alert', () =>
      redis.set(`${PREFIX}:alerted:${day}`, '1', {
        nx: true,
        ex: DAY_KEY_TTL_SECONDS,
      })
    )
    alert = claimed === 'OK'
  }
  return { day, count, alert }
}

/** Email the owner that today's signups passed the alert line. Best effort:
 *  sendAdminMail logs a failure and never throws. */
export async function alertOwner(day: SignupDay): Promise<void> {
  const mail = signupAlertMail({
    day: day.day,
    alertAfter: DAILY_ALERT_AFTER,
    cap: DAILY_CAP,
    analyticsUrl: 'https://aisafety.com/admin/analytics?tab=newsletters',
  })
  for (const owner of ROOT_ADMINS) {
    // "digest" mail can only ever reach the owner's own address; the mail
    // script enforces it.
    await sendAdminMail('digest', owner.email, mail)
  }
}
