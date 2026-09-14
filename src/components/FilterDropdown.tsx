'use client'

import Icon from './Icon'
import { useEffect, useRef, useState } from 'react'
import { trackFilterApply } from '@/lib/analytics'
import { trackedFilterGroup, trackedFilterValue } from '@/lib/filter-tracking'
import styles from './FilterDropdown.module.css'

interface FilterDropdownProps {
  title: string
  options: string[]
  selected: string[]
  counts: Record<string, number>
  onToggle: (value: string) => void
  /** Optional 16×16 svg icon (path in /images) shown before the label. */
  icon?: string
  /** Analytics page name (e.g. 'Training'). When set, turning a value on
   *  records a filter_apply event under this page and the dropdown's title.
   *  Renamed titles and options keep logging their original names via
   *  lib/filter-tracking, so history stays in one line. */
  trackingPage?: string
}

// A single pill-shaped filter that opens a checkbox popover. Used in the
// horizontal FilterBar on the data-driven sub-pages.
export default function FilterDropdown({
  title,
  options,
  selected,
  counts,
  onToggle,
  icon,
  trackingPage,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // The popover is position: fixed (so the filter bar's horizontal scroll
    // can't clip it). Pin it under the pill, clamped to the viewport, and keep
    // it there as the bar/page scrolls. Capture phase catches the bar's scroll.
    const position = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      if (!r) return
      const width = popoverRef.current?.offsetWidth ?? 0
      const left = Math.max(
        16,
        Math.min(r.left, window.innerWidth - width - 16)
      )
      setPos({ top: r.bottom + 8, left })
    }
    position()
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', position, true)
      window.removeEventListener('resize', position)
    }
  }, [open])

  const label =
    selected.length === 0
      ? title
      : selected.length === 1
        ? `${title}: ${selected[0]}`
        : `${title}: ${selected[0]} +${selected.length - 1}`

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.pill} border-plus-fill paragraph-xs-bold${selected.length > 0 ? ` ${styles.pillActive}` : ''}${
          open ? ` ${styles.pillOpen}` : ''
        }`}
        onClick={() => {
          // Pre-position before opening so the popover doesn't flash at 0,0
          // (the effect re-clamps once it's measured).
          if (!open) {
            const r = buttonRef.current?.getBoundingClientRect()
            if (r) setPos({ top: r.bottom + 8, left: r.left })
          }
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
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="flex flex-col gap-16px">
            {options.map(option => (
              <label
                key={option}
                className={`flex items-center cursor-pointer ${styles.option}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => {
                    if (trackingPage && !selected.includes(option)) {
                      const group = trackedFilterGroup(trackingPage, title)
                      trackFilterApply(
                        trackingPage,
                        group,
                        trackedFilterValue(trackingPage, group, option)
                      )
                    }
                    onToggle(option)
                  }}
                  className="checkbox"
                />
                <span className="paragraph-small color-white">
                  {option}
                  <span className="paragraph-xs color-teal-300 margin-left-4px">
                    {' '}
                    ({counts[option] || 0})
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
