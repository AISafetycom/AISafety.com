'use client'

import FilterPopover from './FilterPopover'
import SearchBar from './SearchBar'
import { useState } from 'react'
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
  const [query, setQuery] = useState('')

  const needle = query.trim().toLowerCase()
  const visibleOptions = needle
    ? options.filter(option => option.toLowerCase().includes(needle))
    : options

  const label =
    selected.length === 0
      ? title
      : selected.length === 1
        ? `${title}: ${selected[0]}`
        : `${title}: ${selected[0]} +${selected.length - 1}`

  return (
    <FilterPopover
      label={label}
      active={selected.length > 0}
      icon={icon}
      // Each opening starts from the full list; a search changes the
      // popover's width, so it is re-fitted to the screen as you type.
      onOpen={() => setQuery('')}
      measureKey={needle}
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
          <p className="paragraph-small color-teal-grey-300">Nothing found.</p>
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
              <span className="paragraph-xs color-teal-grey-300 margin-left-4px">
                {' '}
                ({counts[option] || 0})
              </span>
            </span>
          </label>
        ))}
      </div>
    </FilterPopover>
  )
}
