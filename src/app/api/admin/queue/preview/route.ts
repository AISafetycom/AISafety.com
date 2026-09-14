/*
  Queue card preview (sessions with the queue area only).

  POST /api/admin/queue/preview  body { table, record, edits? } → { kind, listing } | { kind: null }

  Reads the target record live (the same read the page already gets through
  GET /api/admin/queue?target=…, so no queue-row lookup first), lays the page's edits over it and runs
  the resource page's own record-to-listing mapper, so the admin sees the
  card exactly as the site would build it. Read-only.
*/

import { NextRequest } from 'next/server'
import { canViewQueue } from '@/lib/admin/auth'
import { getPreviewListing, QueueError, sanitiseEdits } from '@/lib/admin/queue'

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
  const table = typeof body.table === 'string' ? body.table : ''
  const record = typeof body.record === 'string' ? body.record : ''
  if (!table || !record)
    return json({ error: 'table and record required' }, 400)
  try {
    const preview = await getPreviewListing(
      table,
      record,
      sanitiseEdits(body.edits)
    )
    return json(preview ?? { kind: null })
  } catch (e) {
    if (e instanceof QueueError) return json({ error: e.detail }, e.status)
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[admin-queue] preview', msg)
    return json(
      { error: 'The preview failed; details are in the server log.' },
      502
    )
  }
}
