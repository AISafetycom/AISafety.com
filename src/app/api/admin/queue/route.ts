/*
  Queue API. GET needs the queue area (canViewQueue); POST needs its edit
  grant (canReviewQueue).

  GET  /api/admin/queue                        → { items, agent }
       (the rows only, no logo lookup, so the list lands in about a second;
       the page then asks /api/admin/queue/logos for the pictures)
  GET  /api/admin/queue?sync=1                 → the same, after closing the
       open Add rows whose record was deleted, published or hidden in
       Airtable itself – what the Mac worker does every five minutes, done
       now for the page's refreshes. A write, so it takes the edit grant;
       a viewer gets the plain list.
  GET  /api/admin/queue?decided=1              → { items } – every decided row,
       newest decision first, for the search's "Earlier" group (read only
       while a search is typed)
  GET  /api/admin/queue?id=<rec>               → { item } – one row as it is now
       (the page follows a Reopen with it until the Mac is done)
  GET  /api/admin/queue?target=<tbl>/<rec>     → { fields, attachments, schema } (live)
  GET  /api/admin/queue?order=<tbl>            → { order } – the page's published
       listings by Sort, for placing an addition (null for a table with no Sort)
  GET  /api/admin/queue?map=1                  → { records } – every Field map
       listing with its place, unpublished ones included (live, the map
       editor's own read; published logos are the site's copies), for the
       map strip on a /map addition – queue-map.ts
  POST /api/admin/queue  body { id, action, edits?, reason?, replyDraft? } → { item }
       action: accept | reject | edit | later | undo | flag | reopen | fix
       | delete
       (later sets the item aside for a week, Fable reviews it again then;
       delete discards an open item silently: an addition's unpublished
       record goes too, the row closes, no reply, no Undo – deleteItem;
       undo also brings back an item set aside; edit keeps the page's pending edits, and the reply draft as
       edited, on the row – nothing more; flag writes the verdict, reasons
       and reject buttons Fable gave in the chat onto the row, body
       { flag } – or { undo: true } to put back what it replaced –
       queue-flag.ts; reopen brings a declined addition back, however
       old: the Mac rebuilds a deleted record from the row's saved copy –
       queue-reopen.ts; fix writes edits straight onto the listing of an
       addition already published or a change already applied, from Done
       today). An undo that could not put a field back (a picture with no
       copy to write, queue-before-picture.ts) adds { notPutBack: [names] }.
       Accepting a rule that brings wording for the public listing policy
       also takes { public: 'apply' | 'internal', publicSeen: <the wording
       the page showed> } – queue-rule-instant.ts; without them, or with
       wording that has changed since, the accept is refused.

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
import { mapForStrip } from '@/lib/admin/queue-map'
import {
  acceptItem,
  agentInfo,
  closeHandledRows,
  deleteItem,
  fixItem,
  flagItem,
  getPageOrder,
  getQueueItem,
  getTableSchema,
  getTargetFields,
  laterItem,
  listDecided,
  listQueue,
  QueueError,
  rejectItem,
  reopenItem,
  sanitiseEdits,
  saveEdits,
  undoItem,
  unflagItem,
} from '@/lib/admin/queue'
import { parseFlag } from '@/lib/admin/queue-flag'
import { publicChoiceOf } from '@/lib/admin/queue-rule-instant'

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
    if (req.nextUrl.searchParams.get('decided') === '1') {
      return json({ items: await listDecided() })
    }
    const one = req.nextUrl.searchParams.get('id')
    if (one) {
      const item = await getQueueItem(one)
      if (!item) return json({ error: 'That item no longer exists.' }, 404)
      return json({ item })
    }
    // The Field map as it stands, for the map strip on a /map addition:
    // every listing with its place, the ones not yet published included.
    if (req.nextUrl.searchParams.get('map') === '1') {
      return json({ records: await mapForStrip() })
    }
    const orderOf = req.nextUrl.searchParams.get('order')
    if (orderOf) return json({ order: await getPageOrder(orderOf) })
    const target = req.nextUrl.searchParams.get('target')
    if (target) {
      const [table = '', record = ''] = target.split('/')
      const [read, schema] = await Promise.all([
        getTargetFields(table, record),
        getTableSchema(table),
      ])
      if (!read) return json({ error: 'That record no longer exists.' }, 404)
      return json({
        fields: read.fields,
        attachments: read.attachments,
        schema,
      })
    }
    const me = await currentAdmin()
    let items = await listQueue()
    if (
      req.nextUrl.searchParams.get('sync') === '1' &&
      (await canReviewQueue())
    ) {
      const closed = new Set(await closeHandledRows(items))
      if (closed.size) items = items.filter(i => !closed.has(i.id))
    }
    return json({ items, agent: agentInfo(me?.email ?? '') })
  } catch (e) {
    return failure(e)
  }
}

const ACTIONS = new Set([
  'accept',
  'reject',
  'edit',
  'later',
  'undo',
  'flag',
  'reopen',
  'fix',
  'delete',
])

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
    let notPutBack: string[] = []
    if (action === 'accept') {
      const choice = publicChoiceOf(body.public)
      await acceptItem(
        item,
        sanitiseEdits(body.edits),
        typeof body.replyDraft === 'string' ? body.replyDraft : null,
        // Proposed fields Fable has already changed on the record.
        Array.isArray(body.keep)
          ? body.keep.filter((k): k is string => typeof k === 'string')
          : [],
        // A rule's wording for the public listing policy: what he chose,
        // and the wording the page showed him.
        choice
          ? {
              choice,
              seen:
                typeof body.publicSeen === 'string' ? body.publicSeen : null,
            }
          : null
      )
    } else if (action === 'reject') {
      await rejectItem(
        item,
        typeof body.reason === 'string' ? body.reason : '',
        typeof body.rejectReply === 'string' ? body.rejectReply : null
      )
    } else if (action === 'edit') {
      await saveEdits(
        item,
        sanitiseEdits(body.edits),
        typeof body.replyDraft === 'string' ? body.replyDraft : undefined,
        Array.isArray(body.keys)
          ? body.keys.filter((k): k is string => typeof k === 'string')
          : undefined
      )
      return json({ item: await getQueueItem(id) })
    } else if (action === 'fix') {
      await fixItem(item, sanitiseEdits(body.edits))
    } else if (action === 'later') {
      await laterItem(item)
    } else if (action === 'delete') {
      await deleteItem(item)
    } else if (action === 'reopen') {
      await reopenItem(item)
    } else if (action === 'flag') {
      if (body.undo === true) {
        await unflagItem(item)
      } else {
        const parsed = parseFlag(body.flag, item.type)
        if ('error' in parsed) return json({ error: parsed.error }, 400)
        await flagItem(item, parsed.flag)
      }
    } else {
      notPutBack = await undoItem(item)
    }
    console.log(
      `[admin-queue] ${action} ${item.type} ${item.id} "${item.title}" by ${me?.name ?? me?.email ?? '?'}${notPutBack.length ? ` – not put back: ${notPutBack.join(', ')}` : ''}`
    )
    return json({
      item: await getQueueItem(id),
      ...(notPutBack.length ? { notPutBack } : {}),
    })
  } catch (e) {
    return failure(e)
  }
}
