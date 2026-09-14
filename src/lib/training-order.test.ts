import { describe, expect, it } from 'vitest'
import { compareByDeadline, sectionFor, type Orderable } from './training-order'

interface Item extends Orderable {
  id: string
}

function open(id: string, deadline: string | null, start: string | null): Item {
  return {
    id,
    applicationStatus: 'Open',
    applicationsClose: deadline,
    notYetOpen: false,
    startDate: start,
  }
}

function closed(
  id: string,
  deadline: string | null,
  start: string | null
): Item {
  return { ...open(id, deadline, start), applicationStatus: 'Closed' }
}

function notYetOpen(id: string, deadline: string | null, start: string | null) {
  return { ...closed(id, deadline, start), notYetOpen: true }
}

const ids = (items: Item[]) => [...items].sort(compareByDeadline).map(i => i.id)

describe('compareByDeadline', () => {
  it('puts open programs soonest deadline first, whatever their start date', () => {
    const items = [
      open('starts-first', '2026-10-01', '2026-09-14'),
      open('starts-last', '2026-09-06', '2027-01-19'),
      open('middle', '2026-09-13', '2026-11-02'),
    ]
    expect(ids(items)).toEqual(['starts-last', 'middle', 'starts-first'])
  })

  it('breaks deadline ties by start date', () => {
    const items = [
      open('later', '2026-09-07', '2026-09-30'),
      open('sooner', '2026-09-07', '2026-09-14'),
    ]
    expect(ids(items)).toEqual(['sooner', 'later'])
  })

  it('puts open-ended programs after every dated open one, by start date', () => {
    const items = [
      open('rolling-jan', null, '2027-01-01'),
      open('dated-oct', '2026-10-19', '2026-12-01'),
      open('rolling-nov', null, '2026-11-02'),
    ]
    expect(ids(items)).toEqual(['dated-oct', 'rolling-nov', 'rolling-jan'])
  })

  it('orders the blocks open, not yet open, closed — the last two by start date', () => {
    const items = [
      closed('closed-sep', '2026-07-12', '2026-09-02'),
      notYetOpen('nyo-jan', '2026-11-01', '2027-01-11'),
      open('open', '2026-10-02', '2026-11-06'),
      closed('closed-aug', '2026-08-17', '2026-09-08'),
      notYetOpen('nyo-nov', null, '2026-11-15'),
    ]
    expect(ids(items)).toEqual([
      'open',
      'nyo-nov',
      'nyo-jan',
      'closed-sep',
      'closed-aug',
    ])
  })

  it('keeps a passed deadline from floating a closed program to the top', () => {
    const items = [
      closed('closed', '2026-05-03', '2026-09-14'),
      open('open', '2026-10-19', '2026-12-01'),
    ]
    expect(ids(items)).toEqual(['open', 'closed'])
  })
})

describe('sectionFor', () => {
  it('treats not-yet-open as its own block even though its status is Closed', () => {
    expect(sectionFor(notYetOpen('x', '2026-11-01', null))).toBe('notYetOpen')
    expect(sectionFor(closed('x', '2026-05-01', null))).toBe('closed')
    expect(sectionFor(open('x', null, null))).toBe('open')
  })
})
