'use client'

import type { ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import Icon from './Icon'
import Popover from './Popover'
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
  /** What the popover holds. */
  children: ReactNode
}

// The pill-shaped button and the <Popover> that hangs under it, shared by the
// filters in the horizontal FilterBar (checkbox lists, the range slider).
export default function FilterPopover({
  label,
  active,
  icon,
  onOpen,
  children,
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  return (
    <div style={{ position: 'relative' }}>
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

      {/* A search box in it clears on the first Escape; the second closes. */}
      <Popover
        open={open}
        onClose={close}
        triggerRef={buttonRef}
        className={styles.panel}
        escapeClearsText
      >
        {children}
      </Popover>
    </div>
  )
}
