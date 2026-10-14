// The tiles over time for each tab: turns the event store's per-day figures
// (DashboardTrends, PageTrends) into what TrendChart draws, and says in the
// note under the chart what each counts and what its From compares with.

import type { NewsletterSubscribers } from '@/lib/admin/newsletter-subscribers'
import type { DateRange } from '@/lib/analytics/events'
import {
  NEWSLETTERS,
  subscriberPoints,
  valueAt,
} from '@/lib/analytics/subscribers'
import {
  DAY_MS,
  partialBucket,
  previousWindow,
  type TrendFrame,
  type TrendMetric,
} from '@/lib/analytics/trends'
import type { TrendPoint, TrendTile } from './TrendChart'

/** One tile's description. */
export interface TileSpec {
  key: string
  label: string
  /** What the readout calls the value: "visitors". */
  unit: string
  metric: TrendMetric
  /** The first day this was recorded ('2026-07-15'), when that's later than
   *  the store's oldest event: a From reaching back before it would compare
   *  with a stretch that wasn't counted. */
  since?: string
  /** What it counts, one sentence for the note. */
  what: string
}

/** The tiles for event-store figures over one range. `oldestTs` is the
 *  store's oldest event (DashboardData.oldestTs), `rangeKey` the preset
 *  (Today compares with yesterday up to the same time). */
export function eventTiles(
  frame: TrendFrame,
  range: DateRange,
  rangeKey: string,
  oldestTs: string | undefined,
  specs: TileSpec[]
): TrendTile[] {
  const n = frame.starts.length
  if (n === 0) return []
  // A range with no end, or one ending later than now, is still under way.
  const ongoing = range.endMs == null || range.endMs > frame.endMs
  const points = (m: TrendMetric): TrendPoint[] =>
    frame.starts.map((t, i) => ({
      t,
      v: m.points[i] ?? 0,
      ...(partialBucket(frame, i) && { part: partWords(frame, i, ongoing) }),
    }))
  return specs.map(s => {
    const from = fromFor(frame, range, rangeKey, oldestTs, s.since)
    // A tile whose stretch before couldn't be read (the conversation log
    // can fail on its own) says so rather than promising a From.
    const words =
      from.ok && s.metric.previous == null
        ? 'There’s no From, since the stretch before couldn’t be read just now.'
        : from.words
    // Days before this was recorded weren't zero, they weren't counted, so
    // the chart starts on the first day it was (All time, say, starts with
    // the store's oldest click, weeks before the first page view).
    const recorded = s.since ? Date.parse(`${s.since}T00:00:00Z`) : -Infinity
    const drawn = points(s.metric).filter(p => p.t >= recorded)
    return {
      key: s.key,
      label: s.label,
      unit: s.unit,
      value: s.metric.total,
      from: from.ok ? s.metric.previous : null,
      note: `${s.what} ${words}`,
      step: frame.unit,
      first: drawn[0]?.t ?? frame.starts[n - 1],
      last: frame.starts[n - 1],
      points: drawn,
    }
  })
}

/** Whether a tile can show its From, and the sentence saying what it is or
 *  why there isn't one. */
function fromFor(
  frame: TrendFrame,
  range: DateRange,
  rangeKey: string,
  oldestTs: string | undefined,
  since: string | undefined
): { ok: boolean; words: string } {
  // The stretch the store compared with, or the one it would have.
  const wanted = frame.previous ?? previousWindow(range, frame.endMs)
  if (!wanted)
    return {
      ok: false,
      words:
        'All time has nothing before it to compare with, so there’s no From.',
    }
  const stretch =
    rangeKey === 'today'
      ? 'yesterday up to the same time'
      : `the ${daysIn(wanted)} days before (${dayWords(wanted.startMs, wanted.endMs)})`
  const oldest = oldestTs ? Date.parse(oldestTs) : NaN
  const recorded = since ? Date.parse(`${since}T00:00:00Z`) : NaN
  if (!Number.isNaN(recorded) && wanted.startMs < recorded)
    return {
      ok: false,
      words: `There’s no From, since it would cover ${stretch} and this has only been recorded since ${dayWords(recorded)}.`,
    }
  if (!Number.isNaN(oldest) && wanted.startMs < oldest)
    return {
      ok: false,
      words: `There’s no From, since it would cover ${stretch} and the stored data begins on ${dayWords(oldest)}.`,
    }
  if (!frame.previous)
    return {
      ok: false,
      words: `There’s no From, since comparing with ${stretch} would mean reading more events than the server keeps in memory.`,
    }
  return { ok: true, words: `From = the same count for ${stretch}.` }
}

/** How many days a comparison stretch spans. */
function daysIn(w: { startMs: number; endMs: number }): number {
  return Math.max(1, Math.round((w.endMs + 1 - w.startMs) / DAY_MS))
}

/** "15 August to 13 September 2026", or one day on its own. */
function dayWords(startMs: number, endMs = startMs): string {
  const day = (ms: number, year: boolean) =>
    new Date(ms).toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'long',
      ...(year && { year: 'numeric' }),
    })
  const a = new Date(startMs)
  const b = new Date(endMs)
  if (a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10))
    return day(startMs, true)
  return `${day(startMs, a.getUTCFullYear() !== b.getUTCFullYear())} to ${day(endMs, true)}`
}

/** What a part-covered bucket's value covers: "from 18:03 UTC" for the
 *  range's first, "so far" for the one under way, "to 17:00 UTC" for one the
 *  range cuts short. */
function partWords(frame: TrendFrame, i: number, ongoing: boolean): string {
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16)
  if (frame.starts[i] < frame.startMs) return `from ${hhmm(frame.startMs)} UTC`
  return ongoing ? 'so far' : `to ${hhmm(frame.endMs)} UTC`
}

/** The Newsletters tab's subscriber tiles: each newsletter's subscribers now
 *  (at the range's end, for a range in the past), where it stood when the
 *  range began, and the line between: its Substack issues before the move,
 *  its ActiveCampaign list's size at the end of each day since. A newsletter
 *  with nothing to draw (Funding, until its export is added) gets no tile. */
export function subscriberTiles(
  subs: NewsletterSubscribers,
  range: DateRange
): TrendTile[] {
  const day = (t: number) => Math.floor(t / DAY_MS) * DAY_MS
  const end = Math.min(range.endMs ?? subs.liveAt, subs.liveAt)
  const tiles: TrendTile[] = []
  for (const n of NEWSLETTERS) {
    const exported = subs.substack.get(n.substack)
    const live = subs.live?.[n.list]
    const points = subscriberPoints(
      exported?.issues ?? [],
      subs.history?.days[n.list] ?? [],
      n.movedOn,
      live != null ? { t: subs.liveAt, n: live } : null
    )
    if (points.length === 0) continue
    const first = Math.max(
      range.startMs != null ? day(range.startMs) : points[0].t,
      points[0].t
    )
    const last = day(end)
    const shown = points.filter(p => p.t >= first && p.t <= last)
    // Weekly issues leave days without a point, so the chart starts with the
    // figure it had on its first day, as of the issue before.
    const before = points.filter(p => p.t < first).slice(-1)[0]
    if (!before && shown.length === 0) continue
    const opening =
      before && (shown.length === 0 || shown[0].t > first)
        ? [{ t: first, v: before.v, note: `as of ${dayWords(before.t)}` }]
        : []
    const from =
      range.startMs != null ? valueAt(points, range.startMs) : points[0].v
    const fromWords =
      range.startMs == null
        ? `From = the first issue, on ${dayWords(points[0].t)}.`
        : from == null
          ? 'There’s no From, since the range begins before the first issue.'
          : `From = the figure on ${dayWords(range.startMs)}.`
    const moved = n.movedOn ? Date.parse(`${n.movedOn}T00:00:00Z`) : null
    // Events and Training were one newsletter on Substack.
    const together = NEWSLETTERS.filter(m => m.substack === n.substack)
    const wasOnSubstack =
      together.length > 1
        ? `${together.map(m => m.label).join(' and ')} were one Substack newsletter`
        : 'it was on Substack'
    const what = moved
      ? [
          `${n.label} subscribers = people on the ${n.label} list in ActiveCampaign at the end of each day, counting confirmed signups and leaving out unsubscribes and bounces.`,
          exported
            ? `Before ${dayWords(moved)} ${wasOnSubstack}, and the line shows how many people each issue was emailed to. Substack’s own subscriber count is higher, as it includes readers of its app who don’t get email.`
            : `Before ${dayWords(moved)} ${wasOnSubstack}; add its export below to chart those years.`,
          subs.history
            ? ''
            : 'The day-by-day figures since the move are being worked out and show on the next load.',
          live == null
            ? 'Couldn’t read today’s count from ActiveCampaign, so the last point is the latest day worked out.'
            : '',
        ]
      : [
          `${n.label} is still on Substack, so this is how many people each issue was emailed to, from the export added on ${dayWords(Date.parse(exported?.savedAt ?? ''))}.`,
        ]
    tiles.push({
      key: `subscribers-${n.key}`,
      label: moved ? `${n.label} subscribers` : `${n.label} (Substack)`,
      unit: 'subscribers',
      value: valueAt(points, end) ?? 0,
      from,
      note: [...what, fromWords].filter(Boolean).join(' '),
      step: 'day',
      first,
      last,
      points: [...opening, ...shown],
      markers:
        moved != null ? [{ t: moved, label: 'Moved to ActiveCampaign' }] : [],
      fit: true,
    })
  }
  return tiles
}
