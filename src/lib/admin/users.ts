// Who may sign in to /admin with Google, and which areas each of them can open.
//
// Two sources, checked in this order:
//   1. ROOT_ADMINS, built into the code — the owner, with every area. An empty
//      or unreachable store can therefore never lock the owner out, and
//      nothing on the "Admin admin" page can remove them.
//   2. The managed list (users-store.ts), edited from /admin/users: a set of
//      per-area grants (none, view or edit) for each person. Looked up on every request, so
//      removing someone or changing their access takes effect on their next
//      click.
import {
  ALL_ACCESS,
  hasAnyAccess,
  parseAccess,
  type AccessFlags,
} from './access'
import { usersStore } from './users-store'

export interface AdminUser {
  /** The Google account's email, lower-case. Google only reports an address
   *  it has verified, so this is the identity. */
  email: string
  /** Shown in the admin and recorded next to anything this person does. */
  name: string
  access: AccessFlags
}

/** Built into the code. Not editable from the admin, never locked out. */
export const ROOT_ADMINS: AdminUser[] = [
  { email: 'bryceerobertson@gmail.com', name: 'Bryce', access: ALL_ACCESS },
]

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isRootAdmin(email: string): boolean {
  const wanted = normaliseEmail(email)
  return ROOT_ADMINS.some(u => u.email === wanted)
}

/** The admin user for a Google email, or null when the address isn't known.
 *  Root admins resolve without touching the store, so a store outage can
 *  only ever affect managed users (who then read as signed out). */
export async function findAdminUser(email: string): Promise<AdminUser | null> {
  const wanted = normaliseEmail(email)
  const root = ROOT_ADMINS.find(u => u.email === wanted)
  if (root) return root
  try {
    const managed = (await usersStore.list()).find(u => u.email === wanted)
    // Until their first sign-in we have no name from Google yet.
    return managed
      ? {
          email: managed.email,
          name: managed.name ?? managed.email,
          access: managed.access,
        }
      : null
  } catch (err) {
    console.error('[admin-users] could not read the user list:', err)
    return null
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type FieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export function validateEmail(input: unknown): FieldResult<string> {
  if (typeof input !== 'string' || !EMAIL_RE.test(input.trim())) {
    return { ok: false, error: 'Enter a valid email address.' }
  }
  const email = normaliseEmail(input)
  if (isRootAdmin(email)) {
    return {
      ok: false,
      error: 'That address is built in and cannot be edited here.',
    }
  }
  return { ok: true, value: email }
}

export function validateAccess(input: unknown): FieldResult<AccessFlags> {
  const access = parseAccess(input)
  if (!access) return { ok: false, error: 'Pick which tabs they can open.' }
  if (!hasAnyAccess(access)) {
    return { ok: false, error: 'Pick at least one tab.' }
  }
  return { ok: true, value: access }
}

/** Check a new-user row from the Admin admin page: the Google email and the
 *  tabs. The name is not asked for; Google supplies it at first sign-in. */
export function validateUserInput(
  input: unknown
): FieldResult<{ email: string; access: AccessFlags }> {
  const body = (input ?? {}) as Record<string, unknown>
  const email = validateEmail(body.email)
  if (!email.ok) return email
  const access = validateAccess(body.access)
  if (!access.ok) return access
  return { ok: true, value: { email: email.value, access: access.value } }
}
