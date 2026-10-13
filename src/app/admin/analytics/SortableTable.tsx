'use client'

import { Children, useState, type ReactNode } from 'react'
import styles from './analytics.module.css'

/** One header cell of a SortableTable. `sort` makes it clickable: 'number'
 *  starts high→low (counts, percentages), 'rank' low→high (slot ladders:
 *  F1, F2, 1, 2…), 'text' A→Z. Omit it for a column with nothing meaningful
 *  to sort by. */
export interface SortColumn {
  label: string
  className?: string
  sort?: 'text' | 'number' | 'rank'
}

/** What a cell sorts by. null = no value; those rows sort last either way. */
export type SortValue = string | number | null

/** The dashboard's table shell: the whole <table> with a clickable header
 *  (click a column to sort by it, click again to flip), show-more truncation
 *  for long tables, and an optional fixed footer row. The body rows are
 *  rendered on the server and handed in as children, so every per-row detail
 *  (logos, links, pills) stays server-side; `values` is the parallel
 *  per-row/per-column list of what each cell sorts by. Until a header is
 *  clicked the rows keep their server order. */
export default function SortableTable({
  columns,
  values,
  foot,
  children,
  initial = 50,
  step = 50,
}: {
  columns: SortColumn[]
  /** values[row][column], parallel to children. */
  values: SortValue[][]
  /** Fixed footer row(s) (<tr>), e.g. a Total row — never sorted. */
  foot?: ReactNode
  children: ReactNode
  initial?: number
  step?: number
}) {
  const rows = Children.toArray(children)
  const [visible, setVisible] = useState(initial)
  // dir 1 = ascending, -1 = descending; null = server order.
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)

  const order = rows.map((_, i) => i)
  if (sort) {
    const { col, dir } = sort
    order.sort((a, b) => {
      const va = values[a]?.[col] ?? null
      const vb = values[b]?.[col] ?? null
      if (va == null || vb == null) {
        return (va == null ? 1 : 0) - (vb == null ? 1 : 0)
      }
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, {
              sensitivity: 'base',
            })
      return cmp * dir
    })
  }
  const shown = order.slice(0, visible)
  const remaining = rows.length - shown.length

  const headerClick = (i: number) => {
    const kind = columns[i].sort
    if (!kind) return
    setSort(s =>
      s?.col === i
        ? { col: i, dir: s.dir === 1 ? -1 : 1 }
        : { col: i, dir: kind === 'number' ? -1 : 1 }
    )
  }

  // A table wider than its panel (a phone, on an org's own page) scrolls
  // sideways inside the panel rather than widening the page.
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className={c.className}
                aria-sort={
                  sort?.col === i
                    ? sort.dir === 1
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                {c.sort ? (
                  <button
                    type="button"
                    className={styles.sortBtn}
                    onClick={() => headerClick(i)}
                    title={`Sort by ${c.label}`}
                  >
                    {c.label}
                    {sort?.col === i && (
                      <span className={styles.sortArrow} aria-hidden="true">
                        {sort.dir === 1 ? '▲' : '▼'}
                      </span>
                    )}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map(i => rows[i])}
          {remaining > 0 && (
            <tr className={styles.showMoreRow}>
              <td colSpan={columns.length}>
                <button
                  type="button"
                  className={styles.showMoreBtn}
                  onClick={() => setVisible(v => v + step)}
                >
                  Show {Math.min(step, remaining)} more · {remaining} hidden
                </button>
              </td>
            </tr>
          )}
        </tbody>
        {foot && <tfoot>{foot}</tfoot>}
      </table>
    </div>
  )
}
