import { describe, expect, it } from 'vitest'
import {
  NEWSLETTERS,
  SUBSTACK_PUBLICATIONS,
  listDays,
  subscriberPoints,
  valueAt,
  type ListRecord,
} from './subscribers'

const day = (d: string) => Date.parse(`${d}T00:00:00Z`)

describe('listDays', () => {
  // The import on the morning of 8 October (account time is UTC-5), one
  // unsubscribe and one bounce on the 9th, a signup on the 10th, and one
  // that never confirmed.
  const records: ListRecord[] = [
    { list: '6', status: '1', sdate: '2026-10-08T04:31:00-05:00', udate: null },
    { list: '6', status: '1', sdate: '2026-10-08T04:31:05-05:00', udate: null },
    {
      list: '6',
      status: '2',
      sdate: '2026-10-08T04:32:25-05:00',
      udate: '2026-10-09T11:53:01-05:00',
    },
    {
      list: '6',
      status: '3',
      sdate: '2026-10-08T04:33:22-05:00',
      udate: '2026-10-09T15:39:02-05:00',
    },
    { list: '6', status: '1', sdate: '2026-10-10T20:00:00-05:00', udate: null },
    { list: '6', status: '0', sdate: '2026-10-11T09:54:56-05:00', udate: null },
    { list: '7', status: '1', sdate: '2026-10-08T04:31:00-05:00', udate: null },
    { list: '5', status: '1', sdate: '2026-07-08T17:58:50-05:00', udate: null },
  ]

  it('counts who was on each list at the end of each UTC day', () => {
    const { days, unplaced } = listDays(
      records,
      ['6', '7'],
      day('2026-10-08'),
      day('2026-10-12') + 3_600_000
    )
    expect(unplaced).toBe(0)
    expect(days['6'].map(d => d.n)).toEqual([4, 2, 2, 3, 3])
    expect(days['6'][0].t).toBe(day('2026-10-08'))
    // The signup at 20:00 UTC-5 on the 10th is 01:00 UTC on the 11th.
    expect(days['6'][3].t).toBe(day('2026-10-11'))
    expect(days['7'].map(d => d.n)).toEqual([1, 1, 1, 1, 1])
    // Lists not asked for aren't counted.
    expect(days['5']).toBeUndefined()
  })

  it('leaves out a record that has left but says no date', () => {
    const { days, unplaced } = listDays(
      [
        ...records,
        { list: '6', status: '2', sdate: records[0].sdate, udate: null },
      ],
      ['6'],
      day('2026-10-08'),
      day('2026-10-08')
    )
    expect(unplaced).toBe(1)
    expect(days['6'].map(d => d.n)).toEqual([4])
  })
})

describe('subscriberPoints', () => {
  const issues = [
    { t: Date.parse('2026-09-24T14:46:00Z'), n: 2874 },
    { t: Date.parse('2026-10-01T15:19:36Z'), n: 2957 },
    // Sent on Substack after the move: not this list's history.
    { t: Date.parse('2026-10-08T15:00:00Z'), n: 10 },
  ]
  const days = [
    { t: day('2026-10-08'), n: 3012 },
    { t: day('2026-10-09'), n: 3001 },
    { t: day('2026-10-10'), n: 3005 },
  ]

  it('joins the Substack issues to the list since the move, today last', () => {
    const points = subscriberPoints(issues, days, '2026-10-08', {
      t: Date.parse('2026-10-10T12:00:00Z'),
      n: 3007,
    })
    expect(
      points.map(p => [new Date(p.t).toISOString().slice(0, 10), p.v])
    ).toEqual([
      ['2026-09-24', 2874],
      ['2026-10-01', 2957],
      ['2026-10-08', 3012],
      ['2026-10-09', 3001],
      ['2026-10-10', 3007],
    ])
    expect(points[0].note).toBe('emailed the Substack issue')
    expect(points[4].note).toBe('on the list now')
  })

  it('makes two issues on one day one point, the later one', () => {
    const points = subscriberPoints(
      [
        { t: Date.parse('2023-11-10T20:43:03Z'), n: 7 },
        { t: Date.parse('2023-11-10T22:02:40Z'), n: 8 },
        { t: Date.parse('2023-12-10T12:00:00Z'), n: 12 },
      ],
      [],
      null,
      null
    )
    expect(points.map(p => p.v)).toEqual([8, 12])
  })

  it('draws a newsletter still on Substack from its issues alone', () => {
    const points = subscriberPoints(issues, days, null, {
      t: Date.parse('2026-10-10T12:00:00Z'),
      n: 3,
    })
    expect(points.map(p => p.v)).toEqual([2874, 2957, 10])
  })

  it('reads the figure at a moment from the last point before it', () => {
    const points = subscriberPoints(issues, days, '2026-10-08', null)
    expect(valueAt(points, day('2026-10-05'))).toBe(2957)
    expect(valueAt(points, day('2026-10-09'))).toBe(3001)
    expect(valueAt(points, day('2026-09-01'))).toBeNull()
  })
})

describe('the newsletters', () => {
  it('maps each to its own list and its Substack export', () => {
    expect(new Set(NEWSLETTERS.map(n => n.list)).size).toBe(NEWSLETTERS.length)
    expect(SUBSTACK_PUBLICATIONS).toEqual([
      'aisafetyeventsandtraining',
      'aisafetyfunding',
    ])
  })
})
