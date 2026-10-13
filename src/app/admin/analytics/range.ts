// The dashboard's date range, read from the address: shared by the
// dashboard and the org pages it shares (src/app/stats).

import {
  dashboardDay,
  dashboardOffset,
  lastCompleteMonth,
  type DateRange,
} from '@/lib/analytics/events'

// Day boundaries and displayed times use the dashboard's fixed reporting zone
// (DASHBOARD_TZ in events.ts, UTC) — the same for every viewer.
export const DAY = 86_400_000
export const MINUTE = 60_000

export interface ResolvedRange extends DateRange {
  key: string // active preset key ('lastmonth' included), or 'custom'
  from?: string
  to?: string
}

export type SearchParams = Record<string, string | string[] | undefined>

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** Translate the query string into concrete epoch-ms bounds. Defaults to
 *  `preset` (the last 30 days on the dashboard). A custom from/to (inclusive,
 *  dashboard-zone day boundaries) wins. */
export function resolveRange(sp: SearchParams, preset = '30d'): ResolvedRange {
  const from = first(sp.from)
  const to = first(sp.to)
  if (from || to) {
    const s = from
      ? Date.parse(`${from}T00:00:00${dashboardOffset(from)}`)
      : NaN
    const e = to ? Date.parse(`${to}T23:59:59.999${dashboardOffset(to)}`) : NaN
    // The previous calendar month lights up its own preset.
    const last = lastCompleteMonth(Date.now()).range
    const isLastMonth =
      !Number.isNaN(s) &&
      !Number.isNaN(e) &&
      s === last.startMs &&
      e === last.endMs
    return {
      startMs: Number.isNaN(s) ? null : s,
      endMs: Number.isNaN(e) ? null : e,
      key: isLastMonth ? 'lastmonth' : 'custom',
      from,
      to,
    }
  }
  const range = first(sp.range) ?? preset
  // Rolling ranges end now but start on a whole minute, so every load within
  // that minute (a tab switch, the other tabs preloading) asks for the same
  // range and can share the figures the store has already worked out.
  const now = Math.floor(Date.now() / MINUTE) * MINUTE
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
