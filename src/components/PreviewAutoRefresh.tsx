'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/** Fired on `window` whenever this component re-renders the page because its
 *  records changed — `detail.pathname` says which page. Search listens, so
 *  the entries for this page are re-read live in the same moment (and share
 *  the page's own Airtable read). */
export const PREVIEW_CHANGED_EVENT = 'preview:changed'
/** Fired on `window` when the tab or window is returned to. Polling paused
 *  meanwhile, and coming back from Airtable is when an edit to any page's
 *  records may be waiting — search re-checks every listing type. */
export const PREVIEW_RETURNED_EVENT = 'preview:returned'

function notifyChanged(pathname: string) {
  window.dispatchEvent(
    new CustomEvent(PREVIEW_CHANGED_EVENT, { detail: { pathname } })
  )
}

const POLL_MS = 2_000
// The server keeps reporting an edit for several polls (it stays in its
// look-back window); a re-render takes about a second, so rather than stack
// them, refresh on every other poll at most. Two or three refreshes per edit.
const MIN_REFRESH_GAP_MS = 3_500

/** While preview mode is on, keeps the page current without manual reloads:
 *  asks /api/admin/preview/changed every couple of seconds whether any of this
 *  page's Airtable records changed in the last few moments, and re-renders
 *  when they did. The server looks back over a fixed window rather than
 *  "since your last poll", so an edit Airtable was still saving when one poll
 *  ran is caught by the next (a moving cursor skipped such edits for good) —
 *  at the price of an edit re-rendering the page a couple of times before it
 *  ages out of the window, each time from the newest data.
 *
 *  Also re-renders when the tab becomes visible again or the window regains
 *  focus: polling pauses in hidden tabs, and this catches whatever happened
 *  meanwhile, including things the poll can't see (deleted records).
 *
 *  The poll also reports the answering deployment's BUILD_TIME — when that
 *  moves past `buildTime` (the one this page rendered with), a rebuild has
 *  gone live and the page re-renders so the pill's "public built X ago"
 *  starts over instead of counting up from the old build.
 *
 *  router.refresh() re-runs the server render in place, so scroll position
 *  and client state (filters, search) survive. Renders nothing. */
export default function PreviewAutoRefresh({
  buildTime,
}: {
  buildTime: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  // Last new build already refreshed for — one refresh per deployment, so a
  // poll that keeps reporting a build the page can't pick up (however that
  // might happen) can't loop refreshes every five seconds.
  const refreshedForBuildRef = useRef<string | null>(null)

  useEffect(() => {
    // Admin screens aren't part of the site being previewed (and are always
    // rendered fresh) — nothing to poll or refresh there.
    if (pathname.startsWith('/admin')) return

    let stopped = false
    let lastPollRefresh = 0

    const tick = async () => {
      // Don't poll (or pile up refreshes) while the tab isn't being looked at;
      // the visibility and focus listeners below catch up the moment it is.
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch(
          `/api/admin/preview/changed?path=${encodeURIComponent(pathname)}`,
          { cache: 'no-store' }
        )
        if (!res.ok || stopped) return
        const data = (await res.json()) as {
          changed: boolean
          buildTime: string | null
        }
        if (stopped) return
        const newBuild =
          data.buildTime !== null &&
          buildTime !== null &&
          data.buildTime > buildTime &&
          refreshedForBuildRef.current !== data.buildTime
        if (newBuild) refreshedForBuildRef.current = data.buildTime
        const now = Date.now()
        const changed =
          data.changed && now - lastPollRefresh >= MIN_REFRESH_GAP_MS
        if (newBuild || changed) {
          lastPollRefresh = now
          router.refresh()
          if (changed) notifyChanged(pathname)
        }
      } catch (err) {
        // Transient network failure — the next poll will try again.
        console.warn('preview auto-refresh poll failed:', err)
      }
    }

    const interval = setInterval(tick, POLL_MS)
    tick()

    // Switching back to the tab fires both events within the same instant;
    // one refresh is plenty.
    let lastReturnRefresh = 0
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastReturnRefresh < 1_000) return
      lastReturnRefresh = now
      router.refresh()
      window.dispatchEvent(new Event(PREVIEW_RETURNED_EVENT))
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      stopped = true
      clearInterval(interval)
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [pathname, router, buildTime])

  return null
}
