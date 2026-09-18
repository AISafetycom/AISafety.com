/*
  Admin map editor API.

  GET  /api/admin/map      → { fetchedAt, records }  (live Airtable read,
                             published + unpublished, Hide? excluded)
  PATCH /api/admin/map     → body { id, x, y, expected? }
                             writes ONLY x and y on that record
                          → body { id, scale, expected? }
                             writes ONLY Scale (Small/Medium/Large)

  GET needs the mapEditor area (canViewMap); PATCH needs its edit grant
  (canEditMap). Never revalidates any cache or path: the public /map keeps refreshing on its own schedule.
*/

import { NextRequest } from 'next/server'
import { canEditMap, canViewMap } from '@/lib/admin/auth'
import {
  getMapState,
  isMapEditorConfigured,
  listMapRecordsLive,
  updateMapPosition,
  updateMapScale,
} from '@/lib/admin/map-editor'
import {
  isScaleBody,
  samePosition,
  validateMoveBody,
  validateScaleBody,
  ValidationError,
} from '@/lib/admin/map-editor-core'

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
  const allowed = write ? await canEditMap() : await canViewMap()
  if (!allowed) return json({ error: 'unauthorized' }, 401)
  if (!isMapEditorConfigured()) {
    return json({ error: 'AIRTABLE_TOKEN / AIRTABLE_BASE_ID not set' }, 503)
  }
  return null
}

export async function GET() {
  const auth = await ensureAuth(false)
  if (auth) return auth
  try {
    const records = await listMapRecordsLive()
    return json({ fetchedAt: new Date().toISOString(), records })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[map-editor] list failed: ${message}`)
    return json(
      { error: 'Airtable read failed; details are in the server log.' },
      502
    )
  }
}

/** Airtable read/write problems come back to the editor as a visible error
 *  (never swallowed); the details go to the server log too. Airtable's rate
 *  limit (5 req/s per base, then a ~30 s lockout) comes back as 429 so the
 *  editor can wait and retry rather than give up. */
function airtableFailure(id: string, what: string, err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[map-editor] ${what} failed for ${id}: ${message}`)
  const rateLimited = /\b429\b/.test(message) && /RATE_LIMIT/.test(message)
  // Airtable's own error text stays in the log: it can name tables and
  // fields, and the editor only needs the status to decide what to do.
  return json(
    {
      error: rateLimited
        ? 'Airtable is rate-limiting; try again in about 30 seconds.'
        : `Airtable ${what} failed; details are in the server log.`,
    },
    rateLimited ? 429 : 502
  )
}

export async function PATCH(req: NextRequest) {
  const auth = await ensureAuth(true)
  if (auth) return auth

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'body must be JSON' }, 400)
  }

  // ── Scale change ─────────────────────────────────────────────────────────
  if (isScaleBody(body)) {
    let change
    try {
      change = validateScaleBody(body)
    } catch (err) {
      if (err instanceof ValidationError)
        return json({ error: err.message }, 400)
      throw err
    }
    try {
      const current = await getMapState(change.id)
      if (current === null) return json({ error: 'record not found' }, 404)
      if (change.expected !== undefined && current.scale !== change.expected) {
        return json({ error: 'stale', current: { scale: current.scale } }, 409)
      }
      const stored = await updateMapScale(change.id, change.scale)
      console.info(
        `[map-editor] ${change.id}: Scale ${current.scale ?? '(unset)'} → ${stored.scale}`
      )
      return json({ record: { id: change.id, ...stored } })
    } catch (err) {
      return airtableFailure(change.id, 'scale change', err)
    }
  }

  // ── Move ─────────────────────────────────────────────────────────────────
  let move
  try {
    move = validateMoveBody(body)
  } catch (err) {
    if (err instanceof ValidationError) return json({ error: err.message }, 400)
    throw err
  }

  try {
    const current = await getMapState(move.id)
    if (current === null) return json({ error: 'record not found' }, 404)

    if (move.expected && !samePosition(current, move.expected)) {
      return json(
        { error: 'stale', current: { x: current.x, y: current.y } },
        409
      )
    }

    const stored = await updateMapPosition(move.id, move.x, move.y)
    console.info(
      `[map-editor] ${move.id}: (${current.x}, ${current.y}) → (${stored.x}, ${stored.y})`
    )
    return json({ record: { id: move.id, ...stored } })
  } catch (err) {
    return airtableFailure(move.id, 'move', err)
  }
}
