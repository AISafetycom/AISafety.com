'use client'

import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon'
import styles from './FilterPopover.module.css'

interface FilterPopoverProps {
  /** Text on the pill. */
  label: string
  /** Fill the pill: a filter is on. */
  active: boolean
  /** Optional 16×16 svg icon (path in /images) shown before the label. */
  icon?: string
  /** Runs each time the popover opens, e.g. to empty a search box. */
  onOpen?: () => void
  /** Re-fit the popover to the screen when this changes (its width depends
   *  on it, like the options a search leaves). */
  measureKey?: unknown
  /** What the popover holds. */
  children: ReactNode
}

// The pill-shaped button and the popover that hangs under it, shared by the
// filters in the horizontal FilterBar (checkbox lists, the range slider).
export default function FilterPopover({
  label,
  active,
  icon,
  onOpen,
  measureKey,
  children,
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false)
  // Sideways nudge (px) that keeps the popover inside the viewport.
  const [shift, setShift] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // The popover hangs under the pill in the page itself (position: absolute),
  // so it moves with the page as it scrolls, in step. Only the sideways nudge
  // is measured: before paint on opening, and again on resize or when the
  // popover's width changes.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      const width = popoverRef.current?.offsetWidth
      if (!r || width === undefined) return
      const left = Math.max(
        16,
        Math.min(r.left, window.innerWidth - width - 16)
      )
      setShift(left - r.left)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, measureKey])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    // Escape closes the popover and hands focus back to the pill. With text
    // in a search box, the first Escape only clears it, so this runs in the
    // capture phase, before the box empties.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target
      // Only a text box counts: a ticked checkbox's value is "on".
      if (
        target instanceof HTMLInputElement &&
        target.type === 'text' &&
        target.value !== '' &&
        popoverRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.pill} border-plus-fill paragraph-xs-bold${active ? ` ${styles.pillActive}` : ''}${
          open ? ` ${styles.pillOpen}` : ''
        }`}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(o => !o)
        }}
      >
        {icon && <Icon src={icon} />}
        {label}
        <Icon
          src="/images/icons/chevron-down.svg"
          size={16}
          className={styles.chevron}
        />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={`${styles.popover} border-plus-fill drop-shadow-extra-dark`}
          style={{ left: shift }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
