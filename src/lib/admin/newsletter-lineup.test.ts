import { describe, expect, it } from 'vitest'
import {
  addDays,
  fundingAccepting,
  hasStarted,
  inAnIssue,
  issueLabel,
  monthBefore,
  closingKeys,
  pickClosingFunders,
  pickNewFunders,
  pickNewListings,
  withoutWaiting,
} from './newsletter-lineup'

describe('monthBefore', () => {
  it('goes back one calendar month', () => {
    expect(monthBefore('2026-10-08')).toBe('2026-09-08')
  })
  it('crosses the year', () => {
    expect(monthBefore('2027-01-15')).toBe('2026-12-15')
  })
  it('clamps to the end of a shorter month', () => {
    expect(monthBefore('2026-03-31')).toBe('2026-02-28')
    expect(monthBefore('2028-03-30')).toBe('2028-02-29')
  })
})

describe('hasStarted', () => {
  it('counts the issue’s own day as started', () => {
    expect(hasStarted({ startDate: '2026-10-22' }, '2026-10-22')).toBe(true)
    expect(hasStarted({ startDate: '2026-10-06' }, '2026-10-22')).toBe(true)
    expect(hasStarted({ startDate: '2026-10-23' }, '2026-10-22')).toBe(false)
  })
  it('never calls rough timing or no date started', () => {
    expect(
      hasStarted(
        { startDate: '2026-10-01', startDateApprox: 'October 2026' },
        '2026-10-08'
      )
    ).toBe(false)
    expect(hasStarted({ startDate: null }, '2026-10-22')).toBe(false)
  })
})

describe('inAnIssue', () => {
  const listings = [
    { id: 'recSent', dateAdded: '2026-10-16' },
    { id: 'recStray', dateAdded: '2026-10-16' },
    { id: 'recSubstack', dateAdded: '2026-09-24' },
    { id: 'recUnticked', dateAdded: '2026-10-16' },
  ]
  const ticked = new Set(['recSent', 'recStray', 'recSubstack'])
  it('keeps out a tick no issue explains', () => {
    expect([...inAnIssue(listings, ticked, new Set(['recSent']))]).toEqual([
      'recSent',
      'recSubstack',
    ])
  })
  it('takes every tick at its word when the issues couldn’t be read', () => {
    expect([...inAnIssue(listings, ticked, null)]).toEqual([
      'recSent',
      'recStray',
      'recSubstack',
    ])
  })
})

describe('pickNewListings', () => {
  const listings = [
    { id: 'recNew', name: 'New', dateAdded: '2026-10-07', startDate: null },
    {
      id: 'recEdge',
      name: 'Edge',
      dateAdded: '2026-09-08',
      startDate: '2026-10-09',
    },
    { id: 'recOld', name: 'Old', dateAdded: '2026-09-07', startDate: null },
    { id: 'recSent', name: 'Sent', dateAdded: '2026-10-01', startDate: null },
    {
      id: 'recToday',
      name: 'Today',
      dateAdded: '2026-10-05',
      startDate: '2026-10-08',
    },
    { id: 'recUndated', name: 'Undated', dateAdded: null, startDate: null },
  ]
  it('takes listings added since the boundary, not started, not in an issue', () => {
    expect(
      pickNewListings(
        listings,
        new Set(['recSent']),
        '2026-09-08',
        '2026-10-08'
      ).map(l => l.id)
    ).toEqual(['recNew', 'recEdge'])
  })
})

describe('fundingAccepting', () => {
  const open = 'Applications open'
  it('counts an open funder, rolling or with a Deadline still to come', () => {
    expect(
      fundingAccepting(
        { applicationStatus: open, deadline: null },
        '2026-10-28'
      )
    ).toBe(true)
    expect(
      fundingAccepting(
        { applicationStatus: open, deadline: '2026-11-30' },
        '2026-10-28'
      )
    ).toBe(true)
  })
  it('still counts the closing day itself, not the day after', () => {
    const f = { applicationStatus: open, deadline: '2026-10-31' }
    expect(fundingAccepting(f, '2026-10-31')).toBe(true)
    expect(fundingAccepting(f, '2026-11-01')).toBe(false)
  })
  it('leaves out the two closed statuses and a blank one', () => {
    for (const applicationStatus of [
      'Not currently accepting applications',
      'Invite only, no applications',
      '',
    ])
      expect(
        fundingAccepting({ applicationStatus, deadline: null }, '2026-10-28')
      ).toBe(false)
  })
})

describe('pickNewFunders', () => {
  const funders = [
    {
      id: 'recStill',
      name: 'Still open',
      applicationStatus: 'Applications open',
      deadline: null,
    },
    {
      id: 'recReopened',
      name: 'Reopened',
      applicationStatus: 'Applications open',
      deadline: '2026-12-01',
    },
    {
      id: 'recClosed',
      name: 'Closed',
      applicationStatus: 'Not currently accepting applications',
      deadline: null,
    },
    {
      id: 'recInvite',
      name: 'Invite only',
      applicationStatus: 'Invite only, no applications',
      deadline: null,
    },
    {
      id: 'recPassed',
      name: 'Deadline passed since the cache',
      applicationStatus: 'Applications open',
      deadline: '2026-10-27',
    },
  ]
  it('takes funders accepting now that were not accepting at the baseline', () => {
    expect(
      pickNewFunders(funders, new Set(['recStill']), '2026-10-28').map(
        f => f.id
      )
    ).toEqual(['recReopened'])
  })
})

describe('withoutWaiting', () => {
  it('drops listings already in a waiting draft and keeps errors', () => {
    const lineup = {
      events: {
        items: [
          { id: 'recA', name: 'A' },
          { id: 'recB', name: 'B' },
        ],
        since: '8 September 2026',
      },
      training: { error: 'couldn’t be counted just now' },
      funding: {
        items: [{ id: 'recC', name: 'C' }],
        since: 'Issue #22, 2026',
        closing: [
          { id: 'recD', name: 'D' },
          { id: 'recE', name: 'E' },
        ],
      },
    }
    expect(withoutWaiting(lineup, new Set(['recB', 'recC', 'recE']))).toEqual({
      events: { items: [{ id: 'recA', name: 'A' }], since: '8 September 2026' },
      training: { error: 'couldn’t be counted just now' },
      funding: {
        items: [],
        since: 'Issue #22, 2026',
        closing: [{ id: 'recD', name: 'D' }],
      },
    })
  })
})

describe('issueLabel', () => {
  it('drops the newsletter name', () => {
    expect(issueLabel('Funding · Issue #22, 2026')).toBe('Issue #22, 2026')
  })
})

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-10-08', 14)).toBe('2026-10-22')
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
  })
})

describe('pickClosingFunders', () => {
  const open = (id: string, deadline: string | null) => ({
    id,
    name: id.slice(3),
    applicationStatus: 'Applications open',
    deadline,
  })
  const funders = [
    open('recToday', '2026-10-08'),
    open('recEdge', '2026-10-22'),
    open('recLater', '2026-10-23'),
    open('recPast', '2026-10-07'),
    open('recNew', '2026-10-10'),
    open('recRolling', null),
    // A Deadline left on a funder that isn't open doesn't make it closing.
    {
      ...open('recPaused', '2026-10-15'),
      applicationStatus: 'Not currently accepting applications',
    },
  ]
  it('takes deadlines from today to two weeks on, not the new ones', () => {
    expect(
      pickClosingFunders(funders, '2026-10-08', new Set(['recNew'])).map(
        f => f.id
      )
    ).toEqual(['recToday', 'recEdge'])
  })
  it('leaves out one an earlier issue already reminded readers of', () => {
    expect(
      pickClosingFunders(
        funders,
        '2026-10-08',
        new Set(['recNew', 'recToday'])
      ).map(f => f.id)
    ).toEqual(['recEdge'])
  })
})

describe('closingKeys', () => {
  it('takes the closing section only, old heading too', () => {
    expect(
      closingKeys([
        { label: 'Newly announced', cards: [{ key: 'recNew' }] },
        {
          label: 'Closing in the next two weeks',
          cards: [{ key: 'recA' }, { key: 'recB' }],
        },
        { label: 'Closing soon', cards: [{ key: 'recC' }] },
        { label: 'Always open', cards: [{ key: 'recOpen' }] },
      ])
    ).toEqual(['recA', 'recB', 'recC'])
  })
})
