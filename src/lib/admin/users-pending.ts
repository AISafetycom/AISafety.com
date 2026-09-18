// What the Admin admin page was in the middle of when a stale session sent
// the browser through Google (401 { error: 'reauth' } from /api/admin/users).
// The page stashes this in sessionStorage just before it leaves and takes it
// back on return, so the ticks survive the round trip and the refused request
// is sent again rather than clicked again. Pure encode/decode here, so it
// tests without a browser; the storage calls stay in the page.
import { type AccessFlags, DEFAULT_NEW_ACCESS, parseAccess } from './access'

export const USERS_API = '/api/admin/users'
export const REQUESTS_API = '/api/admin/users/requests'

/** Only the Admin admin API is ever replayed, whatever a stash says. */
const REPLAYABLE_URLS: readonly string[] = [USERS_API, REQUESTS_API]
const METHODS: readonly string[] = ['POST', 'PATCH', 'DELETE']
const MAX_TEXT = 300

/** The one request that was refused for a stale session. Sent again as-is. */
export interface PendingAction {
  method: 'POST' | 'PATCH' | 'DELETE'
  url: typeof USERS_API | typeof REQUESTS_API
  body: Record<string, unknown>
  /** Notice to show once it lands. */
  okText: string
  /** The "Add someone" form sent it, so empty the form once it lands. */
  clearForm: boolean
}

export interface PendingState {
  /** When the page left for Google, in ms since the epoch. */
  at: number
  action: PendingAction | null
  /** Tabs ticked under "Waiting for approval", by email. */
  requestPicks: Record<string, AccessFlags>
  /** The "Add someone" form as typed. */
  form: { email: string; access: AccessFlags }
}

/** How long a stash is honoured. Long enough for a slow trip through Google
 *  (its own window is ten minutes) plus a detour via the login page; short
 *  enough that yesterday's half-typed form doesn't come back. */
export const PENDING_MAX_AGE_MS = 60 * 60 * 1000

export function encodePending(state: PendingState): string {
  return JSON.stringify(state)
}

/** Read a stash back. Null when it is missing, malformed or older than
 *  PENDING_MAX_AGE_MS. Inside it, anything that doesn't parse is dropped
 *  rather than trusted: a bad tick set becomes no ticks, a bad request
 *  becomes nothing to send again. */
export function decodePending(
  raw: string | null | undefined,
  now = Date.now()
): PendingState | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const at = parsed.at
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  const age = now - at
  // A minute of slack for a clock nudged backwards between write and read.
  if (age < -60_000 || age > PENDING_MAX_AGE_MS) return null
  return {
    at,
    action: decodeAction(parsed.action),
    requestPicks: decodePicks(parsed.requestPicks),
    form: decodeForm(parsed.form),
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function decodeAction(v: unknown): PendingAction | null {
  if (!isRecord(v)) return null
  const { method, url, body, okText, clearForm } = v
  if (typeof method !== 'string' || !METHODS.includes(method)) return null
  if (typeof url !== 'string' || !REPLAYABLE_URLS.includes(url)) return null
  if (!isRecord(body)) return null
  return {
    method: method as PendingAction['method'],
    url: url as PendingAction['url'],
    body,
    okText: typeof okText === 'string' ? okText.slice(0, MAX_TEXT) : '',
    clearForm: clearForm === true,
  }
}

function decodePicks(v: unknown): Record<string, AccessFlags> {
  const out: Record<string, AccessFlags> = {}
  if (!isRecord(v)) return out
  for (const [email, flags] of Object.entries(v)) {
    const access = parseAccess(flags)
    if (access) out[email] = access
  }
  return out
}

function decodeForm(v: unknown): PendingState['form'] {
  const email =
    isRecord(v) && typeof v.email === 'string' ? v.email.slice(0, MAX_TEXT) : ''
  const access = isRecord(v) ? parseAccess(v.access) : null
  return { email, access: access ?? DEFAULT_NEW_ACCESS }
}
