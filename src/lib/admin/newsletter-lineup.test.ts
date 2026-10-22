import { describe, expect, it } from 'vitest'
import {
  addDays,
  closingDay,
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
  it('counts the open wordings', () => {
    expect(fundingAccepting('Applications close 31 October 2026')).toBe(true)
    expect(fundingAccepting('Applications on a rolling basis')).toBe(true)
  })
  it('leaves out the closed wordings and an empty status', () => {
    expect(fundingAccepting('Not accepting applications')).toBe(false)
    expect(fundingAccepting('Not currently accepting applications')).toBe(false)
    expect(fundingAccepting('  ')).toBe(false)
  })
})

describe('pickNewFunders', () => {
  const funders = [
    {
      id: 'recStill',
      name: 'Still open',
      acceptingApplications: 'Applications on a rolling basis',
    },
    {
      id: 'recReopened',
      name: 'Reopened',
      acceptingApplications: 'Applications close 1 December 2026',
    },
    {
      id: 'recClosed',
      name: 'Closed',
      acceptingApplications: 'Not accepting applications',
    },
  ]
  it('takes funders accepting now that were not accepting at the baseline', () => {
    expect(
      pickNewFunders(funders, new Set(['recStill'])).map(f => f.id)
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

describe('closingDay', () => {
  it('reads the date of the "Applications close" wording', () => {
    expect(closingDay('Applications close 31 October 2026')).toBe('2026-10-31')
    expect(closingDay('Applications close 2 March 2027')).toBe('2027-03-02')
  })
  it('is null for every other wording', () => {
    expect(closingDay('Applications on a rolling basis')).toBeNull()
    expect(closingDay('Not accepting applications')).toBeNull()
    expect(closingDay('Applications close 31 Octobre 2026')).toBeNull()
  })
})

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-10-08', 14)).toBe('2026-10-22')
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
  })
})

describe('pickClosingFunders', () => {
  const funders = [
    {
      id: 'recToday',
      name: 'Today',
      acceptingApplications: 'Applications close 8 October 2026',
    },
    {
      id: 'recEdge',
      name: 'Edge',
      acceptingApplications: 'Applications close 22 October 2026',
    },
    {
      id: 'recLater',
      name: 'Later',
      acceptingApplications: 'Applications close 23 October 2026',
    },
    {
      id: 'recPast',
      name: 'Past',
      acceptingApplications: 'Applications close 7 October 2026',
    },
    {
      id: 'recNew',
      name: 'New',
      acceptingApplications: 'Applications close 10 October 2026',
    },
    {
      id: 'recRolling',
      name: 'Rolling',
      acceptingApplications: 'Applications on a rolling basis',
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
