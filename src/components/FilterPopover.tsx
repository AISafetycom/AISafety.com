'use client'

import type { ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import Button from './Button'
import Icon from './Icon'
import Popover from './Popover'
import styles from './FilterPopover.module.css'

interface FilterPopoverProps {
  /** Text on the pill. */
  label: string
  /** Fill the pill: a filter is on. */
  active: boolean
  /** Switches the whole filter off. While the filter is on, an × takes the
   *  chevron's place and runs this. */
  onClear: () => void
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
  onClear,
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
        {!active && (
          <Icon
            src="/images/icons/chevron-down.svg"
            size={16}
            className={styles.chevron}
          />
        )}
      </button>

      {/* The ×, over the room the active pill leaves at its right end. It
          sits beside the pill's button, not in it: a button can't hold
          another button. */}
      {active && (
        <span className={`${styles.clearSlot} flex items-center`}>
          <Button
            variant="clear"
            size="xs"
            iconPosition="only"
            icon="/images/icons/x-small.svg"
            iconSize={12}
            aria-label={`Clear ${label}`}
            tooltip="Clear filter"
            // Above, so the pill's open list can't cover it.
            tooltipPosition="above"
            onClick={() => {
              onClear()
              // The × leaves with the filter, so focus goes to the pill.
              buttonRef.current?.focus()
            }}
          />
        </span>
      )}

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
