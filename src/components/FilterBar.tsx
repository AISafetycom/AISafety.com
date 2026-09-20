import type { ReactNode } from 'react'
import styles from './FilterBar.module.css'

interface FilterBarProps {
  /** The FilterDropdown pills. */
  children: ReactNode
  /** Number of results currently shown. */
  count: number
  /** Singular noun for the count, e.g. "course". Pluralized with an "s". */
  noun: string
  label?: ReactNode
  /** Drop the 40px gap below the bar (for a bar that isn't above a grid, e.g.
   *  inside the chatbot panel). */
  compact?: boolean
}

// Horizontal row of filter dropdowns with the result count flowing directly
// after them (left-aligned, per the Figma — not pushed to the row's far end),
// sitting above the listing grid (replacing the old vertical FilterSidebar).
// Static — it scrolls away with the page.
export default function FilterBar({
  children,
  count,
  noun,
  label,
  compact,
}: FilterBarProps) {
  return (
    <div
      className={`flex items-start gap-16px ${compact ? '' : 'padding-bottom-40px'} ${styles.bar}`}
    >
      <div className={`flex items-center gap-8px ${styles.pills}`}>
        {children}
      </div>
      <p className={`paragraph-small color-teal-300 ${styles.count}`}>
        {label ?? `${count} ${noun}${count === 1 ? '' : 's'}`}
      </p>
    </div>
  )
}
