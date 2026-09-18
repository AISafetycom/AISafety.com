// First-party analytics event store (server-side only).
//
// Two backends, chosen automatically at runtime:
//   • Production: Upstash Redis — the same instance the chatbot rate-limiter
//     already uses. Events are stored in one list per calendar month
//     (aisafety:analytics:events:2026-07, …), newest first, with a sorted set
//     indexing which months exist. Nothing is ever deleted: a dashboard query
//     reads only the months its date range touches, so reads stay fast and
//     bounded no matter how much history accumulates. (The store originally
//     kept a single list capped at 5,000 events, which silently deleted
//     everything older than ~10 days — including all of 20–30 June 2026, the
//     first stretch after launch. The migrate endpoint copied that list's
//     survivors into their month lists on 10 July 2026.)
//   • Local dev (no Redis env vars set): an append-only NDJSON file under
//     .analytics-dev/ so the whole loop works on a laptop without touching
//     production data.
//
// Aggregation happens per-query in JS over the raw events: this keeps storage
// simple, makes the dashboard fully date-range aware (every event carries a
// timestamp), and means dev and prod compute identically. If a single month
// ever outgrows a JS aggregation pass we'd add daily rollups on top.

import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { displayFilterGroup, displayFilterValue } from '@/lib/filter-tracking'

export interface AnalyticsEvent {
  /** Event kind, e.g. 'listing_click'. Must be in ALLOWED_EVENT_TYPES. */
  type: string
  /** Resource page the event came from, e.g. 'Funding'. */
  page?: string
  /** Airtable record id of the listing, when known — the stable join key back
   *  to the source record (names and urls can change; the id doesn't). */
  listingId?: string
  /** Human-readable label for dashboards, e.g. the listing name. */
  label?: string
  /** The slot the listing occupied when it was clicked — 'F1'/'F2' for the two
   *  featured cards, otherwise its number in the list ('1', '2', …). Stamped at
   *  click time so it survives later reordering; absent on pre-feature clicks. */
  position?: string
  /** Where on the page the click came from. Only set to 'map' on the two pages
   *  with a map (Map, Communities) when the click is on the map itself; every
   *  other click (cards, featured cards) is left unset and treated as a card.
   *  Search events reuse it: on search_open it's how the modal was opened
   *  ('button' | 'cmd-k' | 'slash'); on search_query, the active type filter;
   *  on search_click, the clicked result's type ('job', 'funder', …). On
   *  map_search_open it's how the map's box was opened ('button' | 'cmd-f'). */
  source?: string
  /** The map-area dimension — the listing's first category, stamped on
   *  Map-page clicks and hovers so the dashboard can slice the map by area. */
  area?: string
  /** Site-search and map-search events: the query text as typed — the
   *  subject of a search_query / map_search_query, and on a search_click /
   *  map_search_pick the query that produced the result. */
  query?: string
  /** search_query / map_search_query only: how many results the query
   *  returned. 0 means the visitor searched for something the site (or the
   *  map) has nothing for. */
  results?: number
  /** Destination / relevant URL. */
  url?: string
  /** Referrer path, if available. */
  ref?: string
  /** Anonymous per-browser id, for unique-user counts. */
  vid?: string
  /** ISO timestamp, set server-side — never trust the client clock. */
  ts: string
}

/** Event kinds we accept. Add a kind here when wiring up a new tracked action;
 *  the public endpoint rejects anything not in this set, which bounds what an
 *  abusive caller can write. */
export const ALLOWED_EVENT_TYPES = new Set<string>([
  'page_view',
  'listing_click',
  // A visitor resting on a map listing (Map, Communities): a 500 ms cursor
  // dwell on desktop, or the tap that opens the tooltip on mobile.
  'listing_hover',
  // A visitor turning a filter value on (sidebar checkbox or dropdown option).
  // `source` is the filter group's title, `label` the value picked.
  'filter_apply',
  // A click on a page's contribute buttons: the "Add a …" / "Suggest a
  // correction" rows or an extra action row. `source` slugs the button
  // ('add' | 'correction' | 'extra'), `label` is its visible text.
  'contribute_click',
  // A click on a page's "View data in Airtable" card — data curiosity, not a
  // contribution, so it's its own kind.
  'airtable_view',
  // Map pages (Map, Communities): a click on the button on the map that
  // scrolls down to the listings, and a visitor reaching those listings —
  // fired once per page load when the top of the cards section scrolls into
  // the upper half of the screen, however they got there.
  'cards_button_click',
  'cards_view',
  // A submit of the newsletter signup box (Events/Training). Counts the
  // attempt — the submit opens Substack's subscribe page, so completion
  // happens off-site. Never carries the email address.
  'newsletter_signup',
  // A click on the newsletter signup box outside the email pill — the card
  // doubles as a link to the newsletter's own page, so visitors can read it
  // before subscribing.
  'newsletter_view',
  // A click on one of the footer's external links ("Help us out" /
  // "Newsletters" columns) — outbound, so nothing else records them.
  // `source` is the column heading, `label` the link text, `page` the path
  // the footer was on.
  'footer_click',
  'chatbot_open',
  'chatbot_message',
  'chatbot_click',
  // A thumbs up/down on a chatbot reply. `label` is 'up' | 'down', `page`
  // the path the chat was open on. The per-turn detail lives on the
  // conversation row (Ratings field); this is the aggregate signal.
  'chatbot_rating',
  // The privacy page's analytics switch: the opt-out is the browser's last
  // recorded event, the opt-in its first after coming back.
  'analytics_optout',
  'analytics_optin',
  // Site search: opening the modal, a settled query, and a result click.
  'search_open',
  'search_query',
  'search_click',
  // The Field map's own search box (/map): opening it, a settled query, and
  // a result being picked (the map flies to the listing). Kept apart from the
  // sitewide search_* events — different box, different outcome. Picks carry
  // the listing like a map click does (label, listingId, url, area) plus the
  // result's rank in `position`.
  'map_search_open',
  'map_search_query',
  'map_search_pick',
  // The global nav's +N pill (the pages that don't fit the bar) opening its
  // menu. `source` is how: 'hover' (mouse/trackpad) or 'tap' (touch screens);
  // `page` the path it happened on. One per closed→open transition.
  'nav_overflow_open',
])

/** Dashboard labels for how the +N menu was opened (nav_overflow_open.source). */
const NAV_OVERFLOW_OPEN_LABEL: Record<string, string> = {
  hover: 'Hover',
  tap: 'Tap',
}

// ─── Redis backend ───────────────────────────────────────────────────────────

// The Vercel-Upstash Marketplace integration provisions KV_REST_API_URL /
// KV_REST_API_TOKEN; also accept the upstream UPSTASH_REDIS_REST_* names. Same
// fallback chain the rate-limiter uses, so we hit the same database.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

const trackLimiter = store
  ? new Ratelimit({
      redis: store,
      // Generous for real clicking; bounds scripted abuse. ~40 events / 10s / IP.
      limiter: Ratelimit.slidingWindow(40, '10 s'),
      analytics: false,
      prefix: 'aisafety:analytics:rl',
    })
  : null

// One list of raw events per calendar month (newest first), plus a sorted set
// naming the months that exist so reads never have to scan the keyspace.
const MONTH_KEY_PREFIX = 'aisafety:analytics:events:' // + 'YYYY-MM'
const MONTHS_KEY = 'aisafety:analytics:months'
// The original single-list store, retired 10 Jul 2026. Its contents were copied
// into the month lists by migrateLegacyEvents(); the key itself is left in
// place so a rolled-back deployment still finds its data.
const LEGACY_EVENTS_KEY = 'aisafety:analytics:events'
const MIGRATED_KEY = 'aisafety:analytics:legacy-migrated'
// When each visitor was first seen: a hash of visitor id → epoch ms of the
// earliest event we hold for that browser, any type. Written with every event
// (HSETNX, so the first write sticks) and filled in for pre-existing visitors
// by backfillFirstSeen(). It exists so the dashboard can tell returning
// visitors from new ones without re-reading every stored month on every load —
// one HMGET over the range's visitors instead. Grows by one ~50-byte entry per
// new browser (bots included), i.e. a small fraction of the month lists.
const FIRST_SEEN_KEY = 'aisafety:analytics:first-seen'
// Marker set once backfillFirstSeen() has run; until then first-seen only
// covers visitors seen since the feature deployed, and the dashboard says so.
const FIRST_SEEN_BACKFILLED_KEY = 'aisafety:analytics:first-seen-backfilled'
// Visitor ids per HMGET when looking up first-seen timestamps; a full
// pipeline of these stays well under Upstash's response-size limits.
const FIRST_SEEN_CHUNK = 1000
// Backstop only — never reached by real traffic. Clicks and chatbot events ran
// ~15k/month as of July 2026; page-view tracking (added 15 July 2026) is
// estimated to lift organic volume to ~50–100k/month, so this is ~1.5–3×
// headroom. It bounds what a scripted abuser who stays under the per-IP rate
// limit can grow a month list to: at the cap a month is ~45 MB of organic
// events, inside the shared free-tier database's 256 MB (which the chatbot
// rate limiter also lives in) — but if months ever actually run near the cap,
// that database needs a paid plan or per-day rollups, not just a bigger cap.
// recordEvent warns in the logs whenever the cap actually trims, and the
// dashboard shows a warning banner from MONTH_CAP_WARN_RATIO up — so organic
// growth approaching the cap is visible well before data quietly disappears.
const MONTH_CAP = 150_000
// Share of MONTH_CAP at which the dashboard starts warning: early enough to
// raise the cap (one constant, redeploy) before anything is actually trimmed.
const MONTH_CAP_WARN_RATIO = 0.75
// Month lists are read in slices of this many events, each slice as its OWN
// REST request (a pipeline wouldn't help — the client sends a pipeline as one
// HTTP call whose single response would still carry everything), so no
// response can outgrow Upstash's response-size limits, however big a month
// gets. ~300-byte events make a full slice ~1.5 MB.
const READ_CHUNK = 5000

/** 'YYYY-MM' (UTC) an event belongs to, from its server-stamped timestamp. */
function monthOf(ts: string): string | null {
  return /^\d{4}-\d{2}/.test(ts) ? ts.slice(0, 7) : null
}

/** Numeric sort score for a 'YYYY-MM' month, e.g. '2026-07' → 202607. */
function monthScore(month: string): number {
  return Number(month.replace('-', ''))
}

/** Epoch-ms bounds [start, end) of a 'YYYY-MM' month, in UTC. */
function monthBounds(month: string): { startMs: number; endMs: number } {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return {
    startMs: Date.UTC(y, m - 1, 1),
    endMs: Date.UTC(y, m, 1), // Date.UTC rolls month 12 into January
  }
}

/** The stored months (ascending) whose lists could hold events in the range.
 *  Purely a read optimisation — the per-event date filter in aggregate() is
 *  what actually enforces the bounds. */
function monthsInRange(months: string[], range: DateRange): string[] {
  return months.filter(m => {
    const b = monthBounds(m)
    if (range.startMs != null && b.endMs <= range.startMs) return false
    if (range.endMs != null && b.startMs > range.endMs) return false
    return true
  })
}

// ─── Local-file backend (dev only) ───────────────────────────────────────────

const DEV_DIR = path.join(process.cwd(), '.analytics-dev')
const DEV_FILE = path.join(DEV_DIR, 'events.ndjson')

async function writeDevEvent(e: AnalyticsEvent): Promise<void> {
  await fs.mkdir(DEV_DIR, { recursive: true })
  await fs.appendFile(DEV_FILE, JSON.stringify(e) + '\n', 'utf8')
}

/** Dev events, newest first (file is appended oldest-first, so reverse). */
async function readDevEvents(): Promise<AnalyticsEvent[]> {
  let raw: string
  try {
    raw = await fs.readFile(DEV_FILE, 'utf8')
  } catch {
    return [] // file not created yet — no events recorded so far
  }
  const out: AnalyticsEvent[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line) as AnalyticsEvent)
    } catch {
      console.warn('[analytics] skipping malformed dev-log line')
    }
  }
  return out.reverse()
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Whether to accept another event from this IP right now. Fails open (returns
 *  true) when Redis is unavailable, so dev and a Redis outage don't drop data. */
export async function allowTrack(ip: string): Promise<boolean> {
  if (!trackLimiter) return true
  try {
    const { success } = await trackLimiter.limit(ip)
    return success
  } catch (err) {
    console.warn(
      `[analytics] rate-limit check failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return true
  }
}

/** Month-registry and first-seen writes this server instance has already sent.
 *  Both are idempotent (zadd with a fixed score / hsetnx), so these caches only
 *  skip re-sending them with every event — half the write commands at steady
 *  state. A fresh instance simply sends each once more; entries are added only
 *  after the pipeline succeeds, so a failed write is retried by the next event.
 *  The vid cache is cleared at a cap to keep instance memory flat. */
const registeredMonths = new Set<string>()
const firstSeenWritten = new Set<string>()
const FIRST_SEEN_CACHE_CAP = 50_000

/** Record one event. Never throws to the caller — a failed analytics write must
 *  not break the user's request (it is fired via after() from the route). */
export async function recordEvent(event: AnalyticsEvent): Promise<void> {
  try {
    if (store) {
      const month = monthOf(event.ts)
      if (!month) {
        console.warn(
          `[analytics] dropping event with bad timestamp: ${event.ts}`
        )
        return
      }
      const vid = event.vid
      const p = store.pipeline()
      p.lpush(MONTH_KEY_PREFIX + month, event) // upstash serializes to JSON
      const registerMonth = !registeredMonths.has(month)
      if (registerMonth) {
        p.zadd(MONTHS_KEY, { score: monthScore(month), member: month })
      }
      // First time we see this browser? Remember when. NX keeps the earliest.
      const writeFirstSeen = !!vid && !firstSeenWritten.has(vid)
      if (writeFirstSeen) p.hsetnx(FIRST_SEEN_KEY, vid, Date.parse(event.ts))
      const [len] = (await p.exec()) as [number, ...unknown[]]
      if (registerMonth) registeredMonths.add(month)
      if (writeFirstSeen) {
        if (firstSeenWritten.size >= FIRST_SEEN_CACHE_CAP)
          firstSeenWritten.clear()
        firstSeenWritten.add(vid)
      }
      // Abuse backstop, applied only when actually over the cap. Trimming the
      // tail on every write would also destabilise readMonths' tail-anchored
      // slices, so the common case must stay pure-LPUSH. Never silent: real
      // data loss (an attack, or organic growth outgrowing the cap) is logged.
      if (len > MONTH_CAP) {
        console.warn(
          `[analytics] month ${month} is over its ${MONTH_CAP}-event backstop cap (${len}) — trimming oldest events. If this is organic traffic, raise MONTH_CAP.`
        )
        await store.ltrim(MONTH_KEY_PREFIX + month, 0, MONTH_CAP - 1)
      }
      return
    }
    // No Redis configured (local dev) — fall back to the on-disk log.
    await writeDevEvent(event)
  } catch (err) {
    console.warn(
      `[analytics] event write failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export interface Counted {
  name: string
  count: number
}

export interface ListingRow extends Counted {
  /** Lowest–highest slot this listing was clicked at during the period (e.g.
   *  'F1', '2', '4–8'), from positions stamped at click time. Undefined when
   *  none of its clicks in range carry a recorded position. */
  position?: string
  /** A representative destination url (most recent click) — lets the dashboard
   *  show a favicon for pages whose listings have no Airtable logo. */
  url?: string
  /** Airtable record id, from the most recent event in range that carried one
   *  — the stable join key back to the source record. */
  listingId?: string
  /** The listing's first category (the map-area dimension), from the most
   *  recent event in range that carried one. Map-page rows only. */
  area?: string
}

export interface OverallListingRow extends Counted {
  /** The resource page this listing belongs to (e.g. 'Funding'), so the
   *  site-wide leaderboard can show which page each top listing came from. */
  page?: string
  /** A representative destination url (most recent click), for the favicon. */
  url?: string
}

export interface DateRange {
  /** Inclusive lower bound in epoch ms, or null for no lower bound. */
  startMs: number | null
  /** Inclusive upper bound in epoch ms, or null for no upper bound. */
  endMs: number | null
}

export interface ChatbotFunnel {
  /** Unique users who opened the chatbot. */
  opened: number
  /** Unique users who sent it a message. */
  typed: number
  /** Unique users who clicked a result it surfaced. */
  clicked: number
}

/** A clicked-out destination (from chatbot replies or search results). `name`
 *  is the link's visible text when the click carried one, otherwise the raw
 *  url (the dashboard prettifies it). */
export interface ClickDestination extends Counted {
  /** Destination url — for the favicon and link in the dashboard table. */
  url?: string
  /** Search rows only: the clicked result's search type ('job', 'funder', …),
   *  from the most recent click that recorded one — so the dashboard can show
   *  the resource page the result belongs to. Absent on clicks from before
   *  the type was tracked (the dashboard falls back to matching the url
   *  against the live search index). */
  resultType?: string
}

export interface ChatbotPanelData {
  /** Opens bucketed by the page they happened on ('/funding', '/map', …).
   *  Older opens carry no explicit page, so it's recovered from the beacon's
   *  referer; opens where neither is known fall into 'Unknown'. */
  opensByPage: Counted[]
  /** "% of visitors" per page: distinct visitors who opened the chat there vs
   *  the page's distinct page-view visitors — keyed by the same paths
   *  opensByPage uses. */
  openShareByPage: VisitorShare[]
  /** The Total row's share: distinct visitors who opened the chat anywhere vs
   *  distinct visitors site-wide. */
  siteOpenShare: VisitorShare
  /** Listings and links visitors clicked inside chatbot replies, busiest
   *  first. */
  destinations: ClickDestination[]
}

export interface SearchPanelData {
  /** Unique users at each step of using site search. */
  funnel: {
    opened: number
    searched: number
    clicked: number
  }
  /** How search gets opened: the nav button, ⌘K, or the / key. */
  openMethods: Counted[]
  /** The pages visitors were on when they opened search (site page names). */
  opensByPage: Counted[]
  /** "% of visitors" per page: distinct visitors who opened search there vs
   *  the page's distinct page-view visitors — keyed by the same site page
   *  names opensByPage uses. */
  openShareByPage: VisitorShare[]
  /** The Total row's share: distinct visitors who opened search anywhere vs
   *  distinct visitors site-wide. */
  siteOpenShare: VisitorShare
  /** What people search for, busiest first (lowercased so casings group). */
  topQueries: Counted[]
  /** Searches that returned nothing — what visitors looked for and the site
   *  couldn't answer. A subset of topQueries. */
  noResultQueries: Counted[]
  /** The results visitors clicked out of search, busiest first. */
  destinations: ClickDestination[]
}

export interface MapSearchPanelData {
  /** Unique users at each step of using the map's search box. */
  funnel: {
    opened: number
    searched: number
    picked: number
  }
  /** Distinct visitors who opened the map search vs the Map page's distinct
   *  visitors. Null when the Map page isn't selected. */
  openShare: VisitorShare | null
  /** How the box gets opened: its button, or ⌘F over the map. */
  openMethods: Counted[]
  /** What people search the map for, busiest first (lowercased so casings
   *  group). */
  topQueries: Counted[]
  /** Map searches that matched nothing. A subset of topQueries. */
  noResultQueries: Counted[]
  /** The listings picked from the results, busiest first, each with the rank
   *  range it was picked at (1 = the top result). */
  picked: ListingRow[]
}

export interface VisitsData {
  /** Page views bucketed by page, busiest first — visitors or raw views,
   *  depending on the dashboard's count mode. */
  byPage: Counted[]
  /** Raw page views in range. */
  totalViews: number
  /** Distinct visitors among the page views in range. */
  uniqueVisitors: number
  /** Browsing sessions: one visitor's page views separated by 30+ minutes of
   *  inactivity count as separate visits (the definition Matomo uses too). */
  visitCount: number
  /** The range's visitors split by whether they've been here more than once.
   *  Returning = had a visit before this period (any event we hold for the
   *  browser predates the range) OR made two or more visits within it (sessions
   *  of any activity, 30+ minutes apart); new = one visit so far, their first.
   *  The two sum to `uniqueVisitors`; visitors with no id (private browsing)
   *  can't have a history, so they count as new. Over "All time" nothing
   *  predates the range, so returning is simply every visitor who came back at
   *  least once. */
  newVisitors: number
  returningVisitors: number
  /** Per page: the page's distinct visitors who are returning (by the
   *  site-wide definition above — they've visited the SITE before, not
   *  necessarily this page) against the page's distinct visitors. */
  returningShareByPage: VisitorShare[]
}

export interface CorrelationRow {
  /** The pair of interests, e.g. 'Map' and 'Events & training' — resource
   *  pages, plus 'Chatbot' for chatbot use. */
  a: string
  b: string
  /** Visitors who engaged with BOTH (visited the page, or clicked one of its
   *  listings — clicks reach back before page-view tracking began). */
  both: number
  /** Visitors who engaged with each side at all, the overlap denominators. */
  aTotal: number
  bTotal: number
}

/** One page's distinct visitors who did a thing (filtered, clicked a listing,
 *  …) against the page's distinct visitors — the "% of visitors" columns.
 *  Always per-visitor, whichever count mode is active (a share of visitors
 *  only makes sense that way). */
export interface VisitorShare {
  name: string
  /** Distinct visitors who did it on this page at least once in range. */
  active: number
  /** The page's distinct page-view visitors — the % denominator. 0 when the
   *  range predates page-view tracking (15 July 2026). */
  visitors: number
}

export interface DashboardData {
  /** Which backend served this data — surfaced in the UI so it's obvious in dev. */
  source: 'redis' | 'local-file' | 'none'
  /** True if the store couldn't be read (e.g. Redis outage); UI shows a notice. */
  error?: boolean
  /** Total events within the selected range. */
  totalEvents: number
  byPage: Counted[]
  /** Which resource page the per-listing panels below reflect. Null only when
   *  no page has any clicks in range. */
  selectedPage: string | null
  /** Top listings for `selectedPage`, with each one's slot range this period. */
  topListings: ListingRow[]
  /** `selectedPage`'s clicks bucketed by the slot they happened in, ordered F1,
   *  F2, 1, 2, 3… — answers "do higher slots draw more clicks" for that page. */
  byPosition: Counted[]
  /** Site-wide most-clicked listings, across every page (not scoped to
   *  `selectedPage`). Each row carries the page it came from. */
  topListingsOverall: OverallListingRow[]
  /** Every click across every page bucketed by the slot it happened in, ordered
   *  F1, F2, 1, 2, 3… — the site-wide version of `byPosition`. */
  byPositionOverall: Counted[]
  /** For pages in PAGE_SPLITS: the selected page's clicks split across the
   *  page's surfaces or views (Map vs Cards on map pages, Online vs In person
   *  on Events, Upcoming vs Recurring on Training). Empty for other pages.
   *  Always the full split, even when one source is selected, so the user can
   *  switch between them. */
  bySource: Counted[]
  /** The source the per-listing panels are filtered to (a slug of one of the
   *  page's split labels, or 'untracked'), or null for all sources. Only ever
   *  set on pages in PAGE_SPLITS. */
  selectedSource: string | null
  /** Filter activations per resource page — the Overview's "how much do
   *  filters get used where" table. */
  filtersByPage: Counted[]
  /** The selected page's filter activations per filter group ('Type',
   *  'Focus', …). */
  filterGroups: Counted[]
  /** The selected page's filter activations per 'Group: Value' pair, ranked —
   *  the "which options do people actually pick" table. */
  filterValues: Counted[]
  /** Distinct visitors who turned on at least one filter on the selected page
   *  in range. */
  filterUsers: number
  /** Per page with filter activity: distinct visitors who turned on at least
   *  one filter vs the page's distinct visitors. */
  filterShareByPage: VisitorShare[]
  /** Distinct visitors who clicked a listing on each page vs the page's
   *  distinct visitors — Clicks by page's "% of visitors" column. */
  clickShareByPage: VisitorShare[]
  /** Contribute-button clicks (Add / Suggest a correction / extra rows) per
   *  resource page — the Overview's rollup. */
  contributeByPage: Counted[]
  /** The selected page's contribute clicks per button label. */
  contributeButtons: Counted[]
  /** Distinct visitors who clicked a contribute button on each page vs the
   *  page's distinct visitors. */
  contributeShareByPage: VisitorShare[]
  /** "View data in Airtable" card clicks per resource page. */
  airtableByPage: Counted[]
  /** The selected page's "View data in Airtable" card clicks. */
  airtableViews: number
  /** Distinct visitors who clicked a "View data in Airtable" card on each
   *  page vs the page's distinct visitors. */
  airtableShareByPage: VisitorShare[]
  /** Map pages only: visitors reaching the listings below the map (cards_view
   *  — once per page load, when the cards section scrolls into the upper half
   *  of the screen) and clicks on the button on the map that scrolls there.
   *  The counts follow the unique/total mode; the shares divide distinct
   *  visitors who did it by the page's distinct visitors. 0/null elsewhere. */
  cardsViews: number
  cardsViewShare: VisitorShare | null
  cardsButtonClicks: number
  cardsButtonShare: VisitorShare | null
  /** Newsletter signup-box submits per page (the box lives on Events and
   *  Training). Submits, not confirmed Substack subscriptions. */
  newsletterByPage: Counted[]
  /** Distinct visitors who submitted the newsletter box on each page vs the
   *  page's distinct visitors. */
  newsletterShareByPage: VisitorShare[]
  /** The Overview by-page tables' Total rows: distinct visitors who clicked
   *  any listing / contribute button / Airtable card anywhere on the site vs
   *  distinct visitors site-wide — a visitor active on three pages counts
   *  once on both sides. */
  siteClickShare: VisitorShare | null
  siteContributeShare: VisitorShare | null
  siteAirtableShare: VisitorShare | null
  /** Same for the newsletter box, but divided by visitors to the pages that
   *  have it (Events and Training) rather than the whole site. */
  siteNewsletterShare: VisitorShare | null
  /** For `selectedPage`'s own tables: distinct visitors per listing / slot /
   *  filter group / filter value / contribute button / hovered listing,
   *  each against the page's distinct visitors. Keyed by the same row names
   *  the corresponding tables use. */
  listingShare: VisitorShare[]
  /** The Top listings footer's "% of visitors": distinct visitors who clicked
   *  ANY listing on `selectedPage` vs the page's distinct visitors. Not the
   *  sum of the `listingShare` rows — a visitor who clicked three listings
   *  counts once here. Narrowed by `selectedSource` like the rows above it.
   *  Null when no page is selected. */
  anyListingShare: VisitorShare | null
  positionShare: VisitorShare[]
  filterGroupShare: VisitorShare[]
  filterValueShare: VisitorShare[]
  /** The Filter usage/values footers' "% of visitors": distinct visitors who
   *  turned on ANY filter on `selectedPage` vs the page's distinct visitors.
   *  Not the sum of the `filterGroupShare` rows — a visitor who used three
   *  filters counts once here. Null when no page is selected. */
  anyFilterShare: VisitorShare | null
  /** Contribute buttons' footer: distinct visitors who clicked ANY contribute
   *  button on `selectedPage` vs the page's distinct visitors. */
  anyContributeShare: VisitorShare | null
  /** Top hovered listings' footer (map pages only): distinct visitors who
   *  hovered ANY listing on `selectedPage` vs the page's distinct visitors. */
  anyHoverShare: VisitorShare | null
  contributeButtonShare: VisitorShare[]
  hoverShare: VisitorShare[]
  /** Clicks on the footer's external links, one row per link ('Donate',
   *  'AI Safety Funding', …), sitewide. */
  footerClicks: Counted[]
  /** Opens of the global nav's +N menu, one row per method ('Hover' |
   *  'Tap'), sitewide. */
  navOverflowOpens: Counted[]
  /** Per method: distinct visitors who opened the +N menu that way vs
   *  distinct visitors site-wide — the nav is on every page, so the site is
   *  the denominator. Keyed by the row names `navOverflowOpens` uses. */
  navOverflowOpenShare: VisitorShare[]
  /** The +N table's Total row: distinct visitors who opened the menu at all
   *  vs distinct visitors site-wide. */
  anyNavOverflowOpenShare: VisitorShare
  /** For pages with a map (Map, Communities): `selectedPage`'s most-hovered
   *  map listings — tooltip dwells (500 ms cursor rest on desktop, first tap
   *  on mobile), grouped like `topListings` and following the same unique/
   *  total count mode. Never narrowed by `selectedSource` (every hover is by
   *  definition from the map). Empty for pages without a map. */
  topHovered: ListingRow[]
  /** The Map tab's by-area rollup input: the page's clicks per listing with
   *  the `selectedSource` filter ignored, so the rollup's click column shares
   *  a basis with `topHovered` (which is never source-narrowed). Same rows as
   *  `topListings` when no source is selected. Empty for every page but Map —
   *  only the Map page has areas. */
  areaClicks: ListingRow[]
  funnel: ChatbotFunnel
  /** The Chatbot tab's event-derived panels (opens and reply clicks). */
  chatbot: ChatbotPanelData
  /** The Search tab's event-derived panels (opens, queries, result clicks). */
  search: SearchPanelData
  /** The Map tab's search-box panels (opens, queries, picks). Empty on every
   *  other page — only the Field map has the box. */
  mapSearch: MapSearchPanelData
  /** The privacy page's analytics switch, one bucket per browser by its latest
   *  toggle in range: `off` = switched analytics off and hasn't switched it
   *  back, `on` = switched it back on. Changing your mind moves a browser
   *  between buckets rather than counting it in both. */
  optOuts: { off: number; on: number }
  /** First-party page views (recorded from 15 July 2026). */
  visits: VisitsData
  /** Cross-interest overlaps between pages (and the chatbot), from anonymous
   *  visitor ids: pairs ranked by how many visitors engaged with both. */
  correlations: CorrelationRow[]
  /** Recent clicks and chatbot/search events — page views, map hovers and
   *  cards-section views are excluded so the feed stays an activity log
   *  rather than a firehose. */
  recent: AnalyticsEvent[]
  /** Timestamp of the oldest event in the WHOLE store (not just the selected
   *  range) — lets the dashboard say how far back its data actually goes.
   *  Undefined when the store is empty or the oldest event can't be read. */
  oldestTs?: string
  /** False until backfillFirstSeen() has run against the Redis store: before
   *  that, visitors from before the feature deployed look new on their next
   *  visit. Always true for the dev file store, which derives first-seen
   *  from the whole file. */
  firstSeenBackfilled: boolean
  /** Months whose event count has reached MONTH_CAP_WARN_RATIO of the backstop
   *  cap — the dashboard shows a warning so the cap can be raised before it
   *  trims anything. Checked across the whole store, not just the selected
   *  range. Normally empty. */
  nearCap: { month: string; count: number; cap: number }[]
}

const EMPTY: Omit<DashboardData, 'source'> = {
  totalEvents: 0,
  byPage: [],
  selectedPage: null,
  topListings: [],
  byPosition: [],
  topListingsOverall: [],
  byPositionOverall: [],
  bySource: [],
  selectedSource: null,
  filtersByPage: [],
  filterGroups: [],
  filterValues: [],
  filterUsers: 0,
  filterShareByPage: [],
  clickShareByPage: [],
  contributeByPage: [],
  contributeButtons: [],
  contributeShareByPage: [],
  airtableByPage: [],
  airtableViews: 0,
  airtableShareByPage: [],
  cardsViews: 0,
  cardsViewShare: null,
  cardsButtonClicks: 0,
  cardsButtonShare: null,
  newsletterByPage: [],
  newsletterShareByPage: [],
  siteClickShare: null,
  siteContributeShare: null,
  siteAirtableShare: null,
  siteNewsletterShare: null,
  listingShare: [],
  anyListingShare: null,
  positionShare: [],
  filterGroupShare: [],
  filterValueShare: [],
  anyFilterShare: null,
  anyContributeShare: null,
  anyHoverShare: null,
  contributeButtonShare: [],
  hoverShare: [],
  footerClicks: [],
  navOverflowOpens: [],
  navOverflowOpenShare: [],
  anyNavOverflowOpenShare: { name: 'Any open', active: 0, visitors: 0 },
  topHovered: [],
  areaClicks: [],
  funnel: { opened: 0, typed: 0, clicked: 0 },
  chatbot: {
    opensByPage: [],
    openShareByPage: [],
    siteOpenShare: { name: 'Any page', active: 0, visitors: 0 },
    destinations: [],
  },
  search: {
    funnel: { opened: 0, searched: 0, clicked: 0 },
    openMethods: [],
    opensByPage: [],
    openShareByPage: [],
    siteOpenShare: { name: 'Any page', active: 0, visitors: 0 },
    topQueries: [],
    noResultQueries: [],
    destinations: [],
  },
  mapSearch: {
    funnel: { opened: 0, searched: 0, picked: 0 },
    openShare: null,
    openMethods: [],
    topQueries: [],
    noResultQueries: [],
    picked: [],
  },
  optOuts: { off: 0, on: 0 },
  visits: {
    byPage: [],
    totalViews: 0,
    uniqueVisitors: 0,
    visitCount: 0,
    newVisitors: 0,
    returningVisitors: 0,
    returningShareByPage: [],
  },
  firstSeenBackfilled: true,
  correlations: [],
  recent: [],
  nearCap: [],
}

/** Source filters offered on map pages. 'untracked' = neither map nor cards. */
/** Resource pages that have a map above their card list, so a click can come
 *  from either surface. Gates the hover panels (only maps emit hovers). */
const MAP_PAGES = new Set(['Map', 'Communities'])

/** Pages whose clicks are split across two surfaces or views, and the display
 *  labels of the split. A click's `source` carries the slug of the label it
 *  happened under (map pages tag the surface, Events/Training tag the active
 *  view toggle); untagged clicks — logged before the split was tracked — fall
 *  into an 'Untracked' bucket rather than being miscounted. */
const PAGE_SPLITS: Record<string, string[]> = {
  Map: ['Map', 'Cards'],
  Communities: ['Map', 'Cards'],
  Events: ['Online', 'In person'],
  Training: ['Upcoming', 'Recurring'],
}

/** 'In person' → 'in-person': how a split label appears in a click's `source`
 *  and in the dashboard's ?source query param. */
export function sourceSlug(label: string): string {
  return label.toLowerCase().replace(/ /g, '-')
}

/** What a listing click is counted under. Prefer the human label; fall back to
 *  id/url so nothing is silently dropped. */
function listingMember(e: AnalyticsEvent): string {
  return e.label || e.listingId || e.url || '(unknown)'
}

function tally(items: string[]): Counted[] {
  const m = new Map<string, number>()
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

/** Sort key putting the featured slots above the numbered list: F1, F2, 1, 2…
 *  Unparseable labels sort last so a stray value never crashes the ordering. */
function positionSortKey(p: string): number {
  if (p === 'F1') return -2
  if (p === 'F2') return -1
  const n = Number(p)
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

/** Compact "lowest–highest slot" label for a listing's recorded positions, e.g.
 *  ['3','5','4'] → '3–5', ['F1','F1'] → 'F1'. Undefined for an empty set. */
function positionRange(positions: string[]): string | undefined {
  if (positions.length === 0) return undefined
  const sorted = [...positions].sort(
    (a, b) => positionSortKey(a) - positionSortKey(b)
  )
  const lo = sorted[0]
  const hi = sorted[sorted.length - 1]
  return lo === hi ? lo : `${lo}–${hi}`
}

/** Like tally(), but ordered by slot (F1, F2, 1, 2…) rather than by count, so
 *  the by-position table reads as a ladder from top slot to bottom. */
function tallyPositions(positions: string[]): Counted[] {
  const m = new Map<string, number>()
  for (const p of positions) m.set(p, (m.get(p) ?? 0) + 1)
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => positionSortKey(a.name) - positionSortKey(b.name))
}

// ─── The dashboard's time zone ───────────────────────────────────────────────
// Day boundaries, "today" and displayed times all use one fixed reporting
// zone, the same for every viewer — the usual analytics convention (store
// UTC, report in one configured zone). UTC was chosen on 6 September 2026 so
// the definition of "a day" never depends on where the owner happens to be
// living. Change it here and nowhere else; the page says which zone it is.
export const DASHBOARD_TZ = 'UTC'

/** "2026-09-05" — the dashboard-zone calendar day an instant falls on. */
export function dashboardDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: DASHBOARD_TZ })
}

/** "+00:00" / "+01:00" — the dashboard zone's UTC offset on a given day, for
 *  turning a calendar date into an epoch bound (DST-aware should the zone
 *  ever be one that has it). */
export function dashboardOffset(day: string): string {
  const probe = new Date(`${day}T12:00:00Z`)
  const part = new Intl.DateTimeFormat('en-GB', {
    timeZone: DASHBOARD_TZ,
    timeZoneName: 'longOffset',
  })
    .formatToParts(probe)
    .find(p => p.type === 'timeZoneName')?.value
  const m = /GMT([+-]\d{2}:\d{2})/.exec(part ?? '')
  return m ? m[1] : '+00:00'
}

/** Collapse repeat events so a visitor counts once per listing per day: keep
 *  only the most recent event per (visitor, day, page, listing). Used for
 *  listing clicks, and by topHovered for map hovers — same key, same
 *  semantics, and the two types are always deduped separately. The day is the
 *  dashboard's (DASHBOARD_TZ, see dashboardDay), matching the date-range bounds.
 *  Clicks with no id
 *  (e.g. private browsing, where we can't tell visitors apart) are each kept.
 *  Expects a newest-first list, so the first time a key is seen is the most
 *  recent click. */
function uniqueClicks(clicks: AnalyticsEvent[]): AnalyticsEvent[] {
  const seen = new Set<string>()
  const out: AnalyticsEvent[] = []
  for (const e of clicks) {
    if (!e.vid) {
      out.push(e)
      continue
    }
    const t = Date.parse(e.ts)
    const day = Number.isNaN(t) ? '' : dashboardDay(t)
    const key = `${e.vid}\x00${day}\x00${e.page ?? ''}\x00${listingMember(e)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

/** Unique-mode dedupe for filter activations: one per visitor per group+value
 *  per dashboard-zone day. The group (`source`) is part of the key — the same value
 *  under two groups (e.g. 'Online') stays two activations. */
function uniqueFilterApplies(events: AnalyticsEvent[]): AnalyticsEvent[] {
  const seen = new Set<string>()
  const out: AnalyticsEvent[] = []
  for (const e of events) {
    if (!e.vid) {
      out.push(e)
      continue
    }
    const t = Date.parse(e.ts)
    const day = Number.isNaN(t) ? '' : dashboardDay(t)
    const key = `${e.vid}\x00${day}\x00${e.page ?? ''}\x00${e.source ?? ''}\x00${e.label ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

/** Group events into one row per listing, ranked by count: the range of slots
 *  it was hit at (from positions stamped at event time — hover events carry
 *  none, so their rows get no slot) plus a representative url/id/area. Expects
 *  a newest-first list, so the first url/id/area seen for a listing is the
 *  most recent — older events only fill fields still missing. */
function listingRows(events: AnalyticsEvent[]): ListingRow[] {
  const perListing = new Map<
    string,
    {
      count: number
      positions: string[]
      url?: string
      listingId?: string
      area?: string
    }
  >()
  for (const e of events) {
    const k = listingMember(e)
    const g = perListing.get(k) ?? {
      count: 0,
      positions: [],
      url: e.url,
      listingId: e.listingId,
      area: e.area,
    }
    g.count += 1
    if (e.position) g.positions.push(e.position)
    if (!g.url && e.url) g.url = e.url
    if (!g.listingId && e.listingId) g.listingId = e.listingId
    if (!g.area && e.area) g.area = e.area
    perListing.set(k, g)
  }
  return [...perListing.entries()]
    .map(([name, g]) => ({
      name,
      count: g.count,
      position: positionRange(g.positions),
      url: g.url,
      listingId: g.listingId,
      area: g.area,
    }))
    .sort((a, b) => b.count - a.count)
}

/** Aggregate a newest-first event list into the dashboard view, filtered to the
 *  given date range. `selectedPageReq` chooses which resource page the
 *  per-listing panels reflect; it falls back to Funding, then the busiest page.
 *  `unique` (default) counts each visitor once per listing per day; pass false
 *  to count every click. */
function aggregate(
  all: AnalyticsEvent[],
  { startMs, endMs }: DateRange,
  selectedPageReq?: string,
  unique = true,
  sourceReq?: string,
  /** Epoch ms each visitor was first seen (any event, whole store), for at
   *  least every visitor with a page view in range. What makes "returning"
   *  knowable without reading the months before the range. */
  firstSeen: Map<string, number> = new Map()
): Omit<
  DashboardData,
  'source' | 'error' | 'oldestTs' | 'nearCap' | 'firstSeenBackfilled'
> {
  const inRange = all.filter(e => {
    const t = Date.parse(e.ts)
    if (Number.isNaN(t)) return false
    if (startMs != null && t < startMs) return false
    if (endMs != null && t > endMs) return false
    return true
  })
  // Every click table below derives from this set. In unique mode it's deduped
  // to one click per visitor per listing per day, so repeat clicks don't inflate
  // the counts; in total mode every click is counted. Filtered by type, not by
  // "has a page": chatbot events also carry the page they happened on, and must
  // not count as listing clicks.
  const pageHits = inRange.filter(e => e.type === 'listing_click' && e.page)
  const clicks = unique ? uniqueClicks(pageHits) : pageHits
  const usersOf = (type: string) =>
    uniqueUsers(inRange.filter(e => e.type === type))

  const byPage = tally(clicks.map(e => e.page as string))
  const pageNames = byPage.map(p => p.name)
  // The page the listing panels drill into. An explicit request always wins —
  // even with no clicks in range — so selecting a quiet page's tab shows that
  // page (empty), not a fallback. With no request, default to Funding (Bryce's
  // main interest), then the busiest page.
  const selectedPage = selectedPageReq
    ? selectedPageReq
    : pageNames.includes('Funding')
      ? 'Funding'
      : (pageNames[0] ?? null)

  // On a page with a split (map surface, or the Events/Training view toggle)
  // the panels can be filtered to one click source. The split itself (bySource,
  // below) is always computed from every click on the page so the user can
  // switch sources; only the per-listing panels narrow.
  const split = selectedPage != null ? PAGE_SPLITS[selectedPage] : undefined
  const splitSlugs = split?.map(sourceSlug) ?? []
  const selectedSource =
    split && sourceReq && [...splitSlugs, 'untracked'].includes(sourceReq)
      ? sourceReq
      : null
  const matchesSource = (e: AnalyticsEvent): boolean => {
    if (selectedSource == null) return true // no filter
    if (selectedSource === 'untracked')
      return e.source == null || !splitSlugs.includes(e.source)
    return e.source === selectedSource
  }

  // For the selected page: total clicks per listing, the range of slots each was
  // clicked at (from positions stamped at click time, so it's period-accurate
  // even as the page is reordered), and a representative url for its favicon.
  // Every listing for the page, ranked by clicks — the dashboard shows the first
  // 50 and lets the user reveal more, so we return the full list rather than a
  // fixed top-N here.
  const pageClicksAll = clicks.filter(e => e.page === selectedPage)
  const pageClicks = pageClicksAll.filter(matchesSource)
  const topListings: ListingRow[] = listingRows(pageClicks)

  // Site-wide leaderboards, independent of the selected page: the most-clicked
  // listings and the busiest slots across every page. Keyed by page+listing so
  // the same name on two pages stays two rows (each keeps its own page pill).
  const perOverall = new Map<
    string,
    { name: string; page?: string; count: number; url?: string }
  >()
  for (const e of clicks) {
    const name = listingMember(e)
    const key = `${e.page ?? ''}\x00${name}`
    // clicks is newest-first, so the first url seen for a listing is the latest.
    const g = perOverall.get(key) ?? {
      name,
      page: e.page,
      count: 0,
      url: e.url,
    }
    g.count += 1
    if (!g.url && e.url) g.url = e.url
    perOverall.set(key, g)
  }
  const topListingsOverall: OverallListingRow[] = [...perOverall.values()]
    .map(g => ({ name: g.name, page: g.page, count: g.count, url: g.url }))
    .sort((a, b) => b.count - a.count)
  const byPositionOverall = tallyPositions(
    clicks.map(e => e.position).filter((p): p is string => p != null)
  )

  // Source split, only for pages in PAGE_SPLITS. Clicks are explicitly tagged
  // at click time; anything untagged (logged before source tracking, or a
  // surface we don't tag) is its own 'Untracked' bucket rather than being
  // miscounted. Honours the unique/total mode (same pageClicks). Only
  // non-empty buckets are shown.
  let bySource: Counted[] = []
  if (split) {
    const counts = new Map<string, number>(split.map(label => [label, 0]))
    let untracked = 0
    for (const e of pageClicksAll) {
      const label = split.find(l => sourceSlug(l) === e.source)
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
      else untracked += 1
    }
    bySource = [
      ...split.map(label => ({ name: label, count: counts.get(label) ?? 0 })),
      { name: 'Untracked', count: untracked },
    ].filter(r => r.count > 0)
  }

  // Filter usage. One filter_apply per value a visitor turns on; unique mode
  // counts each group+value once per visitor per day, total mode every toggle.
  const filterHits = inRange.filter(e => e.type === 'filter_apply' && e.page)
  const filterApplies = unique ? uniqueFilterApplies(filterHits) : filterHits
  const filtersByPage = tally(filterApplies.map(e => e.page as string))
  const pageFilters = filterApplies.filter(e => e.page === selectedPage)
  // Renamed filter titles and options are logged under their original names;
  // show the current wording so old and new clicks land in one row.
  const filterGroupName = (e: AnalyticsEvent) =>
    displayFilterGroup(e.page ?? '', e.source ?? '(unknown)')
  const filterValueName = (e: AnalyticsEvent) => {
    const group = e.source ?? '(unknown)'
    const label = e.label ?? '(unknown)'
    const page = e.page ?? ''
    return `${displayFilterGroup(page, group)}: ${displayFilterValue(page, group, label)}`
  }
  const filterGroups = tally(pageFilters.map(filterGroupName))
  const filterValues = tally(pageFilters.map(filterValueName))
  const filterUsers = uniqueUsers(
    filterHits.filter(e => e.page === selectedPage)
  )

  // The "% of visitors" columns: distinct doing-vids per page (filtering,
  // clicking a listing, …) against distinct page_view vids per page.
  // Deliberately ignores the unique/total mode — a share of visitors is only
  // meaningful per-visitor. Events without a visitor id (private browsing)
  // can't contribute.
  const viewVidsByPage = pageViewVids(inRange, p => PAGE_NAME_BY_PATH[p] ?? p)
  const shareByPage = (hits: AnalyticsEvent[]): VisitorShare[] => {
    const vidsByPage = new Map<string, Set<string>>()
    for (const e of hits) {
      if (!e.vid || !e.page) continue
      const set = vidsByPage.get(e.page) ?? new Set<string>()
      set.add(e.vid)
      vidsByPage.set(e.page, set)
    }
    return [...vidsByPage.entries()]
      .map(([name, vids]) => ({
        name,
        active: vids.size,
        visitors: viewVidsByPage.get(name)?.size ?? 0,
      }))
      .sort((a, b) => b.active - a.active)
  }
  const filterShareByPage = shareByPage(filterHits)
  const clickShareByPage = shareByPage(pageHits)

  // The selected page's own tables all share one "% of visitors" denominator:
  // that page's distinct page-view visitors. Rows are keyed exactly like the
  // tables they join (listing label, slot, 'Group: Value', button label).
  const pageVisitorCount =
    selectedPage != null ? (viewVidsByPage.get(selectedPage)?.size ?? 0) : 0
  const shareOnPage = (
    hits: AnalyticsEvent[],
    keyOf: (e: AnalyticsEvent) => string
  ): VisitorShare[] => {
    const vidsByKey = new Map<string, Set<string>>()
    for (const e of hits) {
      if (!e.vid) continue
      const key = keyOf(e)
      const set = vidsByKey.get(key) ?? new Set<string>()
      set.add(e.vid)
      vidsByKey.set(key, set)
    }
    return [...vidsByKey.entries()].map(([name, vids]) => ({
      name,
      active: vids.size,
      visitors: pageVisitorCount,
    }))
  }
  const listingShare = shareOnPage(pageClicks, listingMember)
  // The Total rows' "any at all" shares: one Set across every qualifying
  // event, so a visitor who did several still counts once — deliberately NOT
  // the sum of the per-row shares.
  const distinctVids = (hits: AnalyticsEvent[]): number => {
    const vids = new Set<string>()
    for (const e of hits) if (e.vid) vids.add(e.vid)
    return vids.size
  }
  const anyOnPage = (
    hits: AnalyticsEvent[],
    name: string
  ): VisitorShare | null =>
    selectedPage != null
      ? { name, active: distinctVids(hits), visitors: pageVisitorCount }
      : null
  const anyListingShare = anyOnPage(pageClicks, 'Any listing')
  const positionShare = shareOnPage(
    pageClicks.filter(e => e.position),
    e => e.position as string
  )
  const filterGroupShare = shareOnPage(pageFilters, filterGroupName)
  const filterValueShare = shareOnPage(pageFilters, filterValueName)
  const anyFilterShare = anyOnPage(pageFilters, 'Any filter')

  // Contribute-button and Airtable-card clicks. uniqueClicks dedupes on
  // page+label, which is exactly the button identity here.
  const contributeHits = inRange.filter(
    e => e.type === 'contribute_click' && e.page
  )
  const contributeClicks = unique
    ? uniqueClicks(contributeHits)
    : contributeHits
  const contributeByPage = tally(contributeClicks.map(e => e.page as string))
  const contributeShareByPage = shareByPage(contributeHits)
  const contributeButtons = tally(
    contributeClicks
      .filter(e => e.page === selectedPage)
      .map(e => listingMember(e))
  )
  const pageContributeHits = contributeHits.filter(e => e.page === selectedPage)
  const contributeButtonShare = shareOnPage(pageContributeHits, listingMember)
  const anyContributeShare = anyOnPage(pageContributeHits, 'Any button')
  const airtableHits = inRange.filter(e => e.type === 'airtable_view' && e.page)
  const airtableClicks = unique ? uniqueClicks(airtableHits) : airtableHits
  const airtableByPage = tally(airtableClicks.map(e => e.page as string))
  const airtableShareByPage = shareByPage(airtableHits)
  const airtableViews = airtableClicks.filter(
    e => e.page === selectedPage
  ).length
  const newsletterHits = inRange.filter(
    e => e.type === 'newsletter_signup' && e.page
  )
  const newsletterSubmits = unique
    ? uniqueClicks(newsletterHits)
    : newsletterHits
  const newsletterByPage = tally(newsletterSubmits.map(e => e.page as string))
  const newsletterShareByPage = shareByPage(newsletterHits)

  // The Overview by-page tables' Total rows: distinct visitors who did the
  // thing anywhere on the site vs distinct visitors site-wide — both sides
  // count a visitor once however many pages they touched.
  const siteVisitors = new Set<string>()
  for (const vids of viewVidsByPage.values())
    for (const v of vids) siteVisitors.add(v)
  const anyOnSite = (hits: AnalyticsEvent[], name: string): VisitorShare => ({
    name,
    active: distinctVids(hits),
    visitors: siteVisitors.size,
  })
  const siteClickShare = anyOnSite(pageHits, 'Any listing')
  const siteContributeShare = anyOnSite(contributeHits, 'Any button')
  const siteAirtableShare = anyOnSite(airtableHits, 'Any card')
  // The newsletter box only renders on Events and Training, so its Total row
  // divides by those pages' visitors — a site-wide denominator would count
  // visitors who never saw the box.
  const newsletterVisitors = new Set<string>()
  for (const p of ['Events', 'Training'])
    for (const v of viewVidsByPage.get(p) ?? []) newsletterVisitors.add(v)
  const siteNewsletterShare: VisitorShare = {
    name: 'Any submit',
    active: distinctVids(newsletterHits),
    visitors: newsletterVisitors.size,
  }
  const footerHits = inRange.filter(e => e.type === 'footer_click')
  const footerEvents = unique ? uniqueClicks(footerHits) : footerHits
  const footerClicks = tally(footerEvents.map(e => listingMember(e)))
  // The global nav's +N menu: opens by method, sitewide, following the count
  // mode (unique = one per visitor per method). Shares divide by all site
  // visitors, since the nav is on every page.
  const navOpens = inRange.filter(e => e.type === 'nav_overflow_open')
  const navOpenMethod = (e: AnalyticsEvent) =>
    NAV_OVERFLOW_OPEN_LABEL[e.source ?? ''] ?? 'Unknown'
  const navOverflowOpens = tallyBy(navOpens, navOpenMethod, unique)
  const navOverflowOpenShare = navOverflowOpens.map(row =>
    anyOnSite(
      navOpens.filter(e => navOpenMethod(e) === row.name),
      row.name
    )
  )
  const anyNavOverflowOpenShare = anyOnSite(navOpens, 'Any open')

  // Most-hovered map listings for the selected page — tooltip dwells
  // (listing_hover events), grouped exactly like topListings but with no
  // position (hovers aren't slotted) and no source narrowing (every hover is
  // by definition from the map, so the ?source filter would be a no-op at
  // best and confusing at worst). Follows the unique/total count mode via the
  // same per-visitor-per-day dedupe as clicks. Map pages only — no other page
  // emits hover events.
  let topHovered: ListingRow[] = []
  let hoverShare: VisitorShare[] = []
  let anyHoverShare: VisitorShare | null = null
  // The cards section below the map: visitors reaching it, and the button
  // that scrolls there. Both events carry a fixed label, so uniqueClicks'
  // page+label dedupe makes unique mode one per visitor per day.
  let cardsViews = 0
  let cardsViewShare: VisitorShare | null = null
  let cardsButtonClicks = 0
  let cardsButtonShare: VisitorShare | null = null
  if (selectedPage != null && MAP_PAGES.has(selectedPage)) {
    const hoverHits = inRange.filter(e => e.type === 'listing_hover' && e.page)
    const hovers = (unique ? uniqueClicks(hoverHits) : hoverHits).filter(
      e => e.page === selectedPage
    )
    topHovered = listingRows(hovers)
    hoverShare = shareOnPage(hovers, listingMember)
    anyHoverShare = anyOnPage(hovers, 'Any listing')

    const cardsViewHits = inRange.filter(
      e => e.type === 'cards_view' && e.page === selectedPage
    )
    cardsViews = (unique ? uniqueClicks(cardsViewHits) : cardsViewHits).length
    cardsViewShare = anyOnPage(cardsViewHits, 'Cards section')
    const cardsButtonHits = inRange.filter(
      e => e.type === 'cards_button_click' && e.page === selectedPage
    )
    cardsButtonClicks = (
      unique ? uniqueClicks(cardsButtonHits) : cardsButtonHits
    ).length
    cardsButtonShare = anyOnPage(cardsButtonHits, 'Cards button')
  }

  // The Map tab's by-area rollup compares clicks against hovers per area, and
  // topHovered is never source-narrowed — so its click side must ignore the
  // ?source filter too, or the two columns quietly stop sharing a basis the
  // moment a source is selected. Same rows as topListings when no source is
  // selected; empty on every other page (only the Map page has areas).
  const areaClicks: ListingRow[] =
    selectedPage === 'Map'
      ? selectedSource
        ? listingRows(pageClicksAll)
        : topListings
      : []

  // The Map tab's search-box panels. Map page only — no other page has the
  // box. Never source-narrowed: a pick is by definition from the search.
  const mapSearch: MapSearchPanelData =
    selectedPage === 'Map'
      ? mapSearchPanels(inRange, unique, anyOnPage)
      : EMPTY.mapSearch

  return {
    totalEvents: inRange.length,
    byPage,
    selectedPage,
    topListings,
    byPosition: tallyPositions(
      pageClicks.map(e => e.position).filter((p): p is string => p != null)
    ),
    topListingsOverall,
    byPositionOverall,
    bySource,
    selectedSource,
    filtersByPage,
    filterGroups,
    filterValues,
    filterUsers,
    filterShareByPage,
    clickShareByPage,
    contributeByPage,
    contributeButtons,
    contributeShareByPage,
    airtableByPage,
    airtableViews,
    airtableShareByPage,
    cardsViews,
    cardsViewShare,
    cardsButtonClicks,
    cardsButtonShare,
    newsletterByPage,
    newsletterShareByPage,
    siteClickShare,
    siteContributeShare,
    siteAirtableShare,
    siteNewsletterShare,
    listingShare,
    anyListingShare,
    positionShare,
    filterGroupShare,
    filterValueShare,
    anyFilterShare,
    anyContributeShare,
    anyHoverShare,
    contributeButtonShare,
    hoverShare,
    footerClicks,
    navOverflowOpens,
    navOverflowOpenShare,
    anyNavOverflowOpenShare,
    topHovered,
    areaClicks,
    funnel: {
      opened: usersOf('chatbot_open'),
      typed: usersOf('chatbot_message'),
      clicked: usersOf('chatbot_click'),
    },
    chatbot: chatbotPanels(inRange, unique),
    search: searchPanels(inRange, unique),
    mapSearch,
    optOuts: optOutSplit(inRange),
    visits: visitsData(inRange, unique, firstSeen, startMs, viewVidsByPage),
    correlations: correlations(inRange),
    // Newest-first already; page views, map hovers and cards-section views
    // are left out so the feed stays a log of deliberate actions rather than
    // a firehose of visits, passing cursors and scrolls.
    recent: inRange
      .filter(
        e =>
          e.type !== 'page_view' &&
          e.type !== 'listing_hover' &&
          e.type !== 'cards_view'
      )
      .slice(0, 50),
  }
}

/** Page paths as their resource-page analytics names, so page views line up
 *  with the names listing clicks already use ('/funding' and 'Funding' are the
 *  same interest). Unknown paths pass through as-is. */
export const PAGE_NAME_BY_PATH: Record<string, string> = {
  '/': 'Home',
  '/map': 'Map',
  '/communities': 'Communities',
  '/self-study': 'Self-study',
  '/jobs': 'Jobs',
  '/funding': 'Funding',
  '/media-channels': 'Media channels',
  '/advisors': 'Advisors',
  '/projects': 'Projects',
  '/founders': 'Founders',
  '/events-and-training': 'Events & training',
  // The split successors of /events-and-training — mapped ahead of launch so
  // their views are named from the first day they exist.
  '/events': 'Events',
  '/training': 'Training',
  '/donation-guide': 'Donation guide',
  '/about': 'About',
  '/poster-map': 'Poster map',
}

/** The visits panel: page views bucketed by page. */
function visitsData(
  inRange: AnalyticsEvent[],
  unique: boolean,
  firstSeen: Map<string, number>,
  startMs: number | null,
  viewVidsByPage: Map<string, Set<string>>
): VisitsData {
  const views = inRange.filter(e => e.type === 'page_view')
  const { byVid, anon } = visitsByVisitor(views)

  // Returning = visited before this period, or came back within it. "Before"
  // is the first-seen record predating the range start; with no start (All
  // time) nothing can predate it, and only within-range returns count. A
  // visitor with no first-seen record was never written to the store before
  // their first event in range (or the backfill hasn't run), so they're new.
  // Within-range visits are sessions of ANY activity, not just page views, so
  // a visit from before page-view tracking (a June 2026 listing click) still
  // counts as a visit over ranges that include it — consistent with "before",
  // which any event type satisfies.
  const sessions = visitsByVisitor(inRange).byVid
  const returning = new Set<string>()
  for (const vid of byVid.keys()) {
    const seen = firstSeen.get(vid)
    const before = startMs != null && seen != null && seen < startMs
    if (before || (sessions.get(vid) ?? 1) >= 2) returning.add(vid)
  }
  const returningShareByPage: VisitorShare[] = [...viewVidsByPage.entries()]
    .map(([name, vids]) => ({
      name,
      active: [...vids].filter(v => returning.has(v)).length,
      visitors: vids.size,
    }))
    .sort((a, b) => b.visitors - a.visitors)

  let visitCount = anon
  for (const visits of byVid.values()) visitCount += visits
  return {
    byPage: tallyBy(
      views,
      e => (e.page ? (PAGE_NAME_BY_PATH[e.page] ?? e.page) : 'Unknown'),
      unique
    ),
    totalViews: views.length,
    uniqueVisitors: uniqueUsers(views),
    visitCount,
    newVisitors: byVid.size - returning.size + anon,
    returningVisitors: returning.size,
    returningShareByPage,
  }
}

/** A returning visitor starts a new visit after this much inactivity. */
const SESSION_GAP_MS = 30 * 60_000

/** Browsing sessions among the given events, per visitor: each visitor's
 *  events are grouped, and a gap of SESSION_GAP_MS or more starts a new visit.
 *  Events with no visitor id (private browsing) can't be grouped, so each
 *  counts as its own visit (`anon`) — same spirit as uniqueUsers. Fed page
 *  views for the Visits tile, and every event type for the new/returning
 *  split. */
function visitsByVisitor(views: AnalyticsEvent[]): {
  byVid: Map<string, number>
  anon: number
} {
  const timesByVid = new Map<string, number[]>()
  let anon = 0
  for (const e of views) {
    if (!e.vid) {
      anon++
      continue
    }
    const t = Date.parse(e.ts)
    if (Number.isNaN(t)) continue
    const times = timesByVid.get(e.vid) ?? []
    times.push(t)
    timesByVid.set(e.vid, times)
  }
  const byVid = new Map<string, number>()
  for (const [vid, times] of timesByVid) {
    times.sort((a, b) => a - b)
    let visits = 1
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] >= SESSION_GAP_MS) visits++
    }
    byVid.set(vid, visits)
  }
  return { byVid, anon }
}

/** The interest an event expresses, for the correlations table: the page it
 *  belongs to (viewed, or clicked a listing on), with 'Chatbot' and 'Search'
 *  as interests of their own. Home isn't an interest — nearly everyone passes
 *  through it, so its pairs say nothing. Listing clicks reach back to 20 June
 *  2026, so pairs have history even though page views only started on 15 July
 *  2026. */
function interestOf(e: AnalyticsEvent): string | undefined {
  if (e.type === 'page_view')
    return e.page && e.page !== '/'
      ? (PAGE_NAME_BY_PATH[e.page] ?? e.page)
      : undefined
  if (e.type === 'listing_click') return e.page
  if (e.type.startsWith('chatbot')) return 'Chatbot'
  if (e.type.startsWith('search')) return 'Search'
  // Using the map's search box is engaging with the map.
  if (e.type.startsWith('map_search')) return 'Map'
  return undefined
}

/** Cross-interest overlaps: for every pair of interests, how many visitors
 *  engaged with both. Needs the anonymous visitor id, so events without one
 *  (private browsing) can't contribute. Pairs seen only once are noise and
 *  dropped. */
function correlations(inRange: AnalyticsEvent[]): CorrelationRow[] {
  const byVid = new Map<string, Set<string>>()
  for (const e of inRange) {
    if (!e.vid) continue
    const interest = interestOf(e)
    if (!interest) continue
    const set = byVid.get(e.vid) ?? new Set<string>()
    set.add(interest)
    byVid.set(e.vid, set)
  }

  const totals = new Map<string, number>()
  const pairs = new Map<string, number>()
  for (const set of byVid.values()) {
    const interests = [...set].sort()
    for (const i of interests) totals.set(i, (totals.get(i) ?? 0) + 1)
    for (let x = 0; x < interests.length; x++) {
      for (let y = x + 1; y < interests.length; y++) {
        const key = `${interests[x]}\n${interests[y]}`
        pairs.set(key, (pairs.get(key) ?? 0) + 1)
      }
    }
  }

  return [...pairs.entries()]
    .filter(([, both]) => both >= 2)
    .map(([key, both]) => {
      const [a, b] = key.split('\n')
      return {
        a,
        b,
        both,
        aTotal: totals.get(a) ?? 0,
        bTotal: totals.get(b) ?? 0,
      }
    })
    .sort((p, q) => q.both - p.both)
    .slice(0, 100)
}

/** The page a chatbot event happened on: the explicitly stamped page when the
 *  event carries one (from 15 July 2026), else the path of the beacon's referer
 *  (which every earlier open still has). */
function chatbotPage(e: AnalyticsEvent): string | undefined {
  if (e.page) return e.page
  if (!e.ref) return undefined
  try {
    return new URL(e.ref).pathname || '/'
  } catch {
    return undefined
  }
}

/** Bucket events by a key, counting either distinct users per bucket (matching
 *  the funnel's unique-user semantics; events with no visitor id each count
 *  once) or raw events. */
function tallyBy(
  events: AnalyticsEvent[],
  keyOf: (e: AnalyticsEvent) => string,
  unique: boolean
): Counted[] {
  if (!unique) return tally(events.map(keyOf))
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  for (const e of events) {
    const key = keyOf(e)
    if (e.vid) {
      const dedupe = `${key}\n${e.vid}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
    }
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

/** Clicked-out destinations bucketed by url, busiest first; the most recent
 *  click's label (event lists are newest-first) names the row when one was
 *  recorded. In unique mode each visitor counts once per destination.
 *  `sourceIsType` is set by the search panels, whose clicks carry the result's
 *  type in `source` — the first (newest) one seen becomes the row's
 *  resultType. Chatbot clicks use `source` for something else ('card'/'link'),
 *  so they leave it off. */
function destinationRows(
  clicks: AnalyticsEvent[],
  unique: boolean,
  sourceIsType = false
): ClickDestination[] {
  const byUrl = new Map<string, ClickDestination>()
  const seen = new Set<string>()
  for (const e of clicks) {
    const url = e.url ?? e.label ?? '(unknown)'
    if (unique && e.vid) {
      const dedupe = `${url}\n${e.vid}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
    }
    const g = byUrl.get(url) ?? { name: e.label ?? url, url: e.url, count: 0 }
    if (sourceIsType && !g.resultType && e.source) g.resultType = e.source
    g.count += 1
    byUrl.set(url, g)
  }
  return [...byUrl.values()].sort((a, b) => b.count - a.count)
}

/** Distinct page_view visitor ids per page, under the given key — the
 *  Overview tables' resource-page names, or the chatbot table's raw paths.
 *  The "% of visitors" denominators. */
function pageViewVids(
  inRange: AnalyticsEvent[],
  keyOf: (page: string) => string
): Map<string, Set<string>> {
  const byPage = new Map<string, Set<string>>()
  for (const e of inRange) {
    if (e.type !== 'page_view' || !e.page || !e.vid) continue
    const key = keyOf(e.page)
    const set = byPage.get(key) ?? new Set<string>()
    set.add(e.vid)
    byPage.set(key, set)
  }
  return byPage
}

/** "% of visitors" rows for a per-page table: distinct doing-vids per bucket
 *  against the page's distinct page-view visitors. `keyOf` must bucket
 *  exactly like the table the rows join; buckets with no matching page_view
 *  entry (e.g. 'Unknown') get 0 visitors, which renders as a dash. */
function shareRowsByPage(
  hits: AnalyticsEvent[],
  keyOf: (e: AnalyticsEvent) => string,
  views: Map<string, Set<string>>
): VisitorShare[] {
  const vidsByKey = new Map<string, Set<string>>()
  for (const e of hits) {
    if (!e.vid) continue
    const key = keyOf(e)
    const set = vidsByKey.get(key) ?? new Set<string>()
    set.add(e.vid)
    vidsByKey.set(key, set)
  }
  return [...vidsByKey.entries()]
    .map(([name, vids]) => ({
      name,
      active: vids.size,
      visitors: views.get(name)?.size ?? 0,
    }))
    .sort((a, b) => b.active - a.active)
}

/** The Total row's "% of visitors": distinct visitors who did the thing on
 *  any page vs distinct page-view visitors site-wide — both sides count a
 *  visitor once however many pages they touched. */
function siteShare(
  hits: AnalyticsEvent[],
  views: Map<string, Set<string>>
): VisitorShare {
  const active = new Set<string>()
  for (const e of hits) if (e.vid) active.add(e.vid)
  const site = new Set<string>()
  for (const vids of views.values()) for (const v of vids) site.add(v)
  return { name: 'Any page', active: active.size, visitors: site.size }
}

/** The Chatbot tab's event-derived panels. `unique` mirrors the dashboard's
 *  count mode: unique users per bucket, or every event. */
function chatbotPanels(
  inRange: AnalyticsEvent[],
  unique: boolean
): ChatbotPanelData {
  const opens = inRange.filter(e => e.type === 'chatbot_open')
  const clicks = inRange.filter(e => e.type === 'chatbot_click')
  // opensByPage buckets by raw path, so the view denominators must too.
  const views = pageViewVids(inRange, p => p)
  return {
    opensByPage: tallyBy(opens, e => chatbotPage(e) ?? 'Unknown', unique),
    openShareByPage: shareRowsByPage(
      opens,
      e => chatbotPage(e) ?? 'Unknown',
      views
    ),
    siteOpenShare: siteShare(opens, views),
    destinations: destinationRows(clicks, unique),
  }
}

/** Dashboard labels for how the search modal was opened (search_open.source). */
const SEARCH_OPEN_LABEL: Record<string, string> = {
  button: 'Search button',
  'cmd-k': '⌘K shortcut',
  slash: '/ shortcut',
}

/** The Search tab's panels. The funnel always counts unique users; the other
 *  panels follow the dashboard's count mode via `unique`, like the chatbot's.
 *  Queries are grouped lowercased so casings don't split a search across rows.
 *  A search_query without text (not something the site's own beacons send) is
 *  ignored rather than counted as an empty search. */
function searchPanels(
  inRange: AnalyticsEvent[],
  unique: boolean
): SearchPanelData {
  const opens = inRange.filter(e => e.type === 'search_open')
  const queries = inRange.filter(e => e.type === 'search_query' && e.query)
  const clicks = inRange.filter(e => e.type === 'search_click')
  // opensByPage buckets by site page name, so the view denominators must too.
  const views = pageViewVids(inRange, p => PAGE_NAME_BY_PATH[p] ?? p)
  const openPage = (e: AnalyticsEvent) =>
    e.page ? (PAGE_NAME_BY_PATH[e.page] ?? e.page) : 'Unknown'
  return {
    funnel: {
      opened: uniqueUsers(opens),
      searched: uniqueUsers(queries),
      clicked: uniqueUsers(clicks),
    },
    openMethods: tallyBy(
      opens,
      e => SEARCH_OPEN_LABEL[e.source ?? ''] ?? 'Unknown',
      unique
    ),
    opensByPage: tallyBy(opens, openPage, unique),
    openShareByPage: shareRowsByPage(opens, openPage, views),
    siteOpenShare: siteShare(opens, views),
    topQueries: tallyBy(queries, e => e.query!.toLowerCase(), unique),
    noResultQueries: tallyBy(
      queries.filter(e => e.results === 0),
      e => e.query!.toLowerCase(),
      unique
    ),
    destinations: destinationRows(clicks, unique, true),
  }
}

const MAP_SEARCH_OPEN_LABEL: Record<string, string> = {
  button: 'Search button',
  'cmd-f': '⌘F shortcut',
}

/** The Map tab's search-box panels. The funnel always counts unique users;
 *  the tables follow `unique` — picks are deduped like clicks (one per
 *  visitor per listing per day), the rest one per visitor per bucket.
 *  `anyOnPage` is aggregate's "% of the page's visitors" helper, already
 *  bound to the selected page. */
function mapSearchPanels(
  inRange: AnalyticsEvent[],
  unique: boolean,
  anyOnPage: (hits: AnalyticsEvent[], name: string) => VisitorShare | null
): MapSearchPanelData {
  const opens = inRange.filter(e => e.type === 'map_search_open')
  const queries = inRange.filter(e => e.type === 'map_search_query' && e.query)
  const pickHits = inRange.filter(e => e.type === 'map_search_pick')
  const picks = unique ? uniqueClicks(pickHits) : pickHits
  return {
    funnel: {
      opened: uniqueUsers(opens),
      searched: uniqueUsers(queries),
      picked: uniqueUsers(pickHits),
    },
    openShare: anyOnPage(opens, 'Map search'),
    openMethods: tallyBy(
      opens,
      e => MAP_SEARCH_OPEN_LABEL[e.source ?? ''] ?? 'Unknown',
      unique
    ),
    topQueries: tallyBy(queries, e => e.query!.toLowerCase(), unique),
    noResultQueries: tallyBy(
      queries.filter(e => e.results === 0),
      e => e.query!.toLowerCase(),
      unique
    ),
    picked: listingRows(picks),
  }
}

/** The privacy switch's toggle events bucketed by each browser's latest state:
 *  `off` = the latest toggle turned analytics off, `on` = the latest toggle
 *  turned it back on. Decided per vid by timestamp (ISO strings compare
 *  chronologically), so flip-flopping counts the browser once, under where it
 *  ended up. Vid-less events can't be paired with a later change of mind, so
 *  each counts once under the state it reported. */
function optOutSplit(events: AnalyticsEvent[]): { off: number; on: number } {
  const latestByVid = new Map<string, AnalyticsEvent>()
  let off = 0
  let on = 0
  for (const e of events) {
    if (e.type !== 'analytics_optout' && e.type !== 'analytics_optin') continue
    if (!e.vid) {
      if (e.type === 'analytics_optout') off++
      else on++
      continue
    }
    const prev = latestByVid.get(e.vid)
    if (!prev || e.ts > prev.ts) latestByVid.set(e.vid, e)
  }
  for (const e of latestByVid.values()) {
    if (e.type === 'analytics_optout') off++
    else on++
  }
  return { off, on }
}

/** Distinct users in a set of events: distinct vids, plus each vid-less event
 *  counted once (can't dedup what we can't identify). */
function uniqueUsers(events: AnalyticsEvent[]): number {
  const seen = new Set<string>()
  let anon = 0
  for (const e of events) {
    if (e.vid) seen.add(e.vid)
    else anon++
  }
  return seen.size + anon
}

/** Every event in the given months, globally newest-first. Each month list is
 *  read in READ_CHUNK slices addressed FROM THE TAIL: normal writes only ever
 *  prepend at the head, so tail-relative indices stay stable and a read can't
 *  double-count or skip events mid-way. Events arriving after the length
 *  snapshot simply aren't part of this read — the next refresh has them. (The
 *  one exception to head-only writes is the backstop trim on a month over
 *  MONTH_CAP, which eats the tail; a trim landing mid-read can shift a few
 *  seam events between slices. That's transient, per-read, abuse-only noise —
 *  the stored data stays correct.)
 *
 *  Each slice is awaited as its OWN request, deliberately not pipelined: the
 *  client sends a pipeline as a single HTTP call, whose one response would
 *  carry every slice at once — recreating exactly the oversized response the
 *  slicing exists to prevent. Sequential round trips are fine here: at organic
 *  volume a dashboard range is a handful of slices. */
async function readMonths(
  db: Redis,
  monthsNewestFirst: { month: string; len: number }[]
): Promise<AnalyticsEvent[]> {
  // Newest-first overall: months newest → oldest, and within a month the head
  // (newest) slice first. In tail-relative terms the head slice is the DEEPEST
  // tail offset, so iterate offsets downward.
  const out: AnalyticsEvent[] = []
  for (const { month, len } of monthsNewestFirst) {
    const key = MONTH_KEY_PREFIX + month
    const sliceCount = Math.ceil(len / READ_CHUNK)
    for (let s = sliceCount - 1; s >= 0; s--) {
      const fromTail = s * READ_CHUNK // events between this offset and the tail
      out.push(
        ...(await db.lrange<AnalyticsEvent>(
          key,
          Math.max(-len, -(fromTail + READ_CHUNK)),
          -(fromTail + 1)
        ))
      )
    }
  }
  return out
}

/** The months at or past the warn share of the backstop cap, given every
 *  stored month's event count. Shared by both backends so the dashboard's
 *  early warning behaves identically in dev and prod. */
function nearCapMonths(
  counts: { month: string; count: number }[]
): DashboardData['nearCap'] {
  return counts
    .filter(c => c.count >= MONTH_CAP * MONTH_CAP_WARN_RATIO)
    .map(c => ({ ...c, cap: MONTH_CAP }))
}

/** Every stored month with its event count, oldest first. The lengths come as
 *  one pipeline of integers — cheap, so callers can afford them for the whole
 *  store (the near-cap warning and the backfill both need every month). */
async function storedMonths(
  db: Redis
): Promise<{ month: string; len: number }[]> {
  const months = (await db.zrange(MONTHS_KEY, 0, -1)) as string[]
  if (months.length === 0) return []
  const lenPipe = db.pipeline()
  for (const m of months) lenPipe.llen(MONTH_KEY_PREFIX + m)
  const lens = (await lenPipe.exec()) as number[]
  return months.map((month, i) => ({ month, len: lens[i] }))
}

/** Distinct visitor ids among the page views in range — the visitors whose
 *  first-seen timestamps the dashboard needs to split new from returning. */
function viewVidsInRange(
  all: AnalyticsEvent[],
  { startMs, endMs }: DateRange
): string[] {
  const vids = new Set<string>()
  for (const e of all) {
    if (e.type !== 'page_view' || !e.vid) continue
    const t = Date.parse(e.ts)
    if (Number.isNaN(t)) continue
    if (startMs != null && t < startMs) continue
    if (endMs != null && t > endMs) continue
    vids.add(e.vid)
  }
  return [...vids]
}

/** First-seen epoch ms for the given visitors, from the Redis hash. Looked up
 *  FIRST_SEEN_CHUNK ids per HMGET, a handful of HMGETs per pipeline, pipelines
 *  sequential — so a typical range is one round trip and no single response
 *  outgrows Upstash's limits however many visitors a range has. Visitors with
 *  no record are simply absent from the map. */
async function readFirstSeen(
  db: Redis,
  vids: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const PER_PIPELINE = 10 * FIRST_SEEN_CHUNK
  for (let p0 = 0; p0 < vids.length; p0 += PER_PIPELINE) {
    const pipe = db.pipeline()
    for (
      let i = p0;
      i < Math.min(p0 + PER_PIPELINE, vids.length);
      i += FIRST_SEEN_CHUNK
    ) {
      pipe.hmget<Record<string, number | null>>(
        FIRST_SEEN_KEY,
        ...vids.slice(i, i + FIRST_SEEN_CHUNK)
      )
    }
    const results = (await pipe.exec()) as (Record<
      string,
      number | null
    > | null)[]
    for (const chunk of results) {
      if (!chunk) continue // hmget returns null when every field is missing
      for (const [vid, ms] of Object.entries(chunk)) {
        if (typeof ms === 'number') out.set(vid, ms)
      }
    }
  }
  return out
}

/** First-seen epoch ms per visitor computed from the events themselves — the
 *  dev store's answer (it holds everything in one file) and the backfill's
 *  source of truth. */
function earliestByVid(events: AnalyticsEvent[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of events) {
    if (!e.vid) continue
    const t = Date.parse(e.ts)
    if (Number.isNaN(t)) continue
    const cur = out.get(e.vid)
    if (cur == null || t < cur) out.set(e.vid, t)
  }
  return out
}

export async function readDashboard(
  range: DateRange,
  page?: string,
  unique = true,
  sourceFilter?: string
): Promise<DashboardData> {
  if (store) {
    try {
      // All stored months, oldest first, with lengths (so the near-cap warning
      // covers the whole store); only the months the range touches have their
      // events read. The oldest month also tells us how far back the data goes.
      const byMonth = await storedMonths(store)
      const months = byMonth.map(b => b.month)
      const wanted = monthsInRange(months, range)
        .map(m => byMonth.find(b => b.month === m)!)
        .reverse() // newest first
      const [all, oldestEvent, backfilled] = await Promise.all([
        readMonths(store, wanted),
        months.length > 0
          ? (store.lindex(
              MONTH_KEY_PREFIX + months[0],
              -1
            ) as Promise<AnalyticsEvent | null>)
          : null,
        store.exists(FIRST_SEEN_BACKFILLED_KEY),
      ])
      // Which of the range's visitors were around before it began. Skipped for
      // an open-ended range: nothing can predate "All time".
      const firstSeen =
        range.startMs != null
          ? await readFirstSeen(store, viewVidsInRange(all, range))
          : new Map<string, number>()
      return {
        source: 'redis',
        oldestTs: oldestEvent?.ts,
        nearCap: nearCapMonths(
          byMonth.map(b => ({ month: b.month, count: b.len }))
        ),
        firstSeenBackfilled: backfilled === 1,
        ...aggregate(all, range, page, unique, sourceFilter, firstSeen),
      }
    } catch (err) {
      // Degrade gracefully — a Redis blip must not 500 the dashboard.
      console.warn(
        `[analytics] dashboard read failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return { source: 'redis', error: true, ...EMPTY }
    }
  }

  const all = await readDevEvents()
  if (all.length === 0) return { source: 'none', ...EMPTY }
  const devMonthCounts = new Map<string, number>()
  for (const e of all) {
    const month = monthOf(e.ts)
    if (month) devMonthCounts.set(month, (devMonthCounts.get(month) ?? 0) + 1)
  }
  return {
    source: 'local-file',
    oldestTs: all[all.length - 1]?.ts, // newest-first, so the oldest is last
    nearCap: nearCapMonths(
      [...devMonthCounts.entries()].map(([month, count]) => ({ month, count }))
    ),
    firstSeenBackfilled: true,
    ...aggregate(all, range, page, unique, sourceFilter, earliestByVid(all)),
  }
}

export interface FirstSeenBackfillResult {
  /** Distinct visitors found across every stored month. */
  visitors: number
  /** How many of them got a first-seen timestamp written — new to the hash,
   *  or earlier than what the live write path had recorded. */
  written: number
  months: string[]
}

/** One-off fill of the first-seen hash from every stored month, so visitors
 *  from before the hash existed are recognised as returning instead of
 *  looking new on their next visit. Reads the whole store (the same cost as
 *  an "All time" dashboard load), then writes each visitor's earliest
 *  timestamp wherever the hash has none or a later one — the live HSETNX path
 *  can only have seen events since the feature deployed. Idempotent: a second
 *  run finds nothing earlier and writes nothing. Sets the backfilled marker
 *  when done, which switches off the dashboard's "history incomplete" note.
 *  Safe alongside live traffic: a visitor's first event landing mid-run is
 *  either in the scan (and wins by being earliest) or newer than anything the
 *  scan has for them. */
export async function backfillFirstSeen(): Promise<FirstSeenBackfillResult> {
  if (!store) {
    throw new Error(
      'backfillFirstSeen needs the Redis backend; the dev file store derives first-seen from the whole file'
    )
  }
  const byMonth = await storedMonths(store)
  const all = await readMonths(store, [...byMonth].reverse())
  const earliest = earliestByVid(all)
  const vids = [...earliest.keys()]
  let written = 0
  for (let i = 0; i < vids.length; i += FIRST_SEEN_CHUNK) {
    const chunk = vids.slice(i, i + FIRST_SEEN_CHUNK)
    const existing = await readFirstSeen(store, chunk)
    const updates: Record<string, number> = {}
    for (const vid of chunk) {
      const t = earliest.get(vid)!
      const cur = existing.get(vid)
      if (cur == null || t < cur) updates[vid] = t
    }
    const n = Object.keys(updates).length
    if (n > 0) {
      await store.hset(FIRST_SEEN_KEY, updates)
      written += n
    }
  }
  await store.set(FIRST_SEEN_BACKFILLED_KEY, {
    doneAt: new Date().toISOString(),
    visitors: vids.length,
    written,
  })
  return { visitors: vids.length, written, months: byMonth.map(b => b.month) }
}

export interface MigrationResult {
  /** True when a previous run already did the copy, so this call was a no-op. */
  alreadyMigrated: boolean
  /** Events copied out of the legacy list, per month. Empty on a no-op. */
  copied: Record<string, number>
}

/** One-time copy of the retired single-list store into the per-month lists.
 *  COPIES rather than moves: the legacy list stays untouched so a rolled-back
 *  deployment (which only knows the old key) still sees its data, while new
 *  code never reads it — each event lives in exactly one place per code
 *  version, so nothing double-counts.
 *
 *  A marker key claimed with SET NX makes a second call a no-op — two copies
 *  would double every pre-migration event. The marker is claimed BEFORE the
 *  copy and then updated with per-month progress after every copied batch, so
 *  a mid-copy crash leaves an exact record of what landed. Recovery from such
 *  a crash (never needed if the one POST succeeds): read the marker's copied
 *  counts, then for each listed month LTRIM that many elements OFF THE TAIL of
 *  its month list (copied legacy events always sit at the tail, and head
 *  growth from live traffic doesn't disturb a trim expressed as "keep the
 *  first llen − copied"), delete the marker, and POST again. Do NOT delete
 *  whole month lists: they also hold every event recorded since the deploy,
 *  which exists nowhere else.
 *
 *  Run it a minute or so AFTER the deploy settles: an old-code instance
 *  draining its last requests can still append to the legacy list, and an
 *  event landing there after this function has read the list would be missed
 *  (visible in old dashboards, absent from new ones — recover as above, then
 *  re-run). */
export async function migrateLegacyEvents(): Promise<MigrationResult> {
  if (!store) {
    throw new Error(
      'migrateLegacyEvents needs the Redis backend; the dev file store has no legacy list'
    )
  }
  const claimed = await store.set(
    MIGRATED_KEY,
    { startedAt: new Date().toISOString(), copied: {} },
    { nx: true }
  )
  if (claimed !== 'OK') return { alreadyMigrated: true, copied: {} }

  // The legacy list is bounded (it was capped at 5,000), but read it in chunks
  // anyway — same response-size caution as readMonths.
  const len = await store.llen(LEGACY_EVENTS_KEY)
  const events: AnalyticsEvent[] = []
  for (let start = 0; start < len; start += READ_CHUNK) {
    events.push(
      ...(await store.lrange<AnalyticsEvent>(
        LEGACY_EVENTS_KEY,
        start,
        start + READ_CHUNK - 1
      ))
    )
  }

  // Group by month, keeping each group newest-first (the list already is).
  const byMonth = new Map<string, AnalyticsEvent[]>()
  for (const e of events) {
    const month = monthOf(e.ts)
    if (!month) {
      console.warn(`[analytics] migration skipping event with bad ts: ${e.ts}`)
      continue
    }
    const group = byMonth.get(month) ?? []
    group.push(e)
    byMonth.set(month, group)
  }

  // Legacy events are all older than anything the new code has written (up to
  // a few seconds of rolling-deploy overlap, which only bends ordering at the
  // seam, never counts), so they belong at the TAIL of their month lists:
  // rpush in newest-first order keeps each list newest-first overall. Batches
  // are sent as separate sequential requests (not one pipeline, which would
  // still be a single oversized REST call) so no request can outgrow Upstash's
  // request-size limit, and the marker is updated after every batch so a crash
  // leaves an exact recovery record (see the docstring).
  const copied: Record<string, number> = {}
  const startedAt = new Date().toISOString()
  for (const [month, group] of byMonth) {
    for (let start = 0; start < group.length; start += 500) {
      await store.rpush(
        MONTH_KEY_PREFIX + month,
        ...group.slice(start, start + 500)
      )
      copied[month] = Math.min(start + 500, group.length)
      await store.set(MIGRATED_KEY, { startedAt, copied })
    }
    await store.zadd(MONTHS_KEY, {
      score: monthScore(month),
      member: month,
    })
  }
  await store.set(MIGRATED_KEY, {
    doneAt: new Date().toISOString(),
    copied,
  })
  return { alreadyMigrated: false, copied }
}
