'use client'

import Icon from './Icon'
import SearchBar from './SearchBar'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  /** Show a search box above the options that narrows them as you type.
   *  For long lists; off by default. */
  searchable?: boolean
  /** Cap the option list at this many pixels tall and scroll inside it.
   *  For long lists; off by default. */
  maxListHeight?: number
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
  searchable,
  maxListHeight,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Sideways nudge (px) that keeps the popover inside the viewport.
  const [shift, setShift] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const needle = query.trim().toLowerCase()
  const visibleOptions = needle
    ? options.filter(option => option.toLowerCase().includes(needle))
    : options

  // The popover hangs under the pill in the page itself (position: absolute),
  // so it moves with the page as it scrolls, in step. Only the sideways nudge
  // is measured: before paint on opening, and again on resize or when a
  // search changes the popover's width.
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
  }, [open, needle])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    // Escape closes the popover and hands focus back to the pill. With text
    // in the search box, the first Escape only clears it (SearchBar), so this
    // runs in the capture phase, before the box empties.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target
      // Only the search box counts: a ticked checkbox's value is "on".
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
          // Each opening starts from the full list.
          if (!open) setQuery('')
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
          {searchable && (
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="Search"
              aria-label={`Search ${title.toLowerCase()} options`}
              wrapperClassName="margin-bottom-16px"
            />
          )}
          <div
            className={`flex flex-col gap-16px${maxListHeight ? ` ${styles.scrollList}` : ''}`}
            style={maxListHeight ? { maxHeight: maxListHeight } : undefined}
          >
            {searchable && visibleOptions.length === 0 && (
              <p className="paragraph-small color-teal-300">Nothing found.</p>
            )}
            {visibleOptions.map(option => (
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
