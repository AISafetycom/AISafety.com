'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { chipsFor, greetingFor } from '@/lib/assistant/pages'
import { getPageContext } from '@/lib/assistant/page-context'
import { suggestFormUrl } from '@/lib/assistant/constants'
import { trackEvent, isTrackingOptedOut } from '@/lib/analytics'
import type { CitationRef } from '@/lib/assistant/types'
import ChatBody, {
  type ChatBodyHandle,
  type TurnLifecycleEvent,
} from './ChatBody'
import Icon from '@/components/Icon'
import styles from './Assistant.module.css'

const STORAGE_KEY = 'aisafety-assistant-messages-v3'
const SESSION_KEY = 'aisafety-assistant-session-v1'

/** A fresh id for this browser session: the platform's UUID generator, or
 *  its cryptographic random bytes where that is missing. Never Math.random,
 *  so an id can't be guessed from the clock. */
function newSessionId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    return `s-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`
  }
  return `s-${Date.now()}`
}

function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = newSessionId()
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return newSessionId()
  }
}

function captureUtm(): Record<string, string> | null {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const out: Record<string, string> = {}
  for (const [k, v] of url.searchParams.entries()) {
    if (k.startsWith('utm_') || k === 'ref' || k === 'src') out[k] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

interface GeoFallback {
  city?: string
  region?: string
  country?: string
}

/** A reply currently streaming in, plus what's happened to its surroundings
 *  since the visitor hit send. */
interface LiveTurn {
  turnIndex: number
  sentAt: number
  /** ms after send that the panel was first closed, if it was. */
  panelClosedAtMs?: number
  /** ms after send that the tab first went to the background, if it did. */
  tabHiddenAtMs?: number
}

function tabIsVisible(): boolean {
  return typeof document === 'undefined'
    ? true
    : document.visibilityState === 'visible'
}

const GEO_CACHE_KEY = 'aisafety-assistant-geo-v1'
let geoFallbackCache: GeoFallback | null | undefined

async function fetchGeoFallback(): Promise<GeoFallback | null> {
  if (geoFallbackCache !== undefined) return geoFallbackCache
  try {
    const cached = sessionStorage.getItem(GEO_CACHE_KEY)
    if (cached) {
      geoFallbackCache = JSON.parse(cached) as GeoFallback
      return geoFallbackCache
    }
  } catch (err) {
    console.warn('[assistant] geo cache read failed', err)
  }
  try {
    const res = await fetch('https://ipapi.co/json/', { cache: 'force-cache' })
    if (!res.ok) {
      console.warn('[assistant] ipapi returned', res.status)
      geoFallbackCache = null
      return null
    }
    const data = await res.json()
    const geo: GeoFallback = {
      city: typeof data.city === 'string' ? data.city : undefined,
      region: typeof data.region === 'string' ? data.region : undefined,
      country:
        typeof data.country_code === 'string' ? data.country_code : undefined,
    }
    geoFallbackCache = geo
    try {
      sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geo))
    } catch (err) {
      console.warn('[assistant] geo cache write failed', err)
    }
    return geo
  } catch (err) {
    console.warn('[assistant] geo lookup failed', err)
    geoFallbackCache = null
    return null
  }
}

export default function Assistant() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [hasMessages, setHasMessages] = useState(false)
  const chatRef = useRef<ChatBodyHandle>(null)

  const currentPage = pathname || '/'
  const chips = useMemo(() => chipsFor(currentPage), [currentPage])
  const greeting = useMemo(() => greetingFor(currentPage), [currentPage])

  const fireLog = useCallback(async (event: object) => {
    // The "exclude this browser" switch (privacy page/admin) covers the
    // assistant's open/click/suggest log too, not just conversation turns.
    if (isTrackingOptedOut()) return
    try {
      await fetch('/api/assistant/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        keepalive: true,
      })
    } catch (err) {
      console.warn('[assistant] log post failed', err)
    }
  }, [])

  const handleOpen = useCallback(
    (trigger: 'pill' | 'chip' | 'keyboard') => {
      setIsOpen(true)
      void fireLog({ kind: 'open', trigger, currentPage })
      // First-party funnel: unique users who open the chatbot. The page and
      // trigger feed the admin dashboard's "where/how it's opened" panels.
      trackEvent('chatbot_open', { page: currentPage })
    },
    [currentPage, fireLog]
  )

  // Funnel: unique users who send the chatbot a message. Fired from the public
  // chatbot only (the admin playground doesn't pass onUserSend), so internal
  // testing never inflates the numbers.
  const handleUserSend = useCallback(() => {
    trackEvent('chatbot_message', { page: currentPage })
  }, [currentPage])

  const handleTogglePill = useCallback(() => {
    if (isOpen) {
      setIsOpen(false)
      setIsExpanded(false)
    } else {
      handleOpen('pill')
    }
  }, [isOpen, handleOpen])

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setIsExpanded(false)
  }, [])

  const handleSuggest = useCallback(
    (query: string, type?: string, turnIndex?: number) => {
      void fireLog({
        kind: 'suggest',
        query,
        type,
        turnIndex,
        currentPage,
        sessionId: getSessionId(),
      })
      window.open(suggestFormUrl(type), '_blank', 'noopener')
    },
    [currentPage, fireLog]
  )

  const handleCitationClick = useCallback(
    (c: CitationRef, turnIndex: number) => {
      void fireLog({
        kind: 'click',
        citationId: c.id,
        turnIndex,
        url: c.url,
        currentPage,
        sessionId: getSessionId(),
      })
      // Funnel: unique users who click a result the chatbot surfaced.
      trackEvent('chatbot_click', {
        url: c.url,
        listingId: c.id,
        page: currentPage,
        source: 'card',
      })
    },
    [currentPage, fireLog]
  )

  const handleLinkClick = useCallback(
    (href: string, label: string, turnIndex?: number) => {
      void fireLog({
        kind: 'click',
        target: 'link',
        url: href,
        label,
        turnIndex,
        currentPage,
        sessionId: getSessionId(),
      })
      trackEvent('chatbot_click', {
        url: href,
        label,
        page: currentPage,
        source: 'link',
      })
    },
    [currentPage, fireLog]
  )

  const handleRate = useCallback(
    (value: 'up' | 'down' | null, turnIndex: number) => {
      void fireLog({
        kind: 'rating',
        value,
        turnIndex,
        currentPage,
        sessionId: getSessionId(),
      })
      // null = the visitor clicked their thumb off again; labelled 'removed'
      // so the dashboard's activity feed can spell it out.
      trackEvent('chatbot_rating', {
        label: value ?? 'removed',
        page: currentPage,
      })
    },
    [currentPage, fireLog]
  )

  const handleClear = useCallback(() => {
    chatRef.current?.clear()
    setHasMessages(false)
  }, [])

  // ── Delivery reporting ──────────────────────────────────────────────────
  // The server knows when it finished generating a reply; only the browser
  // knows whether anyone was there for it. So the browser reports back, per
  // turn: the stream finishing here ('received', with whether the panel was
  // open and the tab visible at that moment), the visitor pressing Stop, the
  // page being unloaded mid-reply ('left'), and — if the reply arrived out of
  // view — the moment it was brought back into view ('seen'). Along the way
  // we note the first time the panel was closed or the tab hidden while the
  // reply was still streaming. All of it lands on the conversation row's
  // Delivery field for the admin log.
  const isOpenRef = useRef(isOpen)
  const liveTurnRef = useRef<LiveTurn | null>(null)
  // A reply that arrived while the panel was closed or the tab hidden, not
  // yet brought into view.
  const unseenRef = useRef<{ turnIndex: number; sentAt: number } | null>(null)

  const reportDelivery = useCallback(
    (
      outcome: 'received' | 'stopped' | 'error' | 'left',
      live: LiveTurn,
      ms: number,
      error?: string
    ) => {
      void fireLog({
        kind: 'delivery',
        outcome,
        turnIndex: live.turnIndex,
        ms,
        error,
        panelOpen: isOpenRef.current,
        tabVisible: tabIsVisible(),
        panelClosedAtMs: live.panelClosedAtMs,
        tabHiddenAtMs: live.tabHiddenAtMs,
        currentPage,
        sessionId: getSessionId(),
      })
    },
    [currentPage, fireLog]
  )

  // If an out-of-view reply is now in view (panel open AND tab visible),
  // report it seen. Called whenever either of those flips back on.
  const reportSeenIfVisible = useCallback(() => {
    const unseen = unseenRef.current
    if (!unseen || !isOpenRef.current || !tabIsVisible()) return
    unseenRef.current = null
    void fireLog({
      kind: 'delivery',
      outcome: 'seen',
      turnIndex: unseen.turnIndex,
      ms: Date.now() - unseen.sentAt,
      currentPage,
      sessionId: getSessionId(),
    })
  }, [currentPage, fireLog])

  const handleTurnLifecycle = useCallback(
    (e: TurnLifecycleEvent) => {
      if (e.phase === 'start') {
        liveTurnRef.current = { turnIndex: e.turnIndex, sentAt: Date.now() }
        // Sending a new message means the panel is open and in use — any
        // earlier out-of-view reply has been superseded.
        unseenRef.current = null
        return
      }
      const live = liveTurnRef.current
      if (!live || live.turnIndex !== e.turnIndex) return
      liveTurnRef.current = null
      reportDelivery(e.phase, live, e.ms, e.error)
      if (e.phase === 'received' && (!isOpenRef.current || !tabIsVisible())) {
        unseenRef.current = { turnIndex: live.turnIndex, sentAt: live.sentAt }
      }
    },
    [reportDelivery]
  )

  // Panel open/closed: note a close mid-reply; a reopen may bring an
  // out-of-view reply into view. Watching the state (rather than each close
  // path) covers the X button, the pill, Escape and the scrim alike.
  useEffect(() => {
    isOpenRef.current = isOpen
    const live = liveTurnRef.current
    if (!isOpen && live && live.panelClosedAtMs == null) {
      live.panelClosedAtMs = Date.now() - live.sentAt
    }
    if (isOpen) reportSeenIfVisible()
  }, [isOpen, reportSeenIfVisible])

  // Tab hidden/visible, and the page going away mid-reply. `pagehide` is the
  // last reliable moment to get a request out as a tab closes; fireLog's
  // keepalive lets the browser finish sending it after the page is gone.
  useEffect(() => {
    const onVisibility = () => {
      if (tabIsVisible()) {
        reportSeenIfVisible()
        return
      }
      const live = liveTurnRef.current
      if (live && live.tabHiddenAtMs == null) {
        live.tabHiddenAtMs = Date.now() - live.sentAt
      }
    }
    const onPageHide = () => {
      const live = liveTurnRef.current
      if (!live) return
      liveTurnRef.current = null
      reportDelivery('left', live, Date.now() - live.sentAt)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [reportDelivery, reportSeenIfVisible])

  const buildBodyExtras = useCallback(async () => {
    const pageCtx = getPageContext()
    const referrer =
      typeof document !== 'undefined' && document.referrer
        ? document.referrer
        : null
    const utm = captureUtm()
    const geoFallback = await fetchGeoFallback()
    return {
      currentPage,
      pageState: pageCtx
        ? {
            page: pageCtx.page,
            ...(pageCtx.filters ? { filters: pageCtx.filters } : {}),
            ...(pageCtx.search ? { search: pageCtx.search } : {}),
          }
        : null,
      referrer,
      utm,
      geoFallback,
      sessionId: getSessionId(),
      // When the owner has excluded this browser, tell the server not to log
      // the turn — keeps their own testing out of the conversation log.
      noLog: isTrackingOptedOut() || undefined,
    }
  }, [currentPage])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, handleClose])

  // Focus the message field on open so the user can start typing right away.
  // Desktop only — on touch devices the on-screen keyboard would pop up and
  // cover the greeting and suggestion chips.
  useEffect(() => {
    if (!isOpen) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    chatRef.current?.focusInput()
  }, [isOpen])

  return (
    <>
      <button
        type="button"
        className={`${styles.pill} drop-shadow-dark`}
        onClick={handleTogglePill}
        aria-label={
          isOpen ? 'Close the assistant' : 'Open the AISafety.com assistant'
        }
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <Icon src="/images/icons/chevron-down-xl.svg" size={32} />
        ) : (
          <Icon src="/images/icons/speech-bubble-sparkle-xl.svg" size={32} />
        )}
      </button>

      <div
        className={`${styles.scrim} ${isOpen && isExpanded ? styles.scrimVisible : ''}`}
        onClick={handleClose}
        aria-hidden="true"
      />

      <aside
        className={`${styles.panel} ${isOpen ? styles.panelOpen : ''} ${isExpanded ? styles.panelExpanded : ''}`}
        role="dialog"
        aria-modal={isExpanded}
        aria-label="AISafety.com directory assistant"
        aria-hidden={!isOpen}
      >
        <header className={styles.header}>
          <div className={styles.headerLabel}>
            <Icon
              src="/images/icons/chat.svg"
              size={16}
              className={styles.headerLabelIcon}
            />
            <span>Chatbot (beta)</span>
          </div>
          <div className={styles.headerActions}>
            {hasMessages && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={handleClear}
                aria-label="Clear conversation"
                title="Clear conversation"
              >
                <Icon src="/images/icons/trash.svg" size={16} />
              </button>
            )}
            <button
              type="button"
              className={`${styles.iconButton} ${styles.expandButton}`}
              onClick={() => setIsExpanded(v => !v)}
              aria-label={isExpanded ? 'Shrink assistant' : 'Expand assistant'}
              title={isExpanded ? 'Shrink' : 'Expand'}
            >
              {isExpanded ? (
                <Icon src="/images/icons/shrink.svg" size={16} />
              ) : (
                <Icon src="/images/icons/expand.svg" size={16} />
              )}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleClose}
              aria-label="Close assistant"
            >
              <Icon src="/images/icons/x.svg" size={16} />
            </button>
          </div>
        </header>

        <ChatBody
          ref={chatRef}
          endpoint="/api/assistant"
          bodyExtras={buildBodyExtras}
          chips={chips}
          greeting={greeting}
          storageKey={STORAGE_KEY}
          onSuggest={handleSuggest}
          onCitationClick={handleCitationClick}
          onLinkClick={handleLinkClick}
          onRate={handleRate}
          onUserSend={handleUserSend}
          onTurnLifecycle={handleTurnLifecycle}
          onHasMessagesChange={setHasMessages}
          resizeKey={`${isOpen}-${isExpanded}`}
        />
      </aside>
    </>
  )
}
