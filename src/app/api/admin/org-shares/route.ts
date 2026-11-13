/*
  Org pages API: the Org lookup tab's "Share with the org" box
  (src/lib/analytics/org-shares.ts). A link puts figures outside the admin,
  so making or switching one off needs Admin admin's edit grant (canManageUsers)
  as well as the Analytics tab; anyone else gets 401.

  POST   /api/admin/org-shares  body { query, leftOut, orgName } → { share }
                                 or { kind: 'jobs', orgName } (the Jobs tab)
  DELETE /api/admin/org-shares  body { token }                    → 204

  POST makes the search's link, or updates what an existing one leaves out
  (the address stays the same). Both must come from the admin page itself
  (isSameOriginRequest).
*/

import type { NextRequest } from 'next/server'
import {
  canManageUsers,
  canViewAnalytics,
  currentAdmin,
} from '@/lib/admin/auth'
import { isSameOriginRequest } from '@/lib/admin/origin'
import {
  checkShareInput,
  removeShare,
  saveShare,
} from '@/lib/analytics/org-shares'

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

async function refused(req: Request): Promise<Response | null> {
  if (!isSameOriginRequest(req)) return json({ error: 'forbidden' }, 403)
  if (!(await canManageUsers()) || !(await canViewAnalytics()))
    return json({ error: 'unauthorized' }, 401)
  return null
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json()
    return body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export async function POST(req: NextRequest) {
  const no = await refused(req)
  if (no) return no
  const input = checkShareInput(await readBody(req))
  if (!input) return json({ error: 'invalid' }, 400)
  const me = await currentAdmin()
  try {
    const share = await saveShare(input, me?.name ?? me?.email ?? 'unknown')
    console.info(
      `[org-shares] ${me?.email ?? 'unknown'} shared ${share.kind === 'jobs' ? 'the job board page' : `"${share.query}"`} (${share.token.slice(0, 4)}…)`
    )
    return json({ share: { token: share.token, leftOut: share.leftOut } })
  } catch (err) {
    console.error(
      `[org-shares] couldn't save: ${err instanceof Error ? err.message : String(err)}`
    )
    return json({ error: 'store' }, 503)
  }
}

export async function DELETE(req: NextRequest) {
  const no = await refused(req)
  if (no) return no
  const { token } = await readBody(req)
  if (typeof token !== 'string') return json({ error: 'invalid' }, 400)
  try {
    if (!(await removeShare(token))) return json({ error: 'not_found' }, 404)
  } catch (err) {
    console.error(
      `[org-shares] couldn't remove: ${err instanceof Error ? err.message : String(err)}`
    )
    return json({ error: 'store' }, 503)
  }
  const me = await currentAdmin()
  console.info(
    `[org-shares] ${me?.email ?? 'unknown'} switched off ${token.slice(0, 4)}…`
  )
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  })
}
