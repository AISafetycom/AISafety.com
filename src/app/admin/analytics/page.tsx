import { Fragment } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import Icon from '@/components/Icon'
import {
  readDashboard,
  sourceSlug,
  PAGE_NAME_BY_PATH,
  type Counted,
  type DateRange,
  type ChatbotFunnel,
  type ClickDestination,
  type CorrelationRow,
  type ListingRow,
  type OverallListingRow,
  type SearchPanelData,
  type MapSearchPanelData,
  type VisitorShare,
  DASHBOARD_TZ,
  dashboardDay,
  dashboardOffset,
} from '@/lib/analytics/events'
import {
  readConversationStats,
  type ConversationStats,
  type RatedReply,
  type TopQuestion,
} from '@/lib/analytics/conversations'
import { readQuestionThemes, type ThemeSummary } from '@/lib/analytics/themes'
import {
  buildSearchIndex,
  type SearchEntry,
  type SearchType,
} from '@/lib/data/search-index'
import { TYPE_ICON, TYPE_LABEL, TYPE_PATH } from '@/lib/search'
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
import DateRangePicker from './DateRangePicker'
import ExcludeToggle from './ExcludeToggle'
import Logo from './Logo'
import SortableTable, { type SortColumn, type SortValue } from './SortableTable'
import admin from '../admin.module.css'
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

// Resource pages in the same order as the site nav. `name` is the analytics
// `page` value (the string passed to trackListingClick) and the tab key; `label`
// is the page's name on the live site (from Navigation.tsx) so the tabs read the
// way visitors see them — e.g. the 'Founders' page is labelled "Founder toolkit".
// Drives the order, labels, and icons of the page tabs; every page listed here
// always gets a tab (even with no clicks yet). Pages not listed (e.g. Home) sort
// after these, keeping their by-clicks order and showing their raw name.
const PAGE_NAV: { name: string; label: string; icon: string }[] = [
  { name: 'Training', label: 'Training programs', icon: 'grad-cap.svg' },
  { name: 'Events', label: 'Events', icon: 'calendar.svg' },
  { name: 'Map', label: 'Field map', icon: 'map.svg' },
  { name: 'Communities', label: 'Communities', icon: 'globe.svg' },
  { name: 'Self-study', label: 'Self-study', icon: 'book.svg' },
  { name: 'Jobs', label: 'Jobs', icon: 'briefcase.svg' },
  { name: 'Funding', label: 'Funding', icon: 'coins.svg' },
  { name: 'Media channels', label: 'Media channels', icon: 'megaphone.svg' },
  { name: 'Advisors', label: 'Advisors', icon: 'person.svg' },
  // Volunteer projects has no trackable clicks (its cards are plain text with no
  // links), so it gets no tab. If it's ever tracked, add it back here.
  { name: 'Founders', label: 'Founder toolkit', icon: 'rocket.svg' },
]

// The two non-page tabs that lead the tab bar. Their keys are reserved, so a
// resource page can never collide with them.
const OVERVIEW_TABS: { key: string; label: string }[] = [
  { key: 'pages', label: 'Overview' },
  { key: 'chatbot', label: 'Chatbot' },
  { key: 'search', label: 'Search' },
  { key: 'correlations', label: 'Correlations' },
]
const OVERVIEW_KEYS = new Set(OVERVIEW_TABS.map(t => t.key))

// Pages with a map (mirrors MAP_PAGES in the events store). Only these emit
// listing_hover events, so only their tabs get the hovered-listings panel —
// and only Map has areas, so the by-area rollup is Map-only.
const MAP_PAGES = new Set(['Map', 'Communities'])

// Day boundaries and displayed times use the dashboard's fixed reporting zone
// (DASHBOARD_TZ in events.ts, UTC) — the same for every viewer.
const DAY = 86_400_000

interface ResolvedRange extends DateRange {
  key: string // active preset key, or 'custom'
  from?: string
  to?: string
}

type SearchParams = Record<string, string | string[] | undefined>

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Translate the query string into concrete epoch-ms bounds. Defaults to the
 *  last 30 days. A custom from/to (inclusive, dashboard-zone day boundaries) wins. */
function resolveRange(sp: SearchParams): ResolvedRange {
  const from = first(sp.from)
  const to = first(sp.to)
  if (from || to) {
    const s = from
      ? Date.parse(`${from}T00:00:00${dashboardOffset(from)}`)
      : NaN
    const e = to ? Date.parse(`${to}T23:59:59.999${dashboardOffset(to)}`) : NaN
    return {
      startMs: Number.isNaN(s) ? null : s,
      endMs: Number.isNaN(e) ? null : e,
      key: 'custom',
      from,
      to,
    }
  }
  const range = first(sp.range) ?? '30d'
  const now = Date.now()
  switch (range) {
    case 'today': {
      const today = dashboardDay(now)
      return {
        startMs: Date.parse(`${today}T00:00:00${dashboardOffset(today)}`),
        endMs: null,
        key: 'today',
      }
    }
    case '7d':
      return { startMs: now - 7 * DAY, endMs: null, key: '7d' }
    case '90d':
      return { startMs: now - 90 * DAY, endMs: null, key: '90d' }
    case 'all':
      return { startMs: null, endMs: null, key: 'all' }
    case '30d':
    default:
      return { startMs: now - 30 * DAY, endMs: null, key: '30d' }
  }
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

/** A favicon for any outbound URL — the universal fallback when a listing has
 *  no Airtable logo (or the event isn't a funding listing). */
function faviconFor(url?: string): string | undefined {
  if (!url || url === '#') return undefined
  try {
    const host = new URL(url).hostname
    if (!host) return undefined
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return undefined
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

/** A row's resource-page marker in the clicked-from-search table: the page's
 *  nav icon plus its name. */
interface PageBadge {
  icon: string | null
  label: string
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

function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    return u.hostname.replace(/^www\./, '') + path
  } catch {
    return url
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

/** A share of `total` to one decimal place, e.g. "43.2%". */
function pct1(part: number, total: number): string {
  return `${((100 * part) / total).toFixed(1)}%`
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

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const range = resolveRange(sp)
  // Count each visitor once per listing per day by default; ?clicks=total counts
  // every click.
  const unique = first(sp.clicks) !== 'total'

  // The dashboard is tabbed: two overview tabs (the chatbot and the by-page
  // table) plus one tab per resource page. `tab` holds the active tab — an
  // overview key, or a resource page's analytics name. A resource tab is the
  // page we ask the store to drill into; the overview tabs need no page.
  // 'funnel' is the Chatbot tab's old key, kept working for bookmarked urls.
  const tabRaw = first(sp.tab)
  const tabReq = tabRaw === 'funnel' ? 'chatbot' : tabRaw
  const onResourceTab = tabReq != null && !OVERVIEW_KEYS.has(tabReq)

  const [data, funders, convStats, themes, searchIndex] = await Promise.all([
    readDashboard(
      range,
      onResourceTab ? tabReq : undefined,
      unique,
      first(sp.source)
    ),
    getFunders().catch(() => []),
    // The transcript-derived stats only render on the Chatbot tab, so only
    // fetch the (ever-growing) conversation log when it's the active tab.
    tabReq === 'chatbot' ? readConversationStats(range) : null,
    tabReq === 'chatbot' ? readQuestionThemes() : null,
    // Resolves clicked search results to their resource page; only the Search
    // tab reads it. On error the page icons resolve from recorded types alone.
    tabReq === 'search'
      ? buildSearchIndex().catch(() => [] as SearchEntry[])
      : ([] as SearchEntry[]),
  ])

  // Resource-page tabs: every page in PAGE_NAV always gets one (so quiet pages
  // like Projects still appear), plus any other page that has clicks (e.g.
  // Home). Ordered Home first, then site-nav order, then the rest.
  const pageOrder = new Map(PAGE_NAV.map((p, i) => [p.name, i]))
  const labelByPage = new Map(PAGE_NAV.map(p => [p.name, p.label]))
  const iconByPage = new Map(PAGE_NAV.map(p => [p.name, p.icon]))
  const orderOf = (name: string) =>
    name === 'Home' ? -1 : (pageOrder.get(name) ?? 999)
  const resourceNames = [
    ...new Set([...PAGE_NAV.map(p => p.name), ...data.byPage.map(p => p.name)]),
  ].sort((a, b) => orderOf(a) - orderOf(b))
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

  return (
    <div>
      <div className={styles.headerRow}>
        <h1 className={admin.pageTitle}>Analytics</h1>
        <div className={styles.meta}>
          <span className={styles.badge}>
            {SOURCE_LABEL[data.source] ?? data.source}
          </span>
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

      {data.nearCap.map(({ month, count, cap }) => (
        <div key={month} className={styles.capWarning}>
          ⚠ {formatMonth(month)} already holds {count.toLocaleString()} events –{' '}
          {Math.round((100 * count) / cap)}% of the {cap.toLocaleString()}
          -per-month safety cap. At the cap, the month&apos;s oldest events
          start being deleted. If this is real traffic rather than abuse, raise
          the cap now (MONTH_CAP in the analytics code) so nothing is lost.
        </div>
      ))}

      <DateRangePicker activeKey={range.key} from={range.from} to={range.to} />

      <ClickModeToggle unique={unique} params={sp} />

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
          />

          {activeTab === 'chatbot' && (
            <ChatbotView
              funnel={data.funnel}
              opensByPage={data.chatbot.opensByPage}
              openShareByPage={data.chatbot.openShareByPage}
              siteOpenShare={data.chatbot.siteOpenShare}
              destinations={data.chatbot.destinations}
              conv={convStats}
              themes={themes}
              unique={unique}
            />
          )}

          {activeTab === 'search' && (
            <SearchView
              search={data.search}
              index={searchIndex}
              unique={unique}
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
              <div className={styles.funnel}>
                <Stat
                  label="Visitors"
                  value={data.visits.uniqueVisitors.toLocaleString()}
                />
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
                  label="Visits"
                  value={data.visits.visitCount.toLocaleString()}
                />
                <Stat
                  label="Page views"
                  value={data.visits.totalViews.toLocaleString()}
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
              <SourceSplit
                rows={data.bySource}
                active={data.selectedSource}
                params={sp}
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
                  Submits of the weekly-summary email box on /events and
                  /training – may not all be successful signups. % of visitors =
                  the share of the page&apos;s visitors who submitted it; the
                  Total row divides by visitors to those two pages combined,
                  since only they have the box. Recording since 29 July 2026.
                </p>
              </Panel>
              <Panel title="Footer clicks">
                <CountTable
                  rows={data.footerClicks}
                  labelHead="Link"
                  total={footerTotal}
                />
                <p className={styles.caption}>
                  The footer&apos;s external links – the &quot;Help us out&quot;
                  and &quot;Newsletters&quot; columns. Recording since 29 July
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
 *  for a clean url; both links preserve the rest of the query. */
function ClickModeToggle({
  unique,
  params,
}: {
  unique: boolean
  params: SearchParams
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
      <Link
        href={uniqueQ ? `?${uniqueQ}` : '?'}
        scroll={false}
        className={`${styles.clickToggleBtn}${
          unique ? ` ${styles.clickToggleBtnActive}` : ''
        }`}
      >
        Unique
      </Link>
      <Link
        href={`?${totalParams.toString()}`}
        scroll={false}
        className={`${styles.clickToggleBtn}${
          !unique ? ` ${styles.clickToggleBtnActive}` : ''
        }`}
      >
        Total
      </Link>
    </div>
  )
}

/** For pages with a map, shows how the selected page's clicks split between the
 *  map and the cards. Each split is a link that filters the listing panels below
 *  to that source; "Total" clears the filter. Renders nothing for pages without
 *  a map. */
function SourceSplit({
  rows,
  active,
  params,
  label,
}: {
  rows: Counted[]
  active: string | null
  params: SearchParams
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
          <Link
            href={totalHref}
            scroll={false}
            className={`${styles.sourceStat} ${styles.sourceStatLink}${
              active == null ? ` ${styles.sourceStatActive}` : ''
            }`}
          >
            <span className={styles.sourceStatName}>Total</span>
            <span className={styles.sourceStatCount}>
              {total.toLocaleString()}
            </span>
          </Link>
        )}
        {rows.map(r => {
          const key = sourceSlug(r.name)
          const q = new URLSearchParams(base)
          q.set('source', key)
          return (
            <Link
              key={r.name}
              href={`?${q.toString()}`}
              scroll={false}
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
            </Link>
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
 *  Resource tabs show the site's page name and nav icon. */
function DashboardTabs({
  overview,
  pages,
  active,
  params,
}: {
  overview: { key: string; label: string }[]
  pages: { key: string; label: string; icon?: string }[]
  active: string
  params: SearchParams
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
          <Link
            key={t.key}
            href={hrefFor(t.key)}
            scroll={false}
            className={tabClass(t.key)}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className={styles.tabRow}>
        {pages.map(t => (
          <Link
            key={t.key}
            href={hrefFor(t.key)}
            scroll={false}
            className={tabClass(t.key)}
          >
            {t.icon && (
              <span className={styles.pageTabIcon}>
                <Icon
                  className="color-teal-bright-800"
                  src={`/images/icons/${t.icon}`}
                  size={12}
                />
              </span>
            )}
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{title}</h2>
      {children}
    </section>
  )
}

// Hard ceiling on rows a listings table sends to the browser. Real catalogs
// are a few hundred listings, so organic data never comes near it; it exists
// so a flood of fabricated distinct labels through the public track endpoint
// can't balloon the page payload (every row crosses the server→client
// boundary, hidden rows included). Truncation is announced, never silent.
const MAX_TABLE_ROWS = 1000

function TruncationNote({ shown, of }: { shown: number; of: number }) {
  return (
    <p className={styles.dim}>
      Showing the {shown.toLocaleString()} most-clicked of {of.toLocaleString()}{' '}
      listings.
    </p>
  )
}

/** What a slot label or range ('F1', '3', '3–5') sorts by: featured slots
 *  first, then numeric by the range's lowest slot. null (no slot recorded)
 *  sorts last. */
function rankSortValue(rank: string | undefined): number | null {
  if (!rank) return null
  const lo = rank.split('–')[0]
  const n = lo.startsWith('F') ? Number(lo.slice(1)) - 1000 : Number(lo)
  return Number.isFinite(n) ? n : null
}

/** "% of visitors" cell text: the share of the page's visitors who did the
 *  thing, or a dash when the range has no page-view visitors to divide by. */
function shareCell(share: VisitorShare | undefined): string {
  return share && share.visitors > 0 ? pct1(share.active, share.visitors) : '—'
}

function CountTable({
  rows: allRows,
  labelHead,
  countHead = 'Clicks',
  rankHead = '#',
  logoFor,
  linkFor,
  rankFor,
  pageFor,
  shareFor,
  shareHead = '% of visitors',
  total,
  totalShare,
}: {
  rows: Counted[]
  labelHead: string
  /** Heading for the count column — 'Clicks' unless the rows count something
   *  else (opens, conversations, …). */
  countHead?: string
  rankHead?: string
  logoFor?: (name: string) => string | undefined
  /** Destination url for a row's logo. When set, the logo becomes a link to the
   *  listing; the name text is deliberately left unlinked so it stays
   *  selectable/copyable. */
  linkFor?: (name: string) => string | undefined
  rankFor?: (name: string) => string | undefined
  /** When set, adds a Page column: the resource page each row belongs to,
   *  shown as the page's nav icon and name. */
  pageFor?: (name: string) => PageBadge | undefined
  /** When set, adds a "% of visitors" column: the share of each page's
   *  distinct visitors who did the thing at least once — always per-visitor,
   *  whichever count mode is on. Looked up by the row's displayed name. */
  shareFor?: (name: string) => VisitorShare | undefined
  /** Heading for the `shareFor` column, when it measures something other than
   *  "did the thing" — e.g. '% returning'. */
  shareHead?: string
  /** When set, adds a % column (each row's share of this total) and a Total
   *  footer row. The total is the denominator, so for a sliced "top N" table it
   *  can exceed the sum of the visible rows. */
  total?: number
  /** The Total row's "% of visitors" cell: the share of visitors who did the
   *  thing at least once, counted across the whole table. Computed from
   *  distinct visitors, not by summing the rows — a visitor who did several
   *  things counts once. Blank when unset. */
  totalShare?: VisitorShare
}) {
  if (allRows.length === 0) return <p className={styles.dim}>No data yet.</p>
  const rows = allRows.slice(0, MAX_TABLE_ROWS)
  const showPct = total != null && total > 0
  const columns: SortColumn[] = [
    ...(rankFor
      ? [{ label: rankHead, className: styles.rankCol, sort: 'rank' as const }]
      : []),
    { label: labelHead, sort: 'text' as const },
    ...(pageFor ? [{ label: 'Page', sort: 'text' as const }] : []),
    { label: countHead, className: styles.numCol, sort: 'number' as const },
    ...(showPct
      ? [{ label: '%', className: styles.pctCol, sort: 'number' as const }]
      : []),
    ...(shareFor
      ? [
          {
            label: shareHead,
            className: styles.pctCol,
            sort: 'number' as const,
          },
        ]
      : []),
  ]
  const values: SortValue[][] = rows.map(r => {
    const share = shareFor?.(r.name)
    return [
      ...(rankFor ? [rankSortValue(rankFor(r.name))] : []),
      r.name,
      ...(pageFor ? [pageFor(r.name)?.label ?? null] : []),
      r.count,
      ...(showPct ? [r.count] : []),
      ...(shareFor
        ? [share && share.visitors > 0 ? share.active / share.visitors : null]
        : []),
    ]
  })
  return (
    <>
      <SortableTable
        columns={columns}
        values={values}
        foot={
          total != null ? (
            <tr className={styles.totalRow}>
              {rankFor && <td className={styles.rankCol} />}
              <td className={styles.totalLabel}>Total</td>
              {pageFor && <td />}
              <td className={styles.numCol}>{total.toLocaleString()}</td>
              {showPct && (
                <td className={styles.pctCol}>{pct1(total, total)}</td>
              )}
              {shareFor && (
                <td className={styles.pctCol}>
                  {/* active 0 means the range's clicks predate visitor ids
                      (or all came from private browsing) — that's unknown,
                      not a true 0%, so it gets the same dash as the rows. */}
                  {totalShare
                    ? totalShare.active > 0
                      ? shareCell(totalShare)
                      : '—'
                    : null}
                </td>
              )}
            </tr>
          ) : undefined
        }
      >
        {rows.map((r, i) => {
          const rank = rankFor?.(r.name)
          const featured = rank?.startsWith('F')
          const href = linkFor?.(r.name)
          const badge = pageFor?.(r.name)
          return (
            <tr key={i}>
              {rankFor && (
                <td
                  className={`${styles.rankCol}${
                    featured ? ` ${styles.rankFeatured}` : ''
                  }`}
                >
                  {rank ?? '—'}
                </td>
              )}
              <td className={styles.nameCell}>
                {logoFor &&
                  (href && href !== '#' ? (
                    <a
                      className={styles.logoLink}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${r.name}`}
                    >
                      <Logo src={logoFor(r.name)} />
                    </a>
                  ) : (
                    <Logo src={logoFor(r.name)} />
                  ))}
                <span>{r.name}</span>
              </td>
              {pageFor && (
                <td>
                  {badge && (
                    <span className={styles.pageBadge}>
                      {badge.icon && (
                        <span className={styles.pageTabIcon}>
                          <Image
                            src={badge.icon}
                            alt=""
                            width={12}
                            height={12}
                          />
                        </span>
                      )}
                      {badge.label}
                    </span>
                  )}
                </td>
              )}
              <td className={styles.numCol}>{r.count.toLocaleString()}</td>
              {showPct && (
                <td className={styles.pctCol}>{pct1(r.count, total)}</td>
              )}
              {shareFor && (
                <td className={styles.pctCol}>{shareCell(shareFor(r.name))}</td>
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
  funnel,
  opensByPage,
  openShareByPage,
  siteOpenShare,
  destinations,
  conv,
  themes,
  unique,
}: {
  funnel: ChatbotFunnel
  opensByPage: Counted[]
  openShareByPage: VisitorShare[]
  siteOpenShare: VisitorShare
  destinations: ClickDestination[]
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
  return (
    <>
      <Panel title="Funnel · unique users">
        <Funnel
          stages={[
            { label: 'Opened', value: funnel.opened },
            { label: 'Sent a message', value: funnel.typed },
            { label: 'Clicked a result', value: funnel.clicked },
          ]}
        />
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
  search,
  index,
  unique,
}: {
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

/** One stat in the Conversations row — reuses the funnel-stage styling so the
 *  row reads like the funnel above it. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.funnelStage}>
      <div className={styles.funnelValue}>{value}</div>
      <div className={styles.funnelLabel}>{label}</div>
    </div>
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
