/*
  Dismiss an access request without granting anything (manageUsers sessions
  only, fresh Google session required like every other write here).

  DELETE /api/admin/users/requests  body { email }  → 204

  Approving a request is a normal POST /api/admin/users with the same email:
  that route takes the name Google gave us and clears the request.
*/

import { NextRequest } from 'next/server'
import {
  canManageUsers,
  currentAdmin,
  hasFreshSession,
  SENSITIVE_FRESH_SECONDS,
} from '@/lib/admin/auth'
import { normaliseEmail } from '@/lib/admin/users'
import { usersStore } from '@/lib/admin/users-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export async function DELETE(req: NextRequest) {
  if (!(await canManageUsers())) return json({ error: 'unauthorized' }, 401)
  if (!(await hasFreshSession(SENSITIVE_FRESH_SECONDS))) {
    return json({ error: 'reauth' }, 401)
  }
  let body: { email?: unknown } = {}
  try {
    body = (await req.json()) as { email?: unknown }
  } catch {
    // fall through to the check below
  }
  if (typeof body.email !== 'string')
    return json({ error: 'Which request?' }, 400)
  const email = normaliseEmail(body.email)
  const removed = await usersStore.removeRequest(email)
  if (!removed) return json({ error: 'No such request.' }, 404)
  const me = await currentAdmin()
  console.log(
    `[admin-users] ${me?.name ?? 'unknown'} dismissed the request from ${email}`
  )
  return new Response(null, { status: 204 })
}
