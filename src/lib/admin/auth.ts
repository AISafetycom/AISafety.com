import { cookies } from 'next/headers'
import { cache } from 'react'
import { canEdit, canOpen, NO_ACCESS, type AccessFlags } from './access'
import { openToken, sealToken } from './session'
import { findAdminUser } from './users'

// One way into the admin: a Google session (SESSION_COOKIE), minted by
// /api/admin/auth/google/callback after Google vouched for an email that is a
// root admin (users.ts) or on the managed list (users-store.ts, edited at
// /admin/users). The cookie holds only the email and timestamps under an
// HMAC; the person's access is looked up again each request, so removing
// them or unticking an area takes effect immediately.
//
// Passwords were retired on 4 September 2026. LEGACY_COOKIE is the name the
// old password cookie used; it is only ever deleted now.

const LEGACY_COOKIE = 'aisafety_admin'
export const SESSION_COOKIE_NAME = 'aisafety_admin_session'
export const OAUTH_COOKIE_NAME = 'aisafety_admin_oauth'
/** The in-flight sign-in cookie is only ever read by the callback route. */
export const OAUTH_COOKIE_PATH = '/api/admin/auth/google'
/** Set by the callback when a Google account isn't on the list, so the login
 *  page can say whose access was requested without putting the address in
 *  the URL. Sealed like the session; five minutes. */
export const PENDING_COOKIE_NAME = 'aisafety_admin_pending'
const PENDING_MAX_AGE = 60 * 5
// Not a credential: a JS-readable "1" telling the floating "Switch to
// preview" pill on the public pages to show itself. Set and cleared by the
// master switch on /admin/preview (owner and listing editors only). The real
// gate stays server-side (canUsePreview); forging this cookie only reveals a
// button whose request would then be rejected. Name is mirrored in
// EnterPreviewButton.tsx, which reads document.cookie.
const PREVIEW_PILLS_COOKIE = 'aisafety_preview_pills'

/** Google sessions: 7 days, then sign in again (one click for most people). */
const SESSION_MAX_AGE = 60 * 60 * 24 * 7
/** A Google sign-in must complete within this long of starting. */
const OAUTH_MAX_AGE = 60 * 10
/** How recently a session must have been minted by Google for the actions
 *  that matter most: approving a newsletter send, and changing who can sign
 *  in. A stolen session cookie can't pass this on its own: the
 *  re-confirmation is a full trip through Google, which needs the live Google
 *  login in the browser, not just our cookie. */
export const SENSITIVE_FRESH_SECONDS = 60 * 30
export const NEWSLETTER_FRESH_SECONDS = SENSITIVE_FRESH_SECONDS

interface SessionPayload {
  v: 1
  email: string
  /** Seconds since the epoch when Google vouched for this email. */
  iat: number
  exp: number
}

export interface OauthTransaction {
  state: string
  nonce: string
  verifier: string
  /** Admin path to land on afterwards, '' for the session's home. */
  next: string
  exp: number
}

/** Who is signed in. */
export interface AdminIdentity {
  name: string
  email: string
  /** Seconds since the epoch when Google vouched for the session. */
  signedInAt: number
  access: AccessFlags
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function sessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET ?? ''
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** True when this deployment can sign people in with Google: client id and
 *  secret from the Google Cloud console, plus a secret to seal cookies with. */
export function googleSignInConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    sessionSecret()
  )
}

export function googleClientId(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_ID ?? ''
}

export function googleClientSecret(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? ''
}

/** The signed-in identity for this request, or null. Cached per request so
 *  every gate a layout asks about costs one cookie parse and one lookup. */
const currentSession = cache(async (): Promise<AdminIdentity | null> => {
  const c = await cookies()

  const token = c.get(SESSION_COOKIE_NAME)?.value
  const s = openToken<SessionPayload>(token, sessionSecret())
  if (
    s &&
    s.v === 1 &&
    typeof s.email === 'string' &&
    typeof s.iat === 'number' &&
    typeof s.exp === 'number' &&
    s.exp > nowSeconds()
  ) {
    const user = await findAdminUser(s.email)
    // An email removed from the list since the cookie was minted is simply
    // signed out.
    if (user) {
      return {
        name: user.name,
        email: user.email,
        signedInAt: s.iat,
        access: user.access,
      }
    }
  }
  return null
})

/** Which areas this request's session may open; all false when signed out.
 *  Layouts use this once to build the tab bar. */
export async function currentAccess(): Promise<AccessFlags> {
  return (await currentSession())?.access ?? NO_ACCESS
}

/** Who is signed in, for attribution and the header. Null when signed out. */
export async function currentAdmin(): Promise<AdminIdentity | null> {
  return currentSession()
}

/** Signed in at all. Use this only to tell "signed in" from "signed out" —
 *  for anything gating a section of the admin, ask the specific capability
 *  instead, since not every session reaches every area. */
export async function isAdmin(): Promise<boolean> {
  return (await currentSession()) !== null
}

export async function canViewPlayground(): Promise<boolean> {
  return canOpen(await currentAccess(), 'playground')
}

/** May read visitors' chat transcripts (the log page and its API). */
export async function canViewConversationLog(): Promise<boolean> {
  return canOpen(await currentAccess(), 'conversationLog')
}

/** May enter the chatbot section at all: either of its two pages. */
export async function canViewChatbot(): Promise<boolean> {
  const a = await currentAccess()
  return canOpen(a, 'playground') || canOpen(a, 'conversationLog')
}

export async function canViewAnalytics(): Promise<boolean> {
  return canOpen(await currentAccess(), 'analytics')
}

/** May open /admin/map and read the live records. */
export async function canViewMap(): Promise<boolean> {
  return canOpen(await currentAccess(), 'mapEditor')
}

/** Every save is a write to the live base. */
export async function canEditMap(): Promise<boolean> {
  return canEdit(await currentAccess(), 'mapEditor')
}

export async function canUsePreview(): Promise<boolean> {
  return canOpen(await currentAccess(), 'preview')
}

/** An approval sends to every subscriber on the list. Callers that actually
 *  send should also require hasFreshSession(NEWSLETTER_FRESH_SECONDS). */
export async function canSendNewsletter(): Promise<boolean> {
  return canEdit(await currentAccess(), 'newsletter')
}

/** May open /admin/newsletter and look at drafts and previews: approvers,
 *  plus view-only reviewers who can never send. */
export async function canViewNewsletter(): Promise<boolean> {
  return canOpen(await currentAccess(), 'newsletter')
}

/** May open /admin/queue and read what is waiting, the previews included. */
export async function canViewQueue(): Promise<boolean> {
  return canOpen(await currentAccess(), 'queue')
}

/** May accept, reject or revise proposals. Every accept is a write to the
 *  live base (a publish, a field change, a deletion later). */
export async function canReviewQueue(): Promise<boolean> {
  return canEdit(await currentAccess(), 'queue')
}

/** May open /admin/users and see who can sign in. */
export async function canViewUsers(): Promise<boolean> {
  return canOpen(await currentAccess(), 'manageUsers')
}

/** May change who can sign in; the write routes also require
 *  hasFreshSession(SENSITIVE_FRESH_SECONDS). */
export async function canManageUsers(): Promise<boolean> {
  return canEdit(await currentAccess(), 'manageUsers')
}

/** True when the session was minted by Google within the last
 *  `maxAgeSeconds`. */
export async function hasFreshSession(maxAgeSeconds: number): Promise<boolean> {
  const s = await currentSession()
  if (!s) return false
  return nowSeconds() - s.signedInAt <= maxAgeSeconds
}

// ─── Google session cookies (set by the callback route on its response) ────

export function sessionToken(email: string, now = nowSeconds()): string {
  const payload: SessionPayload = {
    v: 1,
    email,
    iat: now,
    exp: now + SESSION_MAX_AGE,
  }
  return sealToken(payload, sessionSecret())
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secureCookies(),
    path: '/',
    maxAge: SESSION_MAX_AGE,
  }
}

export function sealOauthTransaction(
  t: Omit<OauthTransaction, 'exp'>,
  now = nowSeconds()
): string {
  const payload: OauthTransaction = { ...t, exp: now + OAUTH_MAX_AGE }
  return sealToken(payload, sessionSecret())
}

export function openOauthTransaction(
  token: string | undefined,
  now = nowSeconds()
): OauthTransaction | null {
  const t = openToken<OauthTransaction>(token, sessionSecret())
  if (
    !t ||
    typeof t.state !== 'string' ||
    typeof t.nonce !== 'string' ||
    typeof t.verifier !== 'string' ||
    typeof t.next !== 'string' ||
    typeof t.exp !== 'number' ||
    t.exp <= now
  ) {
    return null
  }
  return t
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secureCookies(),
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_MAX_AGE,
  }
}

export function pendingToken(email: string, now = nowSeconds()): string {
  return sealToken({ email, exp: now + PENDING_MAX_AGE }, sessionSecret())
}

/** The email a just-refused sign-in was for, from the pending cookie. */
export async function pendingRequestEmail(): Promise<string | null> {
  const c = await cookies()
  const t = openToken<{ email?: unknown; exp?: unknown }>(
    c.get(PENDING_COOKIE_NAME)?.value,
    sessionSecret()
  )
  if (!t || typeof t.email !== 'string' || typeof t.exp !== 'number') {
    return null
  }
  return t.exp > nowSeconds() ? t.email : null
}

export function pendingCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: secureCookies(),
    path: '/admin/login',
    maxAge: PENDING_MAX_AGE,
  }
}

/** Cookie names the callback route clears: the old password cookie (left in
 *  browsers from before 4 September 2026) and the preview pills. */
export const LEGACY_COOKIE_NAME = LEGACY_COOKIE
export const PREVIEW_PILLS_COOKIE_NAME = PREVIEW_PILLS_COOKIE

// ─── Preview pills + sign-out ──────────────────────────────────────────────

/** Show or hide the floating switch pills on this browser — the master
 *  switch on /admin/preview. Showing them is capability-gated by the caller
 *  (the route 401s first); hiding is always allowed. */
export async function setPreviewPillsCookie(visible: boolean): Promise<void> {
  const c = await cookies()
  if (visible) {
    c.set({
      name: PREVIEW_PILLS_COOKIE,
      value: '1',
      httpOnly: false,
      sameSite: 'lax',
      secure: secureCookies(),
      path: '/',
      maxAge: SESSION_MAX_AGE,
    })
  } else {
    c.delete(PREVIEW_PILLS_COOKIE)
  }
}

/** Whether this browser has the floating switch pills turned on. */
export async function previewPillsShown(): Promise<boolean> {
  const c = await cookies()
  return c.get(PREVIEW_PILLS_COOKIE)?.value === '1'
}

export async function clearAdminCookie(): Promise<void> {
  const c = await cookies()
  c.delete(SESSION_COOKIE_NAME)
  c.delete(LEGACY_COOKIE) // left over from the password era; harmless if absent
  c.delete(PREVIEW_PILLS_COOKIE)
}
