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
  goto: (timeOffset: number, play?: boolean) => void
  addEventListener: (event: string, handler: (p: unknown) => unknown) => void
  $destroy: () => void
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
          skipInactive: true,
          showController: true,
        },
      }) as unknown as PlayerLike
      player.current = made
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
