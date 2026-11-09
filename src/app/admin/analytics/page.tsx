import { Fragment, Suspense } from 'react'
import { after } from 'next/server'
import { headers } from 'next/headers'
import Icon from '@/components/Icon'
import {
  readDashboard,
  saveViewCopy,
  savedViewWhileCold,
  sourceSlug,
  newsletterErrorLabel,
  PAGE_NAME_BY_PATH,
  type Counted,
  type DashboardData,
  type ChatbotFunnel,
  type ChatbotRepeatUse,
  type ClickDestination,
  type CorrelationRow,
  type ListingRow,
  type OverallListingRow,
  type SearchPanelData,
  type MapSearchPanelData,
  type NewsletterArchiveRow,
  type NewsletterConfirmRow,
  type NewsletterCopyRow,
  type NewsletterLinkRow,
  type NewsletterSignupResults,
  type NewsletterVisits,
  type NewslettersPageStats,
  type DateRange,
  type VisitorShare,
  DASHBOARD_TZ,
} from '@/lib/analytics/events'
import {
  countConversations,
  readConversationStats,
  type ConversationStats,
  type RatedReply,
  type TopQuestion,
} from '@/lib/analytics/conversations'
import { bucketOf, previousWindow, weeklyOf } from '@/lib/analytics/trends'
import { readQuestionThemes, type ThemeSummary } from '@/lib/analytics/themes'
import {
  buildSearchIndex,
  type SearchEntry,
  type SearchType,
} from '@/lib/data/search-index'
import { TYPE_ICON, TYPE_LABEL, TYPE_PATH } from '@/lib/search'
import { isPreviewRequest } from '@/lib/preview'
import RefreshThemesButton from './RefreshThemesButton'
import { getFunders } from '@/lib/data/funding'
import { getEvents } from '@/lib/data/events'
import { getTrainingPrograms, getRecurringPrograms } from '@/lib/data/training'
import { getCourses } from '@/lib/data/self-study'
import { getAdvisors } from '@/lib/data/advisors'
import { getCommunities } from '@/lib/data/communities'
import { getMediaChannels } from '@/lib/data/media-channels'
import { getFounderResources } from '@/lib/data/founders'
import { getJobs } from '@/lib/data/jobs'
import { getMapData, type MapOrg } from '@/lib/data/map'
import { getProjects } from '@/lib/data/projects'
import { requireAccess } from '@/lib/admin/auth'
import {
  isNewsletterConfigured,
  CAMPAIGN_READ_MAX,
  readSendStats,
  type SendStats,
  type SendStatsResult,
} from '@/lib/admin/newsletter'
import {
  historyStale,
  readNewsletterSubscribers,
  refreshSubscriberHistory,
} from '@/lib/admin/newsletter-subscribers'
import {
  readFeedHistory,
  type FeedReaders,
} from '@/lib/newsletter-archive-store'
import { issueName } from '@/lib/newsletter-web'
import { MAX_QUERY, normText, parseLeftOut } from '@/lib/analytics/org-lookup'
import { readIssueClicks } from '@/lib/analytics/org-newsletter'
import {
  sameLeftOut,
  jobsShareOf,
  listShares,
  shareForQuery,
} from '@/lib/analytics/org-shares'
import { canEdit } from '@/lib/admin/access'
import { requestOrigin } from '@/lib/admin/origin'
import DateRangePicker from './DateRangePicker'
import OrgSearch from './OrgSearch'
import ShareOrgLink, {
  LeaveOutLink,
  SharedOrgPages,
  type ShareState,
  type ShareSync,
} from './ShareOrgLink'
import ExcludeToggle from './ExcludeToggle'
import Logo from './Logo'
import PendingMark from './PendingMark'
import RefreshIfStale from './RefreshIfStale'
import PreloadLink, { type Preload } from './PreloadLink'
import SortableTable, { type SortColumn, type SortValue } from './SortableTable'
import TrendChart, { type TrendTile } from './TrendChart'
import SubstackUpload from './SubstackUpload'
import {
  eventTiles,
  feedDays,
  feedTile,
  subscriberTiles,
  type TileSpec,
} from './trend-tiles'
import {
  OrgView,
  openedWords,
  orgNewsletterPanel,
  type OrgAdmin,
  type OrgNewsletter,
} from './OrgView'
import { orgSearchSpec } from './org-search'
import { PAGE_NAV, navOrder } from './page-nav'
import {
  CountTable,
  MAX_TABLE_ROWS,
  Panel,
  Stat,
  TruncationNote,
  faviconFor,
  pct1,
  prettyUrl,
  shareCell,
  type PageBadge,
} from './parts'
import {
  MINUTE,
  first,
  resolveRange,
  type ResolvedRange,
  type SearchParams,
} from './range'
import admin from '../admin.module.css'
import {
  type CardEditCounts,
  readCardEdits,
} from '@/lib/admin/newsletter-edit-counts'
import styles from './analytics.module.css'
import { displayFilterGroup, displayFilterValue } from '@/lib/filter-tracking'

// Always render fresh — the dashboard reflects live event counts and the
// selected date range comes from the query string.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SOURCE_LABEL: Record<string, string> = {
  redis: 'Live',
  'local-file': 'Local dev',
  none: 'No data yet',
}

// The non-page tabs that lead the tab bar. Their keys are reserved (and
// lowercase), so a resource page can never collide with them.
const OVERVIEW_TABS: { key: string; label: string }[] = [
  { key: 'pages', label: 'Overview' },
  { key: 'orgs', label: 'Org lookup' },
  { key: 'chatbot', label: 'Chatbot' },
  { key: 'search', label: 'Search' },
  { key: 'newsletters', label: 'Newsletters' },
  { key: 'correlations', label: 'Correlations' },
]
const OVERVIEW_KEYS = new Set(OVERVIEW_TABS.map(t => t.key))
// Tabs whose views read more than the event store: the Chatbot tab the
// Airtable conversation log, Newsletters ActiveCampaign, Search the whole
// search index, Org lookup the listing catalog and the newsletter clicks.
// Their links preload only once the pointer is on them.
const COSTLY_TABS = new Set(['chatbot', 'newsletters', 'search', 'orgs'])
// The resource pages the site really has. Tab names otherwise come from the
// events, which anyone can send to /api/track, so only these are preloaded
// and kept in the saved copy.
const KNOWN_PAGES = new Set([...PAGE_NAV.map(p => p.name), 'Home'])
// The ranges whose months stay in the store's memory between loads, so their
// views are cheap enough to preload all at once. Last month too: a finished
// month never changes, so its figures are worked out once and kept.
const SHORT_RANGES = new Set(['today', '7d', '30d', 'lastmonth'])
// The range the dashboard opens on. It's the one view saved for servers that
// haven't read the store yet (savedViewWhileCold).
const DEFAULT_RANGE = '30d'

// Pages with a map (mirrors MAP_PAGES in the events store). Only these emit
// listing_hover events, so only their tabs get the hovered-listings panel —
// and only Map has areas, so the by-area rollup is Map-only.
const MAP_PAGES = new Set(['Map', 'Communities'])

// When the events behind some tiles began to be recorded (the captions below
// say the same), so a tile never compares with a stretch from before.
// Clicks and the chatbot go back to the store's oldest event.
const PAGE_VIEWS_SINCE = '2026-07-15'
const SEARCH_SINCE = '2026-07-16'
const FILTERS_SINCE = '2026-07-29'
const SIGNUP_BOX_SINCE = '2026-07-29'
const SITE_SIGNUPS_SINCE = '2026-10-08'

/** How long ago a saved copy was made, for the "figures from …" note. */
function savedAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / MINUTE)
  if (minutes < 1) return 'a moment ago'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${Math.round(hours / 24)} days ago`
}

/** Real Airtable logos for the selected page's listings, keyed by the exact
 *  label each click was tracked under, so the top-listings table shows proper
 *  logos instead of favicons. Returns an empty map (→ favicons) on any error or
 *  for pages without listing data. The Map page isn't handled here — its
 *  caller builds the logo map itself, from records it already fetched for the
 *  by-area panel. */
async function logosForPage(
  page: string | null
): Promise<Map<string, string | null>> {
  try {
    switch (page) {
      case 'Funding':
        return new Map((await getFunders()).map(i => [i.name, i.logo]))
      case 'Events':
        return new Map((await getEvents()).map(i => [i.name, i.logo]))
      case 'Training': {
        // The Training tab lists both upcoming and recurring programs.
        const [upcoming, recurring] = await Promise.all([
          getTrainingPrograms(),
          getRecurringPrograms(),
        ])
        return new Map([...upcoming, ...recurring].map(i => [i.name, i.logo]))
      }
      case 'Self-study':
        return new Map((await getCourses()).map(i => [i.name, i.image]))
      case 'Advisors':
        return new Map((await getAdvisors()).map(i => [i.name, i.logo]))
      case 'Communities':
        return new Map((await getCommunities()).map(i => [i.name, i.logo]))
      case 'Media channels':
        return new Map((await getMediaChannels()).map(i => [i.name, i.logo]))
      case 'Founders':
        return new Map(
          (await getFounderResources()).map(i => [i.name, i.image])
        )
      case 'Projects':
        return new Map((await getProjects()).map(i => [i.name, i.logo]))
      case 'Jobs':
        return new Map(
          (await getJobs()).map(i => [`${i.name} – ${i.organization}`, i.logo])
        )
      default:
        return new Map()
    }
  } catch {
    return new Map()
  }
}

/** The Map tab's per-area rollups: the page's clicks and hovers bucketed by
 *  map area — one list per metric, each sorted by its own count. Newer events
 *  carry their area stamped at click/hover time (what the visitor actually
 *  saw); older rows are resolved against the current map records — by record
 *  id, then exact name, then url — so history from before area tracking still
 *  lands in the right bucket. Rows that match a record with no category show
 *  as 'Other'; rows that match nothing (the listing was removed or renamed
 *  since) show as 'No longer listed'. */
function areaBreakdown(
  clicks: ListingRow[],
  hovers: ListingRow[],
  records: MapOrg[]
): { clicks: Counted[]; hovers: Counted[] } {
  const byId = new Map(records.map(r => [r.id, r]))
  // A record answers to both of its display names: card clicks are tracked
  // under the card title, map tooltips under the (long) tooltip name.
  const byName = new Map<string, MapOrg>()
  for (const r of records) {
    byName.set(r.title, r)
    byName.set(r.tooltipTitle, r)
  }
  // '#' is the map's placeholder for a missing link, not a real url.
  const byUrl = new Map(
    records.filter(r => r.link && r.link !== '#').map(r => [r.link, r])
  )
  const areaOf = (row: ListingRow): string => {
    if (row.area) return row.area
    const rec =
      (row.listingId ? byId.get(row.listingId) : undefined) ??
      byName.get(row.name) ??
      (row.url && row.url !== '#' ? byUrl.get(row.url) : undefined)
    if (!rec) return 'No longer listed'
    // The map files each listing under its first category — that's its area.
    return rec.category.split(',')[0].trim() || 'Other'
  }
  const tally = (rows: ListingRow[]): Counted[] => {
    const areas = new Map<string, number>()
    for (const row of rows) {
      const name = areaOf(row)
      areas.set(name, (areas.get(name) ?? 0) + row.count)
    }
    return [...areas.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }
  return { clicks: tally(clicks), hovers: tally(hovers) }
}

/** '/jobs' → 'job', '/funding' → 'funder', … — so a click on a resource page
 *  itself (a 'page' search result) still resolves to that page's badge. */
const SEARCH_TYPE_BY_PATH = new Map<string, SearchType>(
  (Object.keys(TYPE_PATH) as SearchType[])
    .filter(t => TYPE_PATH[t])
    .map(t => [TYPE_PATH[t]!, t])
)

/** The page each clicked-from-search row belongs to. Newer clicks record the
 *  result's type at click time; rows without one (clicks from before the type
 *  was tracked) are matched against the live search index by url, then title.
 *  Resource-page rows get the page's icon and name; non-resource pages (Home,
 *  About, …) get their own title and nav icon, when they have one — Home
 *  renders as its title alone. A row that matches nothing — or
 *  whose url/title is shared by listings on two different pages — stays
 *  unresolved and shows no badge. */
function searchPageBadges(
  index: SearchEntry[],
  rows: { name: string; url?: string; resultType?: string }[]
): Map<string, PageBadge> {
  // null marks a url/title claimed by entries of two different types —
  // too ambiguous to resolve a page from.
  const byUrl = new Map<string, SearchType | null>()
  const byTitle = new Map<string, SearchType | null>()
  // Non-resource pages, keyed by url and title — the badge is the page's own
  // nav icon (when it has one, e.g. Home doesn't) and title.
  const pageByUrl = new Map<string, PageBadge>()
  const pageByTitle = new Map<string, PageBadge>()
  const claim = (
    m: Map<string, SearchType | null>,
    key: string,
    type: SearchType
  ) => {
    const prev = m.get(key)
    if (prev === undefined) m.set(key, type)
    else if (prev !== type) m.set(key, null)
  }
  for (const e of index) {
    // Page entries resolve to the resource page their url is; non-resource
    // pages (Home, About, …) resolve to their own title.
    const type = e.type === 'page' ? SEARCH_TYPE_BY_PATH.get(e.url) : e.type
    if (!type) {
      const badge = { icon: e.logo, label: e.title }
      pageByUrl.set(e.url, badge)
      pageByTitle.set(e.title, badge)
      continue
    }
    claim(byUrl, e.url, type)
    claim(byTitle, e.title, type)
  }
  const out = new Map<string, PageBadge>()
  for (const r of rows) {
    const recorded =
      r.resultType && r.resultType !== 'page' && r.resultType in TYPE_ICON
        ? (r.resultType as SearchType)
        : undefined
    const matched =
      (r.url ? byUrl.get(r.url) : undefined) || byTitle.get(r.name) || undefined
    const type = recorded ?? matched
    if (type && type !== 'page') {
      out.set(r.name, { icon: TYPE_ICON[type], label: TYPE_LABEL[type] })
      continue
    }
    const page =
      (r.url ? pageByUrl.get(r.url) : undefined) ?? pageByTitle.get(r.name)
    if (page) out.set(r.name, page)
  }
  return out
}

/** en-GB so the date reads day-before-month (e.g. "19 Jun, 20:30"). */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: DASHBOARD_TZ,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

const EVENT_LABELS: Record<string, string> = {
  chatbot_open: 'Opened the chatbot',
  chatbot_message: 'Sent a message',
  chatbot_click: 'Clicked a result',
  analytics_optout: 'Turned analytics off',
  analytics_optin: 'Turned analytics back on',
}

/** Feed lines for search opens, by how the modal was opened. */
const SEARCH_OPEN_LABELS: Record<string, string> = {
  button: 'Opened search',
  'cmd-k': 'Opened search (⌘K)',
  slash: 'Opened search (/)',
}

function pillFor(e: { page?: string; type: string }): string | null {
  // Chatbot/search first: their events carry the page they happened on too,
  // but in the feed they should read as chatbot/search activity, not clicks.
  if (e.type.startsWith('chatbot')) return 'Chatbot'
  if (e.type.startsWith('search')) return 'Search'
  // Footer clicks carry the raw path they happened on; 'Footer' reads better.
  if (e.type === 'footer_click') return 'Footer'
  // Likewise the +N menu: it belongs to the nav, whatever page it opened on.
  if (e.type === 'nav_overflow_open') return 'Nav'
  if (e.page) return e.page
  return null
}

function labelFor(e: {
  label?: string
  type: string
  source?: string
  query?: string
  page?: string
}): string {
  if (e.type === 'nav_overflow_open')
    return e.source === 'tap'
      ? 'Opened the +N menu (tap)'
      : 'Opened the +N menu'
  if (e.type === 'search_open')
    return SEARCH_OPEN_LABELS[e.source ?? ''] ?? 'Opened search'
  if (e.type === 'search_query')
    return e.query ? `Searched for “${e.query}”` : 'Searched'
  // The /map search box: its events carry page 'Map', so the pill already
  // says where; the line says which control.
  if (e.type === 'map_search_open')
    return e.source === 'cmd-f'
      ? 'Opened the map search (⌘F)'
      : 'Opened the map search'
  if (e.type === 'map_search_query')
    return e.query ? `Searched the map for “${e.query}”` : 'Searched the map'
  if (e.type === 'map_search_pick')
    return e.label
      ? `Picked “${e.label}” from the map search`
      : 'Picked a map search result'
  if (e.type === 'filter_apply') {
    // Renamed filters log their original names; show the current wording.
    const page = e.page ?? ''
    const group = e.source ?? '?'
    const value = e.label ?? '?'
    return `Filtered by ${displayFilterGroup(page, group)}: ${displayFilterValue(page, group, value)}`
  }
  // A newsletter signup error's reason is a short code; spell it out.
  if (e.type === 'newsletter_signup_error')
    return `Newsletter signup error: ${newsletterErrorLabel(e.source)}`
  // A rating's label is the bare value ('up' | 'down' | 'removed'), so spell
  // it out.
  if (e.type === 'chatbot_rating') {
    if (e.label === 'removed') return 'Took back a reply rating'
    return e.label === 'up' ? 'Rated a reply 👍' : 'Rated a reply 👎'
  }
  // search_click carries the result's title as its label, like listing clicks.
  return e.label ?? EVENT_LABELS[e.type] ?? e.type
}

/** Conversion percentage of one funnel stage relative to the previous. */
function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((100 * part) / whole)}%` : '—'
}

/** "1 July 2026" in the dashboard's timezone, for the coverage note. */
function formatDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      timeZone: DASHBOARD_TZ,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

/** "July 2026" for a storage month ('2026-07'), for the near-cap warning. */
function formatMonth(month: string): string {
  try {
    return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return month
  }
}

/** What the query string asks for. */
interface Query {
  range: ResolvedRange
  /** Count each visitor once per listing per day (the default); ?clicks=total
   *  counts every click. */
  unique: boolean
  tabReq?: string
  onResourceTab: boolean
}

function readQuery(sp: SearchParams): Query {
  // The dashboard is tabbed: two overview tabs (the chatbot and the by-page
  // table) plus one tab per resource page. `tab` holds the active tab — an
  // overview key, or a resource page's analytics name. A resource tab is the
  // page we ask the store to drill into; the overview tabs need no page.
  // 'funnel' is the Chatbot tab's old key, kept working for bookmarked urls.
  const tabRaw = first(sp.tab)
  const tabReq = tabRaw === 'funnel' ? 'chatbot' : tabRaw
  return {
    range: resolveRange(sp),
    unique: first(sp.clicks) !== 'total',
    tabReq,
    onResourceTab: tabReq != null && !OVERVIEW_KEYS.has(tabReq),
  }
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  // Before anything is read. The layout checks too, but a tab click asks for
  // this page without rendering the layout again (see requireAccess).
  const access = await requireAccess('analytics')
  // Org pages put figures outside the admin, so only Admin admin's editors
  // make them (the API checks the same).
  const canShare = canEdit(access, 'manageUsers')
  // Adding a newsletter's Substack export is for the people who send them.
  const canAddExport = canEdit(access, 'newsletter')

  const sp = await searchParams
  const query = readQuery(sp)
  // A server that hasn't read the range's events yet (each deploy starts
  // fresh ones) needs seconds to. When the page is opened or reloaded on the
  // default view, it shows the copy saved on an earlier load straight away
  // and streams the live figures in to replace it. Only when the browser
  // says it's loading the page itself (Next hides its own navigation headers
  // from pages): not for navigations within the dashboard (tab clicks,
  // preloads, refreshes), which are preloaded anyway, and a refresh must
  // never step back to older figures.
  // Nor on the tabs that read Airtable or ActiveCampaign: those reads would
  // hold the copy up anyway.
  const saved =
    query.range.key === DEFAULT_RANGE &&
    !COSTLY_TABS.has(query.tabReq ?? '') &&
    (await headers()).get('sec-fetch-dest') === 'document'
      ? await savedViewWhileCold(
          query.range,
          query.range.key,
          query.unique,
          query.onResourceTab ? query.tabReq : undefined,
          first(sp.source)
        )
      : null
  const live = (
    <AnalyticsView
      sp={sp}
      query={query}
      canShare={canShare}
      canAddExport={canAddExport}
    />
  )
  if (!saved) return live
  return (
    <Suspense
      fallback={
        <AnalyticsView
          sp={sp}
          query={query}
          canShare={canShare}
          canAddExport={canAddExport}
          saved={saved}
        />
      }
    >
      {live}
    </Suspense>
  )
}

/** The dashboard for one view: live, or `saved`, an earlier copy shown while
 *  the live one loads. */
async function AnalyticsView({
  sp,
  query,
  canShare,
  canAddExport,
  saved,
}: {
  sp: SearchParams
  query: Query
  /** May make org pages from the Org lookup tab. */
  canShare: boolean
  /** May add a newsletter's Substack export on the Newsletters tab. */
  canAddExport: boolean
  saved?: { at: number; data: DashboardData }
}) {
  const { range, unique, tabReq, onResourceTab } = query

  // When these figures were worked out, so a preloaded copy shown later can
  // tell how old it is (RefreshIfStale).
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this stamps that request
  const renderedAt = saved ? saved.at : Date.now()
  // The Org lookup tab's search (?q=) and the rows left out of it (?x=). Only
  // that tab, and only a real search, reads the listing catalog.
  const orgQuery = (first(sp.q) ?? '').trim().slice(0, MAX_QUERY)
  const orgLeftOut = parseLeftOut(first(sp.x))
  const orgSearch =
    tabReq === 'orgs' && normText(orgQuery).length >= 2
      ? orgSearchSpec(orgQuery, orgLeftOut)
      : undefined
  // The stretch the Conversations tile compares with (the tiles' rule,
  // previousWindow); the log is read for it only on the Chatbot tab.
  const convBefore =
    tabReq === 'chatbot' ? previousWindow(range, renderedAt) : null

  const [
    data,
    funders,
    convStats,
    convBeforeCount,
    themes,
    searchIndex,
    sendStats,
    subscribers,
    feeds,
    issueClicks,
    shares,
    cardEdits,
  ] = await Promise.all([
    saved
      ? saved.data
      : readDashboard(
          range,
          onResourceTab ? tabReq : undefined,
          unique,
          first(sp.source),
          orgSearch
        ),
    getFunders().catch(() => []),
    // The transcript-derived stats only render on the Chatbot tab, so only
    // fetch the (ever-growing) conversation log when it's the active tab.
    tabReq === 'chatbot' ? readConversationStats(range) : null,
    convBefore ? countConversations(convBefore) : null,
    tabReq === 'chatbot' ? readQuestionThemes() : null,
    // Resolves clicked search results to their resource page; only the Search
    // tab reads it. On error the page icons resolve from recorded types alone.
    tabReq === 'search'
      ? buildSearchIndex().catch(() => [] as SearchEntry[])
      : ([] as SearchEntry[]),
    // The Newsletters tab reads the sends from ActiveCampaign (slow, so only
    // on that tab). null = couldn't read them; the tab says so.
    tabReq === 'newsletters' && isNewsletterConfigured()
      ? readSendStats(range).catch(err => {
          console.warn(
            `[analytics] newsletter sends unavailable: ${err instanceof Error ? err.message : String(err)}`
          )
          return null
        })
      : null,
    // The subscriber tiles' figures (ActiveCampaign, kept in Upstash, and
    // the Substack histories). Never rejects.
    tabReq === 'newsletters' ? readNewsletterSubscribers() : null,
    // The feeds' readers each day of the range, and yesterday and so far
    // today (UTC days); null = couldn't read them.
    tabReq === 'newsletters' ? readFeeds(range) : null,
    // The Org lookup's newsletter panel: the sent issues' link clicks
    // (Upstash, live site only). Never rejects.
    orgSearch ? readIssueClicks(range) : null,
    // The org pages already made, for the Org lookup's share box and its
    // list of them, and the Jobs tab's box for the job board's page.
    // 'failed' = couldn't read them; the box says so.
    (tabReq === 'orgs' || tabReq === 'Jobs') && canShare
      ? listShares().catch(err => {
          console.warn(
            `[analytics] org pages unavailable: ${err instanceof Error ? err.message : String(err)}`
          )
          return 'failed' as const
        })
      : null,
    // Remove and Put back on /admin/newsletter (Upstash; null = couldn't
    // read them).
    tabReq === 'newsletters' ? readCardEdits(range) : null,
  ])

  // Which of those newsletter links are the searched org's.
  const orgNewsletter: OrgNewsletter | null =
    orgSearch && issueClicks
      ? await orgNewsletterPanel(orgSearch, issueClicks)
      : null

  // The share box: this search's page, if it has one.
  const shareOrigin = canShare ? requestOrigin(await headers()) : ''
  const shared =
    shares && shares !== 'failed' ? shareForQuery(shares, orgQuery) : undefined
  const shareState: ShareState | null | 'unknown' =
    shares === 'failed'
      ? 'unknown'
      : shared
        ? {
            token: shared.token,
            orgName: shared.orgName,
            leftOutDiffers: !sameLeftOut(shared.leftOut, [...orgLeftOut]),
            opened: openedWords(shared.views, shared.lastViewedAt),
          }
        : null
  // The Jobs tab's box: the job board's page, if it has one.
  const jobsShared =
    shares && shares !== 'failed' ? jobsShareOf(shares) : undefined
  const jobsShareBox =
    tabReq === 'Jobs' && shares != null ? (
      <ShareOrgLink
        kind="jobs"
        query=""
        orgName={jobsShared?.orgName ?? '80,000 Hours'}
        leftOut={[]}
        origin={shareOrigin}
        share={
          shares === 'failed'
            ? 'unknown'
            : jobsShared
              ? {
                  token: jobsShared.token,
                  orgName: jobsShared.orgName,
                  leftOutDiffers: false,
                  opened: openedWords(
                    jobsShared.views,
                    jobsShared.lastViewedAt
                  ),
                }
              : null
        }
      />
    ) : null
  const shareBox: OrgAdmin['shareBox'] =
    shares == null
      ? null
      : (orgName, leftOut) => (
          <ShareOrgLink
            // A new search starts the name field afresh. (Not the bare
            // search: the search box beside it is keyed by that.)
            key={`share:${orgQuery}`}
            query={orgQuery}
            orgName={orgName}
            leftOut={leftOut}
            origin={shareOrigin}
            share={shareState}
          />
        )
  // The list before a search: each page opens the lookup on its own search
  // and left-out rows, in the current dates and count mode.
  const lookupHref = (query: string, leftOut: string[]) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(sp))
      if (k !== 'q' && k !== 'x' && typeof v === 'string') q.set(k, v)
    q.set('tab', 'orgs')
    q.set('q', query)
    if (leftOut.length) q.set('x', leftOut.join(','))
    return `?${q.toString()}`
  }
  // The job board's page opens the Jobs tab, in the current dates and
  // count mode.
  const jobsTabHref = () => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(sp))
      if (k !== 'q' && k !== 'x' && k !== 'tab' && typeof v === 'string')
        q.set(k, v)
    q.set('tab', 'Jobs')
    return `?${q.toString()}`
  }
  // Leave out and Put back keep this search's shared page in step, for
  // someone who may change it.
  const shareSync: ShareSync | null = shared
    ? { query: orgQuery, orgName: shared.orgName }
    : null
  const leaveOutLink: OrgAdmin['leaveOutLink'] = ({ label, ...link }) => (
    <LeaveOutLink {...link} sync={shareSync}>
      {label}
    </LeaveOutLink>
  )
  const sharedPages =
    shares && shares !== 'failed' && shares.length > 0 ? (
      <SharedOrgPages
        origin={shareOrigin}
        pages={shares.map(s => ({
          token: s.token,
          orgName: s.kind === 'jobs' ? `${s.orgName} (jobs)` : s.orgName,
          lookupHref:
            s.kind === 'jobs' ? jobsTabHref() : lookupHref(s.query, s.leftOut),
          note: `${openedWords(s.views, s.lastViewedAt)} · made by ${s.createdBy}`,
        }))}
      />
    ) : null

  // Resource-page tabs: every page in PAGE_NAV always gets one (so quiet pages
  // like Projects still appear), plus any other page that has clicks (e.g.
  // Home). Ordered Home first, then site-nav order, then the rest.
  const labelByPage = new Map(PAGE_NAV.map(p => [p.name, p.label]))
  const iconByPage = new Map(PAGE_NAV.map(p => [p.name, p.icon]))
  const resourceNames = [
    ...new Set([...PAGE_NAV.map(p => p.name), ...data.byPage.map(p => p.name)]),
  ].sort((a, b) => navOrder(a) - navOrder(b))
  const resourceTabs = resourceNames.map(name => ({
    key: name,
    label: labelByPage.get(name) ?? name,
    icon: iconByPage.get(name),
  }))

  // Resolve the active tab: the requested one if it's a real tab, else the
  // default overview ('pages'). onResourceView gates the per-page panels.
  const tabKeys = new Set<string>([...OVERVIEW_KEYS, ...resourceNames])
  const activeTab = tabReq && tabKeys.has(tabReq) ? tabReq : 'pages'
  const onResourceView = !OVERVIEW_KEYS.has(activeTab)

  // The dashboard preloads the views its links lead to, so a click shows at
  // once. Every view at once only while that's cheap: a short range, a tab
  // that reads only the event store, and not in preview mode (where every
  // Airtable read goes live). Otherwise a link preloads once the pointer is
  // on it, which still gives the server a head start.
  // Not from a saved copy either: the server is still reading, and the live
  // view that replaces it preloads.
  const preloadAll =
    !saved &&
    SHORT_RANGES.has(range.key) &&
    !COSTLY_TABS.has(activeTab) &&
    !(await isPreviewRequest())

  // Keep the saved copy of the default view (30 days, unique counts) current
  // for the next server that starts cold (saveViewCopy does it at most every
  // few minutes). After the response, so it never slows this one.
  if (!saved && range.key === DEFAULT_RANGE && unique && !data.error)
    after(() =>
      saveViewCopy(
        range,
        range.key,
        unique,
        resourceNames.filter(name => KNOWN_PAGES.has(name))
      )
    )
  const preloadTo = (tab: string): Preload =>
    preloadAll &&
    !COSTLY_TABS.has(tab) &&
    (OVERVIEW_KEYS.has(tab) || KNOWN_PAGES.has(tab))
      ? 'now'
      : 'hover'

  // The Map tab needs the live map records twice — the by-area panel joins
  // clicks and hovers back to them, and the logo maps below read from them —
  // so they're fetched once here and shared. On error the tab degrades (area
  // rows fall to 'No longer listed', logos to favicons) with a warning rather
  // than taking the dashboard down.
  const mapRecords: MapOrg[] =
    data.selectedPage === 'Map'
      ? await getMapData()
          .then(d => d.records)
          .catch(err => {
            console.warn(
              `[analytics] map data unavailable for the Map tab panels: ${
                err instanceof Error ? err.message : String(err)
              }`
            )
            return []
          })
      : []

  // logoById drives the recent-activity feed (funding listings, by record id).
  // logoByName drives the top-listings table for the selected page, fetched from
  // that page's Airtable data so every page shows real logos — not just funding.
  // Funding reuses the already-fetched funders, Map the already-fetched map
  // records — keyed by both display names a Map event can be tracked under
  // (card title and tooltip name). Only needed on a resource view.
  const logoById = new Map(funders.map(f => [f.id, f.logo]))
  const logoByName = !onResourceView
    ? new Map<string, string | null>()
    : data.selectedPage === 'Funding'
      ? new Map<string, string | null>(funders.map(f => [f.name, f.logo]))
      : data.selectedPage === 'Map'
        ? new Map<string, string | null>(
            mapRecords.flatMap((r): [string, string | null][] => [
              [r.tooltipTitle, r.logo],
              [r.title, r.logo],
            ])
          )
        : await logosForPage(data.selectedPage)

  // Per-listing slot range + a url for the favicon, keyed by display name, for
  // whichever page is selected. The slot is stamped onto the click when it
  // happens, so it stays accurate even as the page is reordered; it's undefined
  // for listings whose clicks predate slot tracking.
  const positionByName = new Map(
    data.topListings.map(r => [r.name, r.position])
  )
  const urlByName = new Map(data.topListings.map(r => [r.name, r.url]))

  // Same url lookup for the hovered-listings table — hover rows carry their
  // own urls, independent of the click rows above.
  const hoverUrlByName = new Map(data.topHovered.map(r => [r.name, r.url]))
  // And for the map search's picked-listings table.
  const pickUrlByName = new Map(data.mapSearch.picked.map(r => [r.name, r.url]))
  // Every hover is by definition from the map, so hovers aren't split by
  // source and the table's % denominator is simply the sum of its rows.
  const hoverTotal = data.topHovered.reduce((sum, r) => sum + r.count, 0)
  // The Map tab's by-area rollups (empty on every other tab). Built from
  // areaClicks, not topListings — topListings narrows to the active ?source
  // filter while hovers never do, and the two area panels should stay
  // comparable side by side.
  const areaData =
    data.selectedPage === 'Map'
      ? areaBreakdown(data.areaClicks, data.topHovered, mapRecords)
      : { clicks: [] as Counted[], hovers: [] as Counted[] }
  const areaClickTotal = areaData.clicks.reduce((sum, r) => sum + r.count, 0)
  const areaHoverTotal = areaData.hovers.reduce((sum, r) => sum + r.count, 0)

  // Chart totals (also the % denominators). The listings total is the selected
  // page's whole click count, not just the rows currently revealed.
  const totalClicks = data.byPage.reduce((sum, r) => sum + r.count, 0)
  const pageTotal = data.byPage.find(p => p.name === data.selectedPage)?.count
  // When the listings are filtered to one source, the top-listings table is a
  // share of that source's clicks, not the page's whole. bySource carries the
  // per-source totals, so read the active one from there.
  const listingTotal = data.selectedSource
    ? data.bySource.find(r => sourceSlug(r.name) === data.selectedSource)?.count
    : pageTotal
  const positionTotal = data.byPosition.reduce((sum, r) => sum + r.count, 0)
  const filterTotal = data.filterGroups.reduce((sum, r) => sum + r.count, 0)
  const filterShareByPage = new Map(
    data.filterShareByPage.map(r => [r.name, r])
  )
  // "% of visitors" lookups for the Overview's by-page tables, keyed by the
  // page label the rows display ('Founders' → 'Founder toolkit') since the
  // rows are relabelled before they reach CountTable.
  const shareByLabel = (rows: VisitorShare[]) =>
    new Map(rows.map(r => [labelByPage.get(r.name) ?? r.name, r]))
  const clickShare = shareByLabel(data.clickShareByPage)
  const returningShare = shareByLabel(data.visits.returningShareByPage)
  const contributeShare = shareByLabel(data.contributeShareByPage)
  const airtableShare = shareByLabel(data.airtableShareByPage)
  const newsletterShare = shareByLabel(data.newsletterShareByPage)
  // The selected page's own "% of visitors" lookups, keyed by the raw row
  // names those tables use (listing labels, slots, 'Group: Value', buttons).
  const shareMap = (rows: VisitorShare[]) => new Map(rows.map(r => [r.name, r]))
  const listingShare = shareMap(data.listingShare)
  const positionShare = shareMap(data.positionShare)
  const filterGroupShare = shareMap(data.filterGroupShare)
  const filterValueShare = shareMap(data.filterValueShare)
  const contributeButtonShare = shareMap(data.contributeButtonShare)
  const hoverShare = shareMap(data.hoverShare)
  // The "View data in Airtable" stat panel's share of the page's visitors.
  const airtablePageShare = data.airtableShareByPage.find(
    r => r.name === data.selectedPage
  )
  const contributeTotal = data.contributeButtons.reduce(
    (sum, r) => sum + r.count,
    0
  )
  const contributeTotalByPage = data.contributeByPage.reduce(
    (sum, r) => sum + r.count,
    0
  )
  const airtableTotalByPage = data.airtableByPage.reduce(
    (sum, r) => sum + r.count,
    0
  )
  const footerTotal = data.footerClicks.reduce((sum, r) => sum + r.count, 0)
  const pressTotal = data.press.byAction.reduce((sum, r) => sum + r.count, 0)
  const pressActionShare = shareMap(data.press.actionShare)
  const navOpenTotal = data.navOverflowOpens.reduce(
    (sum, r) => sum + r.count,
    0
  )
  const navOpenShare = new Map(
    data.navOverflowOpenShare.map(s => [s.name, s] as const)
  )
  const newsletterTotalByPage = data.newsletterByPage.reduce(
    (sum, r) => sum + r.count,
    0
  )
  // The site's own sidebar icons, so the rows read like the buttons they count.
  const contributeIcon = (label: string) =>
    label.startsWith('Add ')
      ? '/images/plus-small.svg'
      : label === 'Suggest a correction'
        ? '/images/pencil-small.svg'
        : '/images/star-small.svg'
  // Site-wide leaderboards for the Overview tab. The listings total is every
  // page's clicks (same denominator as "Clicks by page"); the position total is
  // only the clicks that carry a slot. Resolve each row's page to its site label
  // (e.g. 'Founders' → 'Founder toolkit') so the page pills read the site's way.
  const overallListings = data.topListingsOverall.map(r => ({
    ...r,
    pageLabel: r.page ? (labelByPage.get(r.page) ?? r.page) : undefined,
  }))
  const overallPositionTotal = data.byPositionOverall.reduce(
    (sum, r) => sum + r.count,
    0
  )

  // When the selected range reaches back further than the stored data (or is
  // unbounded, like All time), say how far back the data actually goes — so a
  // range like "All time" can't quietly read as more history than exists.
  const oldestMs = data.oldestTs ? Date.parse(data.oldestTs) : NaN
  const showCoverage =
    !Number.isNaN(oldestMs) &&
    (range.startMs == null || range.startMs < oldestMs)

  // The tiles over time, for whichever tab is open.
  const tilesFor = (specs: TileSpec[]) =>
    eventTiles(data.trends.frame, range, range.key, data.oldestTs, specs)
  const per = data.trends.frame.unit === 'hour' ? 'hour' : 'day'
  const clickWords = unique
    ? `once per visitor per listing per day (the Unique count)`
    : `every click (the Total count)`
  const siteTiles =
    activeTab === 'pages'
      ? tilesFor([
          {
            key: 'visitors',
            label: 'Visitors',
            unit: 'visitors',
            metric: data.trends.visitors,
            since: PAGE_VIEWS_SINCE,
            what: `Visitors = distinct browsers that viewed a page. One that came on several ${per}s counts once in the tile and on each of those ${per}s in the chart.`,
          },
          {
            key: 'visits',
            label: 'Visits',
            unit: 'visits',
            metric: data.trends.visits,
            since: PAGE_VIEWS_SINCE,
            what: `Visits = a visitor's page views with less than 30 minutes between them, each counted on the ${per} it began.`,
          },
          {
            key: 'views',
            label: 'Page views',
            unit: 'page views',
            metric: data.trends.pageViews,
            since: PAGE_VIEWS_SINCE,
            what: 'Page views = every page viewed.',
          },
          {
            key: 'clicks',
            label: 'Listing clicks',
            unit: 'listing clicks',
            metric: data.trends.listingClicks,
            what: `Listing clicks = clicks on listings across the resource pages, ${clickWords}.`,
          },
        ])
      : []
  const pageLabel =
    labelByPage.get(data.selectedPage ?? '') ?? data.selectedPage
  const pageTiles = onResourceView
    ? tilesFor([
        {
          key: 'visitors',
          label: 'Visitors',
          unit: 'visitors',
          metric: data.pageTrends.visitors,
          since: PAGE_VIEWS_SINCE,
          what: `Visitors = distinct browsers that viewed this page. One that came on several ${per}s counts once in the tile and on each of those ${per}s in the chart.`,
        },
        {
          key: 'views',
          label: 'Page views',
          unit: 'page views',
          metric: data.pageTrends.pageViews,
          since: PAGE_VIEWS_SINCE,
          what: 'Page views = every view of this page.',
        },
        {
          key: 'clicks',
          label: 'Listing clicks',
          unit: 'listing clicks',
          metric: data.pageTrends.listingClicks,
          what: `Listing clicks = clicks on this page's listings from every part of the page, ${clickWords}.`,
        },
        ...(data.filterGroups.length > 0 || data.pageTrends.filterUses.previous
          ? [
              {
                key: 'filters',
                label: 'Filter uses',
                unit: 'filter uses',
                metric: data.pageTrends.filterUses,
                since: FILTERS_SINCE,
                what: 'Filter uses = a filter value turned on, as Filter usage counts them.',
              },
            ]
          : []),
      ])
    : []
  const { frame } = data.trends
  // Conversations per day (or hour), from the log's start times.
  const conversationPoints = frame.starts.map(() => 0)
  for (const t of convStats?.startedAt ?? []) {
    const b = bucketOf(frame, t)
    if (b >= 0) conversationPoints[b]++
  }
  const chatbotTiles =
    activeTab === 'chatbot'
      ? tilesFor([
          ...(convStats?.available
            ? [
                {
                  key: 'conversations',
                  label: 'Conversations',
                  unit: 'conversations',
                  metric: {
                    total: convStats.totalConversations,
                    previous: convBeforeCount,
                    points: conversationPoints,
                    weekly: weeklyOf(frame, conversationPoints),
                  },
                  what: `Conversations = chats started, from the conversation log, each on the ${per} it began.`,
                },
              ]
            : []),
          {
            key: 'opened',
            label: 'Opened the chatbot',
            unit: 'people opened it',
            metric: data.trends.chatbotOpened,
            what: `Opened, Sent a message and Clicked a result count people, as the funnel below does. One who came back on several ${per}s counts once in the tile and on each of those ${per}s in the chart.`,
          },
          {
            key: 'messaged',
            label: 'Sent a message',
            unit: 'people sent one',
            metric: data.trends.chatbotMessaged,
            what: `Sent a message = people who wrote to the chatbot, counted like Opened.`,
          },
          {
            key: 'clicked',
            label: 'Clicked a result',
            unit: 'people clicked one',
            metric: data.trends.chatbotClicked,
            what: `Clicked a result = people who opened a card or link from a reply, counted like Opened.`,
          },
        ])
      : []
  const searchTiles =
    activeTab === 'search'
      ? tilesFor([
          {
            key: 'opened',
            label: 'Opened search',
            unit: 'people opened it',
            metric: data.trends.searchOpened,
            since: SEARCH_SINCE,
            what: `Opened, Typed a search and Clicked a result count people, as the funnel below does. One who came back on several ${per}s counts once in the tile and on each of those ${per}s in the chart.`,
          },
          {
            key: 'typed',
            label: 'Typed a search',
            unit: 'people searched',
            metric: data.trends.searchTyped,
            since: SEARCH_SINCE,
            what: 'Typed a search = people who searched for something, counted like Opened.',
          },
          {
            key: 'clicked',
            label: 'Clicked a result',
            unit: 'people clicked one',
            metric: data.trends.searchClicked,
            since: SEARCH_SINCE,
            what: 'Clicked a result = people who opened a result, counted like Opened.',
          },
        ])
      : []
  const newsletterTiles =
    activeTab === 'newsletters'
      ? [
          ...(subscribers ? subscriberTiles(subscribers, range) : []),
          ...tilesFor([
            {
              key: 'submits',
              label: 'Signup box submits',
              unit: 'submits',
              metric: data.trends.newsletterSubmits,
              since: SIGNUP_BOX_SINCE,
              what: `Signup box submits = the newsletter boxes on the site sent, ${unique ? 'once per visitor per page per day (the Unique count)' : 'every time (the Total count)'}, as Signup box on the site counts them. Not every submit ends in a signup.`,
            },
            {
              key: 'signups',
              label: 'Signed up through the site',
              unit: 'signups',
              metric: data.trends.newsletterSignups,
              since: SITE_SIGNUPS_SINCE,
              what: 'Signed up through the site = submits of the boxes on /events, /training, /funding, their past issues pages, and /newsletter that ActiveCampaign took and sent a link to confirm, as Signups through the site counts them.',
            },
            {
              key: 'confirmed',
              label: 'Confirmed',
              unit: 'confirmed',
              metric: data.trends.newsletterConfirmed,
              since: SITE_SIGNUPS_SINCE,
              what: `Confirmed = readers who pressed the link in that email and landed on aisafety.com/subscribed/events, /subscribed/training or /subscribed/funding, ${unique ? 'once per visitor, and not again when the same link opens a second time within two minutes (the Unique count)' : 'every landing (the Total count)'}, as Signups through the site counts them.`,
            },
            {
              key: 'newsletter-visits',
              label: 'Visits from newsletters',
              unit: 'visits',
              metric: data.trends.newsletterVisits,
              what: 'Visits from newsletters = visits to aisafety.com that began with a link in one of the newsletters, as Visits from the newsletters counts them.',
            },
          ]),
        ]
      : []
  // The feeds' readers day by day: a level, like the subscribers, so it
  // sits beside them.
  const feedReadersTile =
    activeTab === 'newsletters' && feeds
      ? feedTile(feeds.history, range, renderedAt)
      : null
  if (feedReadersTile) {
    const at = newsletterTiles.findIndex(t => !t.key.startsWith('subscribers-'))
    newsletterTiles.splice(
      at < 0 ? newsletterTiles.length : at,
      0,
      feedReadersTile
    )
  }
  // The subscriber figures since the move take a while to work out, so a
  // load that finds them missing or a few hours old has them worked out
  // again after it's sent.
  if (subscribers && historyStale(subscribers.history))
    after(() => refreshSubscriberHistory())

  return (
    <div className={styles.dashboard}>
      <div className={styles.headerRow}>
        <h1 className={admin.pageTitle}>Analytics</h1>
        <div className={styles.meta}>
          {saved ? (
            <>
              <span className={`${styles.badge} ${styles.badgeUpdating}`}>
                Updating
              </span>
              <span
                className={styles.coverage}
                title="This server has just started, so it's reading the latest events. Until it's done you see the figures saved the last time the dashboard was open; they swap for the live ones by themselves."
              >
                figures from {savedAgo(saved.at)}
              </span>
            </>
          ) : (
            <span className={styles.badge}>
              {SOURCE_LABEL[data.source] ?? data.source}
            </span>
          )}
          <span className={styles.total}>
            {data.totalEvents.toLocaleString()} events
          </span>
          {showCoverage && data.oldestTs && (
            <span
              className={styles.coverage}
              title={`The earliest stored event. Tracking launched on 20 June 2026; events before ${formatDay(data.oldestTs)} were deleted by an early 5,000-event storage cap. The cap has been removed, so nothing is deleted anymore.`}
            >
              data since {formatDay(data.oldestTs)}
            </span>
          )}
          <span
            className={styles.coverage}
            title="Day boundaries and times on this page are in UTC, the same for everyone. The rest of the admin shows your own local time."
          >
            times in {DASHBOARD_TZ}
          </span>
          <ExcludeToggle />
        </div>
      </div>

      {data.highTraffic && (
        <div className={styles.trafficWarning}>
          ⚠ Unusually high traffic: {formatMonth(data.highTraffic.month)}{' '}
          already holds {data.highTraffic.count.toLocaleString()} events, more
          than twice all of {formatMonth(data.highTraffic.prevMonth)} (
          {data.highTraffic.prevCount.toLocaleString()}). Check it&apos;s real
          visitors rather than a script flooding the tracker. Nothing is deleted
          either way.
        </div>
      )}

      {/* Keyed by the range, so Back and Forward refill the date boxes. */}
      <DateRangePicker
        key={`${range.key}|${range.from ?? ''}|${range.to ?? ''}`}
        activeKey={range.key}
        from={range.from}
        to={range.to}
        preloadAll={preloadAll}
      />

      {!saved && (
        <RefreshIfStale renderedAt={renderedAt} failed={data.error === true} />
      )}

      <ClickModeToggle
        unique={unique}
        params={sp}
        preload={preloadTo(activeTab)}
      />

      {data.error ? (
        <div className={styles.empty}>
          Couldn&apos;t reach the analytics store just now — try refreshing in a
          moment.
        </div>
      ) : data.totalEvents === 0 ? (
        <div className={styles.empty}>
          No events in this range. Try a wider range, or click a listing on a
          resource page (e.g. /funding) to record one.
        </div>
      ) : (
        <>
          <DashboardTabs
            overview={OVERVIEW_TABS}
            pages={resourceTabs}
            active={activeTab}
            params={sp}
            preloadTo={preloadTo}
          />

          {activeTab === 'orgs' && (
            <OrgView
              org={data.org}
              range={range}
              labelByPage={labelByPage}
              iconByPage={iconByPage}
              newsletter={orgNewsletter}
              admin={{
                query: orgQuery,
                params: sp,
                unique,
                // Keyed by the search, so Back and Forward refill the box
                // with the search the page is showing.
                searchBox: <OrgSearch key={orgQuery} query={orgQuery} />,
                shareBox,
                sharedPages,
                leaveOutLink,
              }}
            />
          )}

          {activeTab === 'chatbot' && (
            <ChatbotView
              trends={chatbotTiles}
              funnel={data.funnel}
              opensByPage={data.chatbot.opensByPage}
              openShareByPage={data.chatbot.openShareByPage}
              siteOpenShare={data.chatbot.siteOpenShare}
              destinations={data.chatbot.destinations}
              repeatUse={data.chatbot.repeatUse}
              conv={convStats}
              themes={themes}
              unique={unique}
            />
          )}

          {activeTab === 'search' && (
            <SearchView
              trends={searchTiles}
              search={data.search}
              index={searchIndex}
              unique={unique}
            />
          )}

          {activeTab === 'newsletters' && (
            <Panel title="Subscribers and signups">
              <TrendChart
                tiles={newsletterTiles}
                label="Newsletter subscribers and signups"
              />
              {canAddExport && <SubstackUpload />}
            </Panel>
          )}

          {activeTab === 'newsletters' && (
            <NewsletterView
              sends={sendStats}
              rangeStartMs={range.startMs}
              signups={
                <>
                  <Panel title="Signup box on the site">
                    <CountTable
                      rows={data.newsletterByPage.map(r => ({
                        ...r,
                        name: labelByPage.get(r.name) ?? r.name,
                      }))}
                      labelHead="Page"
                      countHead="Submits"
                      total={newsletterTotalByPage}
                      shareFor={name => newsletterShare.get(name)}
                      totalShare={data.siteNewsletterShare ?? undefined}
                    />
                    <p className={styles.caption}>
                      Submits of the newsletter email box on /events, /training,
                      and /funding, on the past issues pages
                      (/newsletter/events, /newsletter/training, and
                      /newsletter/funding, listed by their address), and of the
                      several-newsletters form on /newsletter – not every submit
                      ends in a signup (how the ActiveCampaign ones ended is
                      below). % of visitors = the share of the page&apos;s
                      visitors who submitted it; the Total row divides by
                      visitors to the pages with the box combined. Recording
                      since 29 July 2026; the past issues pages since October
                      2026.
                    </p>
                  </Panel>
                  <SignupResultsPanel
                    results={data.newsletterResults}
                    confirmed={data.newsletterConfirmed}
                    labelFor={name => labelByPage.get(name) ?? name}
                  />
                  <NewsletterVisitsPanel
                    visits={data.newsletterVisits}
                    labelFor={name => labelByPage.get(name) ?? name}
                  />
                  <IssueCopiesPanel
                    rows={data.newsletterCopies}
                    unique={unique}
                  />
                  <PastIssuesPanel
                    rows={data.newsletterArchive}
                    feeds={feeds}
                  />
                  <NewslettersPagePanel stats={data.newslettersPage} />
                  <NewsletterLinksPanel
                    rows={data.newsletterLinks}
                    unique={unique}
                  />
                  <CardEditsPanel counts={cardEdits} />
                </>
              }
            />
          )}

          {activeTab === 'correlations' && (
            <Panel title="Shared interests">
              <CorrelationsTable
                rows={data.correlations}
                labelFor={name => labelByPage.get(name) ?? name}
              />
              <p className={styles.caption}>
                Visitors who engaged with both of a pair — visited the page or
                clicked one of its listings, with chatbot and search use as rows
                of their own. Clicks give this history back to 20 June 2026;
                page views count from 15 July 2026, so overlaps get richer as
                views accumulate.
              </p>
            </Panel>
          )}

          {activeTab === 'pages' && (
            <Panel title="Site traffic">
              <TrendChart tiles={siteTiles} label="Site traffic" />
              <div className={`${styles.funnel} margin-top-16px`}>
                <Stat
                  label="New visitors"
                  value={data.visits.newVisitors.toLocaleString()}
                />
                <Stat
                  label="Returning visitors"
                  value={data.visits.returningVisitors.toLocaleString()}
                />
                <Stat
                  label="of visitors were returning"
                  value={pct(
                    data.visits.returningVisitors,
                    data.visits.uniqueVisitors
                  )}
                />
                <Stat
                  label="Analytics opt-outs"
                  value={data.optOuts.off.toLocaleString()}
                />
              </div>
              <p className={styles.caption}>
                First-party numbers, so ad blockers can&apos;t strip them.
                Visitors = distinct browsers; one visitor&apos;s pages more than
                30 minutes apart count as separate visits. Recording since 15
                July 2026. Returning = visitors who&apos;d been to the site
                before this period (any recorded activity counts
                {data.oldestTs && ` – back to ${formatDay(data.oldestTs)}`}) or
                came back for another visit within it; new = their first visit,
                no return yet. A visitor who clears their browser data or
                switches devices looks new again.
                {!data.firstSeenBackfilled &&
                  ' Visitor history is still being backfilled, so returning counts are low for now.'}{' '}
                Opt-outs = browsers that switched analytics off on the privacy
                page and haven&apos;t switched it back on (recording since 16
                July 2026)
                {data.optOuts.on > 0 &&
                  ` – ${data.optOuts.on.toLocaleString()} more switched it back on`}
                .
              </p>
            </Panel>
          )}

          {activeTab === 'pages' && (
            <div className={styles.grid}>
              <Panel title="Visits by page">
                <CountTable
                  rows={data.visits.byPage.map(r => ({
                    ...r,
                    name: labelByPage.get(r.name) ?? r.name,
                  }))}
                  labelHead="Page"
                  countHead={unique ? 'Visitors' : 'Views'}
                  total={data.visits.byPage.reduce((s, r) => s + r.count, 0)}
                  shareFor={name => returningShare.get(name)}
                  shareHead="% returning"
                  totalShare={{
                    name: 'Total',
                    active: data.visits.returningVisitors,
                    visitors: data.visits.uniqueVisitors,
                  }}
                />
                <p className={styles.caption}>
                  First-party page views — ad blockers can&apos;t strip these,
                  unlike Matomo&apos;s. Recording since 15 July 2026. %
                  returning = the share of the page&apos;s visitors who are
                  returning visitors to the site (as defined above) — which
                  pages regulars come back to, and which ones newcomers land on.
                </p>
              </Panel>
              <Panel title="Clicks by page">
                <CountTable
                  rows={data.byPage.map(r => ({
                    ...r,
                    name: labelByPage.get(r.name) ?? r.name,
                  }))}
                  labelHead="Page"
                  total={totalClicks}
                  shareFor={name => clickShare.get(name)}
                  totalShare={data.siteClickShare ?? undefined}
                />
                <p className={styles.caption}>
                  % of visitors = the share of the page&apos;s visitors who
                  clicked at least one listing (always per-visitor, whichever
                  count mode is on); the Total row is the share of all visitors
                  site-wide. Visitor counts began 15 July 2026.
                </p>
              </Panel>
            </div>
          )}

          {onResourceView && (
            <div className={styles.pageSection}>
              {jobsShareBox}
              <Panel title="Over time">
                <TrendChart
                  tiles={pageTiles}
                  label={`${pageLabel ?? 'This page'} over time`}
                />
              </Panel>
              <SourceSplit
                rows={data.bySource}
                active={data.selectedSource}
                params={sp}
                preload={preloadTo(activeTab)}
                label={
                  MAP_PAGES.has(data.selectedPage ?? '')
                    ? 'Clicks by source'
                    : 'Clicks by view'
                }
              />
              <div className={styles.grid}>
                {/* Titles skip the page name — the active tab already says
                    which page these panels describe. */}
                <Panel title="Top listings">
                  <CountTable
                    rows={data.topListings}
                    labelHead="Listing"
                    rankHead="Slot"
                    logoFor={name =>
                      logoByName.get(name) ?? faviconFor(urlByName.get(name))
                    }
                    linkFor={name => urlByName.get(name)}
                    rankFor={name => positionByName.get(name)}
                    shareFor={name => listingShare.get(name)}
                    total={listingTotal}
                    totalShare={data.anyListingShare ?? undefined}
                  />
                  <p className={styles.caption}>
                    Slot = where each listing was clicked this period (F1/F2 =
                    featured cards). Blank for clicks logged before slot
                    tracking. % of visitors = the share of this page&apos;s
                    visitors who clicked the listing; the Total row is the share
                    who clicked any listing at all (each visitor counted once,
                    so it&apos;s less than the column&apos;s sum).
                  </p>
                </Panel>
                <Panel title="Clicks by position">
                  <CountTable
                    rows={data.byPosition}
                    labelHead="Slot"
                    shareFor={name => positionShare.get(name)}
                    total={positionTotal}
                  />
                  <p className={styles.caption}>
                    Every click on this page counted at the slot it happened in
                    — so a busy top slot shows up even as different listings
                    rotate through it.
                  </p>
                </Panel>
              </div>
              {data.selectedPage === 'Map' && (
                <div className={styles.grid}>
                  <Panel title="Clicks by area">
                    <CountTable
                      rows={areaData.clicks}
                      labelHead="Area"
                      total={areaClickTotal}
                    />
                    <p className={styles.caption}>
                      An area is the listing&apos;s first category. Clicks
                      recorded before areas were tracked are matched against the
                      current map listings – anything that no longer matches
                      shows as No longer listed.
                    </p>
                  </Panel>
                  <Panel title="Hovers by area">
                    <CountTable
                      rows={areaData.hovers}
                      labelHead="Area"
                      countHead="Hovers"
                      total={areaHoverTotal}
                    />
                  </Panel>
                </div>
              )}
              {data.selectedPage != null &&
                MAP_PAGES.has(data.selectedPage) && (
                  <div className={styles.grid}>
                    <Panel title="Top hovered listings">
                      {/* Stays 'Hovers' in unique mode: the count is one per
                          visitor per DAY summed across days, not distinct
                          users — same reason the sibling table keeps 'Clicks'.
                          'Users' is reserved for true per-visitor tallies. */}
                      <CountTable
                        rows={data.topHovered}
                        labelHead="Listing"
                        countHead="Hovers"
                        logoFor={name =>
                          logoByName.get(name) ??
                          faviconFor(hoverUrlByName.get(name))
                        }
                        linkFor={name => hoverUrlByName.get(name)}
                        shareFor={name => hoverShare.get(name)}
                        total={hoverTotal}
                        totalShare={data.anyHoverShare ?? undefined}
                      />
                      <p className={styles.caption}>
                        A hover is recorded when the cursor rests on a map
                        listing for half a second – or, on a phone, when a tap
                        opens its tooltip. The Total row&apos;s % of visitors is
                        the share who hovered any listing at all (each visitor
                        counted once).
                      </p>
                    </Panel>
                    <Panel title="Cards section">
                      <div className={styles.funnel}>
                        <Stat
                          label="Reached the cards"
                          value={data.cardsViews.toLocaleString()}
                        />
                        <Stat
                          label="% of visitors"
                          value={shareCell(data.cardsViewShare ?? undefined)}
                        />
                        <Stat
                          label="Button clicks"
                          value={data.cardsButtonClicks.toLocaleString()}
                        />
                        <Stat
                          label="% of visitors"
                          value={shareCell(data.cardsButtonShare ?? undefined)}
                        />
                      </div>
                      <p className={styles.caption}>
                        Reached the cards = page loads where the top of the
                        listings below the map scrolled into the upper half of
                        the screen – via the button, by hand, or by arriving on
                        a link straight to them. Button clicks = clicks on the
                        button on the map that scrolls there. Both follow the
                        count mode above; each % of visitors is the share of the
                        page&apos;s visitors who did it at all (each visitor
                        counted once). Recording since 2 September 2026.
                      </p>
                    </Panel>
                  </div>
                )}
              {data.selectedPage === 'Map' && (
                <MapSearchPanels
                  data={data.mapSearch}
                  unique={unique}
                  logoFor={name =>
                    logoByName.get(name) ?? faviconFor(pickUrlByName.get(name))
                  }
                  linkFor={name => pickUrlByName.get(name)}
                />
              )}
              {data.filterGroups.length > 0 && (
                <div className={styles.grid}>
                  <Panel title="Filter usage">
                    <CountTable
                      rows={data.filterGroups}
                      labelHead="Filter"
                      countHead="Uses"
                      shareFor={name => filterGroupShare.get(name)}
                      total={filterTotal}
                      totalShare={data.anyFilterShare ?? undefined}
                    />
                    <p className={styles.caption}>
                      A use = a visitor turning a filter value on; switching a
                      value off isn&apos;t counted.{' '}
                      {data.filterUsers.toLocaleString()} visitor
                      {data.filterUsers === 1 ? '' : 's'} filtered this page
                      this period; the Total row&apos;s % of visitors is the
                      share who used any filter at all (each visitor counted
                      once). Recording since 29 July 2026.
                    </p>
                  </Panel>
                  <Panel title="Filter values">
                    <CountTable
                      rows={data.filterValues}
                      labelHead="Filter: value"
                      countHead="Uses"
                      shareFor={name => filterValueShare.get(name)}
                      total={filterTotal}
                      totalShare={data.anyFilterShare ?? undefined}
                    />
                  </Panel>
                </div>
              )}
              {(data.contributeButtons.length > 0 ||
                data.airtableViews > 0) && (
                <div className={styles.grid}>
                  <Panel title="Contribute buttons">
                    <CountTable
                      rows={data.contributeButtons}
                      labelHead="Button"
                      logoFor={contributeIcon}
                      shareFor={name => contributeButtonShare.get(name)}
                      total={contributeTotal}
                      totalShare={data.anyContributeShare ?? undefined}
                    />
                    <p className={styles.caption}>
                      Clicks on this page&apos;s add and correction forms; the
                      Total row&apos;s % of visitors is the share who clicked
                      any of them (each visitor counted once). Recording since
                      29 July 2026.
                    </p>
                  </Panel>
                  <Panel title="View data in Airtable">
                    <div className={styles.funnel}>
                      <Stat
                        label="Card clicks"
                        value={data.airtableViews.toLocaleString()}
                      />
                      <Stat
                        label="% of visitors"
                        value={shareCell(airtablePageShare)}
                      />
                    </div>
                    <p className={styles.caption}>
                      Visitors opening this page&apos;s raw data in Airtable. %
                      of visitors = the share of the page&apos;s visitors who
                      clicked the card. Recording since 29 July 2026.
                    </p>
                  </Panel>
                </div>
              )}
            </div>
          )}

          {activeTab === 'pages' && (
            <div className={styles.grid}>
              <Panel title="Most clicked listings">
                <OverallListingsTable
                  rows={overallListings}
                  total={totalClicks}
                />
                <p className={styles.caption}>
                  Every listing across all resource pages, ranked by clicks this
                  period. Open a page&apos;s tab for its own breakdown.
                </p>
              </Panel>
              <Panel title="Clicks by position">
                <CountTable
                  rows={data.byPositionOverall}
                  labelHead="Slot"
                  total={overallPositionTotal}
                />
                <p className={styles.caption}>
                  Every click across all pages counted at the slot it happened
                  in (F1/F2 = featured cards) — how much attention each slot
                  draws site-wide.
                </p>
              </Panel>
              <Panel title="Filter use by page">
                {data.filtersByPage.length === 0 ? (
                  <p className={styles.dim}>No data yet.</p>
                ) : (
                  <SortableTable
                    columns={[
                      { label: 'Page', sort: 'text' },
                      {
                        label: 'Uses',
                        className: styles.numCol,
                        sort: 'number',
                      },
                      {
                        label: 'Filtered',
                        className: styles.numCol,
                        sort: 'number',
                      },
                      {
                        label: '% of visitors',
                        className: styles.pctCol,
                        sort: 'number',
                      },
                    ]}
                    values={data.filtersByPage.map(r => {
                      const share = filterShareByPage.get(r.name)
                      return [
                        labelByPage.get(r.name) ?? r.name,
                        r.count,
                        share?.active ?? 0,
                        share && share.visitors > 0
                          ? share.active / share.visitors
                          : null,
                      ]
                    })}
                  >
                    {data.filtersByPage.map(r => {
                      const share = filterShareByPage.get(r.name)
                      return (
                        <tr key={r.name}>
                          <td>{labelByPage.get(r.name) ?? r.name}</td>
                          <td className={styles.numCol}>
                            {r.count.toLocaleString()}
                          </td>
                          <td className={styles.numCol}>
                            {(share?.active ?? 0).toLocaleString()}
                          </td>
                          <td className={styles.pctCol}>{shareCell(share)}</td>
                        </tr>
                      )
                    })}
                  </SortableTable>
                )}
                <p className={styles.caption}>
                  A use = a visitor turning a filter value on. Filtered =
                  distinct visitors who used at least one filter; % is their
                  share of the page&apos;s visitors (always per-visitor,
                  whichever count mode is on). Open a page&apos;s tab for its
                  filter breakdown. Recording since 29 July 2026.
                </p>
              </Panel>
              <Panel title="Contribute clicks by page">
                <CountTable
                  rows={data.contributeByPage.map(r => ({
                    ...r,
                    name: labelByPage.get(r.name) ?? r.name,
                  }))}
                  labelHead="Page"
                  total={contributeTotalByPage}
                  shareFor={name => contributeShare.get(name)}
                  totalShare={data.siteContributeShare ?? undefined}
                />
                <p className={styles.caption}>
                  Clicks on the &quot;Add a …&quot; and &quot;Suggest a
                  correction&quot; forms. % of visitors = the share of the
                  page&apos;s visitors who clicked one; the Total row is the
                  share of all visitors site-wide. Open a page&apos;s tab for
                  its per-button split. Recording since 29 July 2026.
                </p>
              </Panel>
              <Panel title="Airtable views by page">
                <CountTable
                  rows={data.airtableByPage.map(r => ({
                    ...r,
                    name: labelByPage.get(r.name) ?? r.name,
                  }))}
                  labelHead="Page"
                  total={airtableTotalByPage}
                  shareFor={name => airtableShare.get(name)}
                  totalShare={data.siteAirtableShare ?? undefined}
                />
                <p className={styles.caption}>
                  Clicks on the &quot;View data in Airtable&quot; cards. % of
                  visitors = the share of the page&apos;s visitors who clicked
                  one; the Total row is the share of all visitors site-wide.
                  Recording since 29 July 2026.
                </p>
              </Panel>
              <Panel title="Newsletter signups by page">
                <CountTable
                  rows={data.newsletterByPage.map(r => ({
                    ...r,
                    name: labelByPage.get(r.name) ?? r.name,
                  }))}
                  labelHead="Page"
                  countHead="Submits"
                  total={newsletterTotalByPage}
                  shareFor={name => newsletterShare.get(name)}
                  totalShare={data.siteNewsletterShare ?? undefined}
                />
                <p className={styles.caption}>
                  Submits of the newsletter email box on /events, /training, and
                  /funding, on the past issues pages (/newsletter/events,
                  /newsletter/training, and /newsletter/funding), and of the
                  several-newsletters form on /newsletter – not every submit
                  ends in a signup (the Newsletters tab shows how the
                  ActiveCampaign ones ended). % of visitors = the share of the
                  page&apos;s visitors who submitted it; the Total row divides
                  by visitors to the pages with the box combined, since only
                  they have it. Recording since 29 July 2026; the past issues
                  pages since October 2026.
                </p>
              </Panel>
              <Panel title="Footer clicks">
                <CountTable
                  rows={data.footerClicks}
                  labelHead="Link"
                  total={footerTotal}
                />
                <p className={styles.caption}>
                  The footer&apos;s link columns – &quot;Help us out&quot;,
                  &quot;Newsletters&quot;, and &quot;For press and
                  developers&quot;. Recording since 29 July 2026.
                </p>
              </Panel>
              <Panel title="Press page">
                <CountTable
                  rows={data.press.byAction}
                  labelHead="Action"
                  total={pressTotal}
                  shareFor={name => pressActionShare.get(name)}
                  totalShare={data.press.anyShare}
                />
                {data.press.byItem.length > 0 && (
                  <CountTable
                    rows={data.press.byItem}
                    labelHead="Item"
                    total={pressTotal}
                  />
                )}
                <p className={styles.caption}>
                  Clicks on /media. Copy = a boilerplate block copied, Download
                  = a logo, screenshot, or the press kit, Contact = the press
                  email link, Jump = one of the two buttons at the top that
                  glide down the page. % of visitors = the share of the
                  page&apos;s visitors who did it. Recording since 19 September
                  2026.
                </p>
              </Panel>
              <Panel title="+N menu opens">
                <CountTable
                  rows={data.navOverflowOpens}
                  labelHead="Method"
                  countHead={unique ? 'Users' : 'Opens'}
                  total={navOpenTotal}
                  shareFor={name => navOpenShare.get(name)}
                  totalShare={data.anyNavOverflowOpenShare}
                />
                <p className={styles.caption}>
                  The +N pill at the end of the global nav, which holds the
                  pages that don&apos;t fit the bar. Hover = mouse or trackpad,
                  tap = touch screens. % of visitors = the share of all visitors
                  who opened it that way at least once; the Total row is the
                  share who opened it at all. Recording since 7 September 2026.
                </p>
              </Panel>
            </div>
          )}

          {activeTab === 'pages' && (
            <Panel title="Recent activity">
              {data.recent.length === 0 ? (
                <p className={styles.dim}>No recent events.</p>
              ) : (
                <ul className={styles.recent}>
                  {data.recent.map((e, i) => (
                    <li key={i} className={styles.recentItem}>
                      <span className={styles.recentTime}>
                        {formatTime(e.ts)}
                      </span>
                      {pillFor(e) && (
                        <span className={styles.pill}>{pillFor(e)}</span>
                      )}
                      <Logo
                        src={
                          (e.listingId
                            ? logoById.get(e.listingId)
                            : undefined) ?? faviconFor(e.url)
                        }
                      />
                      <span className={styles.recentLabel}>{labelFor(e)}</span>
                      {e.url && e.url !== '#' && (
                        <a
                          className={styles.recentUrl}
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {prettyUrl(e.url)}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  )
}

/** Switches the click tables between unique counts (one per visitor per listing
 *  per day) and total counts. Unique is the default, so its link drops the param
 *  for a clean url; both links preserve the rest of the query. The mode not
 *  showing is preloaded, like the tabs (PreloadLink). */
function ClickModeToggle({
  unique,
  params,
  preload,
}: {
  unique: boolean
  params: SearchParams
  /** How the mode not showing preloads. */
  preload: Preload
}) {
  const base = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k === 'clicks' || v == null) continue
    base.set(k, Array.isArray(v) ? (v[0] ?? '') : v)
  }
  const uniqueQ = base.toString()
  const totalParams = new URLSearchParams(base)
  totalParams.set('clicks', 'total')
  return (
    <div className={styles.clickToggle}>
      <span className={styles.clickToggleLabel}>Count</span>
      <PreloadLink
        href={uniqueQ ? `?${uniqueQ}` : '?'}
        scroll={false}
        preload={unique ? 'off' : preload}
        className={`${styles.clickToggleBtn}${
          unique ? ` ${styles.clickToggleBtnActive}` : ''
        }`}
      >
        Unique
        <PendingMark />
      </PreloadLink>
      <PreloadLink
        href={`?${totalParams.toString()}`}
        scroll={false}
        preload={unique ? preload : 'off'}
        className={`${styles.clickToggleBtn}${
          !unique ? ` ${styles.clickToggleBtnActive}` : ''
        }`}
      >
        Total
        <PendingMark />
      </PreloadLink>
    </div>
  )
}

/** For pages with a map, shows how the selected page's clicks split between the
 *  map and the cards. Each split is a link that filters the listing panels below
 *  to that source; "Total" clears the filter. Renders nothing for pages without
 *  a map. The splits not showing are preloaded, like the tabs (PreloadLink). */
function SourceSplit({
  rows,
  active,
  params,
  preload,
  label,
}: {
  rows: Counted[]
  active: string | null
  params: SearchParams
  /** How the splits not showing preload. */
  preload: Preload
  /** Heading for the pill row — 'Clicks by source' on map pages (map vs
   *  cards), 'Clicks by view' on pages with a view toggle. */
  label: string
}) {
  if (rows.length === 0) return null
  const total = rows.reduce((sum, r) => sum + r.count, 0)
  const hasUntracked = rows.some(r => r.name === 'Untracked')
  // Preserve every other query param; only the `source` filter is swapped.
  const base = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k === 'source' || v == null) continue
    base.set(k, Array.isArray(v) ? (v[0] ?? '') : v)
  }
  const totalHref = base.toString() ? `?${base.toString()}` : '?'
  return (
    <div className={styles.sourceSplitWrap}>
      <div className={styles.sourceSplit}>
        <span className={styles.sourceSplitLabel}>{label}</span>
        {rows.length > 1 && (
          <PreloadLink
            href={totalHref}
            scroll={false}
            preload={active == null ? 'off' : preload}
            className={`${styles.sourceStat} ${styles.sourceStatLink}${
              active == null ? ` ${styles.sourceStatActive}` : ''
            }`}
          >
            <span className={styles.sourceStatName}>Total</span>
            <span className={styles.sourceStatCount}>
              {total.toLocaleString()}
            </span>
            <PendingMark />
          </PreloadLink>
        )}
        {rows.map(r => {
          const key = sourceSlug(r.name)
          const q = new URLSearchParams(base)
          q.set('source', key)
          return (
            <PreloadLink
              key={r.name}
              href={`?${q.toString()}`}
              scroll={false}
              preload={active === key ? 'off' : preload}
              className={`${styles.sourceStat} ${styles.sourceStatLink}${
                active === key ? ` ${styles.sourceStatActive}` : ''
              }`}
            >
              <span className={styles.sourceStatName}>{r.name}</span>
              <span className={styles.sourceStatCount}>
                {r.count.toLocaleString()}
              </span>
              {total > 0 && (
                <span className={styles.sourceStatPct}>
                  {pct1(r.count, total)}
                </span>
              )}
              <PendingMark />
            </PreloadLink>
          )
        })}
      </div>
      {hasUntracked && (
        <p className={styles.caption}>
          Untracked = clicks logged before this split was recorded; they age out
          as the date range moves forward.
        </p>
      )}
    </div>
  )
}

/** Tabs that pick which resource page the listing panels drill into. Each tab
 *  preserves the current date range and swaps only the `page` query param. */
/** The dashboard's top tab bar: the overview tabs on one row, then a row with
 *  one tab per resource page. Each tab swaps the `tab` query param (and drops
 *  any active source filter) while preserving the date range and count mode.
 *  Resource tabs show the site's page name and nav icon. The other tabs are
 *  preloaded in the background (Next keeps a preload for five minutes), so a
 *  click shows one at once instead of waiting on the server; the store shares
 *  its site-wide figures between them, so this is cheap. `preloadTo` says
 *  which preload straight away and which on hover. RefreshIfStale freshens a
 *  tab whose preload has aged. */
function DashboardTabs({
  overview,
  pages,
  active,
  params,
  preloadTo,
}: {
  overview: { key: string; label: string }[]
  pages: { key: string; label: string; icon?: string }[]
  active: string
  params: SearchParams
  /** How the link to a tab preloads. */
  preloadTo: (tab: string) => Preload
}) {
  // Preserve everything except the tab itself and the per-page source filter
  // (which is meaningless once you switch tabs); `page` is the old param name.
  const base = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k === 'tab' || k === 'source' || k === 'page' || v == null) continue
    base.set(k, Array.isArray(v) ? (v[0] ?? '') : v)
  }
  const hrefFor = (key: string) => {
    const q = new URLSearchParams(base)
    q.set('tab', key)
    return `?${q.toString()}`
  }
  const tabClass = (key: string) =>
    `${styles.pageTab}${key === active ? ` ${styles.pageTabActive}` : ''}`
  return (
    <div className={styles.pageTabs}>
      <div className={styles.tabRow}>
        {overview.map(t => (
          <PreloadLink
            key={t.key}
            href={hrefFor(t.key)}
            scroll={false}
            preload={t.key === active ? 'off' : preloadTo(t.key)}
            className={tabClass(t.key)}
          >
            {t.label}
            <PendingMark />
          </PreloadLink>
        ))}
      </div>
      <div className={styles.tabRow}>
        {pages.map(t => (
          <PreloadLink
            key={t.key}
            href={hrefFor(t.key)}
            scroll={false}
            preload={t.key === active ? 'off' : preloadTo(t.key)}
            className={tabClass(t.key)}
          >
            {t.icon && (
              <span className={styles.pageTabIcon}>
                <Icon
                  className="color-teal-800"
                  src={`/images/icons/${t.icon}`}
                  size={12}
                />
              </span>
            )}
            {t.label}
            <PendingMark />
          </PreloadLink>
        ))}
      </div>
    </div>
  )
}

/** Each newsletter's feed readers on each day the range covers (feedDays,
 *  for the Feed readers tile), and yesterday and so far today (UTC, for the
 *  Past issues and feeds table), in one read; null when Upstash couldn't be
 *  read. */
async function readFeeds(range: DateRange): Promise<{
  history: FeedReaders[]
  yesterday: FeedReaders[]
  today: FeedReaders[]
} | null> {
  const now = Date.now()
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const yesterday = day(now - 86_400_000)
  const today = day(now)
  const days = feedDays(range, now)
  try {
    const all = await readFeedHistory([...new Set([...days, yesterday, today])])
    const wanted = new Set(days)
    return {
      history: all.filter(f => wanted.has(f.day)),
      yesterday: all.filter(f => f.day === yesterday),
      today: all.filter(f => f.day === today),
    }
  } catch (err) {
    console.warn(
      `[analytics] feed readers unavailable: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

/** /newsletter: visits, the settings readers open from the "Manage
 *  subscriptions" link in an issue, and which newsletters they added or
 *  dropped there. Its signups are in "How the signups went" under their
 *  own page row. */
function NewslettersPagePanel({ stats }: { stats: NewslettersPageStats }) {
  const summary = [
    { name: 'Visits', count: stats.views },
    {
      name: 'Opened from an email’s Manage subscriptions link',
      count: stats.opened,
    },
    {
      name: 'Links that didn’t work (old or broken key)',
      count: stats.brokenLinks,
    },
    {
      name: 'Couldn’t load (ActiveCampaign or connection)',
      count: stats.openFailures,
    },
    { name: 'Saved changes', count: stats.saves },
    { name: 'Saves that failed', count: stats.saveFailures },
  ].filter((r, i) => i < 2 || i === 4 || r.count > 0)
  const any = summary.some(r => r.count > 0) || stats.rows.length > 0
  return (
    <Panel title="Newsletters page">
      {!any ? (
        <p className={styles.dim}>No visits to /newsletter in this range.</p>
      ) : (
        <>
          <CountTable rows={summary} labelHead="What" countHead="Count" />
          {stats.rows.length > 0 && (
            <SortableTable
              columns={[
                { label: 'Newsletter', sort: 'text' },
                {
                  label: 'Added in settings',
                  className: styles.numCol,
                  sort: 'number',
                },
                {
                  label: 'Dropped in settings',
                  className: styles.numCol,
                  sort: 'number',
                },
                {
                  label: 'Clicks to its page',
                  className: styles.numCol,
                  sort: 'number',
                },
              ]}
              values={stats.rows.map(r => [
                r.name,
                r.added,
                r.dropped,
                r.clicks,
              ])}
            >
              {stats.rows.map(r => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className={styles.numCol}>{r.added.toLocaleString()}</td>
                  <td className={styles.numCol}>
                    {r.dropped.toLocaleString()}
                  </td>
                  <td className={styles.numCol}>{r.clicks.toLocaleString()}</td>
                </tr>
              ))}
            </SortableTable>
          )}
        </>
      )}
      <p className={styles.caption}>
        The page that lists every newsletter (/newsletter), where visitors sign
        up to several at once (those signups are under its own row in the signup
        results above) and readers change theirs from the Manage subscriptions
        link at the bottom of each issue. Clicks to its page are clicks through
        to the newsletter&apos;s past issues page (for Updates, to its
        Substack). Recording since the page went live in October 2026.
      </p>
    </Panel>
  )
}

/** The Newsletters tab's count of cards taken out of drafts on
 *  /admin/newsletter, and put back. */
function CardEditsPanel({ counts }: { counts: CardEditCounts | null }) {
  return (
    <Panel title="Cards removed from drafts">
      {counts === null ? (
        <p className={styles.dim}>
          Couldn&apos;t read the counts just now — try refreshing in a moment.
        </p>
      ) : (
        <CountTable
          rows={[
            { name: 'Removed', count: counts.remove },
            {
              name: 'Put back with Undo, right after removing',
              count: counts['put-back-undo'],
            },
            {
              name: 'Put back later, from the list of removed cards',
              count: counts['put-back'],
            },
          ]}
          labelHead="What"
          countHead="Count"
        />
      )}
      <p className={styles.caption}>
        Cards taken out of a newsletter draft with the trash button on
        /admin/newsletter, and how many were put back, test lists included.
        Counted per day (UTC), since Put back arrived on 29 October 2026.
      </p>
    </Panel>
  )
}

/** The Newsletters tab's newsletter pages (/newsletter/events, /training,
 *  /funding) and feeds: the pages' views and clicks in the range, and the
 *  feeds' readers yesterday and today. */
function PastIssuesPanel({
  rows,
  feeds,
}: {
  rows: NewsletterArchiveRow[]
  feeds: { yesterday: FeedReaders[]; today: FeedReaders[] } | null
}) {
  const names = { events: 'Events', training: 'Training', funding: 'Funding' }
  const readers = (list: FeedReaders[], name: string) => {
    const r = list.find(f => names[f.newsletter] === name)
    return r ? r.services + r.direct : 0
  }
  // Every newsletter with page views, clicks or feed readers.
  const shown = [
    ...new Set([
      ...rows.map(r => r.name),
      ...(feeds
        ? [...feeds.yesterday, ...feeds.today]
            .filter(f => f.services + f.direct > 0)
            .map(f => names[f.newsletter])
        : []),
    ]),
  ]
  const rowFor = (name: string) =>
    rows.find(r => r.name === name) ?? {
      name,
      views: 0,
      issueClicks: 0,
      feedClicks: 0,
      substackClicks: 0,
      resourceClicks: 0,
    }
  const feedCell = (list: FeedReaders[] | undefined, name: string) =>
    list ? readers(list, name).toLocaleString() : '—'
  return (
    <Panel title="Past issues and feeds">
      {shown.length === 0 ? (
        <p className={styles.dim}>
          No views of the past issues pages and no feed readers in this range.
        </p>
      ) : (
        <SortableTable
          columns={[
            { label: 'Newsletter', sort: 'text' },
            { label: 'Page views', className: styles.numCol, sort: 'number' },
            { label: 'To an issue', className: styles.numCol, sort: 'number' },
            { label: 'To the feed', className: styles.numCol, sort: 'number' },
            { label: 'To Substack', className: styles.numCol, sort: 'number' },
            {
              label: 'To resource page',
              className: styles.numCol,
              sort: 'number',
            },
            {
              label: 'Feed readers yesterday',
              className: styles.numCol,
              sort: 'number',
            },
            {
              label: 'Today so far',
              className: styles.numCol,
              sort: 'number',
            },
          ]}
          values={shown.map(name => {
            const r = rowFor(name)
            return [
              name,
              r.views,
              r.issueClicks,
              r.feedClicks,
              r.substackClicks,
              r.resourceClicks,
              feeds ? readers(feeds.yesterday, name) : null,
              feeds ? readers(feeds.today, name) : null,
            ]
          })}
        >
          {shown.map(name => {
            const r = rowFor(name)
            return (
              <tr key={name}>
                <td>{name}</td>
                <td className={styles.numCol}>{r.views.toLocaleString()}</td>
                <td className={styles.numCol}>
                  {r.issueClicks.toLocaleString()}
                </td>
                <td className={styles.numCol}>
                  {r.feedClicks.toLocaleString()}
                </td>
                <td className={styles.numCol}>
                  {r.substackClicks.toLocaleString()}
                </td>
                <td className={styles.numCol}>
                  {r.resourceClicks.toLocaleString()}
                </td>
                <td className={styles.numCol}>
                  {feedCell(feeds?.yesterday, name)}
                </td>
                <td className={styles.numCol}>
                  {feedCell(feeds?.today, name)}
                </td>
              </tr>
            )
          })}
        </SortableTable>
      )}
      <p className={styles.caption}>
        Each newsletter&apos;s page (aisafety.com/newsletter/events,
        /newsletter/training, /newsletter/funding) lists its issues sent since
        the move to ActiveCampaign (Events and Training 8 October 2026, Funding
        21 October 2026), with an RSS feed (…/feed). Page views and clicks
        follow the range; a click to an issue opens its web version, and
        &ldquo;To resource page&rdquo; counts the link on to /events, /training,
        or /funding (since 23 October 2026). Feed readers aren&apos;t for the
        range: they&apos;re the people following the feed on one day (UTC). A
        feed service such as Feedly fetches once for all its users and reports
        how many; a reader app fetches for one person. Opening the feed in a
        browser, search engines, AI assistants and scripts aren&apos;t counted.
        Recording since October 2026.
      </p>
    </Panel>
  )
}

/** Rows a "where they went" table shows. */
const VISIT_TOP = 10

/** The Newsletters tab's visits from links in the newsletters: per
 *  newsletter, how many visits and what came of them, then the pages they
 *  saw, the listings they clicked and the issues that sent them. */
function NewsletterVisitsPanel({
  visits,
  labelFor,
}: {
  visits: NewsletterVisits
  labelFor: (name: string) => string
}) {
  const rows = visits.byNewsletter
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((n, r) => n + pick(r), 0)
  const total = {
    visits: sum(r => r.visits),
    morePages: sum(r => r.morePages),
    clicked: sum(r => r.clicked),
    listingClicks: sum(r => r.listingClicks),
  }
  return (
    <Panel title="Visits from the newsletters">
      {rows.length === 0 ? (
        <p className={styles.dim}>
          No visits from links in the newsletters in this range.
        </p>
      ) : (
        <>
          <SortableTable
            columns={[
              { label: 'Newsletter', sort: 'text' },
              { label: 'Visits', className: styles.numCol, sort: 'number' },
              { label: 'Visitors', className: styles.numCol, sort: 'number' },
              {
                label: 'Saw another page',
                className: styles.pctCol,
                sort: 'number',
              },
              {
                label: 'Clicked a listing',
                className: styles.pctCol,
                sort: 'number',
              },
              {
                label: 'Listing clicks',
                className: styles.numCol,
                sort: 'number',
              },
            ]}
            values={rows.map(r => [
              r.name,
              r.visits,
              r.visitors,
              r.visits > 0 ? r.morePages / r.visits : null,
              r.visits > 0 ? r.clicked / r.visits : null,
              r.listingClicks,
            ])}
            foot={
              rows.length > 1 ? (
                <tr className={styles.totalRow}>
                  <td className={styles.totalLabel}>Total</td>
                  <td className={styles.numCol}>
                    {total.visits.toLocaleString()}
                  </td>
                  <td className={styles.numCol} />
                  <td className={styles.pctCol}>
                    {pct(total.morePages, total.visits)}
                  </td>
                  <td className={styles.pctCol}>
                    {pct(total.clicked, total.visits)}
                  </td>
                  <td className={styles.numCol}>
                    {total.listingClicks.toLocaleString()}
                  </td>
                </tr>
              ) : undefined
            }
          >
            {rows.map(r => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className={styles.numCol}>{r.visits.toLocaleString()}</td>
                <td className={styles.numCol}>{r.visitors.toLocaleString()}</td>
                <td className={styles.pctCol}>{pct(r.morePages, r.visits)}</td>
                <td className={styles.pctCol}>{pct(r.clicked, r.visits)}</td>
                <td className={styles.numCol}>
                  {r.listingClicks.toLocaleString()}
                </td>
              </tr>
            ))}
          </SortableTable>
          <div className={styles.grid}>
            <CountTable
              rows={visits.pages
                .slice(0, VISIT_TOP)
                .map(r => ({ ...r, name: labelFor(r.name) }))}
              labelHead="Pages they saw"
              countHead="Views"
            />
            <CountTable
              rows={visits.listings.slice(0, VISIT_TOP)}
              labelHead="Listings they clicked"
            />
          </div>
          <CountTable
            rows={visits.issues.slice(0, VISIT_TOP)}
            labelHead="Issue (its links’ utm_campaign)"
            countHead="Visits"
          />
        </>
      )}
      <p className={styles.caption}>
        Every link to aisafety.com in the newsletters carries tags saying which
        newsletter and issue it&apos;s from (utm_source=events-newsletter,
        utm_campaign=events-2026-week-42), and a page view records the address
        it was on. A visit from a newsletter starts with a page view carrying
        those tags and lasts until the visitor has been away for 30 minutes;
        reloading the page within it isn&apos;t a new visit. Events &amp;
        Training = the two together on Substack, before 8 October 2026; Funding
        sent from Substack with the same tags until it moved on 21 October 2026.
        Saw another page = the share of visits that went on to another page of
        the site; Clicked a listing = the share with a click on a listing. Every
        visit counts, whatever the count mode. Links to other sites in the
        emails go straight there and are under Most-clicked links. A visitor
        whose browser blocks the site&apos;s tracking isn&apos;t counted.
      </p>
    </Panel>
  )
}

/** The Newsletters tab's views of each issue's web and text versions on
 *  aisafety.com (/newsletter/<key>/<issue>, …/text). */
function IssueCopiesPanel({
  rows,
  unique,
}: {
  rows: NewsletterCopyRow[]
  unique: boolean
}) {
  // "Events · Week 41, 2026" → "Week 41, 2026"; the address if it isn't one.
  const issue = (r: NewsletterCopyRow) =>
    issueName(r.newsletter.toLowerCase(), r.issue)?.replace(/^[^·]+· /, '') ??
    r.issue
  const web = rows.reduce((n, r) => n + r.web, 0)
  const text = rows.reduce((n, r) => n + r.text, 0)
  return (
    <Panel title="Issues read on aisafety.com">
      {rows.length === 0 ? (
        <p className={styles.dim}>
          No views of the issues&apos; web or text versions in this range.
        </p>
      ) : (
        <SortableTable
          columns={[
            { label: 'Issue', sort: 'text' },
            { label: 'Newsletter', sort: 'text' },
            { label: 'Web version', className: styles.numCol, sort: 'number' },
            {
              label: 'Text version',
              className: styles.numCol,
              sort: 'number',
            },
          ]}
          values={rows.map(r => [issue(r), r.newsletter, r.web, r.text])}
          foot={
            <tr className={styles.totalRow}>
              <td className={styles.totalLabel}>Total</td>
              <td />
              <td className={styles.numCol}>{web.toLocaleString()}</td>
              <td className={styles.numCol}>{text.toLocaleString()}</td>
            </tr>
          }
        >
          {rows.map(r => (
            <tr key={`${r.newsletter}|${r.issue}`}>
              <td>{issue(r)}</td>
              <td>{r.newsletter}</td>
              <td className={styles.numCol}>{r.web.toLocaleString()}</td>
              <td className={styles.numCol}>{r.text.toLocaleString()}</td>
            </tr>
          ))}
        </SortableTable>
      )}
      <p className={styles.caption}>
        Views of each issue&apos;s web version (the email on its own page,
        aisafety.com/newsletter/events/week-41-2026, opened from &quot;View in
        browser&quot; or the past issues page) and its text version (…/text),{' '}
        {unique
          ? 'once per reader per issue per day (the Unique count)'
          : 'every load (the Total count)'}
        . Those pages run none of the site&apos;s scripts, so each view is
        counted by the server when the page loads a one-pixel image; a reader is
        told apart only within a day, by a hash of their network address and
        browser that changes daily. Link checkers, bots and anyone signed in to
        the admin aren&apos;t counted. Recording since October 2026.
      </p>
    </Panel>
  )
}

/** The Newsletters tab's other ways to the newsletters on the site: the
 *  signup box's card link from when /funding's box handed off to Substack
 *  (before the Funding move), and the footer's Newsletters column. */
function NewsletterLinksPanel({
  rows,
  unique,
}: {
  rows: NewsletterLinkRow[]
  unique: boolean
}) {
  const total = rows.reduce((n, r) => n + r.clicks, 0)
  return (
    <Panel title="Other ways to the newsletters">
      {rows.length === 0 ? (
        <p className={styles.dim}>
          No clicks on the footer&apos;s newsletter links or the Funding
          box&apos;s link in this range.
        </p>
      ) : (
        <SortableTable
          columns={[
            { label: 'Link', sort: 'text' },
            { label: 'Goes to', sort: 'text' },
            { label: 'Clicks', className: styles.numCol, sort: 'number' },
          ]}
          values={rows.map(r => [r.name, r.to, r.clicks])}
          foot={
            rows.length > 1 ? (
              <tr className={styles.totalRow}>
                <td className={styles.totalLabel}>Total</td>
                <td />
                <td className={styles.numCol}>{total.toLocaleString()}</td>
              </tr>
            ) : undefined
          }
        >
          {rows.map(r => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className={styles.dim}>{r.to}</td>
              <td className={styles.numCol}>{r.clicks.toLocaleString()}</td>
            </tr>
          ))}
        </SortableTable>
      )}
      <p className={styles.caption}>
        Funding page&apos;s box = clicks on the Funding signup box outside its
        email field, which opened the newsletter on Substack to read first until
        the Funding newsletter moved on 21 October 2026; since then the box
        signs people up on the site like the others. Footer = the links in the
        site footer&apos;s Newsletters column, on every page: Events, Training
        and Funding go to their pages, whose box signs people up; Updates goes
        to Substack (Funding did too before its move).{' '}
        {unique
          ? 'Once per visitor per link per day (the Unique count).'
          : 'Every click (the Total count).'}
      </p>
    </Panel>
  )
}

/** The Newsletters tab's results of the signups made on the site: the
 *  boxes sign people up through ActiveCampaign (/events and /training from 8
 *  October 2026, /funding from its move day). Per page, how many went through and how many showed the
 *  visitor an error, then what the errors were. */
function SignupResultsPanel({
  results,
  confirmed,
  labelFor,
}: {
  results: NewsletterSignupResults
  confirmed: NewsletterConfirmRow[]
  labelFor: (name: string) => string
}) {
  const succeeded = results.byPage.reduce((n, r) => n + r.succeeded, 0)
  const already = results.byPage.reduce((n, r) => n + r.already, 0)
  const failed = results.byPage.reduce((n, r) => n + r.failed, 0)
  return (
    <Panel title="Signups through the site">
      {results.byPage.length === 0 ? (
        <p className={styles.dim}>No signups through the site in this range.</p>
      ) : (
        <SortableTable
          columns={[
            { label: 'Page', sort: 'text' },
            { label: 'Signed up', className: styles.numCol, sort: 'number' },
            {
              label: 'Already subscribed',
              className: styles.numCol,
              sort: 'number',
            },
            { label: 'Errors', className: styles.numCol, sort: 'number' },
          ]}
          values={results.byPage.map(r => [
            labelFor(r.name),
            r.succeeded,
            r.already,
            r.failed,
          ])}
          foot={
            <tr className={styles.totalRow}>
              <td className={styles.totalLabel}>Total</td>
              <td className={styles.numCol}>{succeeded.toLocaleString()}</td>
              <td className={styles.numCol}>{already.toLocaleString()}</td>
              <td className={styles.numCol}>{failed.toLocaleString()}</td>
            </tr>
          }
        >
          {results.byPage.map(r => (
            <tr key={r.name}>
              <td>{labelFor(r.name)}</td>
              <td className={styles.numCol}>{r.succeeded.toLocaleString()}</td>
              <td className={styles.numCol}>{r.already.toLocaleString()}</td>
              <td className={styles.numCol}>{r.failed.toLocaleString()}</td>
            </tr>
          ))}
        </SortableTable>
      )}
      {results.errors.length > 0 && (
        <CountTable
          rows={results.errors}
          labelHead="What went wrong"
          countHead="Errors"
          total={failed}
        />
      )}
      {confirmed.length > 0 && (
        <SortableTable
          columns={[
            { label: 'Newsletter', sort: 'text' },
            { label: 'Signed up', className: styles.numCol, sort: 'number' },
            { label: 'Confirmed', className: styles.numCol, sort: 'number' },
            {
              label: '% confirmed',
              className: styles.pctCol,
              sort: 'number',
            },
          ]}
          values={confirmed.map(r => [
            r.name,
            r.signedUp,
            r.confirmed,
            r.signedUp > 0 ? r.confirmed / r.signedUp : null,
          ])}
        >
          {confirmed.map(r => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td className={styles.numCol}>{r.signedUp.toLocaleString()}</td>
              <td className={styles.numCol}>{r.confirmed.toLocaleString()}</td>
              <td className={styles.pctCol}>
                {r.signedUp > 0 ? pct(r.confirmed, r.signedUp) : '—'}
              </td>
            </tr>
          ))}
        </SortableTable>
      )}
      <p className={styles.caption}>
        Since 8 October 2026 the boxes on /events and /training (and, since
        October 2026, on their past issues pages) sign people up on the site,
        through ActiveCampaign; /funding&apos;s box does too since the Funding
        newsletter moved on 21 October 2026 (before that it opened Substack, so
        its earlier signups don&apos;t show here), and so does /newsletter,
        several newsletters at once, since 26 October 2026. Signed up =
        ActiveCampaign took the address and emailed a link to confirm it.
        Already subscribed = the address was on the list already, so the visitor
        was told so and nothing was sent. Errors = the visitor saw an error
        message instead. Confirmed = readers who pressed the link in that email:
        ActiveCampaign then sends them to aisafety.com/subscribed/events,
        /subscribed/training or /subscribed/funding, and their view of that page
        is counted. In the Unique count that&apos;s once per visitor, and not
        again when the same link opens a second time within two minutes in
        another browser (an email app&apos;s own browser and then the
        phone&apos;s, or a mail scanner checking the link). Anyone else who
        opens one of those pages counts too, tests included. A confirmation can
        come days after its signup, so near the range&apos;s edges the two
        don&apos;t pair up exactly, and a reader whose browser blocks the
        site&apos;s tracking isn&apos;t counted.
      </p>
    </Panel>
  )
}

/** A small rate with the decimals it needs (0.36%, 2.1%, 42%): an issue's
 *  unsubscribes or bounces would otherwise all round to 0%. */
function pctSmall(part: number, whole: number): string {
  if (whole <= 0) return '—'
  const p = (100 * part) / whole
  if (p === 0) return '0%'
  if (p < 0.01) return '<0.01%'
  return `${p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

/** Most-clicked links shows this many; the caption says when there are more. */
const TOP_LINKS = 50

/** An issue's hard and soft bounces together; null when neither was read. */
function bouncesOf(s: SendStats): number | null {
  return s.hardBounces == null && s.softBounces == null
    ? null
    : (s.hardBounces ?? 0) + (s.softBounces ?? 0)
}

/** The Newsletters tab: the issues first sent in the range (ActiveCampaign's
 *  sends, opens, unsubscribes, bounces and spam complaints; clicks counted
 *  on aisafety.com), the most-clicked links, and the signup box on the
 *  site. */
function NewsletterView({
  sends,
  rangeStartMs,
  signups,
}: {
  sends: SendStatsResult | null
  rangeStartMs: number | null
  signups: React.ReactNode
}) {
  if (sends === null) {
    return (
      <>
        <Panel title="Newsletter sends">
          <p className={styles.dim}>
            Couldn&apos;t read ActiveCampaign just now — try refreshing in a
            moment.
          </p>
        </Panel>
        {signups}
      </>
    )
  }
  const issues = sends.issues
  const sent = issues.reduce((n, s) => n + s.sent, 0)
  const opens = issues.reduce((n, s) => n + (s.opens ?? 0), 0)
  // The click counts are read in one go: all there, or none.
  const clicksKnown = issues.every(s => s.clicks != null)
  const clicks = issues.reduce((n, s) => n + (s.clicks?.total ?? 0), 0)
  const unsubs = issues.reduce((n, s) => n + (s.unsubscribes ?? 0), 0)
  const bounced = issues.reduce((n, s) => n + (bouncesOf(s) ?? 0), 0)
  // Unknown for the range when one issue's report didn't load.
  const spam = issues.some(s => s.spamComplaints == null)
    ? null
    : issues.reduce((n, s) => n + (s.spamComplaints ?? 0), 0)
  const allLinks = issues.flatMap(s =>
    (s.clicks?.links ?? []).map(l => ({ ...l, issue: s.name }))
  )
  const topLinks = [...allLinks]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, TOP_LINKS)
  // The site reads ActiveCampaign's newest campaigns only; say so when the
  // range reaches back past them.
  const readFrom =
    sends.readFrom &&
    (rangeStartMs == null || rangeStartMs < Date.parse(sends.readFrom))
      ? sends.readFrom
      : null
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
  }
  const unfinished: Record<NonNullable<SendStats['unfinished']>, string> = {
    sending: 'still sending',
    paused: 'paused partway',
    stopped: 'stopped partway',
    scheduled: 'more waves to come',
  }
  return (
    <>
      <Panel title="Newsletter sends">
        <div className={styles.funnel}>
          <Stat label="Issues sent" value={issues.length.toLocaleString()} />
          <Stat label="Emails sent" value={sent.toLocaleString()} />
          <Stat label="Opened" value={pct(opens, sent)} />
          <Stat
            label="Clicks"
            value={clicksKnown ? clicks.toLocaleString() : '—'}
          />
          <Stat
            label="Clicks per email"
            value={clicksKnown && sent > 0 ? (clicks / sent).toFixed(2) : '—'}
          />
          <Stat label="Unsubscribed" value={pctSmall(unsubs, sent)} />
          <Stat label="Bounced" value={pctSmall(bounced, sent)} />
          <Stat
            label="Marked as spam"
            value={spam == null ? '—' : spam.toLocaleString()}
          />
        </div>
        {issues.length === 0 ? (
          <p className={styles.dim}>No issues sent in this range.</p>
        ) : (
          <SortableTable
            columns={[
              { label: 'Issue', sort: 'text' },
              { label: 'Newsletter', sort: 'text' },
              { label: 'Sent', sort: 'text' },
              { label: 'Sent to', className: styles.numCol, sort: 'number' },
              { label: 'Opened', className: styles.pctCol, sort: 'number' },
              { label: 'Clicks', className: styles.numCol, sort: 'number' },
              { label: 'Unsubs', className: styles.numCol, sort: 'number' },
              { label: 'Bounced', className: styles.numCol, sort: 'number' },
              { label: 'Spam', className: styles.numCol, sort: 'number' },
            ]}
            values={issues.map(s => [
              s.name,
              s.newsletter,
              s.sentAt ?? '',
              s.sent,
              s.opens != null && s.sent > 0 ? s.opens / s.sent : null,
              s.clicks?.total ?? null,
              s.unsubscribes,
              bouncesOf(s),
              s.spamComplaints,
            ])}
          >
            {issues.map(s => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  {(s.waves > 0 || s.unfinished) && (
                    <span className={styles.dim}>
                      {s.waves > 0 &&
                        (s.wavesPlanned > s.waves
                          ? ` · ${s.waves} of ${s.wavesPlanned} waves`
                          : ` · ${s.waves} wave${s.waves === 1 ? '' : 's'}`)}
                      {s.unfinished && ` · ${unfinished[s.unfinished]}`}
                    </span>
                  )}
                </td>
                <td>{s.newsletter}</td>
                <td className={styles.dim}>
                  {s.sentAt ? formatDay(s.sentAt) : '—'}
                </td>
                <td className={styles.numCol}>{s.sent.toLocaleString()}</td>
                <td className={styles.pctCol}>
                  {s.opens != null ? pct(s.opens, s.sent) : '—'}
                </td>
                <td className={styles.numCol}>
                  {s.clicks ? s.clicks.total.toLocaleString() : '—'}
                </td>
                <td className={styles.numCol}>
                  {s.unsubscribes != null
                    ? s.unsubscribes.toLocaleString()
                    : '—'}
                </td>
                <td
                  className={styles.numCol}
                  title={
                    s.hardBounces != null || s.softBounces != null
                      ? `${(s.hardBounces ?? 0).toLocaleString()} hard, ${(s.softBounces ?? 0).toLocaleString()} soft`
                      : undefined
                  }
                >
                  {bouncesOf(s)?.toLocaleString() ?? '—'}
                </td>
                <td className={styles.numCol}>
                  {s.spamComplaints != null
                    ? s.spamComplaints.toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
          </SortableTable>
        )}
        {readFrom && (
          <p className={styles.dim}>
            ActiveCampaign holds more campaigns than the site reads (the newest{' '}
            {CAMPAIGN_READ_MAX.toLocaleString()}), so issues first sent before{' '}
            {formatDay(readFrom)} may be missing here, or show only some of
            their waves.
          </p>
        )}
        <p className={styles.caption}>
          Issues sent through ActiveCampaign to the Events, Training and Funding
          lists, by the day each first went out. Test lists, and practice sends
          to fewer than 50 people, are left out. Events and Training moved from
          Substack on 8 October 2026 and Funding on 21 October 2026, so their
          earlier issues aren&apos;t here. An issue sent in waves is one row
          with all its waves added up. Sent to = emails sent, bounced ones
          included. Opened = unique opens ÷ emails sent, from ActiveCampaign.
          Apple Mail opens every email it receives, so this reads high, and the
          send watcher&apos;s verified opens, which leave those out, read lower.
          Clicks are counted on aisafety.com as readers follow a link in the
          email or its web, text or feed copy, every click (not unique readers)
          whenever it was made, link checkers left out. Clicks per email =
          clicks ÷ emails sent. Bounced = emails turned away, hard (the address
          doesn&apos;t exist, so ActiveCampaign sends it nothing more) and soft
          (a full mailbox or a server down, tried again next time). Hover a
          number for the split. Spam = readers who pressed Report spam where
          their mail service tells the sender (Yahoo, Outlook, AOL and others;
          Gmail tells nobody about one reader). No sender can see whether an
          email landed in a spam folder, so falling opens are the usual sign.
        </p>
      </Panel>
      <Panel title="Most-clicked links">
        {!clicksKnown ? (
          <p className={styles.dim}>
            The click counts couldn&apos;t be read just now — try refreshing in
            a moment.
          </p>
        ) : topLinks.length === 0 ? (
          <p className={styles.dim}>No clicks counted in this range yet.</p>
        ) : (
          <SortableTable
            columns={[
              { label: 'Link', sort: 'text' },
              { label: 'Goes to', sort: 'text' },
              { label: 'Issue', sort: 'text' },
              { label: 'Clicks', className: styles.numCol, sort: 'number' },
            ]}
            values={topLinks.map(l => [
              l.label,
              host(l.url),
              l.issue,
              l.clicks,
            ])}
          >
            {topLinks.map(l => (
              <tr key={`${l.issue}|${l.url}`}>
                <td>{l.label}</td>
                <td>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.dim}
                  >
                    {host(l.url)}
                  </a>
                </td>
                <td className={styles.dim}>{l.issue}</td>
                <td className={styles.numCol}>{l.clicks.toLocaleString()}</td>
              </tr>
            ))}
          </SortableTable>
        )}
        {allLinks.length > TOP_LINKS && (
          <p className={styles.caption}>
            The {TOP_LINKS} most-clicked of {allLinks.length.toLocaleString()}{' '}
            links clicked on these issues.
          </p>
        )}
      </Panel>
      {signups}
    </>
  )
}

/** The Map tab's per-area table: one row per map area with clicks and hovers
 *  side by side. Two count columns, so CountTable doesn't fit; area counts are
 *  bounded by the map's category list, so no show-more truncation either. */
/** The Overview tab's site-wide listings leaderboard. Like CountTable, but each
 *  row carries the page it came from (shown as a pill) and always uses a favicon
 *  — listings here span every page, so there's no single page's logos to load.
 *  `total` is every page's click count, so the top-N rows can sum to less than
 *  it; the Total footer shows the true denominator. */
function OverallListingsTable({
  rows: allRows,
  total,
}: {
  rows: (OverallListingRow & { pageLabel?: string })[]
  total: number
}) {
  if (allRows.length === 0) return <p className={styles.dim}>No data yet.</p>
  const rows = allRows.slice(0, MAX_TABLE_ROWS)
  const showPct = total > 0
  const columns: SortColumn[] = [
    { label: 'Listing', sort: 'text' },
    { label: 'Page', sort: 'text' },
    { label: 'Clicks', className: styles.numCol, sort: 'number' },
    ...(showPct
      ? [{ label: '%', className: styles.pctCol, sort: 'number' as const }]
      : []),
  ]
  const values: SortValue[][] = rows.map(r => [
    r.name,
    r.pageLabel ?? null,
    r.count,
    ...(showPct ? [r.count] : []),
  ])
  return (
    <>
      <SortableTable
        columns={columns}
        values={values}
        foot={
          <tr className={styles.totalRow}>
            <td className={styles.totalLabel}>Total</td>
            <td />
            <td className={styles.numCol}>{total.toLocaleString()}</td>
            {showPct && <td className={styles.pctCol}>{pct1(total, total)}</td>}
          </tr>
        }
      >
        {rows.map((r, i) => {
          const favicon = faviconFor(r.url)
          const href = r.url
          return (
            <tr key={i}>
              <td className={styles.nameCell}>
                {href && href !== '#' ? (
                  <a
                    className={styles.logoLink}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${r.name}`}
                  >
                    <Logo src={favicon} />
                  </a>
                ) : (
                  <Logo src={favicon} />
                )}
                <span>{r.name}</span>
              </td>
              <td>
                {r.pageLabel && (
                  <span className={styles.pill}>{r.pageLabel}</span>
                )}
              </td>
              <td className={styles.numCol}>{r.count.toLocaleString()}</td>
              {showPct && (
                <td className={styles.pctCol}>{pct1(r.count, total)}</td>
              )}
            </tr>
          )
        })}
      </SortableTable>
      {allRows.length > rows.length && (
        <TruncationNote shown={rows.length} of={allRows.length} />
      )}
    </>
  )
}

/** The Chatbot tab: the unique-user funnel, where and how the panel gets
 *  opened (first-party events, so they honour the date range and count mode),
 *  transcript-derived conversation stats (the Airtable conversation log), and
 *  what visitors click out of replies. */
function ChatbotView({
  trends,
  funnel,
  opensByPage,
  openShareByPage,
  siteOpenShare,
  destinations,
  repeatUse,
  conv,
  themes,
  unique,
}: {
  trends: TrendTile[]
  funnel: ChatbotFunnel
  opensByPage: Counted[]
  openShareByPage: VisitorShare[]
  siteOpenShare: VisitorShare
  destinations: ClickDestination[]
  repeatUse: ChatbotRepeatUse
  conv: ConversationStats | null
  themes: ThemeSummary | null
  unique: boolean
}) {
  const openShare = new Map(openShareByPage.map(r => [r.name, r]))
  const usersHead = unique ? 'Users' : undefined
  const sum = (rows: Counted[]) => rows.reduce((s, r) => s + r.count, 0)
  // Card clicks store only a url (no link text) — those rows read better as a
  // prettified url than a raw one.
  const destRows = destinations.map(d => ({
    ...d,
    name: d.url && d.name === d.url ? prettyUrl(d.url) : d.name,
  }))
  const destUrlByName = new Map(destRows.map(d => [d.name, d.url]))
  const medianLength =
    conv?.medianLength == null ? '—' : String(conv.medianLength)
  const share = (s: number | null) =>
    s == null ? '—' : `${Math.round(100 * s)}%`
  const ratio = (part: number, whole: number) =>
    share(whole === 0 ? null : part / whole)
  const n = (v: number) => v.toLocaleString()
  return (
    <>
      <Panel title="Over time">
        <TrendChart tiles={trends} label="Chatbot over time" />
      </Panel>

      <Panel title="Funnel · unique users">
        <Funnel
          stages={[
            { label: 'Opened', value: funnel.opened },
            { label: 'Sent a message', value: funnel.typed },
            { label: 'Clicked a result', value: funnel.clicked },
          ]}
        />
      </Panel>

      <Panel title="Repeat use · unique users">
        <div className={styles.funnel}>
          <Stat
            label={`used it again on a later visit (${n(repeatUse.usedAgain)} of ${n(repeatUse.tried)} who sent a message)`}
            value={ratio(repeatUse.usedAgain, repeatUse.tried)}
          />
          <Stat
            label={`came back to the site on a later visit (${n(repeatUse.cameBack)} of ${n(repeatUse.tried)})`}
            value={ratio(repeatUse.cameBack, repeatUse.tried)}
          />
          <Stat
            label={`of those who came back used it again (${n(repeatUse.usedAgain)} of ${n(repeatUse.cameBack)})`}
            value={ratio(repeatUse.usedAgain, repeatUse.cameBack)}
          />
        </div>
        <p className={styles.caption}>
          Visitors who sent the chatbot a message in the selected range, and
          what they did on later visits in the same range (a new visit starts
          after 30 minutes away, as in the Visits tile). Private-browsing
          visitors can&apos;t be followed between visits, so they&apos;re left
          out. People who first used it near the end of the range haven&apos;t
          had long to come back, so longer ranges read truer.
        </p>
      </Panel>

      <div className={styles.grid}>
        <Panel title="Where it's opened">
          <CountTable
            rows={opensByPage}
            labelHead="Page"
            countHead={usersHead ?? 'Opens'}
            total={sum(opensByPage)}
            shareFor={name => openShare.get(name)}
            totalShare={siteOpenShare}
          />
          <p className={styles.caption}>
            The page visitors were on when they opened the chat panel. % of
            visitors = the share of the page&apos;s visitors who opened it
            (always per-visitor, whichever count mode is on); the Total row is
            the share of all visitors site-wide.
          </p>
        </Panel>
        {conv?.available && (
          <Panel title="Conversations">
            <div className={styles.statStack}>
              <Stat
                label="Conversations"
                value={conv.totalConversations.toLocaleString()}
              />
              <Stat label="Median messages sent" value={medianLength} />
              <Stat
                label="of conversations started from a suggested question"
                value={share(conv.suggestedShare)}
              />
              <Stat
                label="of messages were a follow-up suggestion (conversation starters excluded)"
                value={share(conv.followUpMessageShare)}
              />
              <Stat
                label="of conversations included a card or link click"
                value={share(conv.clickedShare)}
              />
            </div>
            <p className={styles.caption}>
              From the conversation log (every message since the chatbot
              launched on 7 June 2026), for conversations started in the
              selected date range. These panels count conversations, so the
              Unique/Total toggle doesn&apos;t apply to them.
            </p>
          </Panel>
        )}
      </div>

      {conv && !conv.available && (
        <div className={styles.empty}>
          Couldn&apos;t reach the conversation log just now, so the conversation
          panels are hidden — try refreshing in a moment.
        </div>
      )}

      {conv?.available && (
        <>
          <Panel title="Reply ratings">
            <div className={styles.funnel}>
              <Stat
                label="replies rated 👍"
                value={conv.ratedUp.toLocaleString()}
              />
              <Stat
                label="replies rated 👎"
                value={conv.ratedDown.toLocaleString()}
              />
              <Stat
                label="of rated replies got a thumbs up"
                value={share(conv.thumbsUpShare)}
              />
              <Stat
                label="of conversations included a rating"
                value={share(conv.ratedConversationShare)}
              />
            </div>
            <div className={styles.tileTable}>
              <RatedRepliesTable rows={conv.ratedReplies} />
            </div>
            <p className={styles.caption}>
              Thumbs ratings visitors gave the chatbot&apos;s replies, from the
              conversation log, for conversations started in the selected date
              range. Each reply counts once, under its latest rating (switching
              thumbs overwrites; a rating clicked off again is removed). The
              table lists every rated reply, newest first; a reply that has
              scrolled out of a long conversation&apos;s stored transcript keeps
              its rating but not its text.
            </p>
          </Panel>

          <div className={styles.grid}>
            <Panel title="Conversation length">
              <CountTable
                rows={conv.lengthBuckets}
                labelHead="Length"
                countHead="Conversations"
                total={sum(conv.lengthBuckets)}
              />
              <p className={styles.caption}>
                How many messages the visitor sent in each conversation.
              </p>
            </Panel>
            <Panel title="Languages">
              <CountTable
                rows={conv.languages}
                labelHead="Language"
                countHead="Conversations"
                total={sum(conv.languages)}
              />
              <p className={styles.caption}>
                Auto-detected from the visitor&apos;s messages, so approximate —
                conversations too short to call show as Unknown. A conversation
                that switches language counts under the non-English language.
              </p>
            </Panel>
          </div>

          <Panel title="What people ask about">
            <ThemesTable summary={themes} />
            <p className={styles.caption}>
              <RefreshThemesButton />{' '}
              {themes && <>Last updated {formatTime(themes.generatedAt)}.</>}
            </p>
            <p className={styles.caption}>
              Every typed question since the chatbot launched (suggested-chip
              clicks excluded), grouped into themes by Claude. Always covers the
              whole log — the date range doesn&apos;t filter it — and
              regenerates weekly, or whenever it&apos;s refreshed.
            </p>
          </Panel>

          <Panel title="Suggested questions">
            <QuestionsTable
              rows={conv.topQuestions.filter(q => q.suggested)}
              showPill={false}
            />
            <p className={styles.caption}>
              How often each pre-written question chip started a conversation.
            </p>
          </Panel>
        </>
      )}

      <Panel title="Clicked from replies">
        <CountTable
          rows={destRows}
          labelHead="Destination"
          countHead={usersHead ?? 'Clicks'}
          logoFor={name => faviconFor(destUrlByName.get(name))}
          linkFor={name => destUrlByName.get(name)}
          total={sum(destRows)}
        />
        <p className={styles.caption}>
          The listing cards and links visitors opened from the chatbot&apos;s
          replies.
        </p>
      </Panel>
    </>
  )
}

/** The Search tab: how often site search gets used (and how it's opened),
 *  what people search for, which searches come back empty, and what gets
 *  clicked out of the results. */
function SearchView({
  trends,
  search,
  index,
  unique,
}: {
  trends: TrendTile[]
  search: SearchPanelData
  index: SearchEntry[]
  unique: boolean
}) {
  const usersHead = unique ? 'Users' : undefined
  const sum = (rows: Counted[]) => rows.reduce((s, r) => s + r.count, 0)
  // Rows whose click carried no title read better as a prettified url.
  const destRows = search.destinations.map(d => ({
    ...d,
    name: d.url && d.name === d.url ? prettyUrl(d.url) : d.name,
  }))
  const openShare = new Map(search.openShareByPage.map(r => [r.name, r]))
  const destUrlByName = new Map(destRows.map(d => [d.name, d.url]))
  const pageBadges = searchPageBadges(index, destRows)
  return (
    <>
      <Panel title="Over time">
        <TrendChart tiles={trends} label="Search over time" />
      </Panel>

      <Panel title="Funnel · unique users">
        <Funnel
          stages={[
            { label: 'Opened search', value: search.funnel.opened },
            { label: 'Typed a search', value: search.funnel.searched },
            { label: 'Clicked a result', value: search.funnel.clicked },
          ]}
        />
        <p className={styles.caption}>Recording since 16 July 2026.</p>
      </Panel>

      <div className={styles.grid}>
        <Panel title="How it's opened">
          <CountTable
            rows={search.openMethods}
            labelHead="Method"
            countHead={usersHead ?? 'Opens'}
            total={sum(search.openMethods)}
          />
          <p className={styles.caption}>
            The magnifying-glass button, or a keyboard shortcut (⌘K also counts
            Ctrl+K).
          </p>
        </Panel>
        <Panel title="Where it's opened">
          <CountTable
            rows={search.opensByPage}
            labelHead="Page"
            countHead={usersHead ?? 'Opens'}
            total={sum(search.opensByPage)}
            shareFor={name => openShare.get(name)}
            totalShare={search.siteOpenShare}
          />
          <p className={styles.caption}>
            The page visitors were on when they opened search. % of visitors =
            the share of the page&apos;s visitors who opened it (always
            per-visitor, whichever count mode is on); the Total row is the share
            of all visitors site-wide.
          </p>
        </Panel>
      </div>

      <div className={styles.grid}>
        <Panel title="What people search for">
          <CountTable
            rows={search.topQueries}
            labelHead="Search"
            countHead={usersHead ?? 'Searches'}
            total={sum(search.topQueries)}
          />
          <p className={styles.caption}>
            A search is recorded once the visitor pauses typing, so a few
            half-typed words are normal.
          </p>
        </Panel>
        <Panel title="Searches with no results">
          <CountTable
            rows={search.noResultQueries}
            labelHead="Search"
            countHead={usersHead ?? 'Searches'}
            total={sum(search.noResultQueries)}
          />
          <p className={styles.caption}>
            What visitors looked for and didn&apos;t find — worth scanning for
            things the site should cover.
          </p>
        </Panel>
      </div>

      <Panel title="Clicked from search">
        <CountTable
          rows={destRows}
          labelHead="Result"
          countHead={usersHead ?? 'Clicks'}
          logoFor={name => faviconFor(destUrlByName.get(name))}
          linkFor={name => destUrlByName.get(name)}
          pageFor={name => pageBadges.get(name)}
          total={sum(destRows)}
        />
        <p className={styles.caption}>
          The results visitors opened from search, with the page or listing each
          one leads to. The Page column is the page the result belongs to; a row
          without one can&apos;t be matched to a single page in the search
          index.
        </p>
      </Panel>
    </>
  )
}

/** The Map tab's search-box panels: the funnel from opening the box to
 *  picking a result, how it's opened, what's searched for, and which
 *  listings get picked. Only the Field map has the box, so only the Map tab
 *  renders these. */
function MapSearchPanels({
  data,
  unique,
  logoFor,
  linkFor,
}: {
  data: MapSearchPanelData
  unique: boolean
  logoFor: (name: string) => string | undefined
  linkFor: (name: string) => string | undefined
}) {
  const usersHead = unique ? 'Users' : undefined
  const sum = (rows: Counted[]) => rows.reduce((s, r) => s + r.count, 0)
  const rankByName = new Map(data.picked.map(r => [r.name, r.position]))
  return (
    <>
      <div className={styles.grid}>
        <Panel title="Search box · funnel">
          <Funnel
            stages={[
              { label: 'Opened the search', value: data.funnel.opened },
              { label: 'Typed a search', value: data.funnel.searched },
              { label: 'Picked a result', value: data.funnel.picked },
            ]}
          />
          <p className={styles.caption}>
            The search box at the top left of the map – not the sitewide search,
            which has its own tab. Unique users at each step;{' '}
            {shareCell(data.openShare ?? undefined)} of the page&apos;s visitors
            opened it at all. Recording since 5 September 2026.
          </p>
        </Panel>
        <Panel title="Search box · how it's opened">
          <CountTable
            rows={data.openMethods}
            labelHead="Method"
            countHead={usersHead ?? 'Opens'}
            total={sum(data.openMethods)}
          />
          <p className={styles.caption}>
            The magnifying-glass button on the map, or ⌘F / Ctrl+F while the map
            is on screen.
          </p>
        </Panel>
      </div>
      <div className={styles.grid}>
        <Panel title="Search box · what people search for">
          <CountTable
            rows={data.topQueries}
            labelHead="Search"
            countHead={usersHead ?? 'Searches'}
            total={sum(data.topQueries)}
          />
          <p className={styles.caption}>
            A search is recorded once the visitor pauses typing, so a few
            half-typed words are normal.
          </p>
        </Panel>
        <Panel title="Search box · no results">
          <CountTable
            rows={data.noResultQueries}
            labelHead="Search"
            countHead={usersHead ?? 'Searches'}
            total={sum(data.noResultQueries)}
          />
          <p className={styles.caption}>
            What visitors looked for on the map and didn&apos;t find – worth
            scanning for listings the map should have, or names it should match.
          </p>
        </Panel>
      </div>
      <Panel title="Search box · picked listings">
        {/* Stays 'Picks' in unique mode: one per visitor per listing per DAY
            summed across days, not distinct users — the same rule as the
            Top hovered table. */}
        <CountTable
          rows={data.picked}
          labelHead="Listing"
          countHead="Picks"
          rankHead="Rank"
          rankFor={name => rankByName.get(name)}
          logoFor={logoFor}
          linkFor={linkFor}
          total={sum(data.picked)}
        />
        <p className={styles.caption}>
          The listings visitors picked from the results – the map flies to the
          pin. Rank is where the listing sat in the results when picked (1 =
          top), shown as a range when it varied.
        </p>
      </Panel>
    </>
  )
}

/** Question rows with counts; the pill marks suggested-chip matches (off when
 *  the table already holds only suggested questions). */
function QuestionsTable({
  rows: allRows,
  showPill = true,
}: {
  rows: TopQuestion[]
  showPill?: boolean
}) {
  if (allRows.length === 0) return <p className={styles.dim}>No data yet.</p>
  const rows = allRows.slice(0, MAX_TABLE_ROWS)
  const total = allRows.reduce((s, r) => s + r.count, 0)
  return (
    <>
      <SortableTable
        columns={[
          { label: 'Question', sort: 'text' },
          { label: 'Conversations', className: styles.numCol, sort: 'number' },
          { label: '%', className: styles.pctCol, sort: 'number' },
        ]}
        values={rows.map(r => [r.text, r.count, r.count])}
        foot={
          <tr className={styles.totalRow}>
            <td className={styles.totalLabel}>Total</td>
            <td className={styles.numCol}>{total.toLocaleString()}</td>
            <td className={styles.pctCol}>{pct1(total, total)}</td>
          </tr>
        }
      >
        {rows.map((r, i) => (
          <tr key={i}>
            <td className={styles.nameCell}>
              <span>{r.text}</span>
              {showPill && r.suggested && (
                <span className={styles.pill}>Suggested</span>
              )}
            </td>
            <td className={styles.numCol}>{r.count.toLocaleString()}</td>
            <td className={styles.pctCol}>{pct1(r.count, total)}</td>
          </tr>
        ))}
      </SortableTable>
      {allRows.length > rows.length && (
        <TruncationNote shown={rows.length} of={allRows.length} />
      )}
    </>
  )
}

/** Longest a question or reply snippet gets in the rated-replies table. */
const SNIPPET_CHARS = 220

function snippet(text: string): string {
  return text.length > SNIPPET_CHARS
    ? `${text.slice(0, SNIPPET_CHARS - 1).trimEnd()}…`
    : text
}

/** Every rated reply in the range, newest first: when, which thumb, the
 *  visitor's question with the reply beneath it, and the page the chat was
 *  on. Sortable by time, rating and page. */
function RatedRepliesTable({ rows: allRows }: { rows: RatedReply[] }) {
  if (allRows.length === 0)
    return <p className={styles.dim}>No ratings in this range yet.</p>
  const rows = allRows.slice(0, MAX_TABLE_ROWS)
  return (
    <>
      <SortableTable
        columns={[
          { label: 'Visitor asked → chatbot replied' },
          { label: 'Rating', className: styles.numCol, sort: 'text' },
          { label: 'Page', className: styles.numCol, sort: 'text' },
          { label: 'When', className: styles.numCol, sort: 'text' },
        ]}
        values={rows.map(r => [null, r.rating, r.page, r.at])}
      >
        {rows.map((r, i) => (
          <tr key={i}>
            <td>
              {r.question != null && r.reply != null ? (
                <>
                  <div>{snippet(r.question)}</div>
                  <div className={styles.dim}>{snippet(r.reply)}</div>
                </>
              ) : (
                <div className={styles.dim}>
                  Reply text not in the stored transcript
                </div>
              )}
            </td>
            <td
              className={styles.numCol}
              title={r.rating === 'up' ? 'Thumbs up' : 'Thumbs down'}
            >
              {r.rating === 'up' ? '👍' : '👎'}
            </td>
            <td className={styles.numCol}>
              {r.page ? (PAGE_NAME_BY_PATH[r.page] ?? r.page) : '—'}
            </td>
            <td className={styles.numCol}>{formatTime(r.at)}</td>
          </tr>
        ))}
      </SortableTable>
      {allRows.length > rows.length && (
        <TruncationNote shown={rows.length} of={allRows.length} />
      )}
    </>
  )
}

/** Claude-generated question themes with counts and verbatim examples. */
function ThemesTable({ summary }: { summary: ThemeSummary | null }) {
  if (!summary || summary.themes.length === 0) {
    return (
      <p className={styles.dim}>
        No summary yet — refresh to generate one (it runs weekly on its own).
      </p>
    )
  }
  const total = summary.totalQuestions
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Theme</th>
          <th className={styles.numCol}>Conversations</th>
          <th className={styles.pctCol}>%</th>
        </tr>
      </thead>
      <tbody>
        {summary.themes.map((t, i) => (
          <tr key={i}>
            <td>
              <div>{t.name}</div>
              {t.examples.length > 0 && (
                <div className={styles.dim}>
                  {t.examples.map(e => `“${e}”`).join(' · ')}
                </div>
              )}
            </td>
            <td className={styles.numCol}>{t.count.toLocaleString()}</td>
            <td className={styles.pctCol}>{pct1(t.count, total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={styles.totalRow}>
          <td className={styles.totalLabel}>Total</td>
          <td className={styles.numCol}>{total.toLocaleString()}</td>
          <td className={styles.pctCol}>{pct1(total, total)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

/** Cross-interest overlaps, one row per pair of pages (or page + chatbot),
 *  most-shared first. */
function CorrelationsTable({
  rows: allRows,
  labelFor,
}: {
  rows: CorrelationRow[]
  labelFor: (name: string) => string
}) {
  if (allRows.length === 0) {
    return (
      <p className={styles.dim}>
        No overlaps in this range yet — they build up as visitors move between
        pages.
      </p>
    )
  }
  const rows = allRows.slice(0, MAX_TABLE_ROWS)
  return (
    <SortableTable
      columns={[
        { label: 'Pages', sort: 'text' },
        { label: 'Shared visitors', className: styles.numCol, sort: 'number' },
        { label: 'Overlap' },
      ]}
      values={rows.map(r => [
        `${labelFor(r.a)} + ${labelFor(r.b)}`,
        r.both,
        null,
      ])}
    >
      {rows.map((r, i) => {
        const a = labelFor(r.a)
        const b = labelFor(r.b)
        return (
          <tr key={i}>
            <td className={styles.nameCell}>
              <span>
                {a} + {b}
              </span>
            </td>
            <td className={styles.numCol}>{r.both.toLocaleString()}</td>
            <td>
              {pct1(r.both, r.aTotal)} of {a} · {pct1(r.both, r.bTotal)} of {b}
            </td>
          </tr>
        )
      })}
    </SortableTable>
  )
}

/** A row of funnel stages, with each arrow showing the conversion from the
 *  stage before it. */
function Funnel({ stages }: { stages: { label: string; value: number }[] }) {
  return (
    <div className={styles.funnel}>
      {stages.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && <FunnelArrow pct={pct(s.value, stages[i - 1].value)} />}
          <FunnelStage label={s.label} value={s.value} />
        </Fragment>
      ))}
    </div>
  )
}

function FunnelStage({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.funnelStage}>
      <div className={styles.funnelValue}>{value.toLocaleString()}</div>
      <div className={styles.funnelLabel}>{label}</div>
    </div>
  )
}

function FunnelArrow({ pct }: { pct: string }) {
  return (
    <div className={styles.funnelArrow}>
      <span className={styles.funnelArrowGlyph}>→</span>
      <span className={styles.funnelPct}>{pct}</span>
    </div>
  )
}
