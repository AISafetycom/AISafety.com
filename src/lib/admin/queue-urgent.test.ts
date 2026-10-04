import { describe, expect, it } from 'vitest'

import { byUrgency, urgencyOf, type UrgentInput } from './queue-urgent'

const TODAY = '2026-10-04'

function add(
  fields: Record<string, unknown>,
  verdict = 'Publish'
): UrgentInput {
  return { type: 'Add', verdict, fields, changes: [] }
}

function fix(
  changes: { field: string; to: unknown }[],
  verdict = 'Fix'
): UrgentInput {
  return { type: 'Change', verdict, fields: null, changes }
}

describe('urgencyOf: dated additions', () => {
  it('flags a start or deadline in the next two weeks, soonest first', () => {
    expect(
      urgencyOf(
        add({ 'Start date': '2026-10-17', Deadline: '2026-10-10' }),
        undefined,
        TODAY
      )
    ).toEqual({ days: 6, label: 'Closes 10 Oct' })
    expect(
      urgencyOf(add({ 'Start date': '2026-10-06' }), undefined, TODAY)
    ).toEqual({ days: 2, label: 'Starts 6 Oct' })
  })

  it('says today and tomorrow, and reads a same-day deadline as the start', () => {
    expect(
      urgencyOf(
        add({ 'Start date': '2026-10-04', Deadline: '2026-10-04' }),
        undefined,
        TODAY
      )?.label
    ).toBe('Starts today')
    expect(
      urgencyOf(add({ Deadline: '2026-10-05' }), undefined, TODAY)?.label
    ).toBe('Closes tomorrow')
  })

  it('skips the past, the far future and an undated listing', () => {
    expect(
      urgencyOf(add({ 'Start date': '2026-10-03' }), undefined, TODAY)
    ).toBeNull()
    expect(
      urgencyOf(add({ 'Start date': '2026-10-19' }), undefined, TODAY)
    ).toBeNull()
    expect(urgencyOf(add({ Name: 'Some org' }), undefined, TODAY)).toBeNull()
    // the 14th day is still in
    expect(
      urgencyOf(add({ 'Start date': '2026-10-18' }), undefined, TODAY)?.days
    ).toBe(14)
  })

  it('looks past a passed deadline to an upcoming start', () => {
    expect(
      urgencyOf(
        add({ 'Start date': '2026-10-12', Deadline: '2026-10-01' }),
        undefined,
        TODAY
      )?.label
    ).toBe('Starts 12 Oct')
  })

  it('never flags what Fable says to skip, or a rule', () => {
    expect(
      urgencyOf(
        add({ 'Start date': '2026-10-06' }, "Don't publish"),
        undefined,
        TODAY
      )
    ).toBeNull()
    expect(
      urgencyOf(
        { type: 'Rule', verdict: null, fields: null, changes: [] },
        undefined,
        TODAY
      )
    ).toBeNull()
  })

  it('counts an Unsure or unjudged addition', () => {
    expect(
      urgencyOf(add({ Deadline: '2026-10-10' }, 'Unsure'), undefined, TODAY)
    ).not.toBeNull()
    expect(
      urgencyOf(
        { ...add({ Deadline: '2026-10-10' }), verdict: null },
        undefined,
        TODAY
      )
    ).not.toBeNull()
  })
})

describe('urgencyOf: fixes to live listings', () => {
  it('names what a fix corrects, strongest first', () => {
    expect(
      urgencyOf(fix([{ field: 'Hide?', to: true }]), undefined, TODAY)
    ).toEqual({ days: null, label: 'Listing closed' })
    expect(
      urgencyOf(fix([{ field: 'Publish?', to: false }]), undefined, TODAY)
        ?.label
    ).toBe('Listing closed')
    expect(
      urgencyOf(
        fix([
          { field: 'Name', to: 'X' },
          { field: 'Website', to: 'https://x.org' },
          { field: 'Deadline', to: '2027-01-01' },
        ]),
        undefined,
        TODAY
      )?.label
    ).toBe('Wrong link')
    expect(
      urgencyOf(
        fix([{ field: 'End date', to: '2026-11-29' }]),
        undefined,
        TODAY
      )?.label
    ).toBe('Wrong date')
    expect(
      urgencyOf(
        fix([{ field: 'Accepting applications?', to: 'Rolling' }]),
        undefined,
        TODAY
      )?.label
    ).toBe('Wrong status')
  })

  it('leaves tidying fixes and dismissed findings alone', () => {
    expect(
      urgencyOf(
        fix([{ field: 'Logo', to: ['https://x.org/a.png'] }]),
        undefined,
        TODAY
      )
    ).toBeNull()
    expect(
      urgencyOf(
        fix([{ field: 'Description', to: 'New words' }]),
        undefined,
        TODAY
      )
    ).toBeNull()
    expect(
      urgencyOf(
        fix([{ field: 'Hide?', to: true }], 'Dismiss'),
        undefined,
        TODAY
      )
    ).toBeNull()
  })

  it('dates a tidying fix by the listing it touches', () => {
    expect(
      urgencyOf(
        fix([{ field: 'Host name', to: 'Swiss AI Safety' }]),
        { start: '2026-10-09', closes: null },
        TODAY
      )
    ).toEqual({ days: 5, label: 'Starts 9 Oct' })
    expect(
      urgencyOf(
        fix([{ field: 'Host name', to: 'Swiss AI Safety' }]),
        { start: '2026-12-01' },
        TODAY
      )
    ).toBeNull()
  })

  it('goes by the corrected date over the listing’s', () => {
    expect(
      urgencyOf(
        fix([{ field: 'Deadline', to: '2026-10-11' }]),
        { start: '2026-11-20', closes: '2026-10-24' },
        TODAY
      )
    ).toEqual({ days: 7, label: 'Wrong date · Closes 11 Oct' })
  })
})

describe('byUrgency', () => {
  it('puts dated items soonest first, then undated fixes oldest first', () => {
    const rows = [
      { id: 'a', urgency: { days: null, label: '' }, createdAt: '2026-09-20' },
      { id: 'b', urgency: { days: 6, label: '' }, createdAt: '2026-10-01' },
      { id: 'c', urgency: { days: null, label: '' }, createdAt: '2026-09-10' },
      { id: 'd', urgency: { days: 1, label: '' }, createdAt: '2026-10-03' },
    ]
    expect(rows.sort(byUrgency).map(r => r.id)).toEqual(['d', 'b', 'c', 'a'])
  })
})
