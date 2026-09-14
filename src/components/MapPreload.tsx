'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { MAPBOX_GL_CSS_URL, MAPBOX_GL_JS_URL } from '@/lib/communities-map'

/**
 * Warms the browser cache with the two maps' heavy assets while the visitor
 * reads some other page, so that clicking through draws a complete map at
 * once:
 * - the field map's images (about 1.7 MB in ~370 small files, most of them
 *   permanently cacheable on Vercel Blob), which were the slow part of /map;
 * - the Mapbox library and stylesheet the /communities map loads from
 *   Mapbox's CDN (about 310 KB, cacheable for a year), whose download time
 *   swings from a fraction of a second to several seconds.
 *
 * Deliberately timid, because it spends the visitor's bandwidth on pages they
 * have not asked for yet:
 * - desktop only (the site's 991px breakpoint, plus a hovering pointer), and
 *   never when the browser reports Data Saver or a 2G-class connection;
 * - not on /map itself, where the map fills the cache the ordinary way;
 * - starts a few seconds after the current page's `load` event and then in
 *   an idle slot, so it never competes with what the visitor is looking at;
 * - runs once per browser session (sessionStorage), and never twice in one
 *   page load;
 * - uses `<link rel="prefetch">`, which browsers fetch at their lowest
 *   priority and set aside for anything the page needs. Browsers without it
 *   (Safari) get plain low-priority fetches a few at a time instead.
 *
 * Renders nothing. If anything goes wrong the visitor just gets the maps at
 * their usual speed, so failures are logged, not surfaced.
 */

// Once per browser session, set the moment the image list arrives, or when
// the visitor reaches /map by themselves.
const SESSION_KEY = 'aisafety_maps_prefetched'
// How long after the page's own `load` event to wait before starting.
const SETTLE_MS = 3_000
// requestIdleCallback may never find an idle slot on a busy page; start
// anyway after this long.
const IDLE_TIMEOUT_MS = 2_000
// Fallback path: this many image fetches in flight at once, so they never
// crowd out what the visitor is doing.
const FALLBACK_CONCURRENCY = 6
// Matches the CSS breakpoint (992px and up is desktop) and the hover checks
// used elsewhere in the site, so tablets and phones held sideways are out.
const DESKTOP_QUERY = '(min-width: 992px) and (hover: hover)'

// Module-level so it survives client-side navigations (the layout never
// remounts) and React's development-mode double effects.
let startedThisPageLoad = false

// navigator.connection is Chromium-only and not in the DOM typings.
interface NetworkInformation {
  saveData?: boolean
  effectiveType?: string
}

interface Asset {
  href: string
  // Same request destination the page will use for the file, so the cached
  // response is the one it gets.
  as: 'image' | 'script' | 'style'
}

function sessionDone(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function markSessionDone() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    // Storage blocked (private mode, strict settings): the module flag above
    // still keeps this to once per page load.
  }
}

function isDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches
}

function isConstrainedConnection(): boolean {
  const connection = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection
  if (!connection) return false
  return (
    connection.saveData === true ||
    connection.effectiveType === 'slow-2g' ||
    connection.effectiveType === '2g'
  )
}

function isMapPath(pathname: string): boolean {
  return pathname === '/map' || pathname.startsWith('/map/')
}

function prefetchWithLinks(assets: Asset[]) {
  const fragment = document.createDocumentFragment()
  for (const asset of assets) {
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = asset.as
    link.href = asset.href
    fragment.appendChild(link)
  }
  document.head.appendChild(fragment)
}

// Without prefetch support: images through Image(), a few at a time; the
// library files through low-priority no-cors fetches, whose opaque responses
// still land in the HTTP cache under the URL the page will ask for.
function prefetchWithFetches(assets: Asset[]): Promise<unknown> {
  const queue = assets.filter(a => a.as === 'image').map(a => a.href)
  // Held until loaded so garbage collection can't cancel an in-flight fetch.
  const inFlight = new Set<HTMLImageElement>()
  const startNext = () => {
    const url = queue.shift()
    if (!url) return
    const img = new Image()
    inFlight.add(img)
    img.onload = img.onerror = () => {
      inFlight.delete(img)
      startNext()
    }
    img.fetchPriority = 'low'
    img.decoding = 'async'
    img.src = url
  }
  for (let i = 0; i < FALLBACK_CONCURRENCY; i++) startNext()

  return Promise.all(
    assets
      .filter(a => a.as !== 'image')
      .map(a => fetch(a.href, { mode: 'no-cors', priority: 'low' }))
  )
}

async function preload() {
  const response = await fetch('/api/map-images')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const { urls } = (await response.json()) as { urls: string[] }
  markSessionDone()
  // The visitor reached the map while the list was on its way; it is loading
  // its own images now.
  if (isMapPath(window.location.pathname)) return

  const assets: Asset[] = [
    ...urls.map((href): Asset => ({ href, as: 'image' })),
    { href: MAPBOX_GL_JS_URL, as: 'script' },
    { href: MAPBOX_GL_CSS_URL, as: 'style' },
  ]
  if (document.createElement('link').relList.supports('prefetch')) {
    prefetchWithLinks(assets)
  } else {
    await prefetchWithFetches(assets)
  }

  // The field map's drawing code is loaded on demand when /map opens;
  // fetching it now saves that round trip too. Same module MapClient loads,
  // so it lands in the same cache entry.
  await import('@/app/map/D3Map')
}

export default function MapPreload() {
  const pathname = usePathname()

  useEffect(() => {
    if (isMapPath(pathname)) {
      markSessionDone()
      return
    }
    if (startedThisPageLoad || sessionDone()) return
    if (!isDesktop() || isConstrainedConnection()) return

    // Wait for the page to finish loading, settle, then find an idle moment.
    // Leaving for another page before then cancels the wait; the next page
    // starts its own.
    let cancelled = false
    let settleTimer: number | undefined
    const start = () => {
      if (cancelled || startedThisPageLoad) return
      startedThisPageLoad = true
      preload().catch(err => {
        // Best effort: the maps just open at their normal speed.
        console.warn('Map preload failed:', err)
      })
    }
    const whenIdle = () => {
      if (cancelled) return
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS })
      } else {
        start()
      }
    }
    const afterSettle = () => {
      settleTimer = window.setTimeout(whenIdle, SETTLE_MS)
    }
    if (document.readyState === 'complete') {
      afterSettle()
    } else {
      window.addEventListener('load', afterSettle, { once: true })
    }

    return () => {
      cancelled = true
      window.clearTimeout(settleTimer)
      window.removeEventListener('load', afterSettle)
    }
  }, [pathname])

  return null
}
