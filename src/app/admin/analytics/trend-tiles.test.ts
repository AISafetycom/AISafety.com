import { describe, expect, it } from 'vitest'
import type { NewsletterSubscribers } from '@/lib/admin/newsletter-subscribers'
import { DAY_MS, trendFrame, previousWindow } from '@/lib/analytics/trends'
import { eventTiles, subscriberTiles } from './trend-tiles'

const day = (d: string) => Date.parse(`${d}T00:00:00Z`)
const NOW = Date.parse('2026-10-14T18:03:41Z')

describe('eventTiles', () => {
  const range = { startMs: NOW - 30 * DAY_MS, endMs: null }
  const metric = (n: number) => ({
    total: 100,
    previous: 80,
    points: Array.from({ length: n }, () => 3),
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
    // Funding is still on Substack and has no export: no tile.
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

  it('charts a newsletter still on Substack from its export', () => {
    const funding = new Map(subs().substack)
    funding.set('aisafetyfunding', {
      ...subs().substack.get('aisafetyeventsandtraining')!,
      publication: 'aisafetyfunding',
    })
    const tiles = subscriberTiles(subs({ substack: funding }), range)
    const f = tiles.find(t => t.key === 'subscribers-funding')!
    expect(f.label).toBe('Funding (Substack)')
    expect(f.value).toBe(2957)
    expect(f.note).toContain('still on Substack')
  })

  it('shows a range in the past as it ended', () => {
    const sept = { startMs: day('2026-09-12'), endMs: day('2026-09-20') - 1 }
    const [events] = subscriberTiles(subs(), sept)
    expect(events.value).toBe(2800)
    expect(events.from).toBe(2737)
    expect(events.last).toBe(day('2026-09-19'))
  })
})
