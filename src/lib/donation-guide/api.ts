// Shared bits of the /api/admin/donation-guide routes: the JSON reply, the
// grant check, and the signed-in person as an Actor.
import type { NextRequest } from 'next/server'
import {
  canEditDonationGuide,
  canViewDonationGuide,
  currentAdmin,
} from '@/lib/admin/auth'
import type { Actor } from './types'

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

/** 401 unless the session has the area (reads) or its edit grant (writes). */
export async function ensureGuideAuth(
  write: boolean
): Promise<Response | null> {
  const allowed = write
    ? await canEditDonationGuide()
    : await canViewDonationGuide()
  return allowed ? null : json({ error: 'unauthorized' }, 401)
}

/** Who is acting, for drafts and versions. Only called after ensureGuideAuth
 *  passed, so a session exists. */
export async function actor(): Promise<Actor> {
  const me = await currentAdmin()
  return { name: me?.name ?? 'Unknown', email: me?.email ?? '' }
}

export async function readBody(
  req: NextRequest
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json()
    return body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
