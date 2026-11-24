'use client'

import type { ReactNode, RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { placePopover, type Side } from '@/lib/popover-placement'
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
  /** Float over the page by this box, with a caret pointing at it (e.g.
   *  selected text, a footer link). It goes under it, or above, right or left
   *  of it, whichever fits first, and never covers it (see
   *  src/lib/popover-placement.ts). Leave out to hang under the parent
   *  element in the page instead, without a caret (e.g. a filter pill); the
   *  parent needs position: relative. */
  anchor?: PageBox
  /** For selected text: its first and last lines, which the caret points
   *  at. Without them it points at the anchor's middle. */
  anchorLines?: { first: PageBox; last: PageBox }
  /** Names the popover for screen readers, which then announce it as a
   *  dialog. */
  label?: string
  /** In a text box with text in it, the first Escape belongs to the box (a
   *  search box clears), not the popover. */
  // (To focus a field as the popover opens, give it data-autofocus rather
  // than autoFocus: it is focused once the popover is in place, and only
  // with a mouse.)
  escapeClearsText?: boolean
  children: ReactNode
}

// Space kept between the popover and the screen's edges, and between a
// floating popover and what it hangs from: room for its caret, whose tip
// comes 8px out of the edge.
const EDGE = 16
const CARET_GAP = 12
// The caret keeps clear of the panel's rounded corners (16px) by this much,
// measured to its middle.
const CARET_INSET = 24
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
  anchorLines,
  label,
  escapeClearsText,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{
    left: number
    top?: number
    side?: Side
    caret?: number
  }>({ left: 0 })
  const floating = !!anchor

  // Placed before paint on opening, and again when the screen or the
  // popover's own size changes (a search narrowing a list, an error showing
  // under a form). Hanging in the page (position: absolute), it scrolls with
  // the page, in step.
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el) return
    // Which side of the anchor it opened on. It stays there while open, so
    // a form growing as it's typed in doesn't jump to the other side.
    let side: Side | undefined
    const place = () => {
      const width = el.offsetWidth
      if (!anchor) {
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
      const placed = placePopover({
        anchor,
        first: anchorLines?.first ?? anchor,
        last: anchorLines?.last ?? anchor,
        width,
        height: el.offsetHeight,
        view: {
          left: window.scrollX + EDGE,
          right: window.scrollX + document.documentElement.clientWidth - EDGE,
          top: window.scrollY + NAV_CLEARANCE,
          bottom: window.scrollY + window.innerHeight - EDGE,
        },
        gap: CARET_GAP,
        caretInset: CARET_INSET,
        side,
      })
      // Off the bottom of the screen when it opens (a tall form by text low
      // on a phone): scroll it into view, once.
      if (!side && placed.scroll > 0) {
        window.scrollBy({ top: placed.scroll, behavior: 'smooth' })
      }
      side = placed.side
      setPos(placed)
    }
    place()
    // Focus goes in only once the popover is in place, and without
    // scrolling: a field focused where the popover first renders would
    // scroll the page there. Not on a touch screen, where focusing a box
    // brings up the keyboard, and a dropdown its list of choices, before
    // the visitor has even seen the form: there they tap the field first.
    if (window.matchMedia('(hover: hover)').matches) {
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus({
        preventScroll: true,
      })
    }
    const resize = new ResizeObserver(place)
    resize.observe(el)
    window.addEventListener('resize', place)
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [open, anchor, anchorLines])

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
      className={`${styles.popover} ${floating ? styles.floating : styles.inline} border-plus-fill drop-shadow-extra-dark`}
      style={{ left: pos.left, top: pos.top }}
    >
      {children}
      {floating && pos.side && (
        // The caret, on the edge facing the anchor (the side the popover
        // went to is the opposite one), its spot along that edge worked out
        // in placePopover.
        <span
          aria-hidden="true"
          data-side={pos.side}
          className={`border-plus-fill ${styles.caret}`}
          style={
            pos.side === 'below' || pos.side === 'above'
              ? { left: pos.caret }
              : { top: pos.caret }
          }
        />
      )}
    </div>
  )

  // A floating popover goes at the end of the page, out of any card or bar
  // that would clip it or stack above it.
  return floating ? createPortal(panel, document.body) : panel
}
