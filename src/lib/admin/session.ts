// Tamper-evident tokens for the admin's cookies. A token is the payload as
// base64url JSON plus an HMAC-SHA256 tag under ADMIN_SESSION_SECRET, so a
// browser can hold one without being able to change what it says. Used for
// the signed-in session (which email, since when, until when) and for the
// short-lived record of an in-flight Google sign-in (state, nonce, PKCE
// verifier). Pure functions: no cookies, no env, so they test in isolation.
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Seal a JSON-serialisable payload into an opaque token. */
export function sealToken(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${tag(body, secret)}`
}

/** Open a token made by sealToken. Returns null when the token is malformed,
 *  the tag doesn't match, or the secret is empty (an unset secret must never
 *  make every token valid). Expiry is the caller's business: check `exp` on
 *  what comes back. */
export function openToken<T extends object>(
  token: string | undefined | null,
  secret: string
): T | null {
  if (!token || !secret) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const got = Buffer.from(token.slice(dot + 1))
  const want = Buffer.from(tag(body, secret))
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    )
    return parsed !== null && typeof parsed === 'object' ? (parsed as T) : null
  } catch {
    return null
  }
}

function tag(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url')
}

/** Where to send someone after they sign in. Only paths inside the admin are
 *  honoured, so a crafted link can't bounce a fresh session out to another
 *  site; anything else becomes '' and the caller picks the default. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return ''
  if (!raw.startsWith('/admin')) return ''
  if (raw.startsWith('//') || raw.includes('\\') || /[\r\n]/.test(raw))
    return ''
  return raw
}
