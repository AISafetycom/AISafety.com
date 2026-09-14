/*
  Google sends the browser here after the account chooser. In order:

  1. The sealed cookie from the start route must still be valid (ten minutes)
     and its state must match the one Google echoed back — this ties the
     callback to a sign-in this browser began.
  2. The code is swapped for an ID token, server to server, with the PKCE
     verifier only we hold.
  3. The ID token's signature is checked against Google's published keys, then
     issuer, audience, expiry and nonce (verifyIdToken).
  4. Only a verified email on ADMIN_USERS gets a session cookie; everyone else
     lands back on the login page with a reason.

  Every failure path clears the in-flight cookie and redirects to
  /admin/login?error=<code>; the login page turns the code into a sentence.
*/

import { timingSafeEqual } from 'node:crypto'
import { after, NextRequest, NextResponse } from 'next/server'
import { adminHomeHref } from '@/app/admin/nav'
import {
  googleClientId,
  googleClientSecret,
  googleSignInConfigured,
  LEGACY_COOKIE_NAME,
  OAUTH_COOKIE_NAME,
  OAUTH_COOKIE_PATH,
  openOauthTransaction,
  PENDING_COOKIE_NAME,
  pendingCookieOptions,
  pendingToken,
  PREVIEW_PILLS_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  sessionToken,
} from '@/lib/admin/auth'
import {
  exchangeCode,
  forgetGoogleJwks,
  googleJwks,
  verifyIdToken,
  type IdTokenClaims,
} from '@/lib/admin/google-oidc'
import { publicOrigin } from '@/lib/admin/origin'
import { requestMail, sendAdminMail } from '@/lib/admin/mail'
import { ROOT_ADMINS } from '@/lib/admin/users'
import { findAdminUser } from '@/lib/admin/users'
import { usersStore } from '@/lib/admin/users-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req)
  const fail = (code: string) => {
    const res = NextResponse.redirect(
      new URL(`/admin/login?error=${code}`, origin)
    )
    res.cookies.delete({ name: OAUTH_COOKIE_NAME, path: OAUTH_COOKIE_PATH })
    return res
  }

  if (!googleSignInConfigured()) return fail('google-unconfigured')

  const tx = openOauthTransaction(req.cookies.get(OAUTH_COOKIE_NAME)?.value)
  if (!tx) return fail('expired')

  const params = req.nextUrl.searchParams
  const googleError = params.get('error')
  if (googleError) {
    return fail(googleError === 'access_denied' ? 'cancelled' : 'google')
  }
  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state || !sameString(state, tx.state)) return fail('state')

  let claims: IdTokenClaims
  try {
    const { idToken } = await exchangeCode({
      code,
      codeVerifier: tx.verifier,
      clientId: googleClientId(),
      clientSecret: googleClientSecret(),
      redirectUri: `${origin}/api/admin/auth/google/callback`,
    })
    const check = async () =>
      verifyIdToken(idToken, {
        clientId: googleClientId(),
        nonce: tx.nonce,
        keys: await googleJwks(),
      })
    try {
      claims = await check()
    } catch (err) {
      // Google rotated its keys since we cached them: fetch once more.
      if (
        !(err instanceof Error && err.message === 'no matching signing key')
      ) {
        throw err
      }
      forgetGoogleJwks()
      claims = await check()
    }
  } catch (err) {
    console.warn('[admin-auth] Google sign-in failed:', err)
    return fail('google')
  }

  if (typeof claims.email !== 'string' || claims.email_verified !== true) {
    console.warn('[admin-auth] Google sign-in without a verified email')
    return fail('google')
  }
  const googleName =
    typeof claims.name === 'string' ? claims.name.trim().slice(0, 60) : null
  const user = await findAdminUser(claims.email)
  if (!user) {
    // Not on the list: leave a request for the owner to approve on
    // /admin/users, and show the person an "access requested" screen. The
    // pending cookie lets that screen name the account without putting the
    // address in the URL.
    const email = claims.email.trim().toLowerCase()
    let recorded = false
    try {
      recorded = await usersStore.recordRequest(
        email,
        googleName || null,
        new Date().toISOString()
      )
    } catch (err) {
      console.warn('[admin-auth] could not record an access request:', err)
    }
    console.log(
      `[admin-auth] access requested by ${email}${
        recorded ? '' : ' (not recorded: list full or store down)'
      }`
    )
    if (!recorded) return fail('not-allowed')
    // Tell the owner, after the redirect has gone out.
    const requestedAt = new Date().toISOString()
    after(async () => {
      const list = await usersStore.listRequests().catch(() => [])
      const entry = list.find(r => r.email === email)
      // The script only ever delivers "request" mail to the owner's own address.
      for (const owner of ROOT_ADMINS) {
        await sendAdminMail(
          'request',
          owner.email,
          requestMail({
            email,
            name: entry?.name ?? googleName ?? null,
            at: entry?.lastAt ?? requestedAt,
            count: entry?.count ?? 1,
            adminUrl: `${origin}/admin/users`,
          })
        )
      }
    })
    const res = NextResponse.redirect(
      new URL('/admin/login?requested=1', origin)
    )
    res.cookies.delete({ name: OAUTH_COOKIE_NAME, path: OAUTH_COOKIE_PATH })
    res.cookies.set(
      PENDING_COOKIE_NAME,
      pendingToken(email),
      pendingCookieOptions()
    )
    return res
  }

  console.log(`[admin-auth] ${user.name} (${user.email}) signed in with Google`)
  // Also where a managed user's name comes from: Google's profile name,
  // first time they sign in (and again if they change it).
  usersStore
    .recordSignIn(user.email, new Date().toISOString(), googleName || null)
    .catch(err => console.warn('[admin-auth] could not record sign-in:', err))
  const access = user.access
  const res = NextResponse.redirect(
    new URL(tx.next || adminHomeHref(access), origin)
  )
  res.cookies.delete({ name: OAUTH_COOKIE_NAME, path: OAUTH_COOKIE_PATH })
  res.cookies.set(
    SESSION_COOKIE_NAME,
    sessionToken(user.email),
    sessionCookieOptions()
  )
  // A Google session replaces whatever password cookie this browser held, and
  // a role without preview must not keep the switch pills from an earlier one.
  res.cookies.delete(LEGACY_COOKIE_NAME)
  if (!access.preview) res.cookies.delete(PREVIEW_PILLS_COOKIE_NAME)
  return res
}
