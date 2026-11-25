'use client'

// Plays a recorded visit with rrweb-player, next to the list of what the
// visitor did; a line in the list jumps the replay to that moment.

import 'rrweb-player/dist/style.css'
import { useEffect, useRef, useState } from 'react'
import styles from '../../analytics.module.css'

export interface Moment {
  /** Server-clock epoch ms. */
  at: number
  pill?: string
  label: string
}

interface RecEvent {
  type: number
  timestamp: number
}

/** The parts of rrweb-player this page uses. */
interface PlayerLike {
  /** Leaves it playing or paused as it was, unless `play` says. */
  goto: (timeOffset: number, play?: boolean) => void
  toggle: () => void
  setSpeed: (speed: number) => void
  toggleFullscreen: () => void
  getMetaData: () => { totalTime: number }
  getReplayer: () => {
    getCurrentTime: () => number
    config: { speed: number }
    service: { state: { value: string } }
  }
  addEventListener: (event: string, handler: (p: unknown) => unknown) => void
  $destroy: () => void
}

// The player's speed buttons; < and > step through them.
const SPEEDS = [0.5, 1, 2, 4, 8]
// One frame at 30 a second, for , and . while paused (as on YouTube).
const FRAME_MS = 1000 / 30

/** YouTube's keyboard shortcuts, on the replay. Returns whether the key was
 *  one of them. */
function handleKey(p: PlayerLike, key: string): boolean {
  const replayer = p.getReplayer()
  const now = replayer.getCurrentTime()
  const total = p.getMetaData().totalTime
  const seek = (ms: number) => p.goto(Math.max(0, Math.min(total, ms)))
  const paused = replayer.service.state.value !== 'playing'
  switch (key) {
    case ' ':
    case 'k':
    case 'K':
      p.toggle()
      return true
    case 'j':
    case 'J':
      seek(now - 10_000)
      return true
    case 'l':
    case 'L':
      seek(now + 10_000)
      return true
    case 'ArrowLeft':
      seek(now - 5_000)
      return true
    case 'ArrowRight':
      seek(now + 5_000)
      return true
    case 'Home':
      seek(0)
      return true
    case 'End':
      seek(total)
      return true
    case ',':
    case '.':
      if (paused) seek(now + (key === '.' ? FRAME_MS : -FRAME_MS))
      return true
    case '<':
    case '>': {
      const i = SPEEDS.indexOf(replayer.config.speed)
      const next =
        SPEEDS[
          Math.max(
            0,
            Math.min(
              SPEEDS.length - 1,
              (i < 0 ? 1 : i) + (key === '>' ? 1 : -1)
            )
          )
        ]
      p.setSpeed(next)
      return true
    }
    case 'f':
    case 'F':
      p.toggleFullscreen()
      return true
  }
  if (/^[0-9]$/.test(key)) {
    seek((total * Number(key)) / 10)
    return true
  }
  return false
}

// rrweb's FullSnapshot event: a replay can't begin without one.
const FULL_SNAPSHOT = 2
// Start a jump a moment early, to see what led up to it.
const LEAD_IN_MS = 2000

async function loadChunk(id: string, n: number): Promise<RecEvent[]> {
  const res = await fetch(`/api/admin/recordings/${id}/${n}`)
  if (!res.ok || !res.body) throw new Error(`part ${n}: HTTP ${res.status}`)
  const unzipped = res.body.pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(unzipped).text()) as RecEvent[]
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function ReplayPlayer({
  id,
  chunkCount,
  offset,
  startAt,
  moments,
}: {
  id: string
  chunkCount: number
  /** Add to the visitor's clock to get the server's. */
  offset: number
  /** Server-clock epoch ms to start at; plays from the start without. */
  startAt?: number
  moments: Moment[]
}) {
  const box = useRef<HTMLDivElement>(null)
  const player = useRef<PlayerLike | null>(null)
  // The first event's time on the visitor's clock: the replay's 0:00.
  const [first, setFirst] = useState<number | null>(null)
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'failed' | 'no-start'
  >('loading')
  const [missing, setMissing] = useState(0)
  const [now, setNow] = useState(0)

  useEffect(() => {
    let cancelled = false
    let made: PlayerLike | null = null
    ;(async () => {
      const parts = await Promise.allSettled(
        Array.from({ length: chunkCount }, (_, n) => loadChunk(id, n))
      )
      const events = parts
        .flatMap(p => (p.status === 'fulfilled' ? p.value : []))
        .sort((a, b) => a.timestamp - b.timestamp)
      const failed = parts.filter(p => p.status === 'rejected')
      for (const f of failed)
        console.warn('[recordings] part failed to load', f.reason)
      if (cancelled) return
      setMissing(failed.length)
      if (events.length < 2) {
        setStatus('failed')
        return
      }
      if (!events.some(e => e.type === FULL_SNAPSHOT)) {
        setStatus('no-start')
        return
      }
      const { default: Player } = await import('rrweb-player')
      if (cancelled || !box.current) return
      const width = box.current.clientWidth
      made = new Player({
        target: box.current,
        props: {
          events: events as never,
          width,
          height: Math.round(width * 0.6),
          autoPlay: startAt == null,
          speedOption: SPEEDS,
          skipInactive: true,
          showController: true,
        },
      }) as unknown as PlayerLike
      player.current = made
      // The controls start on the first speed option (0.5x) whatever the
      // replay's own speed; the player doesn't pass its `speed` on.
      made.setSpeed(1)
      const t0 = events[0].timestamp
      made.addEventListener('ui-update-current-time', p =>
        setNow((p as { payload: number }).payload)
      )
      if (startAt != null)
        made.goto(Math.max(0, startAt - offset - t0 - LEAD_IN_MS), true)
      setFirst(t0)
      setStatus('ready')
    })().catch(err => {
      console.error('[recordings] replay failed', err)
      if (!cancelled) setStatus('failed')
    })
    return () => {
      cancelled = true
      made?.$destroy()
      player.current = null
    }
  }, [id, chunkCount, offset, startAt])

  // Keyboard shortcuts, anywhere on the page but a text box.
  useEffect(() => {
    if (status !== 'ready') return
    const onKey = (e: KeyboardEvent) => {
      const p = player.current
      // The player's own timeline already moved for this key.
      if (!p || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t?.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '')
      )
        return
      if (!handleKey(p, e.key)) return
      e.preventDefault()
      // A focused button (play, a speed, a line in the list) would also
      // take the Space press.
      if (document.activeElement instanceof HTMLButtonElement)
        document.activeElement.blur()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status])

  const at = (m: Moment) =>
    first == null ? 0 : Math.max(0, m.at - offset - first)

  return (
    <div className={styles.replayLayout}>
      <div>
        {status === 'loading' && (
          <p className={styles.dim}>Loading the recording…</p>
        )}
        {status === 'failed' && (
          <div className={styles.empty}>
            This recording couldn&apos;t be loaded.
          </div>
        )}
        {status === 'no-start' && (
          <div className={styles.empty}>
            The start of this recording never arrived (the visitor&apos;s
            connection, most likely), so it can&apos;t be played.
          </div>
        )}
        <div ref={box} className={styles.replayFrame} />
        {status === 'ready' && (
          <p className={styles.caption}>
            Keys, as on YouTube: Space or K play and pause, J and L go 10
            seconds back or forward, ← and → 5 seconds, 0 to 9 jump through the
            visit, Home and End go to the start and end, &lt; and &gt; change
            the speed, , and . step one frame while paused, F is full screen.
          </p>
        )}
        {missing > 0 && status === 'ready' && (
          <p className={styles.caption}>
            {missing} of {chunkCount} parts couldn&apos;t be loaded, so the
            replay skips those stretches.
          </p>
        )}
      </div>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>What they did</h2>
        {moments.length === 0 ? (
          <p className={styles.dim}>
            Nothing else recorded for this browser during the visit: no listing
            clicks, searches or chatbot use.
          </p>
        ) : (
          <ul className={styles.recent}>
            {moments.map((m, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={`${styles.momentBtn}${
                    first != null && at(m) > now ? ` ${styles.momentLater}` : ''
                  }`}
                  disabled={status !== 'ready'}
                  onClick={() =>
                    player.current?.goto(Math.max(0, at(m) - LEAD_IN_MS), true)
                  }
                >
                  <span className={styles.recentTime}>
                    {first == null ? '–' : clock(at(m))}
                  </span>
                  {m.pill && <span className={styles.pill}>{m.pill}</span>}
                  <span className={styles.momentLabel}>{m.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.caption}>
          From the rest of the analytics, for the same browser over the same
          minutes. Click a line to jump there.
        </p>
      </section>
    </div>
  )
}
