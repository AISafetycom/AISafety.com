import { NextRequest, after } from 'next/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { getClientIp } from '@/lib/assistant/rate-limit'
import { sendAdminMail } from '@/lib/admin/mail'
import { ROOT_ADMINS } from '@/lib/admin/users'
import {
  airtableFields,
  ownerMail,
  parseSubmission,
  type Submission,
} from '@/lib/site-feedback'

// The site's own correction and feedback form (FeedbackPopover) posts here.
// A submission becomes a row in the same Airtable table the Airtable forms
// filled (Site corrections or Site feedback), so the Queue picks corrections
// up as before. Airtable only emails the owner about its own forms, so this
// route emails them each new row itself.
//
// Same guards as the hackathon form: a hidden honeypot field and a per-IP
// limit. No CAPTCHA.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AIRTABLE_ORIGIN = 'https://api.airtable.com'

// Same env fallbacks as lib/assistant/rate-limit.ts (Vercel-Upstash naming
// first, upstream Upstash naming second).
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const redis =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

// A person sends one or two; a script sending more fills the table.
const limiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '1 h'),
      analytics: false,
      prefix: 'aisafety:site-feedback',
    })
  : null

// The owner's email goes through the admin mail script, whose Gmail quota
// (about 100 a day) the admin's other mail shares. Past this many in a UTC
// day the rows are still saved, just not emailed.
const DAILY_MAIL_CAP = 40

/** Rows saved from a dev server would reach the real tables (and the Queue).
 *  Off the live site they are only logged, unless SITE_FEEDBACK_WRITE=1. */
function writesEnabled(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' ||
    process.env.SITE_FEEDBACK_WRITE === '1'
  )
}

async function underMailCap(): Promise<boolean> {
  if (!redis) return true
  try {
    const key = `aisafety:site-feedback:mail:${new Date().toISOString().slice(0, 10)}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 2 * 24 * 60 * 60)
    return count <= DAILY_MAIL_CAP
  } catch (err) {
    // Redis down: send anyway; the per-IP limit above still holds.
    console.warn(
      `[site-feedback] mail cap check failed – sending anyway: ${err instanceof Error ? err.message : String(err)}`
    )
    return true
  }
}

async function emailOwner(s: Submission, recordUrl: string): Promise<void> {
  if (!(await underMailCap())) {
    console.warn(
      `[site-feedback] over ${DAILY_MAIL_CAP} emails today; saved ${recordUrl} without emailing`
    )
    return
  }
  const mail = ownerMail(s, recordUrl)
  for (const owner of ROOT_ADMINS) {
    // "digest" mail can only ever reach the owner's own address; the mail
    // script enforces it. sendAdminMail logs a failure and never throws.
    await sendAdminMail('digest', owner.email, mail)
  }
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('invalid JSON', { status: 400 })
  }

  // Honeypot filled in → almost certainly a bot. Pretend success so it
  // doesn't learn to adapt; nothing is stored or emailed.
  if (
    body &&
    typeof body === 'object' &&
    typeof (body as Record<string, unknown>).website === 'string' &&
    ((body as Record<string, unknown>).website as string).trim()
  ) {
    return new Response(null, { status: 204 })
  }

  const parsed = parseSubmission(body)
  if (!parsed.ok) {
    return new Response(parsed.error, { status: 400 })
  }
  const submission = parsed.submission

  if (limiter) {
    try {
      const { success } = await limiter.limit(getClientIp(req.headers))
      if (!success) return new Response('rate limited', { status: 429 })
    } catch (err) {
      // Redis unreachable or over quota. Fail open – a broken rate check
      // must not block a real correction.
      console.warn(
        `[site-feedback] rate-limit check failed – allowing request: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const { table, fields } = airtableFields(submission)

  if (!writesEnabled()) {
    console.log(
      `[site-feedback] not the live site; would save to ${table}:`,
      fields
    )
    return new Response(null, { status: 204 })
  }

  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  if (!token || !baseId) {
    console.error('[site-feedback] AIRTABLE_TOKEN / AIRTABLE_BASE_ID not set')
    return new Response('not configured', { status: 500 })
  }

  // Await the write: the visitor needs to know it was saved before the form
  // says thanks.
  let recordId: string
  try {
    const res = await fetch(`${AIRTABLE_ORIGIN}/v0/${baseId}/${table}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error(
        `[site-feedback] Airtable refused the row: ${res.status} ${await res.text()}`
      )
      return new Response('save failed', { status: 502 })
    }
    recordId = ((await res.json()) as { id: string }).id
  } catch (err) {
    console.error('[site-feedback] Airtable call failed:', err)
    return new Response('save failed', { status: 502 })
  }

  const recordUrl = `https://airtable.com/${baseId}/${table}/${recordId}`
  // The email isn't something the visitor waits for.
  after(() => emailOwner(submission, recordUrl))

  return new Response(null, { status: 204 })
}
