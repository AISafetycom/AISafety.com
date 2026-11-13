import { describe, expect, it } from 'vitest'
import type { NewsletterSubscribers } from '@/lib/admin/newsletter-subscribers'
import {
  DAY_MS,
  trendFrame,
  previousWindow,
  weeklyOf,
} from '@/lib/analytics/trends'
import { eventTiles, feedDays, feedTile, subscriberTiles } from './trend-tiles'

const day = (d: string) => Date.parse(`${d}T00:00:00Z`)
const NOW = Date.parse('2026-10-14T18:03:41Z')

describe('eventTiles', () => {
  const range = { startMs: NOW - 30 * DAY_MS, endMs: null }
  const metric = (n: number) => ({
    total: 100,
    previous: 80,
    points: Array.from({ length: n }, () => 30),
    weekly: null,
  })

  it('shows From when the stretch before was counted', () => {
    const frame = trendFrame(
      range,
      NOW,
      day('2026-06-20'),
      previousWindow(range, NOW)
    )
    const [tile] = eventTiles(frame, range, '30d', '2026-06-20T10:00:00Z', [
      {
        key: 'v',
        label: 'Visitors',
        unit: 'visitors',
        metric: metric(31),
        what: 'Visitors = people.',
      },
    ])
    expect(tile.from).toBe(80)
    expect(tile.note).toBe(
      'Visitors = people. From = the same count for the 30 days before (15 August to 14 September 2026).'
    )
    expect(tile.points).toHaveLength(31)
    expect(tile.points[0].part).toBe('from 18:03 UTC')
    expect(tile.points[30].part).toBe('so far')
    expect(tile.points[15].part).toBeUndefined()
  })

  it('says why there’s no From', () => {
    const frame = trendFrame(
      range,
      NOW,
      day('2026-06-20'),
      previousWindow(range, NOW)
    )
    const tile = (since?: string, oldest = '2026-06-20T10:00:00Z') =>
      eventTiles(frame, range, '30d', oldest, [
        {
          key: 'v',
          label: 'V',
          unit: 'v',
          metric: metric(31),
          since,
          what: 'V.',
        },
      ])[0]
    expect(tile('2026-10-08').from).toBeNull()
    expect(tile('2026-10-08').note).toContain(
      'has only been recorded since 8 October 2026'
    )
    expect(tile(undefined, '2026-09-01T00:00:00Z').note).toContain(
      'the stored data begins on 1 September 2026'
    )
    // The store didn't read the stretch before (too much to hold).
    const unread = trendFrame(range, NOW, day('2026-06-20'), null)
    expect(
      eventTiles(unread, range, '30d', '2026-06-20T10:00:00Z', [
        { key: 'v', label: 'V', unit: 'v', metric: metric(31), what: 'V.' },
      ])[0].note
    ).toContain('more events than the server keeps in memory')
    const all = { startMs: null, endMs: null }
    expect(
      eventTiles(
        trendFrame(all, NOW, day('2026-06-20'), null),
        all,
        'all',
        undefined,
        [{ key: 'v', label: 'V', unit: 'v', metric: metric(117), what: 'V.' }]
      )[0].note
    ).toContain('All time has nothing before it')
  })

  it('starts a chart on the day the figure was first recorded', () => {
    const all = { startMs: null, endMs: null }
    const frame = trendFrame(all, NOW, day('2026-06-20'), null)
    const [tile] = eventTiles(frame, all, 'all', '2026-06-20T00:00:00Z', [
      {
        key: 'v',
        label: 'V',
        unit: 'v',
        metric: metric(frame.starts.length),
        since: '2026-07-15',
        what: 'V.',
      },
    ])
    expect(tile.first).toBe(day('2026-07-15'))
    expect(tile.points[0].t).toBe(day('2026-07-15'))
  })
})

describe('weekly tiles', () => {
  // 30 days to Wednesday 14 October, so the first and last weeks are part
  // weeks: Monday 14 September from 18:03, and this week so far.
  const range = { startMs: NOW - 30 * DAY_MS, endMs: null }
  const frame = trendFrame(
    range,
    NOW,
    day('2026-06-20'),
    previousWindow(range, NOW)
  )
  const spec = (perDay: number) => {
    const points = frame.starts.map(() => perDay)
    return {
      key: 'v',
      label: 'V',
      unit: 'v',
      metric: {
        total: 99,
        previous: 9,
        points,
        weekly: weeklyOf(frame, points),
      },
      what: 'V.',
    }
  }

  it('draws a small figure a week at a time', () => {
    const [tile] = eventTiles(frame, range, '30d', '2026-06-20T00:00:00Z', [
      spec(2),
    ])
    expect(tile.step).toBe('week')
    expect(tile.points.map(p => p.v)).toEqual([14, 14, 14, 14, 6])
    expect(tile.points[0].part).toBe('from 18:03 UTC on its first day')
    expect(tile.points[4].part).toBe('3 of its 7 days, so far')
    expect(tile.points[1].part).toBeUndefined()
    expect(tile.first).toBe(day('2026-09-14'))
    expect(tile.last).toBe(day('2026-10-12'))
    expect(tile.note).toContain('Drawn a week at a time')
    // The tile itself still shows the range's total and its From.
    expect(tile.value).toBe(99)
    expect(tile.from).toBe(9)
  })

  it('keeps a busy figure a day at a time', () => {
    const [tile] = eventTiles(frame, range, '30d', '2026-06-20T00:00:00Z', [
      spec(30),
    ])
    expect(tile.step).toBe('day')
    expect(tile.points).toHaveLength(31)
  })

  it('starts a weekly chart in the week the figure was first recorded', () => {
    const [tile] = eventTiles(frame, range, '30d', '2026-06-20T00:00:00Z', [
      { ...spec(1), since: '2026-10-08' },
    ])
    expect(tile.step).toBe('week')
    // Thursday 8 October to Sunday 11, then this week so far.
    expect(
      tile.points.map(p => [new Date(p.t).toISOString().slice(0, 10), p.part])
    ).toEqual([
      ['2026-10-05', '4 of its 7 days'],
      ['2026-10-12', '3 of its 7 days, so far'],
    ])
  })
})

describe('subscriberTiles', () => {
  const subs = (
    over: Partial<NewsletterSubscribers> = {}
  ): NewsletterSubscribers => ({
    history: {
      v: 1,
      builtAt: NOW,
      unplaced: 0,
      days: {
        '6': [
          { t: day('2026-10-08'), n: 3012 },
          { t: day('2026-10-13'), n: 3008 },
        ],
        '7': [{ t: day('2026-10-08'), n: 3011 }],
      },
    },
    live: { '6': 3010, '7': 3031 },
    liveAt: NOW,
    substack: new Map([
      [
        'aisafetyeventsandtraining',
        {
          publication: 'aisafetyeventsandtraining',
          asOf: day('2026-10-08'),
          onList: 3693,
          savedAt: '2026-10-14T17:34:00.000Z',
          savedBy: 'Bryce',
          issues: [
            { t: Date.parse('2026-09-10T15:00:00Z'), n: 2737 },
            { t: Date.parse('2026-09-17T15:00:00Z'), n: 2800 },
            { t: Date.parse('2026-10-01T15:00:00Z'), n: 2957 },
          ],
        },
      ],
    ]),
    ...over,
  })
  const range = { startMs: NOW - 30 * DAY_MS, endMs: null }

  it('joins Substack’s issues to the list since the move', () => {
    const [events, training, ...rest] = subscriberTiles(subs(), range)
    // Funding has no export and its list isn't read yet: no tile.
    expect(rest).toEqual([])
    expect(events.label).toBe('Events subscribers')
    expect(events.value).toBe(3010)
    // 14 September: as of the 10 September issue.
    expect(events.from).toBe(2737)
    expect(events.first).toBe(day('2026-09-14'))
    expect(events.points.map(p => p.v)).toEqual([
      2737, 2800, 2957, 3012, 3008, 3010,
    ])
    expect(events.points[0].note).toBe('as of 10 September 2026')
    expect(events.markers).toEqual([
      { t: day('2026-10-08'), label: 'Moved to ActiveCampaign' },
    ])
    expect(events.note).toContain(
      'Events and Training were one Substack newsletter'
    )
    expect(training.value).toBe(3031)
  })

  it('draws the list alone, and says how to add the Substack years', () => {
    const [events] = subscriberTiles(subs({ substack: new Map() }), range)
    expect(events.from).toBeNull()
    expect(events.first).toBe(day('2026-10-08'))
    expect(events.note).toContain('add its export below')
  })

  it('charts Funding from its own move day', () => {
    const funding = new Map(subs().substack)
    funding.set('aisafetyfunding', {
      ...subs().substack.get('aisafetyeventsandtraining')!,
      publication: 'aisafetyfunding',
    })
    const later = NOW + 10 * DAY_MS
    const tiles = subscriberTiles(
      subs({
        substack: funding,
        history: {
          ...subs().history!,
          days: {
            ...subs().history!.days,
            // Test addresses before the move don't count.
            '8': [
              { t: day('2026-10-20'), n: 3 },
              { t: day('2026-10-21'), n: 807 },
              { t: day('2026-10-22'), n: 809 },
            ],
          },
        },
        live: { '6': 3010, '7': 3031, '8': 811 },
        liveAt: later,
      }),
      { startMs: later - 30 * DAY_MS, endMs: null }
    )
    const f = tiles.find(t => t.key === 'subscribers-funding')!
    expect(f.label).toBe('Funding subscribers')
    expect(f.value).toBe(811)
    expect(f.points.map(p => p.v)).toEqual([2800, 2957, 807, 809, 811])
    expect(f.markers).toEqual([
      { t: day('2026-10-21'), label: 'Moved to ActiveCampaign' },
    ])
    expect(f.note).toContain('it was on Substack')
  })

  it('shows a range in the past as it ended', () => {
    const sept = { startMs: day('2026-09-12'), endMs: day('2026-09-20') - 1 }
    const [events] = subscriberTiles(subs(), sept)
    expect(events.value).toBe(2800)
    expect(events.from).toBe(2737)
    expect(events.last).toBe(day('2026-09-19'))
  })
})

describe('the Feed readers tile', () => {
  it('reads the range’s days, never before the feeds began or after today', () => {
    expect(feedDays({ startMs: day('2026-10-12'), endMs: null }, NOW)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ])
    // Last 30 days: from the feeds’ first day.
    expect(feedDays({ startMs: NOW - 30 * DAY_MS, endMs: null }, NOW)[0]).toBe(
      '2026-10-11'
    )
    expect(feedDays({ startMs: null, endMs: null }, NOW)).toHaveLength(4)
    // A range that ended before the feeds: nothing to read.
    expect(
      feedDays({ startMs: day('2026-09-01'), endMs: day('2026-09-30') }, NOW)
    ).toEqual([])
  })

  const counts = (d: string, events: number, training: number) => [
    { day: d, services: events, direct: 0 },
    { day: d, services: 0, direct: training },
  ]

  it('shows the last full day, From the first, every newsletter together, today drawn as so far', () => {
    const t = feedTile(
      [
        ...counts('2026-10-12', 10, 4),
        ...counts('2026-10-13', 12, 5),
        ...counts('2026-10-14', 3, 1),
      ],
      { startMs: day('2026-10-12'), endMs: null },
      NOW
    )!
    expect(t.label).toBe('Feed readers')
    expect(t.value).toBe(17)
    expect(t.from).toBe(14)
    expect(t.points.map(p => [p.v, p.part])).toEqual([
      [14, undefined],
      [17, undefined],
      [4, 'so far'],
    ])
    expect(t.note).toContain('The figure is 13 October 2026')
    expect(t.note).toContain('From = 12 October 2026.')
  })

  it('has no From for a range that begins before the feeds counted', () => {
    const t = feedTile(
      counts('2026-10-11', 2, 1),
      { startMs: day('2026-10-01'), endMs: day('2026-10-11') + DAY_MS - 1 },
      NOW
    )!
    expect(t.value).toBe(3)
    expect(t.from).toBeNull()
    expect(t.note).toContain('only counted their readers since 11 October 2026')
  })

  it('shows today so far when that’s all the range has, and nothing when unread', () => {
    const t = feedTile(
      counts('2026-10-14', 3, 1),
      { startMs: day('2026-10-14'), endMs: null },
      NOW
    )!
    expect(t.value).toBe(4)
    expect(t.from).toBeNull()
    expect(t.note).toContain('The figure is today so far.')
    expect(feedTile(null, { startMs: null, endMs: null }, NOW)).toBeNull()
    expect(feedTile([], { startMs: null, endMs: null }, NOW)).toBeNull()
  })
})
