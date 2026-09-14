import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildAuthUrl,
  pkceChallenge,
  verifyIdToken,
  type Jwk,
} from './google-oidc'

const CLIENT_ID = '123-test.apps.googleusercontent.com'
const NONCE = 'nonce-for-this-sign-in'
const NOW = 1_800_000_000

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
})
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KEYS: Jwk[] = [
  { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid: 'k1', alg: 'RS256' },
  {
    ...(other.publicKey.export({ format: 'jwk' }) as Jwk),
    kid: 'k2',
    alg: 'RS256',
  },
]

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function token(
  claims: Record<string, unknown>,
  opts: { key?: KeyObject; kid?: string; alg?: string } = {}
): string {
  const header = b64({
    alg: opts.alg ?? 'RS256',
    kid: opts.kid ?? 'k1',
    typ: 'JWT',
  })
  const body = b64(claims)
  const sig = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${body}`),
    opts.key ?? privateKey
  )
  return `${header}.${body}.${sig.toString('base64url')}`
}

const good = {
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '1234567890',
  iat: NOW - 5,
  exp: NOW + 3600,
  nonce: NONCE,
  email: 'someone@example.com',
  email_verified: true,
}

const verify = (t: string) =>
  verifyIdToken(t, { clientId: CLIENT_ID, nonce: NONCE, keys: KEYS, now: NOW })

describe('pkceChallenge', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })
})

describe('buildAuthUrl', () => {
  it('asks Google for a code with PKCE, a nonce and the account chooser', () => {
    const url = new URL(
      buildAuthUrl({
        clientId: CLIENT_ID,
        redirectUri: 'https://aisafety.com/api/admin/auth/google/callback',
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
      })
    )
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    )
    const q = Object.fromEntries(url.searchParams)
    expect(q).toMatchObject({
      client_id: CLIENT_ID,
      redirect_uri: 'https://aisafety.com/api/admin/auth/google/callback',
      response_type: 'code',
      scope: 'openid email profile',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
  })
})

describe('verifyIdToken', () => {
  it('accepts a token Google would issue', () => {
    const claims = verify(token(good))
    expect(claims.email).toBe('someone@example.com')
    expect(claims.sub).toBe('1234567890')
  })

  it('accepts the bare-host issuer form too', () => {
    expect(verify(token({ ...good, iss: 'accounts.google.com' })).sub).toBe(
      good.sub
    )
  })

  it('rejects a signature from a key that is not the named one', () => {
    expect(() => verify(token(good, { key: other.privateKey }))).toThrow(
      'bad signature'
    )
  })

  it('rejects an unknown key id', () => {
    expect(() => verify(token(good, { kid: 'k9' }))).toThrow(
      'no matching signing key'
    )
  })

  it('rejects any algorithm but RS256', () => {
    for (const alg of ['none', 'HS256', 'ES256']) {
      expect(() => verify(token(good, { alg }))).toThrow('unexpected alg')
    }
  })

  it('rejects a token for another client', () => {
    expect(() => verify(token({ ...good, aud: 'other-client' }))).toThrow(
      'wrong audience'
    )
  })

  it('rejects another issuer', () => {
    expect(() =>
      verify(token({ ...good, iss: 'https://evil.example' }))
    ).toThrow('wrong issuer')
  })

  it('rejects an expired token, allowing a minute of drift', () => {
    expect(() => verify(token({ ...good, exp: NOW - 120 }))).toThrow('expired')
    expect(verify(token({ ...good, exp: NOW - 30 })).sub).toBe(good.sub)
  })

  it('rejects a token issued in the future', () => {
    expect(() => verify(token({ ...good, iat: NOW + 600 }))).toThrow(
      'issued in the future'
    )
  })

  it('rejects a nonce from a different sign-in', () => {
    expect(() => verify(token({ ...good, nonce: 'other' }))).toThrow(
      'nonce mismatch'
    )
    expect(() => verify(token({ ...good, nonce: undefined }))).toThrow(
      'nonce mismatch'
    )
  })

  it('rejects things that are not JWTs', () => {
    expect(() => verify('not-a-token')).toThrow('not a JWT')
    expect(() => verify('a.b')).toThrow('not a JWT')
  })
})
