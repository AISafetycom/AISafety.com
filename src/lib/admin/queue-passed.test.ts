import { describe, expect, it } from 'vitest'
import {
  passedBlock,
  passedDay,
  passedOf,
  takenOutOf,
  TAKEN_OUT_FORMULA,
  unseenTakenOut,
} from './queue-passed'

describe('passedOf', () => {
  it('reads the Mac’s block', () => {
    expect(passedOf({ how: 'ended', on: '2026-11-15' })).toEqual({
      how: 'ended',
      on: '2026-11-15',
    })
    expect(passedOf({ how: 'started', on: '2026-11-01' })?.how).toBe('started')
  })

  it('ignores anything else', () => {
    expect(passedOf(null)).toBeNull()
    expect(passedOf('ended')).toBeNull()
    expect(passedOf([])).toBeNull()
    expect(passedOf({ how: 'gone', on: '2026-11-15' })).toBeNull()
    expect(passedOf({ how: 'ended', on: '15 November' })).toBeNull()
  })
})

describe('passedDay and passedBlock', () => {
  it('says the day in words, as a UTC date', () => {
    expect(passedDay('2026-11-15')).toBe('15 November')
    expect(passedDay('2026-12-01')).toBe('1 December')
  })

  it('says why Publish is off and what is left', () => {
    expect(passedBlock({ how: 'started', on: '2026-11-01' })).toBe(
      "It started on 1 November, so it can't go on the site. Reject it to draft their reply."
    )
  })
})

const row = (over: Record<string, unknown> = {}) => ({
  id: 'recRow',
  title: '#war-as-a-service D-Day',
  page: '/events',
  status: 'Closed',
  error: 'Passed: it ended on 15 November 2026. Taken out by the daily check',
  sourceLink: 'https://airtable.com/appX/tblY/recZ',
  ...over,
})

describe('takenOutOf', () => {
  it('reads a row the daily check closed', () => {
    expect(takenOutOf(row())).toEqual({
      id: 'recRow',
      title: '#war-as-a-service D-Day',
      page: '/events',
      how: 'ended',
      day: '15 November 2026',
      link: 'https://airtable.com/appX/tblY/recZ',
    })
    expect(
      takenOutOf(
        row({
          error:
            'Passed: it started on 3 November 2026. Taken out by the daily check',
        })
      )?.how
    ).toBe('started')
  })

  it('reads one taken out on its last day', () => {
    const t = takenOutOf(
      row({
        error:
          'Passed: it ends today, 23 November 2026, too late to publish. Taken out by the daily check',
      })
    )
    expect(t?.how).toBe('ended')
    expect(t?.day).toBe('23 November 2026')
  })

  it('leaves every other row out', () => {
    expect(takenOutOf(row({ status: 'Pending' }))).toBeNull()
    expect(takenOutOf(row({ error: 'Deleted outside the queue' }))).toBeNull()
    expect(takenOutOf(row({ error: null }))).toBeNull()
  })

  it('links only an https address', () => {
    expect(takenOutOf(row({ sourceLink: 'javascript:alert(1)' }))?.link).toBe(
      null
    )
    expect(takenOutOf(row({ sourceLink: null }))?.link).toBeNull()
  })
})

describe('unseenTakenOut', () => {
  it('drops the ones whose line was closed', () => {
    const a = takenOutOf(row({ id: 'recA' }))
    const b = takenOutOf(row({ id: 'recB' }))
    if (!a || !b) throw new Error('rows did not parse')
    expect(unseenTakenOut([a, b], ['recA']).map(t => t.id)).toEqual(['recB'])
    expect(unseenTakenOut([a, b], [])).toHaveLength(2)
  })
})

describe('TAKEN_OUT_FORMULA', () => {
  it('asks for Closed rows the daily check closed in the last week', () => {
    expect(TAKEN_OUT_FORMULA).toContain("{Status}='Closed'")
    expect(TAKEN_OUT_FORMULA).toContain("LEFT({Error},7)='Passed:'")
    expect(TAKEN_OUT_FORMULA).toContain("DATEADD(NOW(),-7,'day')")
  })
})
