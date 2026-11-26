// Session recordings beside the rest of the analytics: each recording gets
// the events its visitor sent while it ran (matched on the browser's
// analytics id and the time), which is what the Recordings tab filters on.

import { PAGE_NAME_BY_PATH, type AnalyticsEvent } from '@/lib/analytics/events'
import type { RecordingSummary } from './store'

/** Events from just before a recording began and after its last chunk
 *  still belong to it: the first chunk's clock starts with the page, a
 *  click's beacon can land after the recording's last event, and the last
 *  few seconds before a tab closes may never arrive. */
const BEFORE_MS = 5_000
const AFTER_MS = 30_000

/** Events that say nothing the replay doesn't show better. */
const LEFT_OUT = new Set(['page_view', 'listing_hover', 'cards_view'])

export interface RecordingRow extends RecordingSummary {
  /** The visitor's events while it ran, oldest first. */
  moments: AnalyticsEvent[]
  /** What they searched for that found nothing. */
  zeroSearches: string[]
  openedChatbot: boolean
  /** The page of each listing they clicked ('Funding'), in order. */
  listingClickPages: string[]
}

/** A page's name as the analytics events use it ('/funding' → 'Funding'). */
export function pageName(path: string): string {
  return PAGE_NAME_BY_PATH[path] ?? path
}

/** Each recording with its visitor's events from the same stretch.
 *  `events` in any order; recordings keep theirs. */
export function joinRecordings(
  recordings: RecordingSummary[],
  events: AnalyticsEvent[]
): RecordingRow[] {
  const byVid = new Map<string, { at: number; e: AnalyticsEvent }[]>()
  for (const e of events) {
    if (!e.vid || LEFT_OUT.has(e.type)) continue
    const at = Date.parse(e.ts)
    if (Number.isNaN(at)) continue
    let list = byVid.get(e.vid)
    if (!list) byVid.set(e.vid, (list = []))
    list.push({ at, e })
  }
  for (const list of byVid.values()) list.sort((a, b) => a.at - b.at)

  return recordings.map(r => {
    const from = r.start - BEFORE_MS
    const to = r.end + AFTER_MS
    const moments = (r.vid ? (byVid.get(r.vid) ?? []) : [])
      .filter(m => m.at >= from && m.at <= to)
      .map(m => m.e)
    const zeroSearches: string[] = []
    const listingClickPages: string[] = []
    let openedChatbot = false
    for (const e of moments) {
      if (e.type === 'search_query' && e.results === 0 && e.query)
        zeroSearches.push(e.query)
      else if (e.type === 'chatbot_open') openedChatbot = true
      else if (e.type === 'listing_click') listingClickPages.push(e.page ?? '')
    }
    return {
      ...r,
      moments,
      zeroSearches: [...new Set(zeroSearches.map(q => q.toLowerCase()))],
      openedChatbot,
      listingClickPages,
    }
  })
}

export const RECORDING_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'zero', label: 'Searched with no results' },
  { key: 'chatbot', label: 'Opened the chatbot' },
  { key: 'noclick', label: 'Left without clicking a listing' },
] as const

export type RecordingFilter = (typeof RECORDING_FILTERS)[number]['key']

export function isRecordingFilter(v: unknown): v is RecordingFilter {
  return RECORDING_FILTERS.some(f => f.key === v)
}

/** Whether a recording passes a filter, on a page (a path) or anywhere.
 *  With a page, "left without clicking" means no listing clicked on that
 *  page. */
export function matchesFilter(
  row: RecordingRow,
  filter: RecordingFilter,
  page?: string
): boolean {
  if (page && !row.pages.includes(page)) return false
  switch (filter) {
    case 'all':
      return true
    case 'zero':
      return row.zeroSearches.length > 0
    case 'chatbot':
      return row.openedChatbot
    case 'noclick':
      return page
        ? !row.listingClickPages.includes(pageName(page))
        : row.listingClickPages.length === 0
  }
}
