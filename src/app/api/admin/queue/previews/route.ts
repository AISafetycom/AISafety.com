/*
  Queue card previews in bulk (sessions with the queue area only).

  POST /api/admin/queue/previews  body { targets: [{ table, record, edits? }] }
    → { cards: [{ kind, listing } | null, …] }   one per target, in order

  The page calls this once the list has loaded, so every open item's card is
  ready before it is opened. Same reads as the single preview route, batched
  per table. Read-only. At most 400 targets a call. The answer is a list,
  not a map by record, since two items can share a record with different
  edits (the key changed from "previews", so a tab still running the old
  page falls back to the single-card route instead of misreading it).
*/

import { NextRequest } from 'next/server'
import { canViewQueue } from '@/lib/admin/auth'
import {
  getPreviewListings,
  QueueError,
  sanitiseEdits,
  type PreviewTarget,
} from '@/lib/admin/queue'

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
  const targets: PreviewTarget[] = []
  if (Array.isArray(body.targets)) {
    for (const t of body.targets.slice(0, 400)) {
      const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
      // A malformed target keeps its place (and gets null), so every card
      // still lines up with the target it answers.
      if (typeof o.table !== 'string' || typeof o.record !== 'string') {
        targets.push({ table: '', record: '', edits: {} })
        continue
      }
      targets.push({
        table: o.table,
        record: o.record,
        edits: sanitiseEdits(o.edits),
      })
    }
  }
  try {
    return json({ cards: await getPreviewListings(targets) })
  } catch (e) {
    if (e instanceof QueueError) return json({ error: e.detail }, e.status)
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[admin-queue] previews', msg)
    return json(
      { error: 'The previews failed; details are in the server log.' },
      502
    )
  }
}
