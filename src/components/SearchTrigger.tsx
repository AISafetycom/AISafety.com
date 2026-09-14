'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { typeForPath, withLiveEntries, type LoadState } from '@/lib/search'
import type { SearchEntry, SearchType } from '@/lib/data/search-index'
import { trackSearchOpen, type SearchOpenMethod } from '@/lib/analytics'
import {
  PREVIEW_CHANGED_EVENT,
  PREVIEW_RETURNED_EVENT,
} from './PreviewAutoRefresh'
import SearchModal from './SearchModal'

interface SearchContextValue {
  open: () => void
  prefetch: () => void
}

const SearchContext = createContext<SearchContextValue | null>(null)

// Preview mode re-reads on open anything older than this: the prebuilt index
// (whose server copy /api/check-rebuild refreshes within about a minute of an
// Airtable edit, so asking more often gains nothing) and the live entries for
// the page being looked at.
const PREVIEW_MAX_AGE_MS = 30_000
// Live entries this old are dropped: by then the prebuilt index has long
// caught up, and an edit made while nothing was watching that table (someone
// else's, to a page other than the one open) must not stay hidden behind an
// older live read.
const LIVE_TTL_MS = 10 * 60_000
// Returning to the tab re-checks every type at once (a dozen small Airtable
// reads); flicking between windows shouldn't repeat that within this long —
// the check is left for the next open instead.
const RECONCILE_MIN_GAP_MS = 10_000

/** Preview mode: a live read of one type's entries, laid over the prebuilt
 *  index (see SearchProvider). */
interface LiveEntries {
  entries: SearchEntry[]
  at: number
}

function withoutExpired(
  live: ReadonlyMap<SearchType, LiveEntries>,
  now: number
): ReadonlyMap<SearchType, LiveEntries> {
  const cutoff = now - LIVE_TTL_MS
  let expired = false
  for (const { at } of live.values()) if (at < cutoff) expired = true
  if (!expired) return live
  return new Map([...live].filter(([, { at }]) => at >= cutoff))
}

export function SearchProvider({
  children,
  counts,
  preview = false,
}: {
  children: ReactNode
  counts?: Partial<Record<string, number>>
  /** True while this browser is in preview mode (src/lib/preview.ts). Search
   *  then keeps up with edits: the entries for the page being looked at are
   *  re-read live, and the prebuilt index is fetched afresh now and then. */
  preview?: boolean
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [load, setLoad] = useState<LoadState>({ status: 'idle' })
  // When the index now in `load` was fetched; null until the first success.
  const fetchedAtRef = useRef<number | null>(null)
  const fetchingRef = useRef(false)
  // Preview mode only. The prebuilt index lags an edit by a minute or two,
  // so the types that may have changed are re-read live (one table each,
  // two for /training) and laid over it: the page being looked at whenever
  // it refreshes for a change, and — on the first open, and each time the
  // tab is returned to, which is when edits made in Airtable are waiting —
  // every type whose table changed in the last few minutes
  // (/api/admin/preview/changed-types). Results never wait for these reads:
  // the prebuilt index shows first and each type is replaced as its read
  // lands.
  const [live, setLive] = useState<ReadonlyMap<SearchType, LiveEntries>>(
    () => new Map()
  )
  const liveAtRef = useRef(new Map<SearchType, number>())
  const liveFetchingRef = useRef(new Set<SearchType>())
  const reconcilingRef = useRef(false)
  const lastReconcileAtRef = useRef(0)
  // Whether the next open should ask which types changed: at first, and
  // again after a return to the tab that didn't check straight away.
  const reconcileOnOpenRef = useRef(true)
  const triggerElRef = useRef<HTMLElement | null>(null)

  const fetchIndex = useCallback(async () => {
    if (fetchingRef.current) return
    const fetchedAt = fetchedAtRef.current
    const refreshing = fetchedAt !== null
    if (
      refreshing &&
      !(preview && Date.now() - fetchedAt >= PREVIEW_MAX_AGE_MS)
    ) {
      return
    }
    fetchingRef.current = true
    // A preview refresh keeps the index already loaded searchable until the
    // new one lands; only the first load shows the loading state.
    if (!refreshing) setLoad({ status: 'loading' })
    try {
      // Without cookies on purpose. In preview mode the browser's Draft Mode
      // cookie would otherwise make the server rebuild the whole index from
      // live Airtable — a dozen tables at once, well past its rate limit —
      // and search hung for a minute or more. The prebuilt index the public
      // site searches is plenty for finding a listing, and it is refreshed
      // within about a minute of an edit anyway (check-rebuild clears the
      // records cache the moment it notices a change).
      //
      // What preview must skip is the browser's own copy: the response is
      // cached for an hour, so without `no-store` the first search after an
      // edit would keep showing the index from up to an hour ago.
      const res = await fetch('/api/search-index', {
        credentials: 'omit',
        cache: preview ? 'no-store' : 'default',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as unknown
      if (!Array.isArray(body)) {
        throw new Error('Search index response was not an array')
      }
      fetchedAtRef.current = Date.now()
      setLoad({ status: 'ready', index: body as SearchEntry[] })
    } catch (err) {
      if (refreshing) {
        // The index already loaded stays searchable; the next open tries again.
        console.warn('Search index refresh failed:', err)
      } else {
        // fetchedAtRef is still null, so the modal's retry can try again.
        setLoad({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load',
        })
      }
    } finally {
      fetchingRef.current = false
    }
  }, [preview])

  // Re-reads one type's entries unless a read newer than `maxAge` is in
  // hand. Failures keep the prebuilt entries: the next change, return or
  // open tries again.
  const fetchLive = useCallback(async (type: SearchType, maxAge: number) => {
    if (liveFetchingRef.current.has(type)) return
    const at = liveAtRef.current.get(type)
    if (at !== undefined && Date.now() - at < maxAge) return
    liveFetchingRef.current.add(type)
    try {
      const res = await fetch(
        `/api/admin/preview/search-entries?type=${encodeURIComponent(type)}`,
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { type?: unknown; entries?: unknown }
      if (body.type !== type || !Array.isArray(body.entries)) {
        throw new Error('Unexpected search-entries response')
      }
      const now = Date.now()
      liveAtRef.current.set(type, now)
      const entries = body.entries as SearchEntry[]
      setLive(prev => new Map(prev).set(type, { entries, at: now }))
    } catch (err) {
      console.warn(`Live search entries for ${type} failed:`, err)
    } finally {
      liveFetchingRef.current.delete(type)
    }
  }, [])

  // Asks which types changed in the last few minutes and re-reads those,
  // one after another (rate-limit care: each is a table read).
  const reconcile = useCallback(async () => {
    if (reconcilingRef.current) return
    reconcilingRef.current = true
    lastReconcileAtRef.current = Date.now()
    try {
      const res = await fetch('/api/admin/preview/changed-types', {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { types?: unknown }
      if (!Array.isArray(body.types)) {
        throw new Error('Unexpected changed-types response')
      }
      reconcileOnOpenRef.current = false
      for (const type of body.types as SearchType[]) await fetchLive(type, 0)
    } catch (err) {
      // Left for the next open to try again.
      console.warn('Checking for changed listings failed:', err)
    } finally {
      reconcilingRef.current = false
    }
  }, [fetchLive])

  useEffect(() => {
    if (!preview) return
    // The page just re-rendered for a change to its records: re-read its
    // entries in the same breath (the two reads share one Airtable fetch).
    // Only once search has been used — before that, the first open reads
    // them anyway, and an unused search shouldn't cost table reads.
    const onChanged = (e: Event) => {
      if (fetchedAtRef.current === null) return
      const detail = (e as CustomEvent<{ pathname?: string }>).detail
      const type = typeForPath(detail?.pathname ?? pathname)
      if (type) fetchLive(type, 0)
    }
    // Back from elsewhere, likely Airtable: edits may have been made to any
    // page's records while polling was paused.
    const onReturned = () => {
      const recently =
        Date.now() - lastReconcileAtRef.current < RECONCILE_MIN_GAP_MS
      if (fetchedAtRef.current === null || recently) {
        reconcileOnOpenRef.current = true
      } else {
        reconcile()
      }
    }
    window.addEventListener(PREVIEW_CHANGED_EVENT, onChanged)
    window.addEventListener(PREVIEW_RETURNED_EVENT, onReturned)
    return () => {
      window.removeEventListener(PREVIEW_CHANGED_EVENT, onChanged)
      window.removeEventListener(PREVIEW_RETURNED_EVENT, onReturned)
    }
  }, [preview, pathname, fetchLive, reconcile])

  const handleOpen = useCallback(
    (method: SearchOpenMethod) => {
      triggerElRef.current = document.activeElement as HTMLElement | null
      fetchIndex()
      if (preview) {
        const type = typeForPath(pathname)
        if (type) fetchLive(type, PREVIEW_MAX_AGE_MS)
        if (reconcileOnOpenRef.current) reconcile()
        setLive(prev => withoutExpired(prev, Date.now()))
      }
      setOpen(true)
      trackSearchOpen(method)
    },
    [fetchIndex, fetchLive, reconcile, preview, pathname]
  )

  // What the modal searches: the prebuilt index, with every live-read type
  // swapped in while in preview mode.
  const loadForModal = useMemo<LoadState>(() => {
    if (!preview || load.status !== 'ready' || live.size === 0) return load
    let index = load.index
    for (const [type, { entries }] of live) {
      index = withLiveEntries(index, type, entries)
    }
    return { status: 'ready', index }
  }, [preview, load, live])

  const handleClose = useCallback(() => {
    setOpen(false)
    // Restore focus so keyboard users land back where they were.
    triggerElRef.current?.focus?.()
  }, [])

  // Capture phase wins against focused-input defaults and extensions.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        e.stopPropagation()
        handleClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (open) {
          handleClose()
        } else {
          handleOpen('cmd-k')
        }
        return
      }
      if (e.key === '/' && !open) {
        const target = e.target as HTMLElement | null
        const isTyping =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target?.isContentEditable ?? false)
        if (isTyping) return
        e.preventDefault()
        handleOpen('slash')
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [open, handleOpen, handleClose])

  return (
    <SearchContext.Provider
      // The context's open() is only reachable from the SearchButtons.
      value={{ open: () => handleOpen('button'), prefetch: fetchIndex }}
    >
      {children}
      <SearchModal
        open={open}
        onClose={handleClose}
        load={loadForModal}
        onRetry={fetchIndex}
        pathCounts={counts}
      />
    </SearchContext.Provider>
  )
}

interface SearchButtonProps {
  className?: string
  children: ReactNode
  onClick?: () => void
}

export function SearchButton({
  className,
  children,
  onClick,
}: SearchButtonProps) {
  const ctx = useContext(SearchContext)
  if (!ctx) {
    throw new Error('SearchButton must be used within a SearchProvider')
  }
  return (
    <button
      type="button"
      onClick={() => {
        onClick?.()
        ctx.open()
      }}
      onMouseEnter={ctx.prefetch}
      onFocus={ctx.prefetch}
      className={className}
      aria-label="Search"
    >
      {children}
    </button>
  )
}
