'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useClosing } from './motion'
import motion from './motion.module.css'

/**
 * Shows `children` while `open`, growing open and shut instead of jumping.
 * It animates only once it has been on screen for a frame, so sections that
 * start open, or fold from saved state as the page loads, don't move.
 */
export function Collapse({
  open,
  as: Tag = 'div',
  className,
  children,
}: {
  open: boolean
  /** 'li' inside a list. */
  as?: 'div' | 'li'
  className?: string
  children: ReactNode
}) {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  const [shown, closing] = useClosing(open, settled)
  const [was, setWas] = useState(open)
  const [moving, setMoving] = useState(false)
  if (open !== was) {
    setWas(open)
    setMoving(settled)
  }
  if (!shown) return null
  const anim = closing ? motion.collapseOut : moving ? motion.collapseIn : ''
  return (
    <Tag
      className={`${motion.collapse} ${anim} ${className ?? ''}`}
      onAnimationEnd={e => {
        if (e.target === e.currentTarget) setMoving(false)
      }}
      inert={closing}
    >
      <div className={motion.collapseBody}>{children}</div>
    </Tag>
  )
}
