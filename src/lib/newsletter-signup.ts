/*
  Newsletter signups through ActiveCampaign: the signup boxes on /events and
  /training post to /api/subscribe, which hands the address to the list's
  double opt-in form. ActiveCampaign then emails the reader a confirmation
  link, and only a confirmed reader joins the list.

  This module is the transport: which form each newsletter uses, how the
  address is checked, and the one request to ActiveCampaign's form endpoint
  (proc.php, the same endpoint its hosted form pages post to). The route
  (src/app/api/subscribe/route.ts) decides whether to send at all; if the
  live endpoint ever refuses server-side posts, swap `postSignup` here and
  nothing else changes. Pure: no Next, no Upstash.

  /funding's box still opens Substack (the Funding newsletter moves later)
  and never comes through here.
*/

/** The newsletters whose boxes sign people up on the site. */
export const SIGNUP_NEWSLETTERS = ['events', 'training'] as const
export type SignupNewsletter = (typeof SIGNUP_NEWSLETTERS)[number]

export function isSignupNewsletter(v: unknown): v is SignupNewsletter {
  return (SIGNUP_NEWSLETTERS as readonly unknown[]).includes(v)
}

export interface AcForm {
  /** The form's number: the `f` hidden input on its hosted page. */
  formId: number
  /** The `or` hidden input on its hosted page (a UUID). */
  orKey: string
  /** The `u` hidden input, only if it isn't the same number as `f`. */
  u?: number
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE TWO ACTIVECAMPAIGN FORMS (made 8 October 2026).
//
//  One double opt-in form per list, made in ActiveCampaign (Website → Forms).
//  Open the form's hosted page, https://alignment23684.activehosted.com/f/<id>,
//  view its source and copy from its hidden inputs:
//    formId  the number in  <input type="hidden" name="f" value="…">
//    orKey   the text in    <input type="hidden" name="or" value="…">
//  `u` normally carries the same number as `f`; add `u: <number>` only if
//  this form's differs. The values are public (every hosted form page shows
//  them), not secrets. While a newsletter's form is left at 0 / '',
//  /api/subscribe answers 503 for it and never contacts ActiveCampaign.
// ═══════════════════════════════════════════════════════════════════════════
export const AC_FORMS: Record<SignupNewsletter, AcForm> = {
  // AI Safety Events (list 6): form 4, "AI Safety Events signup (aisafety.com)".
  events: { formId: 4, orKey: '6a982046-09ff-443b-9e8a-2f5d5dde2ae6' },
  // AI Safety Training (list 7): form 6, "AI Safety Training signup (aisafety.com)".
  training: { formId: 6, orKey: 'baffe016-955b-42bc-be9e-711a2d0d44bf' },
}

/** The account's form endpoint. `jsonp=true` asks for the short JavaScript
 *  answer the embedded forms get instead of a redirect to a thank-you page.
 *  It goes in the address as well as the body, so it counts whichever of the
 *  two the endpoint reads. */
export const AC_PROC_URL =
  'https://alignment23684.activehosted.com/proc.php?jsonp=true'

/** Say who is asking; never pretend to be a browser. */
export const SIGNUP_USER_AGENT =
  'AISafety.com newsletter signup (+https://aisafety.com)'

/** How long ActiveCampaign gets to answer. */
export const AC_TIMEOUT_MS = 8000

export function isFormConfigured(form: AcForm): boolean {
  return (
    Number.isInteger(form.formId) &&
    form.formId > 0 &&
    form.orKey.trim() !== '' &&
    (form.u === undefined || (Number.isInteger(form.u) && form.u > 0))
  )
}

// ─── The address ────────────────────────────────────────────────────────────

/** Characters a copy and paste can carry along without anyone seeing them. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g
/** The usual unquoted local part: letters, digits, and the RFC 5322 symbols,
 *  dots only between them. */
const LOCAL_PART =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
/** Dot-separated labels of letters, digits, and inner hyphens, ending in a
 *  top-level domain of two or more characters that starts with a letter. */
const DOMAIN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/

/** The address to sign up, or null when it can't be one: trimmed (and rid of
 *  invisible characters), at most 254 characters, one @, a sane local part
 *  and domain. The domain is lowercased; the local part is kept as typed. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.replace(INVISIBLE, '').trim()
  if (s.length === 0 || s.length > 254) return null
  const at = s.indexOf('@')
  if (at < 1 || at !== s.lastIndexOf('@')) return null
  const local = s.slice(0, at)
  const domain = s.slice(at + 1).toLowerCase()
  if (local.length > 64 || !LOCAL_PART.test(local) || !DOMAIN.test(domain)) {
    return null
  }
  return `${local}@${domain}`
}

// ─── ActiveCampaign's answer ────────────────────────────────────────────────

/** What ActiveCampaign's answer means.
 *  - subscribed: a clear thank-you; the confirmation email is on its way.
 *  - rejected:   it answered with an error message (`message`, possibly
 *                quoting the address: never log it unredacted).
 *  - blocked:    turned away before the form saw it (HTTP 4xx, or a
 *                Cloudflare check page), so nothing was sent.
 *  - unknown:    anything else; it may or may not have been processed. */
export type AcAnswer =
  | { kind: 'subscribed' }
  | { kind: 'rejected'; message: string; invalidEmail: boolean }
  | { kind: 'blocked' }
  | { kind: 'unknown' }

/** A string or number literal, as ActiveCampaign writes the form id. */
const LITERAL_ARG = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d+)`
/** A call with a literal first argument, so the definition of the function in
 *  a page's own script (`function _show_thank_you(id, …)`) never counts. */
const THANK_YOU_CALL = new RegExp(
  String.raw`(?:^|[^\w$])_show_thank_you\s*\(\s*${LITERAL_ARG}\s*,`
)
const ERROR_CALL = new RegExp(
  String.raw`(?:^|[^\w$])_show_error\s*\(\s*${LITERAL_ARG}\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`
)
const HTML_PAGE = /<(?:!doctype|html|head|body)\b/i
const CLOUDFLARE =
  /cf-chl|challenge-platform|cf_chl_opt|cdn-cgi\/challenge|Just a moment\.\.\.|Attention Required! \| Cloudflare/i

/** The text of a JavaScript string literal from the answer. */
function decodeLiteral(literal: string): string {
  if (literal.startsWith('"')) {
    try {
      return JSON.parse(literal) as string
    } catch {
      // Not valid JSON (an escape JavaScript allows but JSON doesn't); the
      // raw inside is still readable enough to classify and log.
    }
  }
  return literal.slice(1, -1).replace(/\\(.)/g, '$1')
}

/** Read ActiveCampaign's answer to a signup. Only a clear thank-you (HTTP
 *  2xx, a JavaScript answer rather than a page, a `_show_thank_you(…)` call
 *  and no `_show_error(…)`) counts as subscribed. */
export function readAcAnswer(status: number, text: string): AcAnswer {
  const ok = status >= 200 && status < 300
  const page = HTML_PAGE.test(text)
  if (CLOUDFLARE.test(text)) return { kind: 'blocked' }
  if (ok && !page) {
    const error = ERROR_CALL.exec(text)
    if (error) {
      const message = decodeLiteral(error[1])
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return {
        kind: 'rejected',
        message,
        // ActiveCampaign's wording for a bad address mentions the email
        // ("Please enter a valid email address."); any other error (a
        // captcha, a closed form, an address already on the list) isn't
        // the reader's typing to fix.
        invalidEmail:
          /e-?mail/i.test(message) && !/already|subscribed/i.test(message),
      }
    }
    if (THANK_YOU_CALL.test(text)) return { kind: 'subscribed' }
  }
  if (status >= 400 && status < 500) return { kind: 'blocked' }
  return { kind: 'unknown' }
}

// ─── Logging without the address ────────────────────────────────────────────

const ANY_ADDRESS = /[A-Za-z0-9._%+'-]+(?:@|%40|\\u0040)[A-Za-z0-9.-]+/gi

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `text` with the address, and anything else that looks like one (plain or
 *  URL-encoded), replaced by [email]. ActiveCampaign's thank-you quotes the
 *  address it subscribed, and its tracking link carries it encoded. */
export function redactEmails(text: string, email: string): string {
  let out = text
  for (const form of new Set([email, encodeURIComponent(email)])) {
    out = out.replace(new RegExp(escapeRegExp(form), 'gi'), '[email]')
  }
  return out.replace(ANY_ADDRESS, '[email]')
}

/** The start of an answer for the log: the address redacted, on one line. */
export function logSnippet(text: string, email: string, max = 200): string {
  const line = redactEmails(text.slice(0, 4000), email)
    .replace(/\s+/g, ' ')
    .trim()
  return line.length > max ? `${line.slice(0, max)} [cut]` : line
}

// ─── The request ────────────────────────────────────────────────────────────

/** How one signup went.
 *  - subscribed:    ActiveCampaign took it; the confirmation email is sent.
 *  - invalid_email: ActiveCampaign said the address isn't valid.
 *  - failed:        anything else. `mayHaveSent` is true when the request
 *                   could still have reached the form (a timeout, an unclear
 *                   answer), so a confirmation email may be on its way. */
export type SignupResult =
  | { outcome: 'subscribed' }
  | { outcome: 'invalid_email' }
  | { outcome: 'failed'; mayHaveSent: boolean }

/** The form fields ActiveCampaign's hosted form posts, for one address. */
export function signupFields(form: AcForm, email: string): URLSearchParams {
  return new URLSearchParams({
    u: String(form.u ?? form.formId),
    f: String(form.formId),
    s: '',
    c: '0',
    m: '0',
    act: 'sub',
    v: '2',
    or: form.orKey,
    email,
    jsonp: 'true',
  })
}

/** Sign one address up through the newsletter's form. Logs what happened
 *  (the HTTP status and the start of the answer), never the address. */
export async function postSignup(
  newsletter: SignupNewsletter,
  form: AcForm,
  email: string,
  {
    fetchImpl = fetch,
    timeoutMs = AC_TIMEOUT_MS,
  }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<SignupResult> {
  const tag = `[subscribe] ${newsletter}:`
  let status: number
  let text: string
  try {
    const res = await fetchImpl(AC_PROC_URL, {
      method: 'POST',
      headers: {
        'User-Agent': SIGNUP_USER_AGENT,
        Accept: 'text/javascript, application/javascript, */*;q=0.1',
      },
      body: signupFields(form, email),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    status = res.status
    text = await res.text()
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      console.warn(
        `${tag} ActiveCampaign didn't answer within ${timeoutMs / 1000} seconds`
      )
      return { outcome: 'failed', mayHaveSent: true }
    }
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? ` (${(err.cause as Error & { code?: string }).code ?? err.cause.message})`
        : ''
    console.warn(
      `${tag} couldn't reach ActiveCampaign: ${err instanceof Error ? err.message : String(err)}${cause}`
    )
    return { outcome: 'failed', mayHaveSent: false }
  }

  const answer = readAcAnswer(status, text)
  switch (answer.kind) {
    case 'subscribed':
      console.log(`${tag} ActiveCampaign took the signup (HTTP ${status})`)
      return { outcome: 'subscribed' }
    case 'rejected':
      console.warn(
        `${tag} ActiveCampaign refused the signup (HTTP ${status}): "${logSnippet(answer.message, email)}"`
      )
      return answer.invalidEmail
        ? { outcome: 'invalid_email' }
        : { outcome: 'failed', mayHaveSent: false }
    case 'blocked':
      console.warn(
        `${tag} ActiveCampaign turned the request away (HTTP ${status}): ${logSnippet(text, email)}`
      )
      return { outcome: 'failed', mayHaveSent: false }
    case 'unknown':
      console.warn(
        `${tag} unclear answer from ActiveCampaign (HTTP ${status}): ${logSnippet(text, email)}`
      )
      return { outcome: 'failed', mayHaveSent: true }
  }
}
