'use client'

import { useEffect } from 'react'
import FilterPopover from './FilterPopover'
import RangeSlider from './RangeSlider'
import { trackFilterApply } from '@/lib/analytics'
import { trackedFilterGroup, trackedFilterValue } from '@/lib/filter-tracking'
import styles from './FilterRange.module.css'

interface FilterRangeProps {
  title: string
  /** Optional 16×16 svg icon (path in /images) shown before the label. */
  icon?: string
  /** Analytics page name (e.g. 'Funding'). When set, a narrowed range records
   *  a filter_apply event under this page and the filter's title. */
  trackingPage?: string
  /** What each slider position stands for, lowest to highest. */
  labels: string[]
  /** One bar per stretch between positions (labels.length - 1 of them): how
   *  many listings fall in it. */
  bars: number[]
  /** The two handles' positions, lowest first. */
  value: [number, number]
  onChange: (value: [number, number]) => void
  /** The narrowed range in words, shown on the pill ("$5k – $100k"). */
  summary: string
}

// A pill-shaped filter whose popover holds a RangeSlider. Used in the
// horizontal FilterBar, beside the checkbox FilterDropdowns.
export default function FilterRange({
  title,
  icon,
  trackingPage,
  labels,
  bars,
  value,
  onChange,
  summary,
}: FilterRangeProps) {
  const [lo, hi] = value
  const active = lo > 0 || hi < labels.length - 1

  // One filter_apply once the handles stop moving, not one per step dragged.
  // It logs the pill's own wording ("up to $100k", "$25k+"), so the
  // dashboard's rows read the way the pill does.
  useEffect(() => {
    if (!trackingPage || !active) return
    const timer = setTimeout(() => {
      const group = trackedFilterGroup(trackingPage, title)
      trackFilterApply(
        trackingPage,
        group,
        trackedFilterValue(trackingPage, group, summary)
      )
    }, 800)
    return () => clearTimeout(timer)
  }, [trackingPage, title, summary, active])

  return (
    <FilterPopover
      label={active ? `${title}: ${summary}` : title}
      active={active}
      icon={icon}
    >
      <div className={styles.panel}>
        <RangeSlider
          labels={labels}
          bars={bars}
          value={value}
          onChange={onChange}
          name={title.toLowerCase()}
        />
      </div>
    </FilterPopover>
  )
}
