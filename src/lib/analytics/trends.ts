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

/** Whether a timestamp is in the form the store writes every event's in
 *  (toISOString: "2026-10-14T18:03:41.123Z"). Those compare and slice as
 *  text, in time order, several times faster than parsing each one, which
 *  matters over a few hundred thousand events; anything else is parsed. */
function isStoreTime(ts: string): boolean {
  return (
    ts.length === 24 && ts.charCodeAt(23) === 90 && ts.charCodeAt(10) === 84
  )
}

/** Each event's bucket, -1 for those outside the drawn stretch, worked out
 *  once so several counts over the same events share it. */
export function bucketsOf(frame: TrendFrame, events: TrendEvent[]): Int32Array {
  const out = new Int32Array(events.length).fill(-1)
  if (frame.starts.length === 0) return out
  // A store timestamp's day ("2026-10-14") or hour ("2026-10-14T18") names
  // its bucket; the drawn stretch's ends are compared as text too.
  const cut = frame.unit === 'hour' ? 13 : 10
  const index = new Map(
    frame.starts.map((t, i) => [new Date(t).toISOString().slice(0, cut), i])
  )
  const from = new Date(frame.startMs).toISOString()
  const to = new Date(frame.endMs).toISOString()
  for (let k = 0; k < events.length; k++) {
    const ts = events[k].ts
    if (!isStoreTime(ts)) out[k] = bucketOf(frame, Date.parse(ts))
    else if (ts >= from && ts <= to) out[k] = index.get(ts.slice(0, cut)) ?? -1
  }
  return out
}

/** Events per bucket. */
export function countPer(
  frame: TrendFrame,
  buckets: ArrayLike<number>
): number[] {
  const out = new Array<number>(frame.starts.length).fill(0)
  for (let k = 0; k < buckets.length; k++)
    if (buckets[k] >= 0) out[buckets[k]]++
  return out
}

/** Distinct visitors per bucket. Events without a visitor id (private
 *  browsing) can't be told apart, so each counts once, as everywhere else on
 *  the dashboard. */
export function peoplePer(
  frame: TrendFrame,
  events: TrendEvent[],
  buckets: ArrayLike<number>
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

/** The start of each visit among page views (epoch ms, oldest first): one
 *  visitor's views more than `gapMs` apart are separate visits, and an
 *  id-less view is a visit of its own. The same rule as the dashboard's
 *  Visits figure, so the visits per bucket add up to it. One pass, oldest
 *  view first: the store's newest-first order read backwards, or sorted when
 *  the views come in another order. */
export function visitStarts(views: TrendEvent[], gapMs: number): number[] {
  const n = views.length
  const times = new Float64Array(n)
  let newestFirst = true
  for (let k = 0; k < n; k++) {
    times[k] = Date.parse(views[k].ts)
    if (k > 0 && times[k] > times[k - 1]) newestFirst = false
  }
  const order = newestFirst
    ? null
    : Array.from({ length: n }, (_, k) => k).sort((a, b) => times[a] - times[b])
  const lastSeen = new Map<string, number>()
  const starts: number[] = []
  for (let j = 0; j < n; j++) {
    const k = order ? order[j] : n - 1 - j
    const t = times[k]
    if (Number.isNaN(t)) continue
    const vid = views[k].vid
    if (!vid) {
      starts.push(t)
      continue
    }
    const prev = lastSeen.get(vid)
    if (prev === undefined || t - prev >= gapMs) starts.push(t)
    lastSeen.set(vid, t)
  }
  return starts
}

/** How many of these instants fall in each bucket. */
export function instantsPer(frame: TrendFrame, instants: number[]): number[] {
  const out = new Array<number>(frame.starts.length).fill(0)
  for (const t of instants) {
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
  /** The values a week at a time (weeksOf), when the daily ones are small
   *  enough to chart by week (byWeek); null otherwise. */
  weekly: number[] | null
}

/** Days averaging fewer than this are charted by week: a day's one or two
 *  says little, a week's ten does (Bryce, 14 October 2026). */
const WEEKLY_BELOW_PER_DAY = 10

/** Whether a day-by-day series is small enough to chart by week. */
export function byWeek(daily: number[]): boolean {
  if (daily.length === 0) return false
  let sum = 0
  for (const v of daily) sum += v
  return sum / daily.length < WEEKLY_BELOW_PER_DAY
}

/** The weeks a frame's days fall in, Monday to Sunday (UTC), as the Org
 *  lookup's clicks chart counts them. Null for a frame drawn by the hour. */
export interface TrendWeeks {
  /** Each week's Monday, epoch ms, oldest first. */
  starts: number[]
  /** For each of the frame's days, the week it's in. */
  ofDay: number[]
}

export function weeksOf(frame: TrendFrame): TrendWeeks | null {
  if (frame.unit !== 'day' || frame.starts.length === 0) return null
  const starts: number[] = []
  const ofDay: number[] = []
  for (const day of frame.starts) {
    const monday = day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS
    if (starts[starts.length - 1] !== monday) starts.push(monday)
    ofDay.push(starts.length - 1)
  }
  return { starts, ofDay }
}

/** A day-by-day count added up a week at a time. */
export function sumByWeek(weeks: TrendWeeks, daily: number[]): number[] {
  const out = weeks.starts.map(() => 0)
  daily.forEach((v, d) => {
    out[weeks.ofDay[d]] += v
  })
  return out
}

/** Distinct visitors a week at a time, from the events' day buckets
 *  (bucketsOf). Id-less events each count once, as peoplePer does. */
export function peoplePerWeek(
  weeks: TrendWeeks,
  events: TrendEvent[],
  dayBuckets: ArrayLike<number>
): number[] {
  const seen = weeks.starts.map(() => new Set<string>())
  const anon = weeks.starts.map(() => 0)
  for (let k = 0; k < events.length; k++) {
    const d = dayBuckets[k]
    if (d < 0) continue
    const w = weeks.ofDay[d]
    const vid = events[k].vid
    if (vid) seen[w].add(vid)
    else anon[w]++
  }
  return seen.map((s, w) => s.size + anon[w])
}

/** A metric's weekly values (TrendMetric.weekly): its daily counts added up,
 *  or, for one counting people, its events' people per week. Null when it
 *  isn't charted by week. */
export function weeklyOf(
  frame: TrendFrame,
  daily: number[],
  people?: { events: TrendEvent[]; buckets: ArrayLike<number> }
): number[] | null {
  const weeks = weeksOf(frame)
  if (!weeks || !byWeek(daily)) return null
  return people
    ? peoplePerWeek(weeks, people.events, people.buckets)
    : sumByWeek(weeks, daily)
}

/** A test for whether an event's timestamp falls inside inclusive bounds
 *  (either may be open), comparing store timestamps as text (isStoreTime)
 *  and parsing any other; one that doesn't parse is outside. */
export function within(range: {
  startMs: number | null
  endMs: number | null
}): (ts: string) => boolean {
  const { startMs, endMs } = range
  const from = startMs != null ? new Date(startMs).toISOString() : null
  const to = endMs != null ? new Date(endMs).toISOString() : null
  return ts => {
    if (isStoreTime(ts))
      return (from == null || ts >= from) && (to == null || ts <= to)
    const t = Date.parse(ts)
    return (
      !Number.isNaN(t) &&
      (startMs == null || t >= startMs) &&
      (endMs == null || t <= endMs)
    )
  }
}

/** The events inside a window, in the order given. */
export function eventsIn<T extends TrendEvent>(
  events: T[],
  w: TrendWindow | null
): T[] {
  if (!w) return []
  const inside = within(w)
  return events.filter(e => inside(e.ts))
}
