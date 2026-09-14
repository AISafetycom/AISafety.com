/*
  Queue logos in bulk (sessions with the queue area only).

  POST /api/admin/queue/logos  body { targets: [{ table, record }] }
    → { logos: { "<record id>": "<url>" } }

  The list (GET /api/admin/queue) arrives without logos so it is quick; the
  page calls this the moment the list is on screen and fills the pictures in.
  Looking them up means the site's catalog (every table, seconds when its
  cache is cold) plus one read per table for unpublished targets, which is
  why it is not on the list's critical path. Read-only. At most 400 targets
  a call; records without a picture are left out of the answer.
*/

import { NextRequest } from 'next/server'
import { canViewQueue } from '@/lib/admin/auth'
import { queueLogos } from '@/lib/admin/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(req: NextRequest) {
  if (!(await canViewQueue())) return json({ error: 'unauthorized' }, 401)
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object') {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // handled below
  }
  const targets: { table: string; record: string }[] = []
  if (Array.isArray(body.targets)) {
    for (const t of body.targets.slice(0, 400)) {
      if (!t || typeof t !== 'object') continue
      const o = t as Record<string, unknown>
      if (typeof o.table !== 'string' || typeof o.record !== 'string') continue
      targets.push({ table: o.table, record: o.record })
    }
  }
  try {
    return json({ logos: await queueLogos(targets) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[admin-queue] logos', msg)
    return json(
      { error: 'The logos failed; details are in the server log.' },
      502
    )
  }
}
