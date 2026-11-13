'use client'

import { useEffect, useState } from 'react'

/** How long a closing panel stays on screen. Matches --admin-close in admin.module.css. */
export const CLOSE_MS = 100

/**
 * Keeps a panel on screen for CLOSE_MS after `value` turns falsy, so it can
 * play its closing animation (the motion.module.css `…Out` classes). Returns
 * what to render (the last truthy value while closing) and whether it is
 * closing. With `animate` false, or under reduced motion, the panel goes at
 * once.
 *
 * Pass state, not an object built during render: a new object every render
 * would never settle.
 */
export function useClosing<T>(
  value: T,
  animate = true
): [shown: T, closing: boolean] {
  const [kept, setKept] = useState(value)
  if (value ? value !== kept : kept && !animate) setKept(value)
  useEffect(() => {
    if (value || !kept) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => setKept(value), reduce ? 0 : CLOSE_MS)
    return () => clearTimeout(t)
  }, [value, kept])
  const closing = animate && !value && !!kept
  return [closing ? kept : value, closing]
}

/**
 * Keeps a clicked element where it is on screen while a panel above it folds
 * shut. Where only one panel is open at a time, opening one closes the
 * other, and everything below that one rises as it folds: the clicked
 * element with it, often off the top of the screen. Until the fold is over,
 * scroll the page by however far the element has moved.
 */
export function holdOnScreen(el: HTMLElement) {
  const top = el.getBoundingClientRect().top
  let end = 0
  const step = (now: number) => {
    if (!el.isConnected) return
    // The fold starts on the first frame and lasts CLOSE_MS. The margin
    // covers the closed panel's removal landing a frame or two late.
    end ||= now + CLOSE_MS + 50
    const drift = Math.round(el.getBoundingClientRect().top - top)
    if (drift) window.scrollBy({ top: drift, behavior: 'instant' })
    if (now < end) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
