'use client'

/*
  Where an addition goes on its page. The pages that keep a manual order
  (Funding, Self-study, Communities, Media channels, Advisors, Projects,
  Founder toolkit, Recurring training) show their cards by Sort, and an
  addition with no Sort lands at the very top (Bryce, 30 Sept 2026: "we
  need a way of setting where in the list it's sorted to"). This shows
  where it sits now among the published listings, nudges it up or down,
  and opens the whole list to put it after any one of them. The choice is
  an edit to Sort like any other: kept on the row, written by Publish.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import {
  roomFor,
  slotOf,
  sortForSlot,
  sortValue,
  type Placed,
} from '@/lib/admin/queue-place'
import styles from './queue.module.css'
import own from './Position.module.css'

const API = '/api/admin/queue'
const ORDER_TTL_MS = 2 * 60 * 1000

// Each page's order, read once and shared by every addition to it; a
// decision on that table drops it (forgetOrder), and it goes stale after
// two minutes in case Airtable was changed by hand.
const orders = new Map<string, { at: number; read: Promise<Placed[] | null> }>()

export function forgetOrder(table: string | null | undefined): void {
  if (table) orders.delete(table)
}

function readOrder(table: string): Promise<Placed[] | null> {
  const hit = orders.get(table)
  if (hit && Date.now() - hit.at < ORDER_TTL_MS) return hit.read
  const read = fetch(`${API}?order=${encodeURIComponent(table)}`, {
    cache: 'no-store',
  }).then(async res => {
    const data = (await res.json()) as {
      order?: Placed[] | null
      error?: string
    }
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
    return data.order ?? null
  })
  orders.set(table, { at: Date.now(), read })
  read.catch(() => forgetOrder(table))
  return read
}

type Row =
  | { kind: 'top' }
  | { kind: 'new' }
  | { kind: 'listing'; p: Placed; index: number }

export default function Position({
  table,
  record,
  name,
  value,
  edited,
  canEdit,
  focusTick,
  onChange,
}: {
  table: string
  record: string
  /** The addition's name, for its own row in the list. */
  name: string
  /** Its Sort as the page holds it: an edit's text, or the record's. */
  value: unknown
  edited: boolean
  canEdit: boolean
  /** Bumped by P: open the list. */
  focusTick: number
  onChange: (sort: number) => void
}) {
  const [order, setOrder] = useState<Placed[] | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    let cancelled = false
    readOrder(table).then(
      o => {
        if (!cancelled) {
          setOrder(o)
          setError(null)
        }
      },
      e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    )
    return () => {
      cancelled = true
    }
  }, [table, attempt])

  const list = useMemo(
    () => (order ?? []).filter(p => p.id !== record),
    [order, record]
  )
  const sort = sortValue(value)
  const slot = slotOf(list, sort)
  // A listing with no Sort sits above every numbered one, so nothing can
  // be put above it.
  const firstNumbered = list.findIndex(p => p.sort !== null)
  const unsorted = firstNumbered === -1 ? list.length : firstNumbered
  const above = slot > 0 ? list[slot - 1] : null
  const moves = sort === null ? [] : roomFor(list, sort, record)

  const q = query.trim().toLowerCase()
  const rows = useMemo<Row[]>(() => {
    if (q) {
      return list
        .map((p, index) => ({ kind: 'listing' as const, p, index }))
        .filter(r => r.p.name.toLowerCase().includes(q))
    }
    const out: Row[] = unsorted === 0 ? [{ kind: 'top' }] : []
    list.forEach((p, index) => {
      if (index === slot) out.push({ kind: 'new' })
      out.push({ kind: 'listing', p, index })
    })
    if (slot >= list.length) out.push({ kind: 'new' })
    return out
  }, [list, q, slot, unsorted])

  const place = (s: number) => onChange(sortForSlot(list, s))
  // A row stands for "put it after this one"; the top row for the top.
  const pick = (row: Row) => {
    if (row.kind === 'new') return
    place(row.kind === 'top' ? 0 : row.index + 1)
    close()
  }
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const show = () => {
    if (!canEdit || !order) return
    // The cursor starts on the row above the addition, so Enter keeps it
    // where it is.
    const mine = rows.findIndex(r => r.kind === 'new')
    setCursor(mine > 0 ? mine - 1 : mine + 1)
    setOpen(true)
  }

  // P opens the list (a tick from the page; the first value is not a press).
  const seenTick = useRef(focusTick)
  useEffect(() => {
    if (focusTick === seenTick.current) return
    seenTick.current = focusTick
    show()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Opening scrolls the addition's own row into the middle of the list.
  useEffect(() => {
    if (!open) return
    const i = rows.findIndex(r => r.kind === 'new')
    rowRefs.current[i]?.scrollIntoView({ block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open) rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  const step = (from: number, by: 1 | -1) => {
    for (let i = from + by; i >= 0 && i < rows.length; i += by) {
      if (rows[i].kind !== 'new') return i
    }
    return from
  }

  if (order === null) return null

  const summary =
    order === undefined ? (
      error ? (
        <span className={own.error}>
          The page&apos;s order could not be read: {error}{' '}
          <button
            type="button"
            className={own.link}
            onClick={() => {
              setError(null)
              setAttempt(n => n + 1)
            }}
          >
            Try again
          </button>
        </span>
      ) : (
        <span className={styles.note}>Reading the page&apos;s order…</span>
      )
    ) : sort === null ? (
      <span className={own.unplaced}>
        Not placed yet: it would show at the top of the page
      </span>
    ) : (
      <span className={own.where}>
        <strong className={own.rank}>
          #{slot + 1} of {list.length + 1}
        </strong>
        <span className={own.between}>
          {above ? (
            <>
              after <b>{above.name}</b>
            </>
          ) : (
            'at the top'
          )}
        </span>
      </span>
    )

  return (
    <section className={own.position} ref={panelRef}>
      <span className={styles.label}>Position on the page</span>
      <div className={own.line}>
        {summary}
        {order !== undefined && (
          <span className={own.sortNumber}>
            {sort === null ? 'no Sort' : `Sort ${sort}`}
            {edited && <em className={styles.edited}>edited</em>}
          </span>
        )}
        {order !== undefined && canEdit && (
          <span className={own.controls}>
            <button
              type="button"
              className={own.nudge}
              title="Up one place"
              aria-label="Up one place"
              disabled={sort === null || slot <= unsorted}
              onClick={() => place(slot - 1)}
            >
              <Icon src="/images/icons/arrow-up.svg" size={16} />
            </button>
            <button
              type="button"
              className={own.nudge}
              title="Down one place"
              aria-label="Down one place"
              disabled={slot >= list.length}
              onClick={() => place(slot + 1)}
            >
              <Icon src="/images/icons/arrow-down.svg" size={16} />
            </button>
            <button
              type="button"
              className={own.move}
              onClick={() => (open ? close() : show())}
            >
              <Icon src="/images/icons/list-numbered.svg" size={16} />
              {sort === null ? 'Place it' : 'Move'} <kbd>P</kbd>
            </button>
          </span>
        )}
      </div>
      {moves.length > 0 && (
        <p className={styles.note}>
          Publishing moves <b>{moves[0].name}</b>
          {moves.length > 1 ? ` and ${moves.length - 1} more` : ''} down one to
          make room.
        </p>
      )}

      {open && (
        <div className={own.panel}>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Find a listing to put it after…"
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor(c => step(c, 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor(c => step(c, -1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const row = rows[cursor]
                if (row) pick(row)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                close()
              }
            }}
          />
          <ol className={own.list}>
            {rows.map((row, i) => {
              const at = i === cursor
              if (row.kind === 'new') {
                return (
                  <li
                    key="new"
                    ref={el => {
                      rowRefs.current[i] = el
                    }}
                    className={`${own.row} ${own.rowNew}`}
                  >
                    <span className={own.tag}>New</span>
                    <span className={own.rowName}>{name}</span>
                    <span className={own.rowSort}>{sort ?? '—'}</span>
                  </li>
                )
              }
              return (
                <li
                  key={row.kind === 'top' ? 'top' : row.p.id}
                  ref={el => {
                    rowRefs.current[i] = el
                  }}
                  className={`${own.row} ${own.pickable} ${at ? own.rowAt : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(row)}
                >
                  {row.kind === 'top' ? (
                    <span className={own.rowName}>Top of the page</span>
                  ) : (
                    <>
                      <span className={own.rowIndex}>{row.index + 1}</span>
                      <span className={own.rowName}>{row.p.name}</span>
                      {row.p.featured && (
                        <span className={own.featured}>Featured</span>
                      )}
                      <span className={own.rowSort}>{row.p.sort ?? '—'}</span>
                    </>
                  )}
                  <span className={own.after}>
                    {row.kind === 'top' ? 'put it first' : 'put it after'}
                  </span>
                </li>
              )
            })}
            {rows.length === 0 && (
              <li className={`${own.row} ${styles.note}`}>
                No listing on the page matches.
              </li>
            )}
          </ol>
        </div>
      )}
    </section>
  )
}
