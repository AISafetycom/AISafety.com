'use client'

import {
  entryFromEnd,
  historyIsComplete,
  loggedTurnCount,
  turnFromEnd,
} from '@/lib/admin/conversation-turns'
import {
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { parseLog, parseNotes, stampToDate } from '@/lib/admin/annotation-log'
import styles from '../admin.module.css'
import TranscriptMessage, {
  ClickedCardsContext,
  ListingInfoContext,
  hasSuggestButton,
  resolveListing,
  type ListingInfo,
} from './TranscriptMessage'
import ExcludeBrowserToggle from './ExcludeBrowserToggle'
import FilterDropdown from '@/components/FilterDropdown'
import { chipsFor, greetingFor } from '@/lib/assistant/pages'

interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

interface LoggedToolCall {
  name: string
  input?: { id?: string; query?: string }
  ok?: boolean
}

/** The tool calls behind the chatbot message at history index msgIdx.
 *
 *  Data.tools holds one array per LOGGED TURN since the conversation began
 *  (abandoned/error turns log the question with no reply), while
 *  Data.history is a sliding WINDOW (the last 50 messages; 14 on older
 *  rows). turnFromEnd in conversation-turns.ts does the lining up. */
function toolCallsForMessage(
  data: ConversationData,
  msgIdx: number
): LoggedToolCall[] {
  const turn = entryFromEnd(data.tools, turnFromEnd(data, msgIdx))
  if (!Array.isArray(turn)) return []
  return turn.filter(
    (t): t is LoggedToolCall =>
      !!t &&
      typeof t === 'object' &&
      typeof (t as LoggedToolCall).name === 'string'
  )
}

/** Card ids in the reply at history index msgIdx that degraded to a generic
 *  "Browse X" link (or nothing) in the visitor's chat. Undefined when the turn
 *  predates fallback tracking, so the renderer can fall back to its
 *  resolvability heuristic. The set carries each id plus its bare rec form,
 *  since card tokens are sometimes written without the type prefix. */
function fallbackCardsForMessage(
  data: ConversationData,
  msgIdx: number
): Set<string> | undefined {
  if (!data.fallbackCards) return undefined
  const turn = entryFromEnd(data.fallbackCards, turnFromEnd(data, msgIdx))
  if (!Array.isArray(turn)) return undefined
  const set = new Set<string>()
  for (const id of turn) {
    if (typeof id !== 'string') continue
    const cleaned = id.replace(/\s+/g, '')
    set.add(cleaned)
    const rec = /rec[A-Za-z0-9]+/.exec(cleaned)?.[0]
    if (rec) set.add(rec)
  }
  return set
}

/** Lookups beyond the catalog that the bot made while composing a reply —
 *  live page reads and past-round history checks — shown in the transcript
 *  so it's clear when an answer drew on a listing's page or on rounds the
 *  site no longer displays. */
function VisitedPages({ reads }: { reads: LoggedToolCall[] }) {
  const listings = useContext(ListingInfoContext)
  if (reads.length === 0) return null
  return (
    <div className={styles.convTurnVisited}>
      {reads.map((r, i) => {
        const id = r.input?.id ?? ''
        const info = resolveListing(listings, id)
        if (r.name === 'get_program_history') {
          const query = typeof r.input?.query === 'string' ? r.input.query : ''
          const subject = info?.name ?? (query ? `"${query}"` : id)
          return (
            <span key={i}>
              {r.ok ? '🕘 checked past rounds of ' : '🕘 tried past rounds of '}
              {subject}
              {r.ok ? '' : ' – lookup failed'}
            </span>
          )
        }
        const name = info?.name ?? id
        const url = info?.url
        return (
          <span key={i}>
            {r.ok ? '🌐 visited ' : '🌐 tried '}
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                {name}
              </a>
            ) : (
              name
            )}
            {r.ok ? "'s webpage" : "'s webpage – read failed"}
          </span>
        )
      })}
    </div>
  )
}

interface ConversationData {
  user: string
  response: string
  history: HistoryTurn[]
  /** Each history message's position in the VISITOR's message list — the
   *  indexing the delivery/rating/click keys use. Aligned with `history`.
   *  Absent on rows from before this was logged. */
  historyIndices?: unknown[]
  /** URL of the conversation's full-transcript blob mirror — present once
   *  the chat outgrew what the Airtable row can hold. Its presence tells the
   *  viewer a complete transcript is fetchable via the single-row API. */
  transcript?: string
  tools: unknown[]
  /** Per-turn (aligned with tools): card ids that degraded to a "Browse X"
   *  link in the visitor's chat. Absent on rows from before this was logged. */
  fallbackCards?: unknown[]
  /** Per-turn (aligned with tools): ISO timestamp of when that turn's user
   *  message arrived. Absent on rows from before this was logged. */
  turnTimes?: unknown[]
  /** One entry per logged turn (aligned with `tools`): the position of that
   *  turn's reply in the visitor's message list. Rows since 2 Sept 2026. */
  turnIndices?: unknown[]
  /** Per-turn (aligned with tools): the site page the visitor was on when
   *  they sent that turn's message. Absent on rows from before this was
   *  logged. */
  pages?: unknown[]
  citations: string[]
  citationRefs?: { id: string; name: string; url: string; logo?: string }[]
  geo: { city?: string; region?: string; country?: string } | null
  referrer: string | null
  utm: Record<string, string> | null
  pageState: Record<string, unknown> | null
  zeroMatches: boolean
  status?: 'abandoned' | 'error'
}

/** What the visitor's browser reported about one reply (see TurnDelivery in
 *  lib/admin/airtable.ts). All durations are ms from the visitor's send. */
interface TurnDelivery {
  received?: number
  stopped?: number
  error?: number
  /** What the error was, as the browser saw it (set alongside `error`). */
  errorText?: string
  left?: number
  panelClosed?: number
  tabHidden?: number
  panelOpen?: boolean
  tabVisible?: boolean
  seen?: number
}

/** The Review single select's options, as named in Airtable. */
const REVIEW_VALUES = ['Good', 'Bad', 'Unsure'] as const
type ReviewValue = (typeof REVIEW_VALUES)[number]

interface Conversation {
  id: string
  createdAt: string
  session: string
  page: string
  latencyMs: number | null
  promptVersion: string
  notes: string
  tags: string[]
  /** Reviewer's verdict on the whole conversation ('' when not yet rated) —
   *  distinct from `ratings`, the visitor's own thumbs on individual replies. */
  review: ReviewValue | ''
  /** Admin name behind the current verdict ('' when unrated). */
  reviewedBy: string
  /** One line per annotation change, oldest first (see annotation-log.ts). */
  reviewLog: string
  data: ConversationData | null
  clickedCitations: string[]
  /** Visitor's thumbs ratings of the bot's replies (turn index → 'up' |
   *  'down'), from the row's Ratings field. */
  ratings: Record<string, 'up' | 'down'>
  /** What the visitor's browser reported about each reply (turn index →
   *  TurnDelivery), from the row's Delivery field. */
  delivery: Record<string, TurnDelivery>
}

/** "United States" for an ISO-3166 alpha-2 code, US English spelling. */
const regionNames = new Intl.DisplayNames(['en-US'], { type: 'region' })

/** ISO-3166 alpha-2 → "United States 🇺🇸". Falls back to the raw value when
 *  it isn't a recognisable two-letter country code. */
function countryLabel(code: string): string {
  const cc = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return code
  const flag = String.fromCodePoint(
    ...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)
  )
  const name = regionNames.of(cc)
  return `${name && name !== cc ? name : cc} ${flag}`
}

/** ISO 3166-2 subdivision codes that read as opaque abbreviations when Vercel
 *  has no city for a visitor. Keyed by country so codes stay unambiguous;
 *  anything unmapped shows as-is. */
const REGION_NAMES: Record<string, string> = {
  'GB-ENG': 'England',
  'GB-SCT': 'Scotland',
  'GB-WLS': 'Wales',
  'GB-NIR': 'Northern Ireland',
}

function regionLabel(region: string, country?: string): string {
  const cc = country?.trim().toUpperCase() ?? ''
  return REGION_NAMES[`${cc}-${region.trim().toUpperCase()}`] ?? region
}

function geoString(geo: ConversationData['geo']): string {
  if (!geo) return ''
  const country = geo.country ? countryLabel(geo.country) : undefined
  // Prefer the city; only when there's none do we show the region (expanded to
  // a readable name where we have one, e.g. "ENG" → "England").
  const place =
    geo.city ?? (geo.region ? regionLabel(geo.region, geo.country) : undefined)
  return [place, country].filter(Boolean).join(', ')
}

/** "12 June 2026" — site-wide DATE MONTH YEAR convention. */
function formatDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** A stored "2026-09-05 11:42 UTC" annotation stamp, in the viewer's own time
 *  zone like every other time on this page ("5 Sept 2026, 12:42"). */
function formatStamp(stamp: string): string {
  const d = stampToDate(stamp)
  if (!d) return stamp
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** "8s", "1m 12s" — a time-since-send for the delivery notes, coarser than
 *  formatLatency because these mark moments a person did something. */
function formatElapsed(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s - m * 60}s`
}

/** The visitor-side story of one reply, for the transcript and row badge:
 *  a short label, whether it deserves attention (`warn`), and a longer
 *  tooltip. Undefined when the browser reported nothing for the turn (older
 *  rows, excluded browsers, or a report that never arrived). */
function describeDelivery(
  d: TurnDelivery | undefined
): { label: string; warn: boolean; title: string } | undefined {
  if (!d) return undefined
  if (d.left != null) {
    return {
      label: `left the page at ${formatElapsed(d.left)}`,
      warn: true,
      title:
        'The visitor closed the tab or navigated away while the reply was still streaming — they did not get the whole answer',
    }
  }
  if (d.stopped != null) {
    return {
      label: `stopped at ${formatElapsed(d.stopped)}`,
      warn: false,
      title: 'The visitor pressed Stop (or cleared the chat) mid-reply',
    }
  }
  if (d.error != null) {
    const at = `failed in the browser at ${formatElapsed(d.error)}`
    return {
      label: d.errorText ? `${at} — ${d.errorText}` : at,
      warn: true,
      title:
        "The visitor's browser hit an error before the reply finished (network drop, or the server sent an error) — they saw an error message" +
        (d.errorText ? `\n\nWhat the browser reported: ${d.errorText}` : ''),
    }
  }
  if (d.received != null) {
    const base = `received in ${formatElapsed(d.received)}`
    // Out of view when it arrived?
    const outOfView =
      d.panelOpen === false
        ? 'panel closed'
        : d.tabVisible === false
          ? 'tab in background'
          : undefined
    if (!outOfView) {
      const detail =
        d.panelClosed != null
          ? ` (panel closed at ${formatElapsed(d.panelClosed)}, reopened before it finished)`
          : d.tabHidden != null
            ? ` (tab hidden at ${formatElapsed(d.tabHidden)}, back before it finished)`
            : ''
      return {
        label: base + detail,
        warn: false,
        title:
          'The whole reply arrived in the visitor’s browser with the chat panel open and the tab visible — measured from when they sent the message',
      }
    }
    const when =
      outOfView === 'panel closed'
        ? d.panelClosed
        : (d.tabHidden ?? d.panelClosed)
    const whenNote = when != null ? ` at ${formatElapsed(when)}` : ''
    if (d.seen != null) {
      return {
        label: `${base} · ${outOfView}${whenNote} · seen at ${formatElapsed(d.seen)}`,
        warn: false,
        title: `The reply arrived while the ${outOfView === 'panel closed' ? 'chat panel was closed' : 'tab was in the background'}; the visitor came back to it ${formatElapsed(d.seen)} after sending`,
      }
    }
    return {
      label: `${base} · ${outOfView}${whenNote} · not seen`,
      warn: true,
      title: `The reply arrived while the ${outOfView === 'panel closed' ? 'chat panel was closed' : 'tab was in the background'}, and the visitor had not come back to it as of their last report`,
    }
  }
  if (d.seen != null) {
    // A 'seen' without its outcome — the outcome report was lost. Say what
    // we know rather than nothing.
    return {
      label: `seen at ${formatElapsed(d.seen)}`,
      warn: false,
      title:
        'The visitor brought this reply into view (the browser’s earlier report on how it arrived did not reach us)',
    }
  }
  return undefined
}

/** Tooltip for the row-header thumb badge. */
function ratingTitle(value: 'up' | 'down', count: number): string {
  const which = value === 'up' ? 'thumbs up' : 'thumbs down'
  return count === 1
    ? `The visitor rated a reply ${which}`
    : `The visitor rated ${count} replies ${which}`
}

/** Row-header badge for the latest turn: only the cases worth flagging when
 *  skimming (the transcript carries the full note per reply). */
function deliveryBadge(
  d: TurnDelivery | undefined
): { text: string; title: string } | undefined {
  if (!d) return undefined
  if (d.left != null) {
    return {
      text: 'LEFT MID-REPLY',
      title:
        'The visitor closed the tab or navigated away while the reply was still streaming',
    }
  }
  if (d.stopped != null) {
    return { text: 'STOPPED', title: 'The visitor pressed Stop mid-reply' }
  }
  if (d.error != null) {
    return {
      text: 'NOT DELIVERED',
      title:
        "The visitor's browser hit an error before the reply finished — they saw an error message" +
        (d.errorText ? `\n\nWhat the browser reported: ${d.errorText}` : ''),
    }
  }
  if (
    d.received != null &&
    (d.panelOpen === false || d.tabVisible === false) &&
    d.seen == null
  ) {
    return {
      text: 'UNSEEN',
      title:
        d.panelOpen === false
          ? 'The reply arrived after the visitor closed the chat panel, and they had not reopened it as of their last report'
          : 'The reply arrived while the tab was in the background, and the visitor had not come back to it as of their last report',
    }
  }
  return undefined
}

/** When the user message at history index msgIdx was sent, e.g. "14:03" — or
 *  "14 July, 14:03" when it falls on a different day than the conversation
 *  started. Undefined for rows logged before turn times were tracked. */
function timeForUserMessage(
  data: ConversationData,
  msgIdx: number,
  conversationStart: string
): string | undefined {
  const ts = entryFromEnd(data.turnTimes, turnFromEnd(data, msgIdx))
  if (typeof ts !== 'string') return undefined
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return undefined
  const time = formatTime(ts)
  const sameDay = formatDay(ts) === formatDay(conversationStart)
  if (sameDay) return time
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
  return `${day}, ${time}`
}

/** The page the visitor was on when they sent the user message at history
 *  index msgIdx. Undefined for rows logged before per-turn pages were
 *  tracked (same turn resolution as timeForUserMessage). */
function pageForUserMessage(
  data: ConversationData,
  msgIdx: number
): string | undefined {
  const page = entryFromEnd(data.pages, turnFromEnd(data, msgIdx))
  return typeof page === 'string' ? page : undefined
}

// Conversations this browser has already opened, so reviewed chats read as
// dimmed — like seen emails in an inbox. Reviewing is personal to the viewer,
// so the ids live in localStorage rather than Airtable. Most recent last,
// capped so the list can't grow without bound.
const VIEWED_KEY = 'admin-conversations-viewed'
const VIEWED_CAP = 5000

function loadViewedIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VIEWED_KEY) ?? '[]')
    if (!Array.isArray(parsed)) throw new Error('not an array')
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch (err) {
    console.warn('Resetting unreadable viewed-conversations list:', err)
    return []
  }
}

export default function ConversationList() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [listings, setListings] = useState<Record<string, ListingInfo>>({})
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zeroOnly, setZeroOnly] = useState(false)
  // `searchInput` tracks the box; `search` is the debounced value actually sent
  // to the server, so we don't refetch on every keystroke.
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  // Reviewer filters, applied server-side: Review verdicts ('Unrated' for
  // conversations nobody has judged) and exact labels. Several picks within
  // one pill broaden the match, like the site's filter pills.
  const [ratingFilter, setRatingFilter] = useState<string[]>([])
  const [labelFilter, setLabelFilter] = useState<string[]>([])
  // Log-wide label and verdict counts (fetched once), so the filter pills
  // and the per-conversation label picker cover more than what this page
  // happens to show. Merged with the loaded conversations' tags in
  // `allLabels`.
  const [facets, setFacets] = useState<{
    labels: Record<string, number>
    ratings: Record<string, number>
  }>({ labels: {}, ratings: {} })
  // The conversation a shared ?id= link points at. undefined = URL not read
  // yet (loads hold off); null = no link, show the normal list.
  const [linkedId, setLinkedId] = useState<string | null | undefined>(undefined)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Airtable cursor for the next, older batch — null once we've reached the
  // very first conversation. Drives the "Load more" button.
  const [offset, setOffset] = useState<string | null>(null)
  // Label for the viewer's local timezone (e.g. "America/Bogota (GMT-5)").
  // Resolved on the client so it matches the row times, which also render in
  // the browser's local zone. Empty until mounted to avoid an SSR mismatch.
  const [tzLabel, setTzLabel] = useState('')
  // Ids of conversations this browser has opened. Loaded after mount
  // (localStorage is browser-only) to avoid an SSR mismatch.
  const [viewed, setViewed] = useState<Set<string>>(new Set())
  // Ids whose full transcript we've already requested this page view, so
  // the expand effect below fires once per conversation.
  const fullFetched = useRef<Set<string>>(new Set())

  const PAGE_SIZE = 200

  const load = async (opts: {
    zeroOnly: boolean
    search: string
    rating: string[]
    label: string[]
    /** Serve exactly this conversation (a shared link) instead of the list. */
    id?: string
  }) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (opts.id) {
        params.set('id', opts.id)
      } else {
        params.set('limit', String(PAGE_SIZE))
        if (opts.zeroOnly) params.set('zeroOnly', '1')
        if (opts.search) params.set('search', opts.search)
        for (const r of opts.rating) params.append('rating', r)
        for (const l of opts.label) params.append('label', l)
      }
      const res = await fetch(`/api/admin/conversations?${params}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`
        )
      }
      const data = (await res.json()) as {
        conversations: Conversation[]
        listings?: Record<string, ListingInfo>
        offset?: string | null
      }
      setConversations(data.conversations)
      setListings(data.listings ?? {})
      setOffset(data.offset ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    if (!offset || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', offset)
      if (zeroOnly) params.set('zeroOnly', '1')
      if (search) params.set('search', search)
      for (const r of ratingFilter) params.append('rating', r)
      for (const l of labelFilter) params.append('label', l)
      const res = await fetch(`/api/admin/conversations?${params}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`
        )
      }
      const data = (await res.json()) as {
        conversations: Conversation[]
        listings?: Record<string, ListingInfo>
        offset?: string | null
      }
      // Append older conversations, guarding against any id we already have
      // (a record arriving at the page boundary between requests).
      setConversations(prev => {
        const seen = new Set(prev.map(c => c.id))
        return [...prev, ...data.conversations.filter(c => !seen.has(c.id))]
      })
      setListings(prev => ({ ...prev, ...(data.listings ?? {}) }))
      setOffset(data.offset ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setLoadingMore(false)
    }
  }

  // Debounce typing into the committed `search` value (350ms after a pause).
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  // Wait for the mount effect below to read any ?id= from the URL before the
  // first fetch, so a shared link loads its one conversation directly rather
  // than the whole list first.
  useEffect(() => {
    if (linkedId === undefined) return
    void load({
      zeroOnly,
      search,
      rating: ratingFilter,
      label: labelFilter,
      id: linkedId ?? undefined,
    })
  }, [zeroOnly, search, ratingFilter, labelFilter, linkedId])

  // A conversation with a blob-mirrored full transcript arrives windowed in
  // the list payload (the list endpoint can't afford a blob fetch per row).
  // When one is opened, refetch just that conversation — the single-row API
  // merges the blob — and swap it in. Skipped when the stored history
  // already covers every logged turn (e.g. it came in via a shared ?id=
  // link, which is served merged).
  useEffect(() => {
    if (!expandedId || fullFetched.current.has(expandedId)) return
    const conv = conversations.find(c => c.id === expandedId)
    const data = conv?.data
    if (!data?.transcript) return
    const turnCount = data.turnTimes?.length ?? 0
    const stored = data.history.filter(t => t.role === 'user').length
    if (turnCount > 0 && stored >= turnCount) return
    fullFetched.current.add(expandedId)
    const id = expandedId
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/conversations?id=${encodeURIComponent(id)}`
        )
        if (!res.ok) return
        const payload = (await res.json()) as {
          conversations: Conversation[]
          listings?: Record<string, ListingInfo>
        }
        const full = payload.conversations?.[0]
        if (!full) return
        setConversations(prev => prev.map(c => (c.id === full.id ? full : c)))
        setListings(prev => ({ ...prev, ...(payload.listings ?? {}) }))
      } catch (err) {
        // Keep the windowed view — the divider still says turns are missing.
        console.warn('Could not load the full transcript:', err)
      }
    })()
  }, [expandedId, conversations])

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const abbr = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value
    setTzLabel([tz, abbr && `(${abbr})`].filter(Boolean).join(' '))
    setViewed(new Set(loadViewedIds()))
    // A shared link opens the log at one conversation, already expanded.
    const id = new URL(window.location.href).searchParams.get('id')
    setLinkedId(id || null)
    if (id) setExpandedId(id)
    // Log-wide label/verdict counts, for the filter pills and pickers.
    void fetch('/api/admin/conversations?facets=1')
      .then(res => (res.ok ? res.json() : { labels: {}, ratings: {} }))
      .then(
        (data: {
          labels?: Record<string, number>
          ratings?: Record<string, number>
        }) => {
          setFacets({ labels: data.labels ?? {}, ratings: data.ratings ?? {} })
        }
      )
      .catch(err => console.warn('Could not load filter counts:', err))
  }, [])

  /** Keep ?id= in the address bar matching the open conversation, so the URL
   *  is always a shareable link to what's on screen. */
  const syncUrl = (id: string | null) => {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('id', id)
    else url.searchParams.delete('id')
    window.history.replaceState(null, '', url)
  }

  // Every label offered by the pickers: the log-wide list plus anything on
  // the conversations in front of us (which also catches labels added just
  // now, without refetching).
  const allLabels = useMemo(() => {
    const set = new Set(Object.keys(facets.labels))
    for (const c of conversations) for (const t of c.tags) set.add(t)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [facets, conversations])

  /** Site-style multi-select toggle: clicking a checked value unchecks it. */
  const toggleFilter = (
    value: string,
    list: string[],
    set: (next: string[]) => void
  ) => {
    set(list.includes(value) ? list.filter(v => v !== value) : [...list, value])
  }

  const markViewed = (id: string) => {
    if (viewed.has(id)) return
    // Re-read storage so marks from other admin tabs aren't overwritten.
    const ids = [...loadViewedIds().filter(v => v !== id), id].slice(
      -VIEWED_CAP
    )
    try {
      localStorage.setItem(VIEWED_KEY, JSON.stringify(ids))
    } catch (err) {
      console.warn('Could not save viewed-conversations list:', err)
    }
    setViewed(new Set(ids))
  }

  const handleUpdate = (updated: Conversation) => {
    setConversations(prev => prev.map(c => (c.id === updated.id ? updated : c)))
  }

  return (
    <ListingInfoContext.Provider value={listings}>
      <div className={styles.convFilters}>
        <input
          type="search"
          className={styles.convSearch}
          placeholder="Search conversations…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          title="Searches the whole log — user questions, bot replies, listings shown, page, notes and labels"
        />
        <FilterDropdown
          title="Rating"
          options={[...REVIEW_VALUES, 'Unrated']}
          selected={ratingFilter}
          counts={facets.ratings}
          onToggle={v => toggleFilter(v, ratingFilter, setRatingFilter)}
        />
        {allLabels.length > 0 && (
          <FilterDropdown
            title="Label"
            options={allLabels}
            selected={labelFilter}
            counts={facets.labels}
            onToggle={v => toggleFilter(v, labelFilter, setLabelFilter)}
          />
        )}
        <label title="Show only conversations where the chatbot searched the directory and found nothing — useful for spotting gaps in the listings">
          <input
            type="checkbox"
            checked={zeroOnly}
            onChange={e => setZeroOnly(e.target.checked)}
          />
          Only chats with no results
        </label>
        <ExcludeBrowserToggle />
        {loading && <span className={styles.convStatus}>loading…</span>}
        {error && <span className={styles.convError}>{error}</span>}
        {tzLabel && (
          <span
            className={styles.convTzNote}
            title="Times below are shown in your browser's local timezone"
          >
            times in {tzLabel}
          </span>
        )}
      </div>

      {linkedId && (
        <div className={styles.convLinkedNote}>
          Showing one linked conversation.{' '}
          <button
            type="button"
            className={styles.convLinkedClear}
            onClick={() => {
              setLinkedId(null)
              syncUrl(null)
            }}
          >
            Show all conversations
          </button>
        </div>
      )}

      <div className={styles.convList}>
        {conversations.map((c, i) => {
          const day = formatDay(c.createdAt)
          const prevDay =
            i > 0 ? formatDay(conversations[i - 1].createdAt) : null
          return (
            <Fragment key={c.id}>
              {day !== prevDay && (
                <div className={styles.convDayDivider}>{day}</div>
              )}
              <ConversationRow
                conv={c}
                expanded={expandedId === c.id}
                viewed={viewed.has(c.id)}
                allLabels={allLabels}
                onToggle={() => {
                  const next = expandedId === c.id ? null : c.id
                  if (next) markViewed(c.id)
                  setExpandedId(next)
                  syncUrl(next)
                }}
                onUpdate={handleUpdate}
              />
            </Fragment>
          )
        })}
        {conversations.length === 0 && !loading && (
          <div className={styles.convStatus}>
            {search || zeroOnly
              ? 'No conversations match.'
              : 'No conversations yet.'}
          </div>
        )}
      </div>

      {offset && !loading && (
        <div className={styles.convLoadMore}>
          <button
            type="button"
            className={styles.editorButton}
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </ListingInfoContext.Provider>
  )
}

function ConversationRow({
  conv,
  expanded,
  viewed,
  allLabels,
  onToggle,
  onUpdate,
}: {
  conv: Conversation
  expanded: boolean
  viewed: boolean
  allLabels: string[]
  onToggle: () => void
  onUpdate: (c: Conversation) => void
}) {
  const [noteDraft, setNoteDraft] = useState('')
  const [deletingNote, setDeletingNote] = useState<number | null>(null)
  const [saveStatus, setSaveStatus] = useState('')
  const [labelInput, setLabelInput] = useState('')
  // Custom suggestion menu under the label input (a native <datalist> can't
  // be styled, so its white popup clashed with the dark admin theme).
  const [labelMenuOpen, setLabelMenuOpen] = useState(false)
  const [labelHighlight, setLabelHighlight] = useState(-1)
  const [linkCopied, setLinkCopied] = useState(false)
  const data = conv.data
  // Visitor messages actually stored in the (windowed) history — what the
  // transcript below can show.
  const storedTurns = data?.history.filter(t => t.role === 'user').length ?? 0
  // True length of the conversation. When the stored history is the whole
  // message list it is the truth itself — the per-turn arrays can only
  // overshoot it (re-sent turns logged twice, before 2 Sept 2026). Otherwise
  // the per-turn arrays, one entry per logged turn and never windowed, say
  // how far a long chat outgrew the history window. Rows predating per-turn
  // tracking fall back to the stored history.
  const loggedTurns = data ? loggedTurnCount(data) : 0
  const turnCount =
    data && historyIsComplete(data)
      ? storedTurns
      : loggedTurns > 0
        ? loggedTurns
        : storedTurns
  const missingTurns = Math.max(0, turnCount - storedTurns)
  const geo = data ? geoString(data.geo) : ''
  // Collapsed row previews the visitor's OPENING message (how they first
  // arrived), not the most recent turn — or the oldest still stored, when a
  // long chat has outgrown the history window. Fall back to the latest-turn
  // field for old rows that have no stored history.
  const firstUser =
    data?.history.find(t => t.role === 'user')?.content ?? data?.user ?? ''
  // Cards and links the visitor clicked. New clicks are stored turn-scoped as
  // `<turnIndex>:<listing id>` / `<turnIndex>:link:<href>` so only the
  // instance the visitor actually opened is badged — a listing or href shown
  // in three replies no longer looks like three clicks. For card entries we
  // seed the set with each entry verbatim plus a `<turn>:<rec>` variant
  // (tokens are sometimes written without the type prefix). Legacy entries
  // have no leading `<turn>:` — for those the renderers fall back to matching
  // every copy, preserving old rows' behaviour.
  const clickedSet = useMemo(() => {
    const s = new Set<string>()
    for (const raw of conv.clickedCitations) {
      s.add(raw)
      const turnScoped = /^(\d+):(.+)$/.exec(raw)
      if (turnScoped) {
        const [, turn, id] = turnScoped
        if (!id.startsWith('link:')) {
          const rec = /rec[A-Za-z0-9]+/.exec(id)?.[0]
          if (rec) s.add(`${turn}:${rec}`)
        }
      } else if (!raw.startsWith('link:')) {
        const rec = /rec[A-Za-z0-9]+/.exec(raw)?.[0]
        if (rec) s.add(rec)
      }
    }
    return s
  }, [conv.clickedCitations])
  // Thumbs ratings the visitor left, by turn index (same indexing as the
  // `<turnIndex>:…` click keys above, so the badge lands on the exact reply).
  const ratingByTurn = useMemo(() => {
    const m = new Map<number, 'up' | 'down'>()
    for (const [turn, value] of Object.entries(conv.ratings)) {
      const n = Number(turn)
      if (Number.isInteger(n) && (value === 'up' || value === 'down')) {
        m.set(n, value)
      }
    }
    return m
  }, [conv.ratings])
  // Header badge: how many replies the visitor rated each way, so a thumb is
  // visible while skimming the list rather than only inside the transcript.
  // Counted straight off the field (not via clientIndexOf) — a rating is worth
  // flagging even when we can't pin it to a specific reply.
  const ratingCounts = useMemo(() => {
    let up = 0
    let down = 0
    for (const value of Object.values(conv.ratings)) {
      if (value === 'up') up++
      else if (value === 'down') down++
    }
    return { up, down }
  }, [conv.ratings])
  // Maps a stored-history index to the visitor's message-list position — the
  // indexing the delivery reports, thumbs ratings, and turn-scoped click keys
  // are keyed on. New rows store the mapping (historyIndices); the two
  // indexings only agree while nothing was dropped from the stored history,
  // so for legacy rows without it, keep the identity mapping only when it is
  // provably safe (no turns trimmed, strict user/assistant alternation) and
  // otherwise hide the position-keyed badges rather than pin them on the
  // wrong replies — a trimmed conversation showed "stopped at 6s" on a reply
  // the visitor never stopped. Null means "unknowable, show nothing".
  const clientIndexOf = useMemo(() => {
    const history = data?.history ?? []
    const indices = data?.historyIndices
    if (
      Array.isArray(indices) &&
      indices.length === history.length &&
      indices.every(n => typeof n === 'number' && Number.isInteger(n))
    ) {
      return (i: number) => indices[i] as number
    }
    if (missingTurns > 0) return null
    const alternating = history.every(
      (m, i) => m.role === (i % 2 === 0 ? 'user' : 'assistant')
    )
    return alternating ? (i: number) => i : null
  }, [data, missingTurns])
  // What the visitor's browser reported about the latest reply, and the badge
  // (if any) it earns in the collapsed row. Delivery is keyed by the reply's
  // position in the VISITOR's message list, so translate the stored index.
  const latestDelivery = useMemo(() => {
    const history = data?.history ?? []
    const last = history.length - 1
    if (last < 0 || history[last].role !== 'assistant') return undefined
    if (!clientIndexOf) return undefined
    return conv.delivery[String(clientIndexOf(last))]
  }, [data, conv.delivery, clientIndexOf])
  const latestBadge = useMemo(
    () => deliveryBadge(latestDelivery),
    [latestDelivery]
  )
  // An abandoned turn now keeps whatever had streamed before the connection
  // dropped. Distinguish "nothing the visitor could read" from "cut off
  // part-way through the answer", and let the browser's own report name the
  // cause when it has one (Stop pressed / left). Visible text is what follows
  // the last [[/thinking]] marker; with no marker yet, a turn that had made
  // tool calls was still in its reasoning preamble (which the widget hides
  // behind the tool activity), so nothing readable had shown.
  const abandonedHadText = useMemo(() => {
    if (data?.status !== 'abandoned') return false
    const parts = data.response.split(/\[\[\s*\/\s*thinking\s*\]\]/i)
    if (parts.length === 1) {
      const lastTools = data.tools[data.tools.length - 1]
      if (Array.isArray(lastTools) && lastTools.length > 0) return false
    }
    return (parts.pop() ?? '').trim().length > 0
  }, [data])
  // Where the visitor ended up if they navigated mid-conversation. conv.page
  // is the page the chat STARTED on (per-turn pages live in data.pages), so a
  // differing last entry means the conversation moved — surface the hop in
  // the collapsed row. Undefined on rows from before pages were logged.
  const navigatedTo = useMemo(() => {
    const pages = data?.pages
    if (!Array.isArray(pages)) return undefined
    const last = pages[pages.length - 1]
    return typeof last === 'string' && last !== conv.page ? last : undefined
  }, [data, conv.page])
  // Once the bot offered a "Suggest a listing" button, the "NO MATCH" badge is
  // redundant — the no-match was handled gracefully. Keep the badge only for
  // no-match conversations where no suggest form was offered.
  const showedSuggest = useMemo(() => {
    if (!data) return false
    const replies =
      data.history.length > 0
        ? data.history.filter(t => t.role === 'assistant').map(t => t.content)
        : [data.response]
    return replies.some(hasSuggestButton)
  }, [data])

  const persist = async (patch: {
    notes?: string
    tags?: string[]
    review?: ReviewValue | null
    addNote?: string
    deleteNote?: { index: number; at: string; actor: string }
  }) => {
    setSaveStatus('saving…')
    try {
      const res = await fetch('/api/admin/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conv.id, ...patch }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setSaveStatus(body.error ?? 'save failed')
        return
      }
      const updated = (await res.json()) as { conversation: Conversation }
      // Keep the transcript we're already showing: the PATCH re-reads the
      // row without the blob merge, and annotations never change Data — so
      // taking the response's data would re-window a merged transcript.
      onUpdate({ ...updated.conversation, data: conv.data })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(''), 1500)
    } catch {
      setSaveStatus('save failed')
    }
  }

  /** Attach a label, reusing an existing label's casing when the reviewer's
   *  typing differs only there — so "scope" can't spawn a sibling of "Scope". */
  const addLabel = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const canonical =
      allLabels.find(l => l.toLowerCase() === trimmed.toLowerCase()) ?? trimmed
    setLabelInput('')
    setLabelHighlight(-1)
    if (conv.tags.includes(canonical)) return
    void persist({ tags: [...conv.tags, canonical] })
  }

  // Labels offered in the suggestion menu: not already on the conversation,
  // narrowed by whatever is typed so far.
  const labelSuggestions = useMemo(() => {
    const q = labelInput.trim().toLowerCase()
    return allLabels.filter(
      l => !conv.tags.includes(l) && (!q || l.toLowerCase().includes(q))
    )
  }, [allLabels, conv.tags, labelInput])

  const removeLabel = (label: string) => {
    void persist({ tags: conv.tags.filter(t => t !== label) })
  }

  const copyLink = async () => {
    const url = `${window.location.origin}/admin/chatbot/log?id=${conv.id}`
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      // Clipboard access can be blocked (e.g. a non-HTTPS origin) — fall back
      // to showing the link for manual copying.
      window.prompt('Copy this link:', url)
    }
  }

  return (
    <div>
      <button
        type="button"
        className={[
          styles.convRow,
          viewed ? styles.convRowViewed : '',
          expanded ? styles.convRowExpanded : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className={styles.convRowHeader}>
          <span className={styles.convRowMeta}>
            <span className={styles.convRowDate}>
              {formatTime(conv.createdAt)}
            </span>
            <span
              className={styles.convRowPage}
              title={
                navigatedTo
                  ? `The chat started on ${conv.page} and the visitor navigated to ${navigatedTo}`
                  : undefined
              }
            >
              {conv.page}
              {navigatedTo && ` → ${navigatedTo}`}
            </span>
            {turnCount > 1 && <span>{turnCount} turns</span>}
            {geo && <span>{geo}</span>}
            {ratingCounts.up > 0 && (
              <span
                className={styles.convRowRating}
                title={ratingTitle('up', ratingCounts.up)}
              >
                👍{ratingCounts.up > 1 ? ` ${ratingCounts.up}` : ''}
              </span>
            )}
            {ratingCounts.down > 0 && (
              <span
                className={styles.convRowRating}
                title={ratingTitle('down', ratingCounts.down)}
              >
                👎{ratingCounts.down > 1 ? ` ${ratingCounts.down}` : ''}
              </span>
            )}
            {conv.review && (
              <span
                className={`${styles.convRowReview} ${styles[`convRowReview${conv.review}`]}`}
                title="Reviewer's verdict on this conversation"
              >
                {conv.review.toUpperCase()}
              </span>
            )}
            {data?.zeroMatches && !showedSuggest && (
              <span className={styles.convRowZero}>NO MATCH</span>
            )}
            {data?.status === 'abandoned' &&
              (latestBadge &&
              (latestBadge.text === 'STOPPED' ||
                latestBadge.text === 'LEFT MID-REPLY') ? (
                <span
                  className={styles.convRowAbandoned}
                  title={latestBadge.title}
                >
                  {latestBadge.text}
                </span>
              ) : abandonedHadText ? (
                <span
                  className={styles.convRowAbandoned}
                  title="The visitor's connection dropped while the reply was streaming — the part they had received is logged"
                >
                  CUT OFF
                </span>
              ) : (
                <span
                  className={styles.convRowAbandoned}
                  title="The visitor left before (or without) an answer streamed — only their question was logged"
                >
                  NO REPLY
                </span>
              ))}
            {data?.status === 'error' && (
              <span
                className={styles.convRowError}
                title="Generation failed for this turn — only the user's question was logged"
              >
                ERROR
              </span>
            )}
            {!data?.status && latestBadge && (
              <span
                className={styles.convRowAbandoned}
                title={latestBadge.title}
              >
                {latestBadge.text}
              </span>
            )}
          </span>
          <span className={styles.convRowMeta}>
            {conv.tags.map(t => (
              <span key={t} className={styles.convRowTag} title="Label">
                {t}
              </span>
            ))}
            {conv.promptVersion && (
              <span title="Prompt version">v{conv.promptVersion}</span>
            )}
            {conv.latencyMs ? (
              <span title="Response time of the latest reply">
                {formatLatency(conv.latencyMs)}
              </span>
            ) : null}
          </span>
        </div>
        <div className={styles.convRowQuery}>{firstUser}</div>
      </button>

      {expanded && data && (
        <ClickedCardsContext.Provider value={clickedSet}>
          <div className={styles.convDetail}>
            <div className={styles.convDetailField}>
              <div className={styles.convDetailLabel}>
                Transcript ({turnCount} turn{turnCount === 1 ? '' : 's'})
              </div>
              <div className={styles.convTranscript}>
                {/* conv.page is the page the chat started on, so this is the
                    greeting the visitor actually opened the widget under
                    (from today's page config — old rows show the current
                    wording). Mid-chat navigation appears as dividers below. */}
                <div className={styles.convGreeting}>
                  {greetingFor(conv.page)}
                </div>
                {/* The suggestion chips offered with the greeting. Chips send
                    their text verbatim, so a first message that matches one
                    was a press, not typed — badge it. Like the greeting, the
                    chips come from today's page config rather than the log,
                    so old rows show the current set. */}
                <div className={styles.convGreetingChips}>
                  {chipsFor(conv.page).map(chip => {
                    const pressed = chip === firstUser.trim()
                    return (
                      <span
                        key={chip}
                        className={
                          pressed
                            ? `${styles.convChip} ${styles.convChipPressed}`
                            : styles.convChip
                        }
                        title={
                          pressed
                            ? 'The visitor pressed this suggestion — their first message was not typed'
                            : 'Suggestion offered with the greeting'
                        }
                      >
                        {chip}
                        {pressed && (
                          <span className={styles.convChipPressedTag}>✓</span>
                        )}
                      </span>
                    )
                  })}
                </div>
                {/* The stored history is a window (the last 50 messages; 14
                    on rows logged before 17 Aug 2026), so a long chat's
                    opening turns are gone from the transcript even though
                    the per-turn arrays still count them. Say so, rather than
                    letting the visible start read as the real one. */}
                {missingTurns > 0 && data.history.length > 0 && (
                  <div
                    className={styles.convNavDivider}
                    title="The log keeps only the most recent messages of a conversation; earlier turns were not stored"
                  >
                    {missingTurns} earlier turn{missingTurns === 1 ? '' : 's'}{' '}
                    not stored
                  </div>
                )}
                {data.history.length > 0 ? (
                  data.history.map((t, i) => {
                    // This reply's position in the visitor's own message list
                    // — what the rating/delivery/click keys point at.
                    // Undefined when the mapping is unknowable (legacy row
                    // with dropped messages): the badges are hidden rather
                    // than misattributed.
                    const clientIdx =
                      t.role === 'assistant' && clientIndexOf
                        ? clientIndexOf(i)
                        : undefined
                    const reads =
                      t.role === 'assistant'
                        ? toolCallsForMessage(data, i).filter(
                            c =>
                              c.name === 'read_listing_page' ||
                              c.name === 'get_program_history'
                          )
                        : []
                    // The visitor moved to a different page before sending
                    // this message — mark it so the transcript reads in the
                    // context they actually saw.
                    const navTo = (() => {
                      if (t.role !== 'user') return undefined
                      const page = pageForUserMessage(data, i)
                      if (!page) return undefined
                      for (let j = i - 1; j >= 0; j--) {
                        if (data.history[j].role === 'user') {
                          const prev = pageForUserMessage(data, j)
                          return prev && prev !== page ? page : undefined
                        }
                      }
                      return undefined
                    })()
                    return (
                      <Fragment key={i}>
                        {navTo && (
                          <div className={styles.convNavDivider}>
                            navigated to {navTo}
                          </div>
                        )}
                        <div
                          className={
                            t.role === 'user'
                              ? styles.convTurnUser
                              : styles.convTurnAssistant
                          }
                        >
                          <div className={styles.convTurnRole}>
                            {t.role === 'user' ? 'User' : 'Chatbot'}
                            {t.role === 'user' &&
                              (() => {
                                const time = timeForUserMessage(
                                  data,
                                  i,
                                  conv.createdAt
                                )
                                return time ? (
                                  <span
                                    className={styles.convTurnTime}
                                    title="When the visitor sent this message (your browser's local timezone)"
                                  >
                                    {time}
                                  </span>
                                ) : null
                              })()}
                            {clientIdx != null &&
                              ratingByTurn.has(clientIdx) && (
                                <span
                                  className={styles.convRating}
                                  title={
                                    ratingByTurn.get(clientIdx) === 'up'
                                      ? 'The visitor rated this reply thumbs up'
                                      : 'The visitor rated this reply thumbs down'
                                  }
                                >
                                  {ratingByTurn.get(clientIdx) === 'up'
                                    ? '👍'
                                    : '👎'}
                                </span>
                              )}
                            {clientIdx != null &&
                              (() => {
                                const note = describeDelivery(
                                  conv.delivery[String(clientIdx)]
                                )
                                return note ? (
                                  <span
                                    className={
                                      note.warn
                                        ? `${styles.convDelivery} ${styles.convDeliveryWarn}`
                                        : styles.convDelivery
                                    }
                                    title={note.title}
                                  >
                                    {note.label}
                                  </span>
                                ) : null
                              })()}
                          </div>
                          <VisitedPages reads={reads} />
                          {t.role === 'user' ? (
                            <div className={styles.convTurnContent}>
                              {t.content}
                            </div>
                          ) : (
                            <TranscriptMessage
                              text={t.content}
                              turnIndex={clientIdx}
                              fallbackCardIds={fallbackCardsForMessage(data, i)}
                            />
                          )}
                        </div>
                      </Fragment>
                    )
                  })
                ) : (
                  <TranscriptMessage text={data.response} />
                )}
              </div>
            </div>

            {data.referrer && (
              <div className={styles.convDetailField}>
                <div className={styles.convDetailLabel}>Came from</div>
                <div className={styles.convDetailValue}>{data.referrer}</div>
              </div>
            )}

            <div className={styles.convDetailField}>
              <div className={styles.convDetailLabel}>Rating</div>
              <div className={styles.convAnnotRow}>
                {REVIEW_VALUES.map(v => {
                  const active = conv.review === v
                  return (
                    <button
                      key={v}
                      type="button"
                      className={[
                        styles.convRateBtn,
                        styles[`convRate${v}`],
                        active ? styles.convRateActive : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={active}
                      title={
                        active
                          ? 'Click again to clear this verdict'
                          : `Mark this conversation ${v.toLowerCase()}`
                      }
                      onClick={() =>
                        void persist({ review: active ? null : v })
                      }
                    >
                      {v}
                    </button>
                  )
                })}
                <button
                  type="button"
                  className={styles.convCopyLink}
                  onClick={() => void copyLink()}
                  title="Copy a direct link to this conversation — opening it still needs an admin sign-in"
                >
                  {linkCopied ? 'Link copied ✓' : '🔗 Copy link'}
                </button>
              </div>
              {conv.review && conv.reviewedBy && (
                <div className={styles.convReviewedBy}>
                  Rated {conv.review.toLowerCase()} by {conv.reviewedBy}
                </div>
              )}
            </div>

            <div className={styles.convDetailField}>
              <div className={styles.convDetailLabel}>Labels</div>
              <div className={styles.convAnnotRow}>
                {conv.tags.map(t => (
                  <span key={t} className={styles.convLabelChip}>
                    {t}
                    <button
                      type="button"
                      className={styles.convLabelRemove}
                      onClick={() => removeLabel(t)}
                      title={`Remove the "${t}" label`}
                      aria-label={`Remove the ${t} label`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <div className={styles.convLabelPicker}>
                  <input
                    className={styles.convLabelInput}
                    value={labelInput}
                    onChange={e => {
                      setLabelInput(e.target.value)
                      setLabelMenuOpen(true)
                      setLabelHighlight(-1)
                    }}
                    onFocus={() => setLabelMenuOpen(true)}
                    onBlur={() => {
                      setLabelMenuOpen(false)
                      setLabelHighlight(-1)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'ArrowDown' && labelSuggestions.length) {
                        e.preventDefault()
                        setLabelMenuOpen(true)
                        setLabelHighlight(
                          h => (h + 1) % labelSuggestions.length
                        )
                      } else if (
                        e.key === 'ArrowUp' &&
                        labelSuggestions.length
                      ) {
                        e.preventDefault()
                        setLabelMenuOpen(true)
                        setLabelHighlight(h =>
                          h <= 0 ? labelSuggestions.length - 1 : h - 1
                        )
                      } else if (e.key === 'Enter') {
                        e.preventDefault()
                        if (
                          labelMenuOpen &&
                          labelHighlight >= 0 &&
                          labelHighlight < labelSuggestions.length
                        ) {
                          addLabel(labelSuggestions[labelHighlight])
                        } else {
                          addLabel(labelInput)
                        }
                      } else if (e.key === 'Escape') {
                        setLabelMenuOpen(false)
                        setLabelHighlight(-1)
                      }
                    }}
                    placeholder="Add label…"
                    title="Pick an existing label or type a new one and press Enter"
                  />
                  {labelMenuOpen && labelSuggestions.length > 0 && (
                    <div className={styles.convLabelMenu}>
                      {labelSuggestions.map((l, i) => (
                        <button
                          key={l}
                          type="button"
                          className={[
                            styles.convLabelOption,
                            i === labelHighlight
                              ? styles.convLabelOptionActive
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          // Keep the input focused so its blur doesn't close
                          // the menu before this click lands.
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => addLabel(l)}
                          onMouseEnter={() => setLabelHighlight(i)}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {labelInput.trim() && (
                  <button
                    type="button"
                    className={styles.convLabelAdd}
                    onClick={() => addLabel(labelInput)}
                  >
                    Add
                  </button>
                )}
              </div>
            </div>

            <div className={styles.convDetailField}>
              <div className={styles.convDetailLabel}>Notes</div>
              {(() => {
                const parsed = parseNotes(conv.notes)
                return (
                  <>
                    {parsed.legacy && (
                      <div className={styles.convNoteLegacy}>
                        {parsed.legacy}
                      </div>
                    )}
                    {parsed.entries.length > 0 && (
                      <ul className={styles.convNoteList}>
                        {parsed.entries.map((n, i) => (
                          <li key={i} className={styles.convNoteEntry}>
                            <div className={styles.convNoteMeta}>
                              <span className={styles.convActivityWho}>
                                {n.actor}
                              </span>
                              <span className={styles.convActivityWhen}>
                                {formatStamp(n.at)}
                              </span>
                              <span className={styles.convNoteActions}>
                                {deletingNote === i ? (
                                  <>
                                    <span className={styles.convNoteConfirm}>
                                      Delete this note?
                                    </span>
                                    <button
                                      type="button"
                                      className={`${styles.convNoteDelete} ${styles.convNoteDanger}`}
                                      onClick={() => {
                                        setDeletingNote(null)
                                        void persist({
                                          deleteNote: {
                                            index: i,
                                            at: n.at,
                                            actor: n.actor,
                                          },
                                        })
                                      }}
                                    >
                                      Yes, delete
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.convNoteDelete}
                                      onClick={() => setDeletingNote(null)}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    className={styles.convNoteDelete}
                                    onClick={() => setDeletingNote(i)}
                                  >
                                    Delete
                                  </button>
                                )}
                              </span>
                            </div>
                            <div className={styles.convNoteText}>{n.text}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )
              })()}
              <textarea
                className={styles.convNotes}
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    if (noteDraft.trim()) {
                      void persist({ addNote: noteDraft })
                      setNoteDraft('')
                    }
                  }
                }}
                placeholder="Add a note — it will be signed with your name and the time"
              />
              <div className={styles.convAnnotRow}>
                <button
                  type="button"
                  className={styles.convLabelAdd}
                  disabled={!noteDraft.trim()}
                  onClick={() => {
                    void persist({ addNote: noteDraft })
                    setNoteDraft('')
                  }}
                >
                  Add note
                </button>
              </div>
            </div>

            {conv.reviewLog.trim() && (
              <div className={styles.convDetailField}>
                <div className={styles.convDetailLabel}>Activity</div>
                <ul className={styles.convActivity}>
                  {parseLog(conv.reviewLog).map((e, i) => (
                    <li key={i} className={styles.convActivityRow}>
                      {e.actor ? (
                        <>
                          <span className={styles.convActivityWho}>
                            {e.actor}
                          </span>{' '}
                          {e.what}
                          <span className={styles.convActivityWhen}>
                            {formatStamp(e.at)}
                          </span>
                        </>
                      ) : (
                        e.what
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {saveStatus && (
              <div className={styles.convStatus}>{saveStatus}</div>
            )}
          </div>
        </ClickedCardsContext.Provider>
      )}
    </div>
  )
}
