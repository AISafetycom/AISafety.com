/*
  Queue API. GET needs the queue area (canViewQueue); POST needs its edit
  grant (canReviewQueue).

  GET  /api/admin/queue                        → { items, agent }
       (the rows only, no logo lookup, so the list lands in about a second;
       the page then asks /api/admin/queue/logos for the pictures)
  GET  /api/admin/queue?target=<tbl>/<rec>     → { fields, schema } (live)
  POST /api/admin/queue  body { id, action, edits?, reason?, replyDraft? } → { item }
       action: accept | reject | edit | undo
       (edit keeps the page's pending edits, and the reply draft as
       edited, on the row – nothing more)

  `agent` is { port, token } for the local agent on the owner's Mac (null
  when QUEUE_AGENT_SECRET is not set): the page calls it after an accept so
  a Gmail reply draft lands at once instead of on the worker's next pass.

  Every accept writes to the live base, so the route re-reads the row first
  and refuses anything already decided (409). No fresh-session requirement:
  an accept is no more dangerous than a map-editor save, and the point of
  the page is one click.
*/

import { NextRequest } from 'next/server'
import { canReviewQueue, canViewQueue, currentAdmin } from '@/lib/admin/auth'
import {
  acceptItem,
  agentInfo,
  getQueueItem,
  getTableSchema,
  getTargetFields,
  listQueue,
  QueueError,
  rejectItem,
  sanitiseEdits,
  saveEdits,
  undoItem,
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

async function ensureAuth(write: boolean): Promise<Response | null> {
  const allowed = write ? await canReviewQueue() : await canViewQueue()
  if (!allowed) return json({ error: 'unauthorized' }, 401)
  return null
}

/** A QueueError carries text written for the page; anything else is
 *  logged and answered with a plain summary, never the raw error. */
function failure(e: unknown): Response {
  if (e instanceof QueueError) return json({ error: e.detail }, e.status)
  const msg = e instanceof Error ? e.message : String(e)
  console.error('[admin-queue]', msg)
  return json(
    { error: 'The queue could not do that; details are in the server log.' },
    502
  )
}

export async function GET(req: NextRequest) {
  const auth = await ensureAuth(false)
  if (auth) return auth
  try {
    const target = req.nextUrl.searchParams.get('target')
    if (target) {
      const [table = '', record = ''] = target.split('/')
      const [fields, schema] = await Promise.all([
        getTargetFields(table, record),
        getTableSchema(table),
      ])
      if (!fields) return json({ error: 'That record no longer exists.' }, 404)
      return json({ fields, schema })
    }
    const me = await currentAdmin()
    return json({
      items: await listQueue(),
      agent: agentInfo(me?.email ?? ''),
    })
  } catch (e) {
    return failure(e)
  }
}

const ACTIONS = new Set(['accept', 'reject', 'edit', 'undo'])

export async function POST(req: NextRequest) {
  const auth = await ensureAuth(true)
  if (auth) return auth
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object') {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // empty body: handled below
  }
  const id = typeof body.id === 'string' ? body.id : ''
  const action = typeof body.action === 'string' ? body.action : ''
  if (!ACTIONS.has(action)) return json({ error: 'unknown action' }, 400)
  try {
    const item = await getQueueItem(id)
    if (!item) return json({ error: 'That item no longer exists.' }, 404)
    const me = await currentAdmin()
    if (action === 'accept') {
      await acceptItem(
        item,
        sanitiseEdits(body.edits),
        typeof body.replyDraft === 'string' ? body.replyDraft : null
      )
    } else if (action === 'reject') {
      await rejectItem(item, typeof body.reason === 'string' ? body.reason : '')
    } else if (action === 'edit') {
      await saveEdits(
        item,
        sanitiseEdits(body.edits),
        typeof body.replyDraft === 'string' ? body.replyDraft : undefined
      )
      return json({ item: await getQueueItem(id) })
    } else {
      await undoItem(item)
    }
    console.log(
      `[admin-queue] ${action} ${item.type} ${item.id} "${item.title}" by ${me?.name ?? me?.email ?? '?'}`
    )
    return json({ item: await getQueueItem(id) })
  } catch (e) {
    return failure(e)
  }
}
