'use client'

import { useState } from 'react'
import { area, curveMonotoneX, line } from 'd3'
import {
  chartDateLabels,
  chartHourLabels,
  scaleFit,
  scaleTop,
} from '@/lib/analytics/chart-dates'
import styles from './analytics.module.css'
import own from './TrendChart.module.css'

/** One value on a trend chart. */
export interface TrendPoint {
  /** Epoch ms: the start of the day (or hour) the value is for. */
  t: number
  v: number
  /** Set when the value covers only part of its day or hour ("so far",
   *  "from 18:03"): drawn lighter, so a short day isn't read as a dip. */
  part?: string
  /** Where the value comes from, for the readout and the table ("Substack
   *  issue"). */
  note?: string
}

/** One tile and the chart it opens: the tile shows `value`, where it started
 *  (`from`) and the change; picking it draws `points` across the days (or
 *  hours) from `first` to `last`. */
export interface TrendTile {
  key: string
  /** "Visitors" */
  label: string
  /** What the readout calls the value: "visitors". */
  unit: string
  value: number
  /** Where it started, or null when there's nothing to compare with. */
  from: number | null
  /** Under the chart while the tile is picked: what it counts, and what
   *  From is. */
  note: string
  step: 'day' | 'hour'
  first: number
  last: number
  /** Oldest first. A point before `first` is drawn (the line comes in from
   *  the left edge) but can't be pointed at. */
  points: TrendPoint[]
  /** Moments worth a line of their own ("Moved to ActiveCampaign"). */
  markers?: { t: number; label: string }[]
  /** Fit the scale to the values rather than start it at zero, for a total
   *  that moves little against its size (subscribers). Drawn as a line
   *  alone: a filled area would make the cut-off scale look like the whole
   *  amount. */
  fit?: boolean
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
// The plot's own coordinates. The SVG stretches them to the plot's size;
// lines keep their 2px whatever the stretch (vector-effect in the CSS).
const W = 1000
const H = 100

/** The tiles in a row, Substack-style, and a smooth filled line of the
 *  picked one over time. Every value is also in the table under the chart,
 *  so nothing hides behind a hover. */
export default function TrendChart({
  tiles,
  label,
}: {
  tiles: TrendTile[]
  /** What the tiles are, for screen readers: "Site traffic". */
  label: string
}) {
  const [picked, setPicked] = useState(tiles[0]?.key)
  const tile = tiles.find(t => t.key === picked) ?? tiles[0]
  if (!tile) return null
  return (
    <div>
      <div className={own.tiles} role="group" aria-label={label}>
        {tiles.map(t => (
          <Tile
            key={t.key}
            tile={t}
            picked={t.key === tile.key}
            onPick={() => setPicked(t.key)}
          />
        ))}
      </div>
      {/* Keyed, so the pointed-at day doesn't carry over to another tile. */}
      <Chart key={tile.key} tile={tile} />
      <p className={styles.caption}>{tile.note}</p>
    </div>
  )
}

function Tile({
  tile,
  picked,
  onPick,
}: {
  tile: TrendTile
  picked: boolean
  onPick: () => void
}) {
  const change = changeOf(tile.value, tile.from)
  return (
    <button
      type="button"
      className={`${own.tile}${picked ? ` ${own.tilePicked}` : ''}`}
      aria-pressed={picked}
      onClick={onPick}
    >
      <span className={own.tileLabel}>{tile.label}</span>
      <span className={own.tileValue}>
        {tile.value.toLocaleString('en-US')}
      </span>
      <span className={own.tileFrom}>
        <span>
          From {tile.from == null ? '—' : tile.from.toLocaleString('en-US')}
        </span>
        {change && (
          <span className={`${own.change} ${own[change.dir]}`}>
            <span aria-hidden>{change.arrow}</span>
            <span className="visually-hidden">{change.dir}</span> {change.pct}
          </span>
        )}
      </span>
    </button>
  )
}

/** The change from `from` to `value`, or null when there's no from (or it's
 *  zero, where a percentage means nothing). One decimal, dropped when it's
 *  .0: "18.3%", "59%". */
export function changeOf(
  value: number,
  from: number | null
): { dir: 'up' | 'down' | 'flat'; arrow: string; pct: string } | null {
  if (from == null || from === 0) return null
  const pct = ((value - from) / from) * 100
  const rounded = Math.round(Math.abs(pct) * 10) / 10
  if (rounded === 0) return { dir: 'flat', arrow: '→', pct: '0%' }
  return {
    dir: pct > 0 ? 'up' : 'down',
    arrow: pct > 0 ? '↑' : '↓',
    pct: `${rounded.toLocaleString('en-US')}%`,
  }
}

function Chart({ tile }: { tile: TrendTile }) {
  const [active, setActive] = useState<number | null>(null)
  const { first, last, step } = tile
  const span = last - first
  const xOf = (t: number) => (span > 0 ? (t - first) / span : 0.5)
  // Only points on the chart can be pointed at, listed in the table, or
  // counted for the scale's top.
  const shown = tile.points.filter(p => p.t >= first && p.t <= last)
  const drawn = tile.points.filter(p => p.t <= last)
  const values = drawn.map(p => p.v)
  // From zero, with gridlines at the top, halfway (when that's a whole
  // number) and zero; or fitted to the values (`fit`).
  const top = scaleTop(Math.max(0, ...values)) || 1
  const { lo, hi, ticks } = tile.fit
    ? scaleFit(Math.min(...values), Math.max(...values))
    : {
        lo: 0,
        hi: top,
        ticks: Number.isInteger(top / 2) ? [top, top / 2, 0] : [top, 0],
      }
  const yOf = (v: number) => 1 - (v - lo) / (hi - lo)

  const lineOf = line<TrendPoint>()
    .x(p => xOf(p.t) * W)
    .y(p => yOf(p.v) * H)
    .curve(curveMonotoneX)
  const fill = area<TrendPoint>()
    .x(p => xOf(p.t) * W)
    .y0(H)
    .y1(p => yOf(p.v) * H)
    .curve(curveMonotoneX)
  // A part-day at either end is drawn lighter, on its own stretch of line.
  let a = 0
  let b = drawn.length - 1
  while (a < b && drawn[a].part) a++
  while (b > a && drawn[b].part) b--
  const stretches = [
    { points: drawn.slice(0, a + 1), part: true },
    { points: drawn.slice(a, b + 1), part: false },
    { points: drawn.slice(b), part: true },
  ].filter(s => s.points.length > 1)

  const when = (p: TrendPoint) =>
    step === 'hour' ? hourWords(p.t) : longDay(p.t)
  const shownPoint = active == null ? null : shown[active]
  const nearest = (clientX: number, el: HTMLElement) => {
    if (shown.length === 0) return
    const box = el.getBoundingClientRect()
    const t = first + ((clientX - box.left) / box.width) * span
    let best = 0
    for (let i = 1; i < shown.length; i++)
      if (Math.abs(shown[i].t - t) < Math.abs(shown[best].t - t)) best = i
    setActive(best)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (shown.length === 0) return
    const go = (i: number) => {
      e.preventDefault()
      setActive(Math.max(0, Math.min(shown.length - 1, i)))
    }
    if (e.key === 'ArrowRight')
      go(active == null ? shown.length - 1 : active + 1)
    else if (e.key === 'ArrowLeft')
      go(active == null ? shown.length - 1 : active - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(shown.length - 1)
    else if (e.key === 'Escape') setActive(null)
  }

  // The dates (or hours) under the plot, one slot per day across it.
  const slots =
    step === 'hour'
      ? Math.round(span / HOUR_MS) + 1
      : Math.round(span / DAY_MS) + 1
  const slotStarts = Array.from(
    { length: slots },
    (_, i) => first + i * (step === 'hour' ? HOUR_MS : DAY_MS)
  )
  const labels =
    step === 'hour'
      ? chartHourLabels(slotStarts)
      : chartDateLabels(
          slotStarts.map(t => new Date(t).toISOString().slice(0, 10))
        )
  const slotWidth = 100 / Math.max(1, slots - 1)

  return (
    <div className={styles.chart}>
      <div className={styles.chartReadout} aria-live="polite">
        {shownPoint ? (
          <>
            <strong>{shownPoint.v.toLocaleString('en-US')}</strong>{' '}
            <span>
              {tile.unit} · {when(shownPoint)}
              {shownPoint.part && `, ${shownPoint.part}`}
              {shownPoint.note && ` (${shownPoint.note})`}
            </span>
          </>
        ) : (
          <span>
            {shown.length === 0
              ? 'Nothing to draw in this range'
              : `Point at the chart for a ${step === 'hour' ? 'figure an hour' : 'day’s figure'}`}
          </span>
        )}
      </div>
      <div className={styles.chartBody}>
        <div className={styles.chartAxis} aria-hidden>
          {ticks.map(t => (
            <span key={t}>{t.toLocaleString('en-US')}</span>
          ))}
        </div>
        <div
          className={own.plot}
          tabIndex={shown.length > 0 ? 0 : undefined}
          aria-label={`${tile.label} over time. Arrow keys step through the ${step === 'hour' ? 'hours' : 'days'}; the table below lists them all.`}
          onPointerMove={e => nearest(e.clientX, e.currentTarget)}
          onPointerDown={e => nearest(e.clientX, e.currentTarget)}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ticks.map(t => (
            <span
              key={t}
              className={styles.chartGrid}
              style={{ bottom: `${((t - lo) / (hi - lo)) * 100}%` }}
              aria-hidden
            />
          ))}
          {(tile.markers ?? [])
            .filter(m => m.t >= first && m.t <= last)
            .map(m => (
              <span
                key={m.t}
                className={own.marker}
                style={{ left: `${xOf(m.t) * 100}%` }}
                aria-hidden
              >
                <span
                  className={own.markerLabel}
                  data-side={xOf(m.t) > 0.6 ? 'left' : 'right'}
                >
                  {m.label}
                </span>
              </span>
            ))}
          {/* eslint-disable-next-line no-restricted-syntax -- the chart's own lines, not an icon */}
          <svg
            className={own.svg}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {/* Each stretch fills its own area, so the fill's edge follows its
                line exactly where a part-day stretch meets the rest. */}
            {!tile.fit &&
              stretches.map((s, i) => (
                <path
                  key={`a${i}`}
                  className={own.area}
                  d={fill(s.points) ?? undefined}
                />
              ))}
            {stretches.map((s, i) => (
              <path
                key={`l${i}`}
                className={`${own.line}${s.part ? ` ${own.linePart}` : ''}`}
                d={lineOf(s.points) ?? undefined}
              />
            ))}
          </svg>
          {/* A lone point has no line, so it always shows its dot. */}
          {shown.length === 1 && shownPoint == null && (
            <span
              className={own.dot}
              style={{
                left: `${xOf(shown[0].t) * 100}%`,
                top: `${yOf(shown[0].v) * 100}%`,
              }}
              aria-hidden
            />
          )}
          {shownPoint && (
            <>
              <span
                className={own.crosshair}
                style={{ left: `${xOf(shownPoint.t) * 100}%` }}
                aria-hidden
              />
              <span
                className={own.dot}
                style={{
                  left: `${xOf(shownPoint.t) * 100}%`,
                  top: `${yOf(shownPoint.v) * 100}%`,
                }}
                aria-hidden
              />
            </>
          )}
        </div>
      </div>
      {/* One slot per day, centered under it; the CSS thins them out as the
          chart narrows, as on the clicks chart (chart-dates.ts). */}
      <div className={styles.chartDates} aria-hidden>
        {labels.map(l => {
          const center = slots > 1 ? (l.index / (slots - 1)) * 100 : 50
          // The newest ends flush with the plot rather than past it.
          const left =
            l.index === slots - 1 && slots > 1
              ? 100 - slotWidth
              : center - slotWidth / 2
          return (
            <span
              key={l.index}
              className={styles.chartDate}
              data-keep={l.keep}
              style={{ left: `${left}%`, width: `${slotWidth}%` }}
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
          )
        })}
      </div>
      {shown.length > 0 && (
        <details className={styles.chartTable}>
          <summary>Show as a table</summary>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{step === 'hour' ? 'Hour' : 'Day'}</th>
                <th className={styles.numCol}>{tile.label}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(p => (
                <tr key={p.t}>
                  <td>
                    {when(p)}
                    {p.part && `, ${p.part}`}
                    {p.note && <span className={styles.dim}> · {p.note}</span>}
                  </td>
                  <td className={styles.numCol}>
                    {p.v.toLocaleString('en-US')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

/** A UTC day as "3 October 2026". */
function longDay(t: number): string {
  return new Date(t).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** A UTC hour as "09:00 to 10:00, 14 October 2026". */
function hourWords(t: number): string {
  const hh = (ms: number) =>
    `${String(new Date(ms).getUTCHours()).padStart(2, '0')}:00`
  return `${hh(t)} to ${hh(t + HOUR_MS)}, ${longDay(t)}`
}
