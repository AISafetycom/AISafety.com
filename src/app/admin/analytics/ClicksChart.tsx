'use client'

import { useState } from 'react'
import { chartDateLabels, scaleTop } from '@/lib/analytics/chart-dates'
import styles from './analytics.module.css'

/** A small one-series column chart: clicks (or `noun`) per day (or week). Each column is
 *  its own hover and focus target and shows its date and count; the same
 *  numbers are in the table underneath (unless `table` is false, for a page
 *  that gives them another way), so nothing hides behind a hover. A
 *  week only partly inside the range (`days` set) is drawn lighter and says
 *  how many of its days count, so a short week doesn't read as a dip. */
export default function ClicksChart({
  points,
  unit,
  table = true,
  noun = CLICKS,
  tone = 'teal',
}: {
  points: { start: string; count: number; days?: number }[]
  unit: 'day' | 'week'
  table?: boolean
  /** What the columns count, when it isn't clicks. */
  noun?: { one: string; many: string }
  /** Blue sets a chart of something else apart from the teal ones near it. */
  tone?: 'teal' | 'blue'
}) {
  const [active, setActive] = useState<number | null>(null)
  if (points.length === 0) return null
  const max = Math.max(...points.map(p => p.count))
  const top = scaleTop(max)
  // Gridlines at the top, halfway (when that's a whole number) and zero.
  const ticks =
    top === 0 ? [0] : Number.isInteger(top / 2) ? [top, top / 2, 0] : [top, 0]
  // "13 October 2026 (2 of its 7 days)": a week's first day, and how much
  // of it counts when the range cuts it short.
  const weekOf = ({ start, days }: { start: string; days?: number }) =>
    days ? `${longDay(start)} (${days} of its 7 days)` : longDay(start)
  const when = (p: { start: string; days?: number }) =>
    unit === 'day' ? longDay(p.start) : `Week of ${weekOf(p)}`
  const shown = active == null ? null : points[active]

  return (
    <div
      className={`${styles.chart}${tone === 'blue' ? ` ${styles.chartBlue}` : ''}`}
    >
      <div className={styles.chartReadout} aria-live="polite">
        {shown ? (
          <>
            <strong>{countLabel(shown.count, noun)}</strong>{' '}
            <span>{when(shown)}</span>
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
              aria-label={`${when(p)}, ${countLabel(p.count, noun)}`}
            >
              {p.count > 0 && (
                <span
                  className={`${styles.chartBar}${p.days ? ` ${styles.chartBarPartial}` : ''}`}
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
      {table && (
        <details className={styles.chartTable}>
          <summary>Show as a table</summary>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{unit === 'week' ? 'Week of' : 'Day'}</th>
                <th className={styles.numCol}>
                  {noun.many[0].toUpperCase() + noun.many.slice(1)}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map(p => (
                <tr key={p.start}>
                  <td>{unit === 'week' ? weekOf(p) : longDay(p.start)}</td>
                  <td className={styles.numCol}>{p.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

const CLICKS = { one: 'click', many: 'clicks' }

function countLabel(n: number, noun: { one: string; many: string }): string {
  return `${n.toLocaleString()} ${n === 1 ? noun.one : noun.many}`
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
