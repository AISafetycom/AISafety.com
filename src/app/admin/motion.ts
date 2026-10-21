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
