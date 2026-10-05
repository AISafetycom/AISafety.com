'use client'

/*
  "Edit another field" on a change. A change shows only the fields its
  proposal names; this opens the rest of the record's fields to pick one
  and edit it beside them (Bryce, 5 Oct 2026: "I want a way of editing
  other random fields too"). The edit is kept on the row like any other
  and written by Accept.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import styles from './queue.module.css'
import own from './FieldPicker.module.css'

export interface PickableField {
  name: string
  /** What the record holds now, as shown on the page ('—' for nothing). */
  value: string
}

export default function FieldPicker({
  fields,
  canEdit,
  focusTick,
  onPick,
}: {
  /** The fields that can be picked, in the table's order; null while the
   *  record is still being read. */
  fields: PickableField[] | null
  canEdit: boolean
  /** Bumped by E: open the list. */
  focusTick: number
  onPick: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const rowRefs = useRef<(HTMLLIElement | null)[]>([])

  const q = query.trim().toLowerCase()
  const rows = useMemo(
    () => (fields ?? []).filter(f => !q || f.name.toLowerCase().includes(q)),
    [fields, q]
  )

  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const show = () => {
    if (!canEdit) return
    setCursor(0)
    setOpen(true)
  }
  const pick = (name: string) => {
    close()
    onPick(name)
  }

  // E opens the list (a tick from the page; the first value is not a press).
  const seenTick = useRef(focusTick)
  useEffect(() => {
    if (focusTick === seenTick.current) return
    seenTick.current = focusTick
    show()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus({ preventScroll: true })
    // The list opens under the change's rows, often below the fold and
    // under the Accept bar: bring all of it up.
    listRef.current?.scrollIntoView({ block: 'nearest' })
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  if (!canEdit) return null

  return (
    <div className={own.picker} ref={panelRef}>
      <button
        type="button"
        className={styles.unsetChip}
        onClick={() => (open ? close() : show())}
      >
        <Icon src="/images/icons/plus-small.svg" size={12} />
        Edit another field <kbd>E</kbd>
      </button>
      {open && (
        <div className={own.panel}>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Find a field…"
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor(c => Math.min(c + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor(c => Math.max(c - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const row = rows[cursor]
                if (row) pick(row.name)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                close()
              }
            }}
          />
          <ul className={own.list} ref={listRef}>
            {fields === null ? (
              <li className={`${own.row} ${styles.note}`}>
                Reading the record…
              </li>
            ) : rows.length === 0 ? (
              <li className={`${own.row} ${styles.note}`}>
                No other field matches.
              </li>
            ) : (
              rows.map((f, i) => (
                <li
                  key={f.name}
                  ref={el => {
                    rowRefs.current[i] = el
                  }}
                  className={`${own.row} ${i === cursor ? own.rowAt : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(f.name)}
                >
                  <span className={own.name}>{f.name}</span>
                  <span className={own.value}>{f.value}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
