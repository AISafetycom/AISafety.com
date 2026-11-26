import { NextRequest, after } from 'next/server'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { getClientIp } from '@/lib/assistant/rate-limit'
import {
  MAX_CHUNKS,
  MAX_CHUNK_BYTES,
  MAX_CHUNK_JSON_BYTES,
  isRecordingId,
  summarizeChunk,
} from '@/lib/recordings/shared'
import { saveChunk } from '@/lib/recordings/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const gunzipAsync = promisify(gunzip)

// Session recording chunks from the browser (src/lib/recordings/recorder.ts).
// Public, like /api/track: the body is checked to be a list of rrweb events
// before anything is kept, and size, rate and daily caps bound what a caller
// can store (src/lib/recordings/store.ts). The answer is 204 whatever
// happens to the chunk, so the page learns nothing from it.

export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const id = q.get('id')
  const seq = Number(q.get('seq'))
  const enc = q.get('enc')
  if (
    !isRecordingId(id) ||
    !Number.isInteger(seq) ||
    seq < 0 ||
    seq >= MAX_CHUNKS * 2 ||
    (enc !== 'gzip' && enc !== 'json')
  )
    return new Response('bad chunk', { status: 400 })
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_CHUNK_BYTES)
    return new Response('too large', { status: 413 })

  const raw = new Uint8Array(await req.arrayBuffer())
  if (raw.length === 0 || raw.length > MAX_CHUNK_BYTES)
    return new Response('bad size', { status: 413 })

  let text: string
  try {
    text =
      enc === 'gzip'
        ? (
            await gunzipAsync(raw, { maxOutputLength: MAX_CHUNK_JSON_BYTES })
          ).toString('utf8')
        : new TextDecoder().decode(raw)
  } catch {
    return new Response('bad body', { status: 400 })
  }
  let body: { v?: unknown; vid?: unknown; events?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return new Response('bad JSON', { status: 400 })
  }
  const events = body?.events
  if (body?.v !== 1 || !Array.isArray(events) || !summarizeChunk(events))
    return new Response('bad events', { status: 400 })
  const vid =
    typeof body.vid === 'string' && body.vid.length <= 64 ? body.vid : undefined

  const ip = getClientIp(req.headers)
  // after() keeps the function alive until the write completes (see
  // /api/track). Like that beacon, a failed write is logged and dropped:
  // a recording must never cost the visitor anything.
  after(async () => {
    try {
      const result = await saveChunk({ id, seq, vid, events, ip })
      if (result !== 'saved')
        console.warn(`[recordings] chunk ${id}/${seq} not kept: ${result}`)
    } catch (err) {
      console.warn(
        `[recordings] chunk write failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  })
  return new Response(null, { status: 204 })
}
