// Client-side analytics helpers.
//
// Every listing click runs through trackListingClick, which does two things:
//   1. Pushes a Matomo event (window._paq), exactly as before.
//   2. Sends a first-party beacon to our own /api/track endpoint.
//
// The beacon is sent IN ADDITION to Matomo and on our own domain, so clicks are
// still captured when an ad blocker strips the Matomo request. Everything here
// no-ops safely during SSR and never throws into a click handler.

type Paq = { push: (args: unknown[]) => void }

declare global {
  interface Window {
    _paq?: Paq
  }
}

interface TrackPayload {
  type: string
  page?: string
  label?: string
  url?: string
  listingId?: string
  /** Slot the listing sat in when clicked ('F1'/'F2' or a number) — lets the
   *  dashboard tie clicks to the rank that produced them. */
  position?: string
  /** 'map' when the click came from a page's map (Map, Communities); left unset
   *  for card clicks, which the dashboard treats as the default. Search events
   *  reuse it: how the modal was opened (search_open), the active type filter
   *  (search_query), or the clicked result's type (search_click). */
  source?: string
  /** The map-area dimension — the listing's FIRST category, stamped on
   *  Map-page clicks and hovers so the dashboard can slice the map by area. */
  area?: string
  /** Site-search and map-search events: the query text as typed. */
  query?: string
  /** search_query / map_search_query only: how many results the query
   *  returned. */
  results?: number
}

const VID_KEY = 'aisafety_vid'
const OPTOUT_KEY = 'aisafety_no_track'

/** Raw opt-out marker for this browser: the ISO timestamp it was excluded from
 *  the stats, or '' when it isn't excluded (a legacy '1' may exist from before
 *  the date was stored). The flag lives in localStorage rather than being
 *  matched on IP, because the owner is a nomad whose IP changes monthly; a
 *  per-browser flag sticks regardless of location. The dashboard control reads
 *  this directly as its reactive snapshot. */
export function getTrackingOptOut(): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    return localStorage.getItem(OPTOUT_KEY) ?? ''
  } catch {
    return ''
  }
}

/** True when this browser has opted out of first-party analytics — used to keep
 *  the site owner's own clicks out of the dashboard. */
export function isTrackingOptedOut(): boolean {
  return getTrackingOptOut() !== ''
}

/** Turn first-party tracking off (true) or back on (false) for this browser.
 *  When turning off we record the moment, so the dashboard can show that the
 *  exclusion only applies from then on — earlier visits stay counted. */
export function setTrackingOptOut(optOut: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (optOut) localStorage.setItem(OPTOUT_KEY, new Date().toISOString())
    else localStorage.removeItem(OPTOUT_KEY)
  } catch {
    // Storage unavailable (private mode); nothing to persist.
  }
}

/** A stable, anonymous per-browser id (random UUID in localStorage) so the
 *  dashboard can count UNIQUE users — e.g. not double-counting one person who
 *  opens the chatbot ten times. No PII; first-party only. Returns undefined if
 *  storage is unavailable (private mode), in which case the event is still
 *  recorded, just not deduped. */
function getVisitorId(): string | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined
    let id = localStorage.getItem(VID_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(VID_KEY, id)
    }
    return id
  } catch {
    return undefined
  }
}

/** Fire a first-party event to /api/track. Prefers sendBeacon so it survives the
 *  navigation a click triggers; falls back to keepalive fetch. */
function sendTrackEvent(payload: TrackPayload): void {
  // The owner can exclude their own browser from the stats.
  if (isTrackingOptedOut()) return
  try {
    const body = JSON.stringify({ ...payload, vid: getVisitorId() })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const queued = navigator.sendBeacon(
        '/api/track',
        new Blob([body], { type: 'application/json' })
      )
      // sendBeacon returns false if the user agent couldn't queue it; fall
      // through to fetch rather than silently dropping the event.
      if (queued) return
    }
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
  } catch (err) {
    // Analytics must never break a click.
    console.warn('[analytics] beacon failed', err)
  }
}

/**
 * Track a click on a listing (funder, job, event, course, etc.).
 * Matomo category is "Listings - <page>" to match the legacy Webflow format.
 * `listingId` is the Airtable record id when available, so clicks can be joined
 * back to the exact source record. `area` is the listing's first category —
 * stamped on Map-page clicks only, where areas are how the map is grouped.
 */
export function trackListingClick(
  page: string,
  name: string,
  url: string,
  listingId?: string,
  position?: string,
  source?: string,
  area?: string
): void {
  if (typeof window === 'undefined') return
  // Opted-out browsers skip Matomo too, so the owner's clicks stay out of both.
  if (isTrackingOptedOut()) return
  window._paq?.push(['trackEvent', `Listings - ${page}`, name, url])
  sendTrackEvent({
    type: 'listing_click',
    page,
    label: name,
    url,
    listingId,
    position,
    source,
    area,
  })
}

/**
 * Track a hover on a map listing: on desktop the cursor rested on it for
 * 500 ms, on mobile the first tap that opened its tooltip. First-party beacon
 * only — no Matomo event, since hovers are a dashboard-only signal. `source`
 * is always 'map': hovers can only happen on the map surface, never on cards.
 * `area` is the listing's first category (stamped on the Map page only).
 * Opt-out isn't checked here — sendTrackEvent already does that itself.
 */
export function trackListingHover(
  page: string,
  name: string,
  url?: string,
  listingId?: string,
  area?: string
): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({
    type: 'listing_hover',
    page,
    label: name,
    url,
    listingId,
    area,
    source: 'map',
  })
}

/**
 * Track a visitor turning a filter value on (a sidebar checkbox or a dropdown
 * option) on a resource page. Deselections aren't recorded — the activation is
 * the expression of interest. `source` carries the filter group's title (e.g.
 * 'Type'), `label` the value picked (e.g. 'Fellowship').
 */
export function trackFilterApply(
  page: string,
  group: string,
  value: string
): void {
  if (typeof window === 'undefined') return
  if (isTrackingOptedOut()) return
  window._paq?.push(['trackEvent', `Filters - ${page}`, group, value])
  sendTrackEvent({
    type: 'filter_apply',
    page,
    source: group,
    label: value,
  })
}

/**
 * Track a click on a page's contribute buttons: the "Add a …" / "Suggest a
 * correction" rows or an extra action row. `action` slugs the button
 * ('add' | 'correction' | 'extra'), `label` is its visible text. The "View
 * data in Airtable" card is not a contribution — see trackAirtableView.
 */
export function trackContributeClick(
  page: string,
  action: string,
  label: string,
  url: string
): void {
  if (typeof window === 'undefined') return
  if (isTrackingOptedOut()) return
  window._paq?.push(['trackEvent', `Contribute - ${page}`, label, url])
  sendTrackEvent({
    type: 'contribute_click',
    page,
    source: action,
    label,
    url,
  })
}

/**
 * Track a submit of the newsletter signup box (arrow click or Enter — both
 * fire the form's submit). Counts the attempt: the submit opens Substack's
 * subscribe page, so completion happens off-site. The email itself is never
 * recorded.
 */
export function trackNewsletterSignup(page: string): void {
  if (typeof window === 'undefined') return
  if (isTrackingOptedOut()) return
  window._paq?.push(['trackEvent', `Newsletter - ${page}`, 'Signup'])
  sendTrackEvent({
    type: 'newsletter_signup',
    page,
    label: 'Newsletter signup',
  })
}

/**
 * Track a click on the newsletter signup box outside the email pill — the
 * card doubles as a link to the newsletter's own page, for visitors who want
 * to read it before subscribing.
 */
export function trackNewsletterView(page: string): void {
  if (typeof window === 'undefined') return
  if (isTrackingOptedOut()) return
  window._paq?.push(['trackEvent', `Newsletter - ${page}`, 'View'])
  sendTrackEvent({
    type: 'newsletter_view',
    page,
    label: 'Newsletter view',
  })
}

/**
 * Track a click on one of the footer's external links (the "Help us out" and
 * "Newsletters" columns) — outbound, so nothing else would record them.
 * `section` is the column heading, `label` the link text; `page` is stamped
 * with the path the footer was on, like page views.
 */
export function trackFooterClick(
  section: string,
  label: string,
  url: string
): void {
  if (typeof window === 'undefined') return
  if (isTrackingOptedOut()) return
  window._paq?.push(['trackEvent', 'Footer', label, url])
  sendTrackEvent({
    type: 'footer_click',
    page: window.location.pathname,
    source: section,
    label,
    url,
  })
}

/** Track a click on a page's "View data in Airtable" card. */
export function trackAirtableView(page: string, url: string): void {
  if (typeof window === 'undefined') return
  if (isTrackingOptedOut()) return
  window._paq?.push(['trackEvent', `Airtable - ${page}`, 'View data', url])
  sendTrackEvent({
    type: 'airtable_view',
    page,
    label: 'View data in Airtable',
    url,
  })
}

/**
 * Track a page visit. Fired on every route change, initial load included (see
 * MatomoRouteTracker). Matomo records its own page views via its snippet —
 * this is the first-party copy that ad blockers can't strip, and it carries
 * the visitor id that makes cross-page interest analysis possible.
 */
export function trackPageView(path: string): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({ type: 'page_view', page: path })
}

/** How the search modal was opened: the nav's magnifying-glass button,
 *  ⌘K/Ctrl+K, or the / key. */
export type SearchOpenMethod = 'button' | 'cmd-k' | 'slash'

/** Track the site-search modal opening, and how it was opened. */
export function trackSearchOpen(method: SearchOpenMethod): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({
    type: 'search_open',
    source: method,
    page: window.location.pathname,
  })
}

/** How the global nav's +N menu was opened: a mouse/trackpad hover, or a tap
 *  on a touch screen. */
export type NavOverflowOpenMethod = 'hover' | 'tap'

/** Track the global nav's +N menu opening, and how. Fired once per
 *  closed→open transition: the 150 ms hover grace keeps the panel open while
 *  the pointer crosses the gap into it, so that never counts twice. */
export function trackNavOverflowOpen(method: NavOverflowOpenMethod): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({
    type: 'nav_overflow_open',
    source: method,
    page: window.location.pathname,
  })
}

/**
 * Track a settled site-search query — fired once the visitor pauses typing,
 * or immediately if they click a result / close search before the pause.
 * `results` is how many results the query returned (0 = the site had nothing
 * for it); `filter` is the active type filter, when the search was narrowed
 * to one resource type.
 */
export function trackSearchQuery(
  query: string,
  results: number,
  filter?: string
): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({
    type: 'search_query',
    query,
    results,
    source: filter,
    page: window.location.pathname,
  })
}

/**
 * Track a click on a site-search result. `query` is what was typed when the
 * result was clicked (empty when browsing a type filter without typing);
 * `position` is the result's rank in the list, counted from 1; `resultType`
 * is the result's search type ('job', 'funder', …) — recorded so the
 * dashboard can show which resource page the result belongs to even after
 * the listing itself is gone from the index.
 */
export function trackSearchClick(
  query: string,
  title: string,
  url: string,
  position: string,
  resultType: string
): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({
    type: 'search_click',
    query: query || undefined,
    label: title,
    url,
    position,
    source: resultType,
    page: window.location.pathname,
  })
}

/** How the /map search box was opened: its magnifying-glass button, or
 *  ⌘F/Ctrl+F taking over the browser's find-in-page while over the map. */
export type MapSearchOpenMethod = 'button' | 'cmd-f'

/**
 * Track the Field map's own search box opening. Distinct from the sitewide
 * search modal, which has its own search_* events: different box, different
 * outcome (a pick flies the map to the pin instead of opening a page). Always
 * on the Map page, so `page` is the resource-page name the map's clicks and
 * hovers already use.
 */
export function trackMapSearchOpen(method: MapSearchOpenMethod): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({ type: 'map_search_open', page: 'Map', source: method })
}

/**
 * Track a settled /map search — fired once the visitor pauses typing, or
 * immediately if they pick a result / leave the box before the pause.
 * `results` is how many listings matched (0 = the map has nothing for it).
 */
export function trackMapSearchQuery(query: string, results: number): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({ type: 'map_search_query', page: 'Map', query, results })
}

/**
 * Track a /map search result being picked (the map flies to the listing).
 * `query` is what was typed when it was picked; `position` is the result's
 * rank counted from 1; `area` is the listing's first category — the same area
 * dimension map clicks and hovers carry, so picks can be sliced like them.
 */
export function trackMapSearchPick(
  query: string,
  title: string,
  url: string,
  listingId: string,
  position: string,
  area?: string
): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({
    type: 'map_search_pick',
    page: 'Map',
    query: query || undefined,
    label: title,
    url,
    listingId,
    position,
    area,
  })
}

/**
 * Track an arbitrary first-party event (e.g. a chatbot open, newsletter signup,
 * or donate click). Send-only — does not touch Matomo. Lets us start capturing
 * new actions without a schema change on the server.
 */
export function trackEvent(
  type: string,
  props: Omit<TrackPayload, 'type'> = {}
): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({ type, ...props })
}

/**
 * Track a click on the button that sits on a page's map and scrolls down to
 * the listings below it ("View cards" on Map, "View online communities" on
 * Communities). `label` is the button's visible text.
 */
export function trackCardsButtonClick(page: string, label: string): void {
  if (typeof window === 'undefined') return
  if (isTrackingOptedOut()) return
  window._paq?.push(['trackEvent', `Cards - ${page}`, 'Button click', label])
  sendTrackEvent({ type: 'cards_button_click', page, label })
}

/**
 * Track a visitor reaching the listings below a page's map (Map,
 * Communities). Fired once per page load, when the top of the cards section
 * scrolls into the upper half of the screen — via the button, by hand, or by
 * arriving on a link straight to it. First-party only, like hovers: a passive
 * signal for the dashboard rather than a Matomo event. The fixed label gives
 * the dashboard's unique-mode dedupe (one per visitor per page per day) a key.
 */
export function trackCardsView(page: string): void {
  if (typeof window === 'undefined') return
  sendTrackEvent({ type: 'cards_view', page, label: 'Cards section' })
}
