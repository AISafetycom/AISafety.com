'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { trackPageView, trackedPath, isTrackingOptedOut } from '@/lib/analytics'

/**
 * Notifies Matomo AND our first-party analytics about page views on Next.js
 * client-side route changes.
 *
 * The Matomo tracker snippet in layout.tsx only fires `trackPageView` once on
 * initial load. Without this component, navigations between pages via Next.js
 * Link clicks would never be recorded as page views, and listing click events
 * would be attributed to the original landing page's URL.
 */
export default function MatomoRouteTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isFirstRender = useRef(true)
  const lastFirstParty = useRef<string | null>(null)

  useEffect(() => {
    // First-party page view: every pathname change INCLUDING the initial load
    // (no snippet fires one for us). Only on pathname changes — filter/search
    // query-param changes aren't new page visits. Admin pages are internal
    // and never counted.
    if (
      pathname &&
      pathname !== lastFirstParty.current &&
      !pathname.startsWith('/admin')
    ) {
      lastFirstParty.current = pathname
      trackPageView(pathname)
    }

    // Skip the very first render — the Matomo snippet already fires
    // trackPageView once on initial load, so we'd otherwise double-count.
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    if (typeof window === 'undefined' || !window._paq) return

    // Opted-out browsers (the privacy-page/admin switch) skip Matomo too —
    // trackPageView above already checks the same flag internally.
    if (isTrackingOptedOut()) return

    // An org's private page goes in as '/stats', never its token.
    const path = trackedPath(window.location.pathname)
    window._paq.push([
      'setCustomUrl',
      path === window.location.pathname
        ? window.location.href
        : window.location.origin + path,
    ])
    window._paq.push(['setDocumentTitle', document.title])
    window._paq.push(['trackPageView'])
  }, [pathname, searchParams])

  return null
}
