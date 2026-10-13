// Panels, tables and small helpers shared by the dashboard (page.tsx) and
// the Org lookup view, which the shared org pages (src/app/stats) render too.

import Image from 'next/image'
import type { Counted, VisitorShare } from '@/lib/analytics/events'
import Logo from './Logo'
import SortableTable, { type SortColumn, type SortValue } from './SortableTable'
import styles from './analytics.module.css'

export function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{title}</h2>
      {children}
    </section>
  )
}

// Hard ceiling on rows a listings table sends to the browser. Real catalogs
// are a few hundred listings, so organic data never comes near it; it exists
// so a flood of fabricated distinct labels through the public track endpoint
// can't balloon the page payload (every row crosses the server→client
// boundary, hidden rows included). Truncation is announced, never silent.
export const MAX_TABLE_ROWS = 1000

export function TruncationNote({ shown, of }: { shown: number; of: number }) {
  return (
    <p className={styles.dim}>
      Showing the {shown.toLocaleString()} most-clicked of {of.toLocaleString()}{' '}
      listings.
    </p>
  )
}

/** What a slot label or range ('F1', '3', '3–5') sorts by: featured slots
 *  first, then numeric by the range's lowest slot. null (no slot recorded)
 *  sorts last. */
export function rankSortValue(rank: string | undefined): number | null {
  if (!rank) return null
  const lo = rank.split('–')[0]
  const n = lo.startsWith('F') ? Number(lo.slice(1)) - 1000 : Number(lo)
  return Number.isFinite(n) ? n : null
}

/** "% of visitors" cell text: the share of the page's visitors who did the
 *  thing, or a dash when the range has no page-view visitors to divide by. */
export function shareCell(share: VisitorShare | undefined): string {
  return share && share.visitors > 0 ? pct1(share.active, share.visitors) : '—'
}

export function CountTable({
  rows: allRows,
  labelHead,
  countHead = 'Clicks',
  rankHead = '#',
  logoFor,
  linkFor,
  rankFor,
  pageFor,
  shareFor,
  shareHead = '% of visitors',
  total,
  totalShare,
}: {
  rows: Counted[]
  labelHead: string
  /** Heading for the count column — 'Clicks' unless the rows count something
   *  else (opens, conversations, …). */
  countHead?: string
  rankHead?: string
  logoFor?: (name: string) => string | undefined
  /** Destination url for a row's logo. When set, the logo becomes a link to the
   *  listing; the name text is deliberately left unlinked so it stays
   *  selectable/copyable. */
  linkFor?: (name: string) => string | undefined
  rankFor?: (name: string) => string | undefined
  /** When set, adds a Page column: the resource page each row belongs to,
   *  shown as the page's nav icon and name. */
  pageFor?: (name: string) => PageBadge | undefined
  /** When set, adds a "% of visitors" column: the share of each page's
   *  distinct visitors who did the thing at least once — always per-visitor,
   *  whichever count mode is on. Looked up by the row's displayed name. */
  shareFor?: (name: string) => VisitorShare | undefined
  /** Heading for the `shareFor` column, when it measures something other than
   *  "did the thing" — e.g. '% returning'. */
  shareHead?: string
  /** When set, adds a % column (each row's share of this total) and a Total
   *  footer row. The total is the denominator, so for a sliced "top N" table it
   *  can exceed the sum of the visible rows. */
  total?: number
  /** The Total row's "% of visitors" cell: the share of visitors who did the
   *  thing at least once, counted across the whole table. Computed from
   *  distinct visitors, not by summing the rows — a visitor who did several
   *  things counts once. Blank when unset. */
  totalShare?: VisitorShare
}) {
  if (allRows.length === 0) return <p className={styles.dim}>No data yet.</p>
  const rows = allRows.slice(0, MAX_TABLE_ROWS)
  const showPct = total != null && total > 0
  const columns: SortColumn[] = [
    ...(rankFor
      ? [{ label: rankHead, className: styles.rankCol, sort: 'rank' as const }]
      : []),
    { label: labelHead, sort: 'text' as const },
    ...(pageFor ? [{ label: 'Page', sort: 'text' as const }] : []),
    { label: countHead, className: styles.numCol, sort: 'number' as const },
    ...(showPct
      ? [{ label: '%', className: styles.pctCol, sort: 'number' as const }]
      : []),
    ...(shareFor
      ? [
          {
            label: shareHead,
            className: styles.pctCol,
            sort: 'number' as const,
          },
        ]
      : []),
  ]
  const values: SortValue[][] = rows.map(r => {
    const share = shareFor?.(r.name)
    return [
      ...(rankFor ? [rankSortValue(rankFor(r.name))] : []),
      r.name,
      ...(pageFor ? [pageFor(r.name)?.label ?? null] : []),
      r.count,
      ...(showPct ? [r.count] : []),
      ...(shareFor
        ? [share && share.visitors > 0 ? share.active / share.visitors : null]
        : []),
    ]
  })
  return (
    <>
      <SortableTable
        columns={columns}
        values={values}
        foot={
          total != null ? (
            <tr className={styles.totalRow}>
              {rankFor && <td className={styles.rankCol} />}
              <td className={styles.totalLabel}>Total</td>
              {pageFor && <td />}
              <td className={styles.numCol}>{total.toLocaleString()}</td>
              {showPct && (
                <td className={styles.pctCol}>{pct1(total, total)}</td>
              )}
              {shareFor && (
                <td className={styles.pctCol}>
                  {/* active 0 means the range's clicks predate visitor ids
                      (or all came from private browsing) — that's unknown,
                      not a true 0%, so it gets the same dash as the rows. */}
                  {totalShare
                    ? totalShare.active > 0
                      ? shareCell(totalShare)
                      : '—'
                    : null}
                </td>
              )}
            </tr>
          ) : undefined
        }
      >
        {rows.map((r, i) => {
          const rank = rankFor?.(r.name)
          const featured = rank?.startsWith('F')
          const href = linkFor?.(r.name)
          const badge = pageFor?.(r.name)
          return (
            <tr key={i}>
              {rankFor && (
                <td
                  className={`${styles.rankCol}${
                    featured ? ` ${styles.rankFeatured}` : ''
                  }`}
                >
                  {rank ?? '—'}
                </td>
              )}
              <td className={styles.nameCell}>
                {logoFor &&
                  (href && href !== '#' ? (
                    <a
                      className={styles.logoLink}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${r.name}`}
                    >
                      <Logo src={logoFor(r.name)} />
                    </a>
                  ) : (
                    <Logo src={logoFor(r.name)} />
                  ))}
                <span>{r.name}</span>
              </td>
              {pageFor && (
                <td>
                  {badge && (
                    <span className={styles.pageBadge}>
                      {badge.icon && (
                        <span className={styles.pageTabIcon}>
                          <Image
                            src={badge.icon}
                            alt=""
                            width={12}
                            height={12}
                          />
                        </span>
                      )}
                      {badge.label}
                    </span>
                  )}
                </td>
              )}
              <td className={styles.numCol}>{r.count.toLocaleString()}</td>
              {showPct && (
                <td className={styles.pctCol}>{pct1(r.count, total)}</td>
              )}
              {shareFor && (
                <td className={styles.pctCol}>{shareCell(shareFor(r.name))}</td>
              )}
            </tr>
          )
        })}
      </SortableTable>
      {allRows.length > rows.length && (
        <TruncationNote shown={rows.length} of={allRows.length} />
      )}
    </>
  )
}

/** One stat in the Conversations row — reuses the funnel-stage styling so the
 *  row reads like the funnel above it. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.funnelStage}>
      <div className={styles.funnelValue}>{value}</div>
      <div className={styles.funnelLabel}>{label}</div>
    </div>
  )
}

/** A small table for rows with their own keys: a name (with an optional
 *  favicon linking out), where it happened, and a count with its share. */
export function KeyedTable({
  rows: allRows,
  labelHead,
  whereHead = 'Where',
  countHead,
  empty,
}: {
  rows: {
    key: string
    name: string
    href?: string
    logo?: string
    where: string
    count: number
  }[]
  labelHead: string
  whereHead?: string
  countHead: string
  empty: string
}) {
  if (allRows.length === 0) return <p className={styles.dim}>{empty}</p>
  // The total covers every row; only the busiest MAX_TABLE_ROWS are sent to
  // the browser (the rows' text comes from the public beacon).
  const total = allRows.reduce((n, r) => n + r.count, 0)
  const rows = allRows.slice(0, MAX_TABLE_ROWS)
  const withLogos = rows.some(r => r.logo)
  const columns: SortColumn[] = [
    { label: labelHead, sort: 'text' },
    { label: whereHead, sort: 'text' },
    { label: countHead, className: styles.numCol, sort: 'number' },
    { label: '%', className: styles.pctCol, sort: 'number' },
  ]
  return (
    <>
      <SortableTable
        columns={columns}
        values={rows.map(r => [r.name, r.where, r.count, r.count])}
        foot={
          <tr className={styles.totalRow}>
            <td className={styles.totalLabel}>Total</td>
            <td />
            <td className={styles.numCol}>{total.toLocaleString()}</td>
            <td className={styles.pctCol}>{pct1(total, total)}</td>
          </tr>
        }
      >
        {rows.map(r => {
          const href = safeHref(r.href)
          return (
            <tr key={r.key}>
              <td className={styles.nameCell}>
                {withLogos &&
                  (href ? (
                    <a
                      className={styles.logoLink}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${r.name}`}
                    >
                      <Logo src={r.logo} />
                    </a>
                  ) : (
                    <Logo src={r.logo} />
                  ))}
                <span>{r.name}</span>
              </td>
              <td>
                <span className={styles.pill}>{r.where}</span>
              </td>
              <td className={styles.numCol}>{r.count.toLocaleString()}</td>
              <td className={styles.pctCol}>{pct1(r.count, total)}</td>
            </tr>
          )
        })}
      </SortableTable>
      {allRows.length > rows.length && (
        <p className={styles.dim}>
          Showing the busiest {rows.length.toLocaleString()} of{' '}
          {allRows.length.toLocaleString()}.
        </p>
      )}
    </>
  )
}

/** A row's resource-page marker in the clicked-from-search table: the page's
 *  nav icon plus its name. */
export interface PageBadge {
  icon: string | null
  label: string
}

/** A favicon for any outbound URL — the universal fallback when a listing has
 *  no Airtable logo (or the event isn't a funding listing). */
export function faviconFor(url?: string): string | undefined {
  if (!url || url === '#') return undefined
  try {
    const host = new URL(url).hostname
    if (!host) return undefined
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return undefined
  }
}

export function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    return u.hostname.replace(/^www\./, '') + path
  } catch {
    return url
  }
}

/** An address with its utm_ tracking tags removed. */
export function withoutUtm(url: string): string {
  try {
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()])
      if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return url
  }
}

/** Only http(s) addresses become links: event urls come from the public
 *  beacon and could be anything. */
export function safeHref(url: string | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

/** "A", "A and B", "A, B, and C" (Oxford comma). */
export function joinList(items: string[]): string {
  if (items.length <= 2) return items.join(' and ')
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

/** A share of `total` to one decimal place, e.g. "43.2%"; a dash when the
 *  total is 0 (an org's newsletter links that nobody has clicked yet). */
export function pct1(part: number, total: number): string {
  return total > 0 ? `${((100 * part) / total).toFixed(1)}%` : '—'
}
