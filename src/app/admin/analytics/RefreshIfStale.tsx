'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// The dashboard preloads its other tabs, and Next keeps a preload for up to
// five minutes, so a tab can open with figures worked out a while ago. Past
// this age they're quietly swapped for fresh ones.
const STALE_MS = 60_000
// How long a view has to stay on screen before that refresh goes out. A
// refresh drops every preload (Next fetches them all again), so it waits
// until a tab has been settled on, rather than firing on each click while
// someone is going through the tabs.
const SETTLE_MS = 4_000

// This browser's clock minus the server's, from the first view shown (always
// fresh: it came with the page). Ages are measured on the server's clock, so
// a computer clock that's a few minutes out can't make every view look old.
let clockOffset: number | null = null
// When the last refresh went out: at most one a minute, whatever happens.
let lastRefresh = 0

/** Lets a preloaded tab show at once, then refreshes it in the background if
 *  its figures are more than a minute old, or if the store couldn't be read
 *  when it was worked out. The figures update in place; nothing fades. A
 *  refresh also renews the other tabs' preloads. Renders nothing. */
export default function RefreshIfStale({
  renderedAt,
  failed,
}: {
  /** Server time (epoch ms) the view was worked out. */
  renderedAt: number
  failed: boolean
}) {
  const router = useRouter()
  useEffect(() => {
    const now = Date.now()
    if (clockOffset == null) clockOffset = now - renderedAt
    const age = now - clockOffset - renderedAt
    if (!failed && age <= STALE_MS) return
    // Settled on, and a minute since the last refresh. Leaving the view first
    // (another tab, another page) cancels it.
    const wait = Math.max(SETTLE_MS, lastRefresh + STALE_MS - now)
    const timer = setTimeout(() => {
      lastRefresh = Date.now()
      router.refresh()
    }, wait)
    return () => clearTimeout(timer)
  }, [renderedAt, failed, router])
  return null
}
