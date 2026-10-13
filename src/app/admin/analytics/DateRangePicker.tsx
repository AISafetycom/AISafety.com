'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import PendingMark from './PendingMark'
import PreloadLink from './PreloadLink'
import styles from './analytics.module.css'

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
]
// The presets are preloaded like the dashboard's tabs, so a click shows the
// range at once. These two only once the pointer is on them: they read months
// the shorter ranges don't, and preloading them on every visit would have the
// server download and hold the whole store each time.
const PRELOAD_ON_HOVER = new Set(['90d', 'all'])

export default function DateRangePicker({
  activeKey,
  from,
  to,
  preloadAll,
}: {
  activeKey: string
  from?: string
  to?: string
  /** Whether the page preloads its links straight away (see page.tsx); when
   *  not, every preset waits for the pointer too. */
  preloadAll: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [customFrom, setCustomFrom] = useState(from ?? '')
  const [customTo, setCustomTo] = useState(to ?? '')
  // A custom range takes a moment to load, so the preset it replaces steps
  // back at once (and the figures below fade, via data-pending) until it
  // arrives. The preset links do the same through PendingMark.
  const [pending, startTransition] = useTransition()
  const shownKey = pending ? 'custom' : activeKey

  // Keep the rest of the query (active tab, count mode, source filter) when the
  // date changes — only the date params (range/from/to) get swapped, so changing
  // the range no longer kicks you back to the Overview tab.
  const carryOver = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('range')
    params.delete('from')
    params.delete('to')
    return params
  }

  const presetHref = (key: string) => {
    const params = carryOver()
    params.set('range', key)
    return `${pathname}?${params.toString()}`
  }
  const applyCustom = () => {
    const params = carryOver()
    if (customFrom) params.set('from', customFrom)
    if (customTo) params.set('to', customTo)
    const qs = params.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  return (
    <div className={styles.rangeBar}>
      <span hidden data-pending={pending || undefined} />
      <div className={styles.presets}>
        {PRESETS.map(p => (
          <PreloadLink
            key={p.key}
            href={presetHref(p.key)}
            scroll={false}
            preload={
              p.key === activeKey
                ? 'off'
                : preloadAll && !PRELOAD_ON_HOVER.has(p.key)
                  ? 'now'
                  : 'hover'
            }
            onClick={() => {
              setCustomFrom('')
              setCustomTo('')
            }}
            className={`${styles.presetBtn} ${shownKey === p.key ? styles.presetBtnActive : ''}`}
          >
            {p.label}
            <PendingMark />
          </PreloadLink>
        ))}
      </div>
      <div className={styles.custom}>
        <input
          type="date"
          value={customFrom}
          max={customTo || undefined}
          onChange={e => setCustomFrom(e.target.value)}
          className={styles.dateInput}
          aria-label="From date"
        />
        <span className={styles.rangeDash}>→</span>
        <input
          type="date"
          value={customTo}
          min={customFrom || undefined}
          onChange={e => setCustomTo(e.target.value)}
          className={styles.dateInput}
          aria-label="To date"
        />
        <button
          type="button"
          className={styles.applyBtn}
          onClick={applyCustom}
          disabled={!customFrom && !customTo}
        >
          Apply
        </button>
      </div>
    </div>
  )
}
