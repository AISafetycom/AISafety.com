// The Recordings tab: recorded visits in the range, filtered by what the
// visitor did (from the rest of the analytics), each linking to its replay.

import Link from 'next/link'
import { DASHBOARD_TZ } from '@/lib/analytics/events'
import {
  RECORDING_FILTERS,
  matchesFilter,
  pageName,
  type RecordingFilter,
  type RecordingRow,
} from '@/lib/recordings/join'
import {
  MAX_RECORDING_MS,
  RECORDING_SAMPLE_RATE,
  RECORDING_START_PATHS,
} from '@/lib/recordings/shared'
import { PAGE_NAV } from './page-nav'
import { Panel, joinList } from './parts'
import type { SearchParams } from './range'
import styles from './analytics.module.css'

/** Rows shown; the counts above cover every recording read. */
const SHOWN = 200

const LABEL_BY_NAME = new Map(PAGE_NAV.map(p => [p.name, p.label]))

/** A page path as the site's nav names it ('/map' → 'Field map'). */
export function pageLabel(path: string): string {
  const name = pageName(path)
  return LABEL_BY_NAME.get(name) ?? name
}

/** "2 min 5 s", "45 s". */
export function formatLength(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`
}

/** "Phone", "Tablet" or "Desktop", from the window's width. */
export function screenOf(width: number | undefined): string {
  if (width == null) return '–'
  if (width <= 600) return 'Phone'
  if (width <= 1024) return 'Tablet'
  return 'Desktop'
}

export function formatStart(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: DASHBOARD_TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** The dashboard's query string with some params changed (null drops one). */
function hrefWith(
  sp: SearchParams,
  changes: Record<string, string | null>
): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (v == null || k in changes) continue
    q.set(k, Array.isArray(v) ? (v[0] ?? '') : v)
  }
  for (const [k, v] of Object.entries(changes)) if (v != null) q.set(k, v)
  return `?${q.toString()}`
}

function FilterPill({
  href,
  active,
  name,
  count,
}: {
  href: string
  active: boolean
  name: string
  count?: number
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`${styles.sourceStat} ${styles.sourceStatLink}${
        active ? ` ${styles.sourceStatActive}` : ''
      }`}
    >
      <span className={styles.sourceStatName}>{name}</span>
      {count != null && <span className={styles.sourceStatCount}>{count}</span>}
    </Link>
  )
}

export default function RecordingsTab({
  rows,
  filter,
  page,
  sp,
  truncated,
}: {
  /** null = couldn't read them. */
  rows: RecordingRow[] | null
  filter: RecordingFilter
  /** A path, or undefined for any page. */
  page?: string
  sp: SearchParams
  /** More recordings began in the range than were read. */
  truncated: boolean
}) {
  if (rows == null)
    return (
      <div className={styles.empty}>
        Couldn&apos;t read the recordings just now – try refreshing in a moment.
      </div>
    )

  // The pages recordings went to, most visited first.
  const pageCounts = new Map<string, number>()
  for (const r of rows)
    for (const p of new Set(r.pages))
      pageCounts.set(p, (pageCounts.get(p) ?? 0) + 1)
  const pages = [...pageCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p]) => p)
  if (page && !pages.includes(page)) pages.push(page)

  const onPage = page ? rows.filter(r => r.pages.includes(page)) : rows
  const shown = onPage.filter(r => matchesFilter(r, filter, page))
  const startPages = joinList(RECORDING_START_PATHS.map(pageLabel))

  return (
    <Panel title="Recorded visits">
      <div className={styles.sourceSplitWrap}>
        <div className={styles.sourceSplit}>
          <span className={styles.sourceSplitLabel}>Visits that</span>
          {RECORDING_FILTERS.map(f => (
            <FilterPill
              key={f.key}
              href={hrefWith(sp, { rf: f.key === 'all' ? null : f.key })}
              active={f.key === filter}
              name={f.label}
              count={onPage.filter(r => matchesFilter(r, f.key, page)).length}
            />
          ))}
        </div>
      </div>
      {pages.length > 0 && (
        <div className={styles.sourceSplitWrap}>
          <div className={styles.sourceSplit}>
            <span className={styles.sourceSplitLabel}>On</span>
            <FilterPill
              href={hrefWith(sp, { rp: null })}
              active={!page}
              name="Any page"
            />
            {pages.map(p => (
              <FilterPill
                key={p}
                href={hrefWith(sp, { rp: p })}
                active={p === page}
                name={pageLabel(p)}
                count={pageCounts.get(p) ?? 0}
              />
            ))}
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className={styles.dim}>
          {rows.length === 0
            ? 'No visits recorded in this range.'
            : 'No recorded visits match.'}
        </p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Started</th>
                <th className={styles.numCol}>Length</th>
                <th>Pages</th>
                <th>What happened</th>
                <th>Screen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, SHOWN).map(r => (
                <tr key={r.id}>
                  <td className={styles.recentTime}>{formatStart(r.start)}</td>
                  <td className={styles.numCol}>
                    {formatLength(r.end - r.start)}
                  </td>
                  <td>{r.pages.map(pageLabel).join(' → ')}</td>
                  <td>
                    <span className={styles.recordingPills}>
                      {r.openedChatbot && (
                        <span className={styles.pill}>Chatbot</span>
                      )}
                      {r.zeroSearches.slice(0, 3).map(q => (
                        <span key={q} className={styles.pill}>
                          No results for “{q}”
                        </span>
                      ))}
                      <span className={styles.pill}>
                        {r.listingClickPages.length === 0
                          ? 'No listing clicks'
                          : r.listingClickPages.length === 1
                            ? '1 listing click'
                            : `${r.listingClickPages.length} listing clicks`}
                      </span>
                    </span>
                  </td>
                  <td>{screenOf(r.width)}</td>
                  <td>
                    <Link
                      href={`/admin/analytics/recordings/${r.id}`}
                      className={styles.recordingLink}
                    >
                      Watch
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.caption}>
        {shown.length > SHOWN &&
          `Showing the newest ${SHOWN} of ${shown.length}. `}
        {truncated &&
          'Only the newest recordings in this range were read; pick a shorter range to see older ones. '}
        {Math.round(RECORDING_SAMPLE_RATE * 100)}% of visits that reach{' '}
        {startPages} are recorded, from there until the visitor leaves (at most{' '}
        {MAX_RECORDING_MS / 60_000} minutes). Visits with no mouse, touch or
        typing aren&apos;t kept, so bots mostly leave none. Everything typed
        shows as asterisks. What happened comes from the rest of the analytics
        for the same browser over the same minutes. Left without clicking a
        listing, with a page picked, means no listing clicked on that page.
      </p>
    </Panel>
  )
}
