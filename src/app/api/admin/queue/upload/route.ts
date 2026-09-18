/*
  Queue image upload (sessions with the queue area's edit grant only).

  POST /api/admin/queue/upload
       body { id, field, filename, contentType, data }   data = base64
       body { id, field, clear: true }                    empty the field
       → { urls, attachments, previous }

  Drops one image into an attachment field of the item's target record,
  replacing what was there – or empties the field. `previous` is the picture
  the write took off the record (bytes included), so the page can offer
  Undo without Airtable keeping anything extra. The record is unpublished,
  so the site does not change; Accept is still the only thing that
  publishes.
*/

import { NextRequest } from 'next/server'
import { canReviewQueue, currentAdmin } from '@/lib/admin/auth'
import {
  clearImage,
  getQueueItem,
  QueueError,
  uploadImage,
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
  if (!field || (!data && !clear)) {
    return json({ error: 'No image received.' }, 400)
  }
  try {
    const item = await getQueueItem(id)
    if (!item) return json({ error: 'That item no longer exists.' }, 404)
    if (!item.targetTable || !item.targetRecord) {
      return json({ error: 'This item has no record to attach to.' }, 400)
    }
    const stored = clear
      ? await clearImage(item.targetTable, item.targetRecord, field)
      : await uploadImage(item.targetTable, item.targetRecord, field, {
          filename,
          contentType,
          base64: data,
        })
    const me = await currentAdmin()
    console.log(
      `[admin-queue] image ${field} ${clear ? 'cleared' : 'replaced'} on ${item.targetRecord} (${item.title}) by ${me?.name ?? '?'}`
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
