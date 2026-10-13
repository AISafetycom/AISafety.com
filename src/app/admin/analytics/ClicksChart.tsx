'use client'

import { useState } from 'react'
import { chartDateLabels } from '@/lib/analytics/chart-dates'
import styles from './analytics.module.css'

/** A small one-series column chart: clicks per day (or week). Each column is
 *  its own hover and focus target and shows its date and count; the same
 *  numbers are in the table underneath, so nothing hides behind a hover. */
export default function ClicksChart({
  points,
  unit,
}: {
  points: { start: string; count: number }[]
  unit: 'day' | 'week'
}) {
  const [active, setActive] = useState<number | null>(null)
  if (points.length === 0) return null
  const max = Math.max(...points.map(p => p.count))
  const top = niceCeil(max)
  // Gridlines at the top, halfway (when that's a whole number) and zero.
  const ticks =
    top === 0 ? [0] : Number.isInteger(top / 2) ? [top, top / 2, 0] : [top, 0]
  const when = (start: string) =>
    unit === 'week' ? `Week of ${longDay(start)}` : longDay(start)
  const shown = active == null ? null : points[active]

  return (
    <div className={styles.chart}>
      <div className={styles.chartReadout} aria-live="polite">
        {shown ? (
          <>
            <strong>{clicksLabel(shown.count)}</strong>{' '}
            <span>{when(shown.start)}</span>
          </>
        ) : (
          <span>Point at a column for its date and count</span>
        )}
      </div>
      <div className={styles.chartBody}>
        <div className={styles.chartAxis} aria-hidden>
          {ticks.map(t => (
            <span key={t}>{t.toLocaleString()}</span>
          ))}
        </div>
        <div
          className={styles.chartPlot}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map(t => (
            <span
              key={t}
              className={styles.chartGrid}
              style={{ bottom: `${top ? (t / top) * 100 : 0}%` }}
              aria-hidden
            />
          ))}
          {points.map((p, i) => (
            <button
              key={p.start}
              type="button"
              className={`${styles.chartCol}${i === active ? ` ${styles.chartColActive}` : ''}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${when(p.start)}, ${clicksLabel(p.count)}`}
            >
              {p.count > 0 && (
                <span
                  className={styles.chartBar}
                  style={{ height: `${(p.count / top) * 100}%` }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
      {/* Each date spans its own column; the CSS hides the data-keep 1s, then
          the 2s, as the chart narrows, and shows a year from its
          data-year-from thinning on. */}
      <div className={styles.chartDates} aria-hidden>
        {chartDateLabels(points.map(p => p.start)).map(l => (
          <span
            key={l.index}
            className={styles.chartDate}
            data-keep={l.keep}
            style={{
              left: `${(l.index / points.length) * 100}%`,
              width: `${100 / points.length}%`,
            }}
          >
            <span>
              {l.text}
              {l.year && (
                <span
                  className={styles.chartDateYear}
                  data-year-from={l.yearFrom}
                >
                  {` ${l.year}`}
                </span>
              )}
            </span>
          </span>
        ))}
      </div>
      <details className={styles.chartTable}>
        <summary>Show as a table</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{unit === 'week' ? 'Week of' : 'Day'}</th>
              <th className={styles.numCol}>Clicks</th>
            </tr>
          </thead>
          <tbody>
            {points.map(p => (
              <tr key={p.start}>
                <td>{longDay(p.start)}</td>
                <td className={styles.numCol}>{p.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

/** The smallest 1, 2 or 5 × 10ⁿ at or above n (0 stays 0), so the axis
 *  reads in round numbers. */
function niceCeil(n: number): number {
  if (n <= 0) return 0
  const p = 10 ** Math.floor(Math.log10(n))
  for (const m of [1, 2, 5, 10]) if (m * p >= n) return m * p
  return 10 * p
}

function clicksLabel(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'click' : 'clicks'}`
}

/** 'YYYY-MM-DD' (a UTC day) as "3 October 2026". */
function longDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
