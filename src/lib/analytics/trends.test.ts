import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  HOUR_MS,
  bucketOf,
  bucketsOf,
  countPer,
  eventsIn,
  partialBucket,
  peopleIn,
  peoplePer,
  instantsPer,
  previousWindow,
  trendFrame,
  visitStarts,
} from './trends'

const at = (iso: string) => Date.parse(iso)
const MINUTE = 60_000
const GAP = 30 * MINUTE

describe('previousWindow', () => {
  it('compares a rolling range with the same number of days before it', () => {
    // resolveRange starts rolling ranges on a whole minute and ends them now,
    // so 30 days is a few seconds more than 30 days.
    const now = at('2026-10-14T18:03:41Z')
    const start = at('2026-10-14T18:03:00Z') - 30 * DAY_MS
    expect(previousWindow({ startMs: start, endMs: null }, now)).toEqual({
      startMs: start - 30 * DAY_MS,
      endMs: start - 1,
    })
  })

  it('compares today with yesterday up to the same time', () => {
    const now = at('2026-10-14T09:30:00Z')
    const w = previousWindow(
      { startMs: at('2026-10-14T00:00:00Z'), endMs: null },
      now
    )
    expect(w).toEqual({
      startMs: at('2026-10-13T00:00:00Z'),
      endMs: at('2026-10-13T09:30:00Z'),
    })
  })

  it('compares a calendar month with the days just before it', () => {
    const w = previousWindow(
      {
        startMs: at('2026-09-01T00:00:00Z'),
        endMs: at('2026-09-30T23:59:59.999Z'),
      },
      at('2026-10-14T12:00:00Z')
    )
    expect(w).toEqual({
      startMs: at('2026-08-02T00:00:00Z'),
      endMs: at('2026-08-31T23:59:59.999Z'),
    })
  })

  it('has nothing to compare All time with', () => {
    expect(previousWindow({ startMs: null, endMs: null }, Date.now())).toBe(
      null
    )
  })

  it('stops a range ending in the future at now', () => {
    const now = at('2026-10-14T12:00:00Z')
    const w = previousWindow(
      {
        startMs: at('2026-10-10T00:00:00Z'),
        endMs: at('2026-10-20T00:00:00Z'),
      },
      now
    )
    // 4.5 days so far, rounded to 5.
    expect(w).toEqual({
      startMs: at('2026-10-05T00:00:00Z'),
      endMs: at('2026-10-09T12:00:00Z'),
    })
  })
})

describe('trendFrame', () => {
  it('draws a rolling 30 days a day at a time, today included', () => {
    const now = at('2026-10-14T18:03:41Z')
    const f = trendFrame(
      { startMs: now - 30 * DAY_MS, endMs: null },
      now,
      at('2026-06-20T00:00:00Z'),
      null
    )
    expect(f.unit).toBe('day')
    expect(f.starts).toHaveLength(31)
    expect(f.starts[0]).toBe(at('2026-09-14T00:00:00Z'))
    expect(f.starts[30]).toBe(at('2026-10-14T00:00:00Z'))
    // The first day only counts from 18:03, today only up to now.
    expect(partialBucket(f, 0)).toBe(true)
    expect(partialBucket(f, 1)).toBe(false)
    expect(partialBucket(f, 30)).toBe(true)
  })

  it('draws today an hour at a time', () => {
    const now = at('2026-10-14T09:30:00Z')
    const f = trendFrame(
      { startMs: at('2026-10-14T00:00:00Z'), endMs: null },
      now,
      0,
      null
    )
    expect(f.unit).toBe('hour')
    expect(f.starts).toHaveLength(10)
    expect(f.starts[9]).toBe(at('2026-10-14T09:00:00Z'))
    expect(partialBucket(f, 0)).toBe(false)
    expect(partialBucket(f, 9)).toBe(true)
  })

  it('starts All time at the oldest event read', () => {
    const now = at('2026-10-14T12:00:00Z')
    const f = trendFrame(
      { startMs: null, endMs: null },
      now,
      at('2026-06-20T10:00:00Z'),
      null
    )
    expect(f.unit).toBe('day')
    expect(f.starts[0]).toBe(at('2026-06-20T00:00:00Z'))
    expect(f.startMs).toBe(at('2026-06-20T10:00:00Z'))
    expect(partialBucket(f, 0)).toBe(true)
  })

  it('draws nothing when there are no events', () => {
    const f = trendFrame(
      { startMs: null, endMs: null },
      Date.now(),
      Infinity,
      null
    )
    expect(f.starts).toEqual([])
  })

  it('draws a finished month with no part-days', () => {
    const f = trendFrame(
      {
        startMs: at('2026-09-01T00:00:00Z'),
        endMs: at('2026-09-30T23:59:59.999Z'),
      },
      at('2026-10-14T12:00:00Z'),
      0,
      null
    )
    expect(f.starts).toHaveLength(30)
    expect(f.starts.some((_, i) => partialBucket(f, i))).toBe(false)
  })
})

describe('bucket counts', () => {
  const now = at('2026-10-14T12:00:00Z')
  const frame = trendFrame(
    { startMs: at('2026-10-12T00:00:00Z'), endMs: null },
    now,
    0,
    null
  )
  // Three days drawn by days: 12, 13 and 14 October.
  const events = [
    { ts: '2026-10-14T11:00:00Z', vid: 'a' },
    { ts: '2026-10-14T10:00:00Z', vid: 'a' },
    { ts: '2026-10-13T09:00:00Z', vid: 'b' },
    { ts: '2026-10-13T08:00:00Z' },
    { ts: '2026-10-13T07:00:00Z' },
    { ts: '2026-10-11T23:59:59Z', vid: 'c' },
  ]

  it('puts each event in its day, leaving out ones outside the stretch', () => {
    expect(frame.unit).toBe('day')
    expect([...bucketsOf(frame, events)]).toEqual([2, 2, 1, 1, 1, -1])
    expect(bucketOf(frame, at('2026-10-14T12:00:01Z'))).toBe(-1)
  })

  it('counts events and distinct visitors per day', () => {
    const b = bucketsOf(frame, events)
    expect(countPer(frame, b)).toEqual([0, 3, 2])
    // b once, plus the two id-less events.
    expect(peoplePer(frame, events, b)).toEqual([0, 3, 1])
  })

  it('counts distinct visitors over a whole stretch', () => {
    expect(peopleIn(events)).toBe(5)
  })

  it('counts visits where they began, 30 minutes apart', () => {
    const views = [
      { ts: '2026-10-13T23:50:00Z', vid: 'a' },
      { ts: '2026-10-14T00:10:00Z', vid: 'a' }, // same visit, began the 13th
      { ts: '2026-10-14T01:00:00Z', vid: 'a' }, // a second visit
      { ts: '2026-10-14T01:05:00Z' }, // id-less: its own visit
    ]
    expect(visitStarts(views, GAP)).toHaveLength(3)
    expect(instantsPer(frame, visitStarts(views, GAP))).toEqual([0, 1, 2])
    // Newest first, as the store holds them: the same visits.
    expect(visitStarts([...views].reverse(), GAP)).toEqual(
      visitStarts(views, GAP)
    )
  })

  it('reads timestamps in other forms the slow way, with the same result', () => {
    const odd = [
      { ts: '2026-10-13T09:00:00+00:00', vid: 'x' },
      { ts: 'not a time', vid: 'y' },
      { ts: '2026-10-14T11:00:00Z', vid: 'z' },
    ]
    expect([...bucketsOf(frame, odd)]).toEqual([1, -1, 2])
    expect(
      eventsIn(odd, {
        startMs: at('2026-10-13T00:00:00Z'),
        endMs: at('2026-10-14T00:00:00Z'),
      }).map(e => e.vid)
    ).toEqual(['x'])
  })

  it('keeps the events inside a window', () => {
    expect(
      eventsIn(events, {
        startMs: at('2026-10-13T08:00:00Z'),
        endMs: at('2026-10-14T10:00:00Z'),
      }).map(e => e.ts)
    ).toEqual([
      '2026-10-14T10:00:00Z',
      '2026-10-13T09:00:00Z',
      '2026-10-13T08:00:00Z',
    ])
    expect(eventsIn(events, null)).toEqual([])
  })

  it('buckets hours on a short range', () => {
    const hourly = trendFrame(
      { startMs: at('2026-10-14T00:00:00Z'), endMs: null },
      now,
      0,
      null
    )
    const b = bucketsOf(hourly, events)
    expect(countPer(hourly, b)[10]).toBe(1)
    expect(countPer(hourly, b)[11]).toBe(1)
    expect(hourly.starts[11] - hourly.starts[10]).toBe(HOUR_MS)
  })
})
