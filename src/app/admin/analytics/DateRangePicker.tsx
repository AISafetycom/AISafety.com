'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import styles from './analytics.module.css'

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
]

export default function DateRangePicker({
  activeKey,
  from,
  to,
}: {
  activeKey: string
  from?: string
  to?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [customFrom, setCustomFrom] = useState(from ?? '')
  const [customTo, setCustomTo] = useState(to ?? '')
  // The new range takes a moment to load, so the clicked preset lights up at
  // once (and the figures below fade, via data-pending) until it arrives.
  const [pending, startTransition] = useTransition()
  const [clicked, setClicked] = useState<string | null>(null)
  const shownKey = pending && clicked ? clicked : activeKey

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

  const setPreset = (key: string) => {
    setCustomFrom('')
    setCustomTo('')
    const params = carryOver()
    params.set('range', key)
    setClicked(key)
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }
  const applyCustom = () => {
    const params = carryOver()
    if (customFrom) params.set('from', customFrom)
    if (customTo) params.set('to', customTo)
    const qs = params.toString()
    setClicked('custom')
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  return (
    <div className={styles.rangeBar}>
      <span hidden data-pending={pending || undefined} />
      <div className={styles.presets}>
        {PRESETS.map(p => (
          <button
            key={p.key}
            type="button"
            className={`${styles.presetBtn} ${shownKey === p.key ? styles.presetBtnActive : ''}`}
            onClick={() => setPreset(p.key)}
          >
            {p.label}
          </button>
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
