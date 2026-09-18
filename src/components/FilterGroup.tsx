'use client'

import { trackFilterApply } from '@/lib/analytics'
import { trackedFilterGroup, trackedFilterValue } from '@/lib/filter-tracking'

interface FilterGroupProps {
  title: string
  options: string[]
  selected: string[]
  counts: Record<string, number>
  onToggle: (value: string) => void
  // Optional map from option value to the label shown to the user. Filtering
  // and counts still run on the raw option values; only the display changes.
  labels?: Record<string, string>
  /** Analytics page name (e.g. 'Jobs'). When set, turning a value on records
   *  a filter_apply event under this page and the group's title. Renamed
   *  titles and options keep logging their original names via
   *  lib/filter-tracking, so history stays in one line. */
  trackingPage?: string
}

export default function FilterGroup({
  title,
  options,
  selected,
  counts,
  onToggle,
  labels,
  trackingPage,
}: FilterGroupProps) {
  return (
    <div className="padding-bottom-40px">
      <p className="paragraph-small-bold color-white padding-bottom-16px">
        {title}
      </p>
      <div className="flex flex-col gap-16px">
        {options.map(option => (
          <label key={option} className="flex items-center cursor-pointer">
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
            <span className="paragraph-small color-teal-300">
              {labels?.[option] ?? option}
              <span className="paragraph-xs color-teal-300 margin-left-4px">
                {' '}
                ({counts[option] || 0})
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
