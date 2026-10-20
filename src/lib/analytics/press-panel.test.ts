import { describe, expect, it } from 'vitest'
import { pressPanel, type AnalyticsEvent } from './events'

// The Analytics Overview tab's "Press page" panel: clicks on /media per
// action and per item, following the Unique/Total count mode.

const ev = (
  source: string,
  label: string,
  vid: string | undefined,
  ts: string,
  page = 'Press',
  type = 'press_action'
) => ({ type, page, source, label, vid, ts }) as AnalyticsEvent

const DAY1 = '2026-10-08T10:00:00Z'
const DAY1_LATER = '2026-10-08T18:00:00Z'
const DAY2 = '2026-10-09T09:00:00Z'

const EVENTS = [
  // a copies the full boilerplate twice the same day, then again the next.
  ev('copy', 'Copied full boilerplate', 'a', DAY1),
  ev('copy', 'Copied full boilerplate', 'a', DAY1_LATER),
  ev('copy', 'Copied full boilerplate', 'a', DAY2),
  // a also copies the one-line version: another item, another click.
  ev('copy', 'Copied one-line boilerplate', 'a', DAY1),
  ev('jump', 'Jumped to the boilerplate', 'a', DAY1),
  // b jumps both ways and emails the press inbox.
  ev('jump', 'Jumped to the boilerplate', 'b', DAY1),
  ev('jump', 'Jumped to the reporter resources', 'b', DAY1),
  ev('contact', 'Emailed the press inbox', 'b', DAY1),
  // No visitor id (private browsing): always counted, never a visitor.
  ev('download', 'Downloaded press kit', undefined, DAY1),
  ev('download', 'Downloaded press kit', undefined, DAY1),
  // Not the press page's: another page, another event type.
  ev('copy', 'Copied full boilerplate', 'c', DAY1, '/media'),
  ev('copy', 'Copied full boilerplate', 'c', DAY1, 'Press', 'footer_click'),
]

// a, b, and two who only looked.
const PAGE_VIDS = new Set(['a', 'b', 'd', 'e'])

describe('pressPanel', () => {
  it('counts every click in total mode', () => {
    const p = pressPanel(EVENTS, false, PAGE_VIDS)
    expect(p.byAction).toEqual([
      { name: 'Copy', count: 4 },
      { name: 'Jump', count: 3 },
      { name: 'Download', count: 2 },
      { name: 'Contact', count: 1 },
    ])
    expect(p.byItem).toEqual([
      { name: 'Copied full boilerplate', count: 3 },
      { name: 'Jumped to the boilerplate', count: 2 },
      { name: 'Downloaded press kit', count: 2 },
      { name: 'Copied one-line boilerplate', count: 1 },
      { name: 'Jumped to the reporter resources', count: 1 },
      { name: 'Emailed the press inbox', count: 1 },
    ])
  })

  it('counts one click per visitor per item per day in unique mode', () => {
    const p = pressPanel(EVENTS, true, PAGE_VIDS)
    // a's second copy on day 1 drops; the day-2 copy stays.
    expect(p.byItem.find(r => r.name === 'Copied full boilerplate')).toEqual({
      name: 'Copied full boilerplate',
      count: 2,
    })
    expect(p.byAction.find(r => r.name === 'Copy')?.count).toBe(3)
    // Vid-less downloads can't be told apart, so both stay.
    expect(p.byAction.find(r => r.name === 'Download')?.count).toBe(2)
    // The two tables add up to the same total.
    const sum = (rows: { count: number }[]) =>
      rows.reduce((s, r) => s + r.count, 0)
    expect(sum(p.byAction)).toBe(sum(p.byItem))
  })

  it('divides distinct visitors by the page’s visitors', () => {
    const p = pressPanel(EVENTS, true, PAGE_VIDS)
    const share = new Map(p.actionShare.map(s => [s.name, s]))
    expect(share.get('Copy')).toEqual({ name: 'Copy', active: 1, visitors: 4 })
    expect(share.get('Jump')).toEqual({ name: 'Jump', active: 2, visitors: 4 })
    expect(share.get('Download')).toEqual({
      name: 'Download',
      active: 0,
      visitors: 4,
    })
    expect(p.anyShare).toEqual({ name: 'Any action', active: 2, visitors: 4 })
  })

  it('names an unknown action and survives no page views', () => {
    const p = pressPanel([ev('share', 'Shared', 'a', DAY1)], false, undefined)
    expect(p.byAction).toEqual([{ name: 'Unknown', count: 1 }])
    expect(p.anyShare).toEqual({ name: 'Any action', active: 1, visitors: 0 })
  })
})
