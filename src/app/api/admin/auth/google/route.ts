/*
  Start of Google sign-in. Mints the one-time values for this attempt (state,
  nonce, PKCE verifier), seals them in a short-lived cookie only the callback
  route can read, and sends the browser to Google's account chooser.

  ?next=/admin/... is where to land afterwards; anything outside /admin is
  ignored (safeNextPath).
*/

import { NextRequest, NextResponse } from 'next/server'
import {
  googleClientId,
  googleSignInConfigured,
  OAUTH_COOKIE_NAME,
  oauthCookieOptions,
  sealOauthTransaction,
} from '@/lib/admin/auth'
import {
  buildAuthUrl,
  pkceChallenge,
  randomToken,
} from '@/lib/admin/google-oidc'
import { publicOrigin } from '@/lib/admin/origin'
import { safeNextPath } from '@/lib/admin/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req)
  if (!googleSignInConfigured()) {
    return NextResponse.redirect(
      new URL('/admin/login?error=google-unconfigured', origin)
    )
  }
  const state = randomToken()
  const nonce = randomToken()
  const verifier = randomToken(48)
  const url = buildAuthUrl({
    clientId: googleClientId(),
    redirectUri: `${origin}/api/admin/auth/google/callback`,
    state,
    nonce,
    codeChallenge: pkceChallenge(verifier),
  })
  const res = NextResponse.redirect(url)
  res.cookies.set(
    OAUTH_COOKIE_NAME,
    sealOauthTransaction({
      state,
      nonce,
      verifier,
      next: safeNextPath(req.nextUrl.searchParams.get('next')),
    }),
    oauthCookieOptions()
  )
  return res
}
