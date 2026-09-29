'use client'

/*
  The send watcher's open alerts, as a red banner at the top of
  /admin/newsletter. The watcher (a cron every 10 minutes, see
  src/lib/admin/newsletter-watch.ts) has already emailed each one; this is
  the same list, so a problem is also in front of whoever opens the page.
  Nothing shows while all is well. Also warns when the watcher itself has
  stopped running, since then nothing is being watched.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './NewsletterAlerts.module.css'

interface Alert {
  id: string
  severity: 'red' | 'amber'
  title: string
  detail: string[]
  since: string
}

interface AlertsView {
  lastRunAt: string | null
  stale: boolean
  alerts: Alert[]
}

const POLL_MS = 60_000

function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function NewsletterAlerts() {
  const [view, setView] = useState<AlertsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await fetch('/api/admin/newsletter/alerts', {
        cache: 'no-store',
      })
      const body = (await res.json()) as AlertsView & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setView(body)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Reread every minute while the tab is visible, and straight away when
  // it comes back into view. A hidden tab reads nothing.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  if (error && !view) {
    return (
      <p className={styles.readError}>
        Couldn’t check the send watcher’s alerts: {error}
      </p>
    )
  }
  if (!view || (view.alerts.length === 0 && !view.stale)) return null

  const n = view.alerts.length
  const red = view.alerts.some(a => a.severity === 'red') || view.stale
  return (
    <div
      role="alert"
      className={`${styles.banner} ${red ? styles.bannerRed : styles.bannerAmber}`}
    >
      {n > 0 && (
        <p className={styles.heading}>
          {n === 1
            ? 'The send watcher found a problem'
            : `The send watcher found ${n} problems`}
        </p>
      )}
      {n > 0 && (
        <ul className={styles.list}>
          {view.alerts.map(a => (
            <li
              key={a.id}
              className={
                a.severity === 'red' ? styles.itemRed : styles.itemAmber
              }
            >
              <span className={styles.title}>{a.title}</span>
              <span className={styles.since}> · since {when(a.since)}</span>
              {a.detail.map((line, i) => (
                <span key={i} className={styles.detail}>
                  {line}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {view.stale && (
        <p className={styles.stale}>
          {view.lastRunAt
            ? `The send watcher last ran ${when(view.lastRunAt)}. It should run every 10 minutes, so nothing is being watched right now.`
            : 'The send watcher hasn’t run yet, so nothing is being watched right now.'}
        </p>
      )}
      {n > 0 && (
        <p className={styles.footnote}>
          The watcher also emails each problem once, a few emails an hour at
          most. The banner clears by itself once the watcher sees the problem is
          gone.
        </p>
      )}
    </div>
  )
}
