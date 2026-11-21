/*
  Queue image upload (sessions with the queue area's edit grant only).

  POST /api/admin/queue/upload
       body { id, field, filename, contentType, data }   data = base64
       body { id, field, clear: true }                    empty the field
       body { id, field, prepared: filename }             Fable's proposed logo
       → { urls, attachments, previous }

  Drops one image into an attachment field of the item's target record,
  replacing what was there – or empties the field. `previous` is the picture
  the write took off the record (bytes included), so the page can offer
  Undo without Airtable keeping anything extra. The record is unpublished,
  so the site does not change; Accept is still the only thing that
  publishes. On an addition already published (opened from Done today)
  the picture goes live with the listing, as any field fixed there does.

  `prepared` is Use on the logo Fable's field check proposes for an open
  addition (queue-field-flags.ts, 17 Nov 2026): the file Logo Prep made,
  which the Mac keeps on the Queue row, is copied onto the record – only
  while the record still holds the logo Fable looked at.
*/

import { NextRequest } from 'next/server'
import { canReviewQueue, currentAdmin } from '@/lib/admin/auth'
import {
  clearImage,
  forgetRowEdit,
  getQueueItem,
  isFixable,
  QueueError,
  uploadImage,
  applyPreparedLogo,
} from '@/lib/admin/queue'

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
  if (!(await canReviewQueue())) return json({ error: 'unauthorized' }, 401)
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object') {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // handled below
  }
  const id = typeof body.id === 'string' ? body.id : ''
  const field = typeof body.field === 'string' ? body.field : ''
  const filename = typeof body.filename === 'string' ? body.filename : 'image'
  const contentType =
    typeof body.contentType === 'string' ? body.contentType : ''
  const data = typeof body.data === 'string' ? body.data : ''
  const clear = body.clear === true
  const prepared = typeof body.prepared === 'string' ? body.prepared : ''
  if (!field || (!data && !clear && !prepared)) {
    return json({ error: 'No image received.' }, 400)
  }
  try {
    const item = await getQueueItem(id)
    if (!item) return json({ error: 'That item no longer exists.' }, 404)
    if (!item.targetTable || !item.targetRecord) {
      return json({ error: 'This item has no record to attach to.' }, 400)
    }
    const stored = prepared
      ? await applyPreparedLogo(item, field, prepared)
      : clear
        ? await clearImage(item.targetTable, item.targetRecord, field)
        : await uploadImage(item.targetTable, item.targetRecord, field, {
            filename,
            contentType,
            base64: data,
          })
    if (isFixable(item)) await forgetRowEdit(item, field)
    const me = await currentAdmin()
    console.log(
      `[admin-queue] image ${field} ${prepared ? "replaced with Fable's prepared logo" : clear ? 'cleared' : 'replaced'} on ${item.targetRecord} (${item.title}) by ${me?.name ?? '?'}`
    )
    return json(stored)
  } catch (e) {
    if (e instanceof QueueError) return json({ error: e.detail }, e.status)
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[admin-queue] upload', msg)
    return json(
      { error: 'The upload failed; details are in the server log.' },
      502
    )
  }
}
