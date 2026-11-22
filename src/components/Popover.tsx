'use client'

import type { ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './Popover.module.css'

/** A box in page coordinates (scroll included). */
export interface PageBox {
  left: number
  right: number
  top: number
  bottom: number
}

/** An element's box in page coordinates: an anchor for a floating popover. */
export function pageBox(el: Element): PageBox {
  const r = el.getBoundingClientRect()
  return {
    left: r.left + window.scrollX,
    right: r.right + window.scrollX,
    top: r.top + window.scrollY,
    bottom: r.bottom + window.scrollY,
  }
}

interface PopoverProps {
  open: boolean
  /** Called on Escape, or a press outside the popover and its trigger. */
  onClose: () => void
  /** The button or link that opens it. Pressing it doesn't count as a press
   *  outside (so it can toggle the popover itself), and focus goes back to it
   *  after Escape. */
  triggerRef: RefObject<HTMLElement | SVGElement | null>
  /** Float over the page at this box, under it, or above it when there's no
   *  room below, always on screen (e.g. selected text, a footer link). Leave
   *  out to hang under the parent element in the page instead (e.g. a filter
   *  pill); the parent needs position: relative. */
  anchor?: PageBox
  /** Names the popover for screen readers, which then announce it as a
   *  dialog. */
  label?: string
  /** Extra classes on the panel, e.g. the padding its content wants. */
  className?: string
  /** In a text box with text in it, the first Escape belongs to the box (a
   *  search box clears), not the popover. */
  // (To focus a field as the popover opens, give it data-autofocus rather
  // than autoFocus: it is focused once the popover is in place.)
  escapeClearsText?: boolean
  children: ReactNode
}

// Space kept between the popover and the screen's edges, and between it and
// what it hangs from.
const EDGE = 16
const GAP = 8
// Space kept clear at the top of the screen for the nav bar (as on
// SelectionMenu): a floating popover never opens above the anchor into it.
const NAV_CLEARANCE = 96

// The site's popover: a panel with the shared surface (.border-plus-fill) and
// shadow (.drop-shadow-extra-dark), kept on screen, closed by Escape or a
// press outside it. It holds anything: a filter's options (FilterPopover), a
// form (FeedbackPopover).
export default function Popover({
  open,
  onClose,
  triggerRef,
  anchor,
  label,
  className,
  escapeClearsText,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top?: number }>({ left: 0 })
  const floating = !!anchor
  const {
    left: aLeft,
    right: aRight,
    top: aTop,
    bottom: aBottom,
  } = anchor ?? { left: 0, right: 0, top: 0, bottom: 0 }

  // Placed before paint on opening, and again when the screen or the
  // popover's own size changes (a search narrowing a list, an error showing
  // under a form). Hanging in the page (position: absolute), it scrolls with
  // the page, in step.
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    // Which side of the anchor it opened on. It stays there while open, so
    // a form growing as it's typed in doesn't jump to the other side.
    let side: 'below' | 'above' | undefined
    const place = () => {
      const width = el.offsetWidth
      if (!floating) {
        // Only a sideways nudge: it hangs under its parent.
        const r = el.parentElement?.getBoundingClientRect()
        if (!r) return
        const left = Math.max(
          EDGE,
          Math.min(r.left, window.innerWidth - width - EDGE)
        )
        setPos({ left: left - r.left })
        return
      }
      const height = el.offsetHeight
      const minLeft = window.scrollX + EDGE
      const maxLeft =
        window.scrollX + document.documentElement.clientWidth - width - EDGE
      const centered = (aLeft + aRight) / 2 - width / 2
      // Under the anchor; above it when there's no room under it; and when
      // there's room on neither side, as low as it fits on screen, over the
      // anchor (a tall form by text low on the screen).
      const minTop = window.scrollY + NAV_CLEARANCE
      const maxTop = window.scrollY + window.innerHeight - height - EDGE
      const below = aBottom + GAP
      const above = aTop - GAP - height
      side ??= below <= maxTop || above < minTop ? 'below' : 'above'
      const top = side === 'below' ? Math.min(below, maxTop) : above
      setPos({
        left: Math.max(minLeft, Math.min(centered, maxLeft)),
        top: Math.max(minTop, top),
      })
    }
    place()
    // Focus goes in only once the popover is in place, and without
    // scrolling: a field focused where the popover first renders would
    // scroll the page there.
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus({
      preventScroll: true,
    })
    const resize = new ResizeObserver(place)
    resize.observe(el)
    window.addEventListener('resize', place)
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [open, floating, aLeft, aRight, aTop, aBottom])

  useEffect(() => {
    if (!open) return
    const handlePress = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      onClose()
    }
    // Escape closes the popover and hands focus back to its trigger. With
    // escapeClearsText, it runs in the capture phase, so a text box's value
    // is still there to look at before the box empties.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target
      // Only a text box counts: a ticked checkbox's value is "on".
      if (
        escapeClearsText &&
        target instanceof HTMLInputElement &&
        target.type === 'text' &&
        target.value !== '' &&
        ref.current?.contains(target)
      ) {
        return
      }
      onClose()
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', handlePress)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('mousedown', handlePress)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [open, onClose, triggerRef, escapeClearsText])

  if (!open) return null

  const panel = (
    <div
      ref={ref}
      role={label ? 'dialog' : undefined}
      aria-label={label}
      className={`${styles.popover} ${floating ? styles.floating : styles.inline} border-plus-fill drop-shadow-extra-dark${className ? ` ${className}` : ''}`}
      style={{ left: pos.left, top: pos.top }}
    >
      {children}
    </div>
  )

  // A floating popover goes at the end of the page, out of any card or bar
  // that would clip it or stack above it.
  return floating ? createPortal(panel, document.body) : panel
}
