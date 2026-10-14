/** The dashboard's "over time" figures: which days (or hours) a range is
 *  drawn as, the stretch of time it's compared with, and the per-bucket
 *  counts behind each chart. Dependency-free so it can be unit-tested; the
 *  event store (events.ts) feeds it events, the trend chart draws the result.
 *
 *  Buckets are UTC days, or UTC hours for a range of two days or less (Today,
 *  a single custom day), matching the dashboard's reporting zone (DASHBOARD_TZ
 *  in events.ts, UTC). */

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

/** Ranges up to this long are drawn an hour at a time: a day drawn by days
 *  would be a single point. */
const HOURLY_MAX_MS = 2 * DAY_MS

export interface TrendWindow {
  startMs: number
  endMs: number
}

/** The buckets a range is drawn as. */
export interface TrendFrame {
  unit: 'hour' | 'day'
  /** Each bucket's start (epoch ms), oldest first. */
  starts: number[]
  /** Where the drawn stretch begins and ends: the range's own start and end,
   *  except that the start never goes back before the oldest event read and
   *  the end never passes now. */
  startMs: number
  endMs: number
  /** The stretch each tile's "From" covers (the same length just before the
   *  range), or null when there's no earlier stretch to compare with. */
  previous: TrendWindow | null
}

/** A range as the dashboard passes it: inclusive epoch-ms bounds, either open. */
interface Bounds {
  startMs: number | null
  endMs: number | null
}

/** The stretch just before a range, as long as it: the same number of whole
 *  days, so Today compares with yesterday up to the same time, the last 30
 *  days with the 30 days before, and a calendar month with the 30 or 31 days
 *  before it. Null for a range with no start (All time). Never overlaps the
 *  range. */
export function previousWindow(range: Bounds, now: number): TrendWindow | null {
  if (range.startMs == null) return null
  const end = Math.min(range.endMs ?? now, now)
  if (end <= range.startMs) return null
  // Rounded, not rounded up: a rolling range starts on a whole minute but
  // ends now, so "7 days" is a few seconds longer than 7 days.
  const days = Math.max(1, Math.round((end - range.startMs) / DAY_MS))
  const shift = days * DAY_MS
  return {
    startMs: range.startMs - shift,
    endMs: Math.min(end - shift, range.startMs - 1),
  }
}

/** The buckets for a range, from the later of its start and the oldest event
 *  read (`oldestMs`) to the earlier of its end and now. No buckets when
 *  there's nothing to draw. */
export function trendFrame(
  range: Bounds,
  now: number,
  oldestMs: number,
  previous: TrendWindow | null
): TrendFrame {
  const endMs = Math.min(range.endMs ?? now, now)
  const startMs =
    range.startMs != null ? Math.max(range.startMs, oldestMs) : oldestMs
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs)
    return { unit: 'day', starts: [], startMs: endMs, endMs, previous }
  const unit =
    range.startMs != null && endMs - range.startMs <= HOURLY_MAX_MS
      ? 'hour'
      : 'day'
  const step = unit === 'hour' ? HOUR_MS : DAY_MS
  const starts: number[] = []
  for (let b = Math.floor(startMs / step) * step; b <= endMs; b += step)
    starts.push(b)
  return { unit, starts, startMs, endMs, previous }
}

/** Which bucket an instant falls in, or -1 outside the drawn stretch. */
export function bucketOf(frame: TrendFrame, t: number): number {
  if (frame.starts.length === 0 || t < frame.startMs || t > frame.endMs)
    return -1
  const step = frame.unit === 'hour' ? HOUR_MS : DAY_MS
  const i = Math.floor((t - frame.starts[0]) / step)
  return i >= 0 && i < frame.starts.length ? i : -1
}

/** Whether a bucket only partly counts: the first one when the range starts
 *  part-way through it, the last when it hasn't finished (today, this hour)
 *  or the range ends early. Drawn lighter, so a short day isn't read as a
 *  dip. */
export function partialBucket(frame: TrendFrame, i: number): boolean {
  const step = frame.unit === 'hour' ? HOUR_MS : DAY_MS
  const start = frame.starts[i]
  return start < frame.startMs || start + step - 1 > frame.endMs
}

/** The fields of an event the counts read. */
export interface TrendEvent {
  ts: string
  vid?: string
}

/** Each event's bucket, -1 for those outside the drawn stretch, worked out
 *  once so several counts over the same events share it. */
export function bucketsOf(frame: TrendFrame, events: TrendEvent[]): Int32Array {
  const out = new Int32Array(events.length)
  for (let k = 0; k < events.length; k++)
    out[k] = bucketOf(frame, Date.parse(events[k].ts))
  return out
}

/** Events per bucket. */
export function countPer(frame: TrendFrame, buckets: Int32Array): number[] {
  const out = new Array<number>(frame.starts.length).fill(0)
  for (const b of buckets) if (b >= 0) out[b]++
  return out
}

/** Distinct visitors per bucket. Events without a visitor id (private
 *  browsing) can't be told apart, so each counts once, as everywhere else on
 *  the dashboard. */
export function peoplePer(
  frame: TrendFrame,
  events: TrendEvent[],
  buckets: Int32Array
): number[] {
  const seen = frame.starts.map(() => new Set<string>())
  const anon = new Array<number>(frame.starts.length).fill(0)
  for (let k = 0; k < events.length; k++) {
    const b = buckets[k]
    if (b < 0) continue
    const vid = events[k].vid
    if (vid) seen[b].add(vid)
    else anon[b]++
  }
  return seen.map((s, b) => s.size + anon[b])
}

/** Distinct visitors among the events, each id-less event counting once. */
export function peopleIn(events: TrendEvent[]): number {
  const seen = new Set<string>()
  let anon = 0
  for (const e of events) {
    if (e.vid) seen.add(e.vid)
    else anon++
  }
  return seen.size + anon
}

/** The start of each visit among page views: one visitor's views more than
 *  `gapMs` apart are separate visits, and an id-less view is a visit of its
 *  own. The same rule as the dashboard's Visits figure, so the visits per
 *  bucket add up to it. */
export function visitStarts(views: TrendEvent[], gapMs: number): number[] {
  const byVid = new Map<string, number[]>()
  const starts: number[] = []
  for (const e of views) {
    const t = Date.parse(e.ts)
    if (Number.isNaN(t)) continue
    if (!e.vid) {
      starts.push(t)
      continue
    }
    const times = byVid.get(e.vid)
    if (times) times.push(t)
    else byVid.set(e.vid, [t])
  }
  for (const times of byVid.values()) {
    times.sort((a, b) => a - b)
    starts.push(times[0])
    for (let i = 1; i < times.length; i++)
      if (times[i] - times[i - 1] >= gapMs) starts.push(times[i])
  }
  return starts
}

/** Visits per bucket, each counted where it began. */
export function visitsPer(
  frame: TrendFrame,
  views: TrendEvent[],
  gapMs: number
): number[] {
  const out = new Array<number>(frame.starts.length).fill(0)
  for (const t of visitStarts(views, gapMs)) {
    const b = bucketOf(frame, t)
    if (b >= 0) out[b]++
  }
  return out
}

/** One tile's figures: the range's own total (counted the way the panels
 *  below it count), the same over the stretch before, and the per-bucket
 *  values the chart draws. */
export interface TrendMetric {
  total: number
  /** Null when the range has no stretch before it to compare with. */
  previous: number | null
  points: number[]
}

/** The events (newest first, as the store holds them) inside a window. */
export function eventsIn<T extends TrendEvent>(
  events: T[],
  w: TrendWindow | null
): T[] {
  if (!w) return []
  return events.filter(e => {
    const t = Date.parse(e.ts)
    return t >= w.startMs && t <= w.endMs
  })
}
