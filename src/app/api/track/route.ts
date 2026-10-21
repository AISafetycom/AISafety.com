import { NextRequest, after } from 'next/server'
import {
  recordEvent,
  allowTrack,
  ALLOWED_EVENT_TYPES,
  type AnalyticsEvent,
} from '@/lib/analytics/events'
import { getClientIp } from '@/lib/assistant/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// First-party analytics ingest. Public (like the assistant log endpoint) — it's
// a fire-and-forget beacon from the browser. Validation is intentionally light
// but every field is length-capped so a bad/abusive payload can't bloat storage.

/** Coerce an unknown to a trimmed, length-capped string, or undefined. */
function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!s) return undefined
  return s.length > max ? s.slice(0, max) : s
}

/** Coerce an unknown to a capped non-negative integer, or undefined. */
function count(v: unknown, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined
  return Math.min(Math.round(v), max)
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('invalid JSON', { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return new Response('invalid event', { status: 400 })
  }
  const b = body as Record<string, unknown>
  const type = str(b.type, 64)
  // Only known event kinds are accepted — this keeps a public caller from
  // minting unlimited counter entries in the shared Redis database.
  if (!type || !ALLOWED_EVENT_TYPES.has(type)) {
    return new Response('invalid type', { status: 400 })
  }

  const event: AnalyticsEvent = {
    type,
    page: str(b.page, 64),
    listingId: str(b.listingId, 64),
    label: str(b.label, 300),
    position: str(b.position, 16),
    // 32, not 16: filter_apply events carry the filter group's title here
    // (longest today: 'Accepting applications', 22 chars).
    source: str(b.source, 32),
    area: str(b.area, 64),
    query: str(b.query, 200),
    results: count(b.results, 100_000),
    url: str(b.url, 600),
    ref: str(req.headers.get('referer'), 600),
    vid: str(b.vid, 64),
    ts: new Date().toISOString(), // server clock, not the client's
  }

  const ip = getClientIp(req.headers)
  // after() keeps the function alive until the write completes; a bare promise
  // gets frozen once the 204 returns and the event would be lost on Vercel. The
  // rate-limit check runs here too so it never delays the beacon response.
  after(async () => {
    if (await allowTrack(ip)) await recordEvent(event)
  })
  // The same answer on a preview deployment, which records nothing
  // (writesSharedStore in events.ts): the page can't tell the difference.
  return new Response(null, { status: 204 })
}
