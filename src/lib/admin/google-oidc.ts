// Google sign-in for the admin: the OpenID Connect authorization-code flow
// with PKCE, done by hand against Google's documented endpoints. There is no
// auth library because the whole exchange is two requests and one signature
// check, and keeping every step in view is worth more than the dependency.
//
// Flow: /api/admin/auth/google builds the Google URL (buildAuthUrl) and
// remembers state/nonce/verifier in a sealed cookie; Google sends the browser
// back to /api/admin/auth/google/callback with a code; that route swaps the
// code for an ID token (exchangeCode), checks the token's signature and claims
// against Google's published keys (verifyIdToken), and only then looks the
// email up in the admin list.
import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
  type JsonWebKey,
} from 'node:crypto'

export const GOOGLE_AUTH_ENDPOINT =
  'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
])
/** Tolerance for clock drift between us and Google when checking exp/iat. */
const CLOCK_SKEW_SECONDS = 60

/** Unguessable URL-safe string for state, nonce and PKCE verifiers. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** PKCE S256: the challenge Google stores alongside the code, which only the
 *  holder of the original verifier can later redeem. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function buildAuthUrl(p: {
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  codeChallenge: string
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT)
  url.searchParams.set('client_id', p.clientId)
  url.searchParams.set('redirect_uri', p.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', p.state)
  url.searchParams.set('nonce', p.nonce)
  url.searchParams.set('code_challenge', p.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // Always show the account chooser. Team members often have a personal and a
  // work Google account, and a silent pick of the wrong one lands them on
  // "not on the admin list" with no way to switch.
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

/** Redeem the code Google handed the browser for an ID token. Server-to-server
 *  over TLS, with the client secret and the PKCE verifier. */
export async function exchangeCode(p: {
  code: string
  codeVerifier: string
  clientId: string
  clientSecret: string
  redirectUri: string
  fetchImpl?: typeof fetch
}): Promise<{ idToken: string }> {
  const f = p.fetchImpl ?? fetch
  const res = await f(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: p.code,
      client_id: p.clientId,
      client_secret: p.clientSecret,
      redirect_uri: p.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: p.codeVerifier,
    }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`)
  const body = (await res.json()) as { id_token?: unknown }
  if (typeof body.id_token !== 'string') {
    throw new Error('token response had no id_token')
  }
  return { idToken: body.id_token }
}

export interface Jwk {
  kty: string
  kid?: string
  alg?: string
  use?: string
  n?: string
  e?: string
}

export interface IdTokenClaims {
  iss: string
  aud: string
  sub: string
  exp: number
  iat: number
  email?: string
  email_verified?: boolean
  name?: string
  nonce?: string
}

/** Check an ID token the way the OpenID Connect spec asks: RS256 signature
 *  against one of Google's published keys, then issuer, audience (our client
 *  id), expiry, and the nonce we minted for this sign-in. Throws with a short
 *  reason on any failure; returns the claims on success. */
export function verifyIdToken(
  idToken: string,
  opts: { clientId: string; nonce: string; keys: Jwk[]; now?: number }
): IdTokenClaims {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('id_token is not a JWT')
  const [h, p, s] = parts
  const header = parseSegment(h) as { alg?: unknown; kid?: unknown }
  if (header.alg !== 'RS256') {
    throw new Error(`unexpected alg ${String(header.alg)}`)
  }
  const jwk = opts.keys.find(k => k.kty === 'RSA' && k.kid === header.kid)
  if (!jwk) throw new Error('no matching signing key')
  const key = createPublicKey({
    key: jwk as unknown as JsonWebKey,
    format: 'jwk',
  })
  const ok = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    key,
    Buffer.from(s, 'base64url')
  )
  if (!ok) throw new Error('bad signature')

  const claims = parseSegment(p) as Partial<IdTokenClaims>
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) {
    throw new Error('wrong issuer')
  }
  if (claims.aud !== opts.clientId) throw new Error('wrong audience')
  if (
    typeof claims.exp !== 'number' ||
    claims.exp + CLOCK_SKEW_SECONDS <= now
  ) {
    throw new Error('expired')
  }
  if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_SECONDS > now) {
    throw new Error('issued in the future')
  }
  if (claims.nonce !== opts.nonce) throw new Error('nonce mismatch')
  if (typeof claims.sub !== 'string') throw new Error('no subject')
  return claims as IdTokenClaims
}

function parseSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

// Google rotates its signing keys every so often and says how long to cache
// them in Cache-Control. Kept in module memory: one fetch per warm function
// instance, and a miss on a key id (see the callback) refetches.
let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null

export async function googleJwks(
  fetchImpl: typeof fetch = fetch
): Promise<Jwk[]> {
  const now = Date.now()
  if (jwksCache && jwksCache.expiresAt > now) return jwksCache.keys
  const res = await fetchImpl(GOOGLE_JWKS_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`jwks endpoint answered ${res.status}`)
  const body = (await res.json()) as { keys?: Jwk[] }
  const keys = Array.isArray(body.keys) ? body.keys : []
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')
  const ttl = maxAge ? Number(maxAge[1]) * 1000 : 60 * 60 * 1000
  jwksCache = { keys, expiresAt: now + Math.min(ttl, 24 * 60 * 60 * 1000) }
  return keys
}

export function forgetGoogleJwks(): void {
  jwksCache = null
}
