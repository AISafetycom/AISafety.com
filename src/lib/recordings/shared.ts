// Session recordings: what the browser recorder and the server agree on.
//
// A sample of visits to a few key pages is recorded with rrweb, which saves
// the page as data (the DOM and every change to it, the mouse, scrolling)
// rather than as video. The browser sends the recording in chunks to
// /api/recordings; the server keeps each chunk in Vercel Blob and a short
// summary of it in the analytics database, and /admin/analytics replays them.
// Nothing here imports rrweb itself, so the summary code runs on the server
// and in tests without it.

/** Pages a recording can START on: the busiest pages, and the ones where the
 *  Chatbot and Search tabs see the most use. Once started, a recording
 *  follows the visitor to other pages until they leave (see
 *  isRecordablePath). Paths as in the address bar. */
export const RECORDING_START_PATHS: readonly string[] = [
  '/',
  '/funding',
  '/training',
  '/map',
  '/jobs',
]

/** The share of visits to those pages that get recorded, decided once per
 *  tab the first time it reaches one of them. */
export const RECORDING_SAMPLE_RATE = 0.25

/** Pages that are never recorded, even part-way through a recording: the
 *  admin, private links whose page shows someone's own data (an org's stats
 *  page, a candidate's work test, the newsletter settings opened from an
 *  email), and API routes. */
const NEVER_RECORDED = ['/admin', '/api', '/stats', '/work-test', '/newsletter']

export function isRecordablePath(pathname: string): boolean {
  return !NEVER_RECORDED.some(
    p => pathname === p || pathname.startsWith(`${p}/`)
  )
}

/** A recording stops after this long, however long the visit. */
export const MAX_RECORDING_MS = 30 * 60_000

/** A recording that has seen no mouse, touch or typing this long after it
 *  started is dropped without sending anything: almost always a bot, or a
 *  tab left open in the background. */
export const IDLE_DROP_MS = 3 * 60_000

/** Chunks per recording the server accepts (one every ~15 seconds for 30
 *  minutes is 120; reloads and tab switches add a few). */
export const MAX_CHUNKS = 200

/** Largest chunk body the server accepts, compressed. */
export const MAX_CHUNK_BYTES = 2_500_000

/** Largest chunk once decompressed. */
export const MAX_CHUNK_JSON_BYTES = 25_000_000

/** Text inside elements with this attribute is hidden in recordings, on top
 *  of every typed field (see the recorder). It marks the places a page shows
 *  back what the visitor typed: their own messages in the chatbot, and the
 *  search box's "No results for …" line. */
export const MASK_ATTRIBUTE = 'data-rr-mask'

// rrweb's event numbering (EventType, IncrementalSource, MouseInteractions in
// @rrweb/types), copied so this file doesn't need the package.
export const RR = {
  FullSnapshot: 2,
  IncrementalSnapshot: 3,
  Meta: 4,
  Custom: 5,
  // IncrementalSnapshot sources
  MouseMove: 1,
  MouseInteraction: 2,
  Input: 5,
  TouchMove: 6,
  // MouseInteraction types
  Click: 2,
  TouchStart: 7,
} as const

/** The custom event the recorder adds when the visitor moves to another
 *  page without a reload (rrweb only notes the address on a full snapshot). */
export const NAV_TAG = 'nav'

/** One rrweb event, as far as the server needs to know it. */
export interface RecEvent {
  type: number
  timestamp: number
  data?: unknown
}

/** Whether an event is the visitor doing something (moving the mouse,
 *  touching, clicking or typing). Scrolling isn't counted: pages scroll
 *  themselves (restoring a position, jumping to a #section). */
export function isInteraction(e: RecEvent): boolean {
  if (e.type !== RR.IncrementalSnapshot) return false
  const source = (e.data as { source?: unknown } | undefined)?.source
  return (
    source === RR.MouseMove ||
    source === RR.MouseInteraction ||
    source === RR.Input ||
    source === RR.TouchMove
  )
}

/** The path part of an address, or null when it isn't one. */
export function pathOf(href: unknown): string | null {
  if (typeof href !== 'string') return null
  try {
    return new URL(href, 'https://aisafety.com').pathname
  } catch {
    return null
  }
}

/** What the server keeps about one chunk. */
export interface ChunkSummary {
  /** First and last event times, by the visitor's clock. */
  t0: number
  t1: number
  /** Pages shown in this chunk, in order (paths). */
  pages: string[]
  /** Clicks and taps. */
  clicks: number
  /** The browser window's width when the chunk began, if it says. */
  width?: number
  /** Whether the chunk starts with a full copy of the page (the start of a
   *  recording, or after a reload). */
  full: boolean
}

/** Read a chunk's events into its summary. Null when they aren't a list of
 *  rrweb events (wrong shape, no timestamps). */
export function summarizeChunk(events: unknown): ChunkSummary | null {
  if (!Array.isArray(events) || events.length === 0) return null
  let t0 = Infinity
  let t1 = -Infinity
  let clicks = 0
  let width: number | undefined
  let full = false
  const pages: string[] = []
  const addPage = (p: string | null) => {
    if (p && pages[pages.length - 1] !== p) pages.push(p)
  }
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') return null
    const e = raw as RecEvent
    if (typeof e.type !== 'number' || typeof e.timestamp !== 'number')
      return null
    if (!Number.isFinite(e.timestamp)) return null
    if (e.timestamp < t0) t0 = e.timestamp
    if (e.timestamp > t1) t1 = e.timestamp
    const data = (e.data ?? {}) as Record<string, unknown>
    if (e.type === RR.Meta) {
      addPage(pathOf(data.href))
      if (width == null && typeof data.width === 'number') width = data.width
    } else if (e.type === RR.FullSnapshot) {
      full = true
    } else if (e.type === RR.Custom && data.tag === NAV_TAG) {
      addPage(pathOf((data.payload as { path?: unknown } | undefined)?.path))
    } else if (
      e.type === RR.IncrementalSnapshot &&
      data.source === RR.MouseInteraction &&
      data.type === RR.Click
    ) {
      clicks++
    }
  }
  return { t0, t1, pages, clicks, width, full }
}

/** A recording id: a random UUID made by the browser. */
export function isRecordingId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  )
}
