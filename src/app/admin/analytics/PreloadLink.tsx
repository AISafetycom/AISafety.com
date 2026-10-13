'use client'

import Link from 'next/link'
import { useState, type ComponentProps } from 'react'

/** How a dashboard link preloads its view: as soon as it shows, once the
 *  pointer (or keyboard focus, or a touch) reaches it, or not at all. */
export type Preload = 'now' | 'hover' | 'off'

/** A dashboard <Link> that preloads the view behind it, so a click shows it at
 *  once instead of waiting on the server. A hover only counts for the address
 *  it happened on: when the link's address changes (another tab, range or
 *  count mode), it waits for a fresh hover before preloading again. */
export default function PreloadLink({
  preload,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, 'prefetch'> & { preload: Preload }) {
  const href =
    typeof props.href === 'string' ? props.href : JSON.stringify(props.href)
  const [reached, setReached] = useState<string | null>(null)
  const prefetch =
    preload === 'now' || (preload === 'hover' && reached === href)
  return (
    <Link
      {...props}
      prefetch={prefetch}
      onMouseEnter={e => {
        setReached(href)
        onMouseEnter?.(e)
      }}
      onFocus={e => {
        setReached(href)
        onFocus?.(e)
      }}
      onTouchStart={e => {
        setReached(href)
        onTouchStart?.(e)
      }}
    />
  )
}
