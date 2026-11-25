/*
  GET /api/admin/recordings/<id>/<n>  → the n-th chunk (in order, from 0) of
      a session recording: its rrweb events as gzipped JSON, for the replay
      page (/admin/analytics/recordings/<id>), which unzips them in the
      browser. Analytics access only.
*/

import { NextRequest } from 'next/server'
import { canViewAnalytics } from '@/lib/admin/auth'
import { isRecordingId } from '@/lib/recordings/shared'
import { readChunkBytes, readRecording } from '@/lib/recordings/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; n: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!(await canViewAnalytics()))
    return new Response('unauthorized', { status: 401 })
  const { id, n: rawN } = await ctx.params
  const n = /^\d{1,4}$/.test(rawN) ? Number(rawN) : null
  if (!isRecordingId(id) || n === null)
    return new Response('bad request', { status: 400 })
  try {
    const rec = await readRecording(id)
    const chunk = rec?.chunks[n]
    if (!chunk) return new Response('not found', { status: 404 })
    const bytes = await readChunkBytes(chunk, id)
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/gzip',
        // A chunk never changes once written.
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (err) {
    console.error('[recordings] chunk read failed:', err)
    return new Response('read failed', { status: 502 })
  }
}
