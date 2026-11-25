// The browser side of session recordings (see shared.ts for the whole story).
//
// SessionRecorder (src/components) calls onRoute() on every page change. The
// first time a tab reaches one of RECORDING_START_PATHS it is put in or out
// of the sample, once; a tab in the sample loads rrweb (only then, and only
// once the page has finished loading) and records until the visitor leaves,
// MAX_RECORDING_MS passes, or analytics is switched off.
//
// Nothing is sent until the visitor first moves the mouse, touches the screen
// or types, so bots and background tabs never leave a recording. After that
// the recording goes to /api/recordings in chunks: every FLUSH_EVERY_MS, and
// when the tab is hidden or closed. Every typed field is masked in the
// browser, before anything leaves it.
//
// Recording is analytics, so like the tracking beacon it is fire-and-forget:
// a failure here is swallowed (with a console warning) and never breaks the
// page.

import {
  TRACKING_OFF_EVENT,
  getVisitorId,
  isTrackingOptedOut,
} from '@/lib/analytics'
import { isLiveSiteHost } from '@/lib/live-site'
import {
  IDLE_DROP_MS,
  MASK_ATTRIBUTE,
  MAX_RECORDING_MS,
  NAV_TAG,
  RECORDING_SAMPLE_RATE,
  RECORDING_START_PATHS,
  RR,
  isInteraction,
  isRecordablePath,
  type RecEvent,
} from './shared'

const ENDPOINT = '/api/recordings'
// One tab's recording: its id, whether it's in the sample, and how far it got.
// sessionStorage, so a reload carries on with the same recording and a new
// tab gets its own.
const SESSION_KEY = 'aisafety_rec'
// Local development only: '1' puts every tab in the sample, so the recorder
// can be tried without rolling the dice (and in an automated browser).
const FORCE_KEY = 'aisafety_rec_force'
const FLUSH_EVERY_MS = 15_000
// Send early when this many events pile up (a busy page's mutations).
const FLUSH_AT_EVENTS = 3_000
// sendBeacon and keepalive fetches are capped at 64 KB in browsers.
const BEACON_MAX_CHARS = 60_000

interface RecSession {
  id: string
  /** In the sample. */
  on: boolean
  /** When the recording began (epoch ms). */
  start: number
  /** The next chunk's number. */
  seq: number
  /** The visitor has interacted, so chunks are being sent. */
  armed: boolean
}

type RecordFn = typeof import('@rrweb/record').record

let session: RecSession | null = null
let recordFn: RecordFn | null = null
let loading: Promise<RecordFn | null> | null = null
let stopFn: (() => void) | null = null
let buffer: RecEvent[] = []
let lastPath: string | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let tick: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let listening = false

function readSession(): RecSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as RecSession) : null
  } catch {
    return null
  }
}

function saveSession(): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Storage unavailable: the recording still works for this page.
  }
}

function forced(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  try {
    return localStorage.getItem(FORCE_KEY) === '1'
  } catch {
    return false
  }
}

/** Whether this copy of the site records at all: the live site, or a dev
 *  server with the force flag. Previews and translation proxies don't, and
 *  neither do automated browsers. */
function recordsHere(): boolean {
  if (forced()) return true
  if (!isLiveSiteHost(location.hostname)) return false
  if (location.hostname.endsWith('.translate.goog')) return false
  return !navigator.webdriver
}

function newId(): string {
  return crypto.randomUUID()
}

/** Called on every page change (and the first page). */
export function onRoute(pathname: string): void {
  try {
    route(pathname)
  } catch (err) {
    console.warn('[recordings] route handling failed', err)
  }
}

function route(pathname: string): void {
  if (typeof window === 'undefined' || !recordsHere()) return
  if (isTrackingOptedOut()) {
    abandon()
    return
  }
  session ??= readSession()
  if (!session) {
    if (!RECORDING_START_PATHS.includes(pathname)) return
    session = {
      id: newId(),
      on: forced() || Math.random() < RECORDING_SAMPLE_RATE,
      start: Date.now(),
      seq: 0,
      armed: false,
    }
    saveSession()
  }
  if (!session.on) return
  if (Date.now() - session.start > MAX_RECORDING_MS) {
    finish()
    return
  }
  if (!isRecordablePath(pathname)) {
    stop()
    lastPath = null
    return
  }
  if (stopFn) {
    if (pathname !== lastPath) {
      lastPath = pathname
      recordFn?.addCustomEvent(NAV_TAG, { path: pathname })
    }
    return
  }
  lastPath = pathname
  whenPageIsLoaded(() => void begin(pathname))
}

function whenPageIsLoaded(fn: () => void): void {
  const idle = () =>
    'requestIdleCallback' in window
      ? window.requestIdleCallback(fn, { timeout: 4000 })
      : setTimeout(fn, 1500)
  if (document.readyState === 'complete') idle()
  else window.addEventListener('load', idle, { once: true })
}

function loadRecorder(): Promise<RecordFn | null> {
  loading ??= import('@rrweb/record')
    .then(m => (recordFn = m.record))
    .catch(err => {
      console.warn('[recordings] recorder failed to load', err)
      loading = null
      return null
    })
  return loading
}

async function begin(pathname: string): Promise<void> {
  const record = await loadRecorder()
  // The visitor may have moved on, or switched analytics off, meanwhile.
  if (!record || stopFn || !session?.on || lastPath !== pathname) return
  if (isTrackingOptedOut()) return
  listen()
  try {
    stopFn =
      record({
        emit: e => onEvent(e as RecEvent),
        // Everything a visitor types shows as asterisks: text boxes, the
        // chatbot's box, search boxes, email fields. Choices (dropdowns,
        // sliders, checkboxes) stay visible.
        maskInputOptions: {
          text: true,
          textarea: true,
          search: true,
          email: true,
          tel: true,
          url: true,
          number: true,
          password: true,
          date: true,
          'datetime-local': true,
          month: true,
          week: true,
          time: true,
        },
        // And the places the page shows typed text back (MASK_ATTRIBUTE).
        maskTextSelector: `[${MASK_ATTRIBUTE}]`,
        slimDOMOptions: 'all',
        recordCanvas: false,
        collectFonts: false,
        inlineImages: false,
        sampling: { mousemove: 100, scroll: 150, input: 'last' },
        // A recording must never break the page.
        errorHandler: err => {
          console.warn('[recordings] recorder error', err)
          return true
        },
      }) ?? null
  } catch (err) {
    console.warn('[recordings] recorder failed to start', err)
    stopFn = null
    return
  }
  tick ??= setInterval(onTick, FLUSH_EVERY_MS)
  if (!session.armed) startIdleClock()
}

function onEvent(e: RecEvent): void {
  if (!session) return
  if (e.type === RR.Meta) {
    // The address without its query or #fragment, which can carry what a
    // visitor typed into a filter, or a key.
    const data = e.data as { href?: string }
    data.href = location.origin + location.pathname
  }
  buffer.push(e)
  if (!session.armed && isInteraction(e)) {
    session.armed = true
    saveSession()
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    flushSoon()
  } else if (
    session.armed &&
    (e.type === RR.FullSnapshot || buffer.length >= FLUSH_AT_EVENTS)
  ) {
    flushSoon()
  }
}

/** Drop the recording if nobody interacts with the page for IDLE_DROP_MS
 *  while it's on screen. */
function startIdleClock(): void {
  if (idleTimer) clearTimeout(idleTimer)
  if (document.visibilityState !== 'visible') return
  idleTimer = setTimeout(() => {
    if (session && !session.armed) finish({ send: false })
  }, IDLE_DROP_MS)
}

function onTick(): void {
  if (!session) return
  if (Date.now() - session.start > MAX_RECORDING_MS) finish()
  else flush()
}

function flushSoon(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, 1000)
}

function listen(): void {
  if (listening) return
  listening = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush({ leaving: true })
    else if (session && !session.armed && stopFn) startIdleClock()
  })
  window.addEventListener('pagehide', () => flush({ leaving: true }))
  window.addEventListener(TRACKING_OFF_EVENT, abandon)
}

/** Send what's buffered. `leaving`: the tab is being hidden or closed, so
 *  send it now, uncompressed, in a way that survives the page going away. */
function flush({ leaving = false }: { leaving?: boolean } = {}): void {
  if (!session?.armed || buffer.length === 0) return
  if (isTrackingOptedOut()) {
    abandon()
    return
  }
  const events = buffer
  buffer = []
  const seq = session.seq++
  saveSession()
  const body = JSON.stringify({ v: 1, vid: getVisitorId(), events })
  const url = `${ENDPOINT}?id=${session.id}&seq=${seq}`
  if (leaving && body.length <= BEACON_MAX_CHARS) {
    try {
      if (
        navigator.sendBeacon(
          `${url}&enc=json`,
          new Blob([body], { type: 'application/json' })
        )
      )
        return
    } catch {
      // Fall through to the compressed send.
    }
  }
  void send(url, body)
}

async function send(url: string, body: string): Promise<void> {
  try {
    const gz = await gzip(body)
    const payload = gz ?? body
    const size = gz ? gz.size : body.length
    await fetch(`${url}&enc=${gz ? 'gzip' : 'json'}`, {
      method: 'POST',
      headers: {
        'Content-Type': gz ? 'application/octet-stream' : 'application/json',
      },
      body: payload,
      keepalive: size <= BEACON_MAX_CHARS,
    })
  } catch (err) {
    // Fire-and-forget, like the tracking beacon.
    console.warn('[recordings] chunk upload failed', err)
  }
}

async function gzip(text: string): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([text])
      .stream()
      .pipeThrough(new CompressionStream('gzip'))
    return await new Response(stream).blob()
  } catch {
    return null
  }
}

/** Stop recording for now (the visitor went to a page that's never
 *  recorded), sending what's buffered. A later recordable page starts it
 *  again with a fresh copy of that page. */
function stop(): void {
  if (!stopFn) return
  try {
    stopFn()
  } catch {
    // Already stopped.
  }
  stopFn = null
  flush()
}

/** End this tab's recording for good. */
function finish({ send: sendRest = true }: { send?: boolean } = {}): void {
  if (sendRest) stop()
  else {
    try {
      stopFn?.()
    } catch {
      // Already stopped.
    }
    stopFn = null
    buffer = []
  }
  if (tick) clearInterval(tick)
  tick = null
  if (session) {
    session.on = false
    saveSession()
  }
}

/** Analytics was switched off: stop, and send nothing more. */
function abandon(): void {
  buffer = []
  finish({ send: false })
}
