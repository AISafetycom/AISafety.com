import { describe, expect, it } from 'vitest'
import { goneFields, goneNote, goneOf, isRetired } from './queue-retired'

const FUNDING = 'tblzMTLDZWZKqTxrq'
const ADVISORS = 'tblf3KKYnmgcjVGhD'
const EVENTS = 'tblXbN9swwldwq8f7'

const fundingNow = [
  { id: 'fldsFpgVduYnNuYkN', name: 'Name' },
  { id: 'fldD8GVcdVy4Vonaa', name: 'Application status' },
  { id: 'fldv6IKA9WMDJNTbT', name: 'Deadline' },
]

describe('isRetired', () => {
  it('knows the two retired columns by name and id, on their own table only', () => {
    expect(isRetired(FUNDING, 'Accepting applications?')).toBe(true)
    expect(isRetired(FUNDING, 'fld398tQjtRGz0Pk1')).toBe(true)
    expect(isRetired(ADVISORS, 'Focus')).toBe(true)
    expect(isRetired(ADVISORS, 'Focus areas')).toBe(false)
    expect(isRetired(FUNDING, 'Type')).toBe(false)
    // Communities, Self-study and Training have a Focus field of their own.
    expect(isRetired(EVENTS, 'Focus')).toBe(false)
  })
})

describe('goneFields', () => {
  it('names a retired column the table no longer has', () => {
    expect(
      goneFields(
        FUNDING,
        ['Accepting applications?', 'Application status'],
        fundingNow
      )
    ).toEqual(['Accepting applications?'])
  })

  it('leaves a retired column alone while the table still has it', () => {
    expect(
      goneFields(
        FUNDING,
        ['Accepting applications?'],
        [
          ...fundingNow,
          { id: 'fld398tQjtRGz0Pk1', name: 'Accepting applications?' },
        ]
      )
    ).toEqual([])
    // Renamed, but still there: found by its id.
    expect(
      goneFields(
        FUNDING,
        ['fld398tQjtRGz0Pk1'],
        [
          ...fundingNow,
          { id: 'fld398tQjtRGz0Pk1', name: 'Accepting applications (old)' },
        ]
      )
    ).toEqual([])
  })

  it('never names a field that was not retired, even one the table lacks', () => {
    // A misspelt field still reaches Airtable, which says what is wrong.
    expect(goneFields(FUNDING, ['Aplication status'], fundingNow)).toEqual([])
  })

  it('names nothing when the schema could not be read', () => {
    expect(goneFields(FUNDING, ['Accepting applications?'], [])).toEqual([])
  })

  it('names each once', () => {
    expect(
      goneFields(ADVISORS, ['Focus', 'Focus'], [{ id: 'fldX', name: 'Name' }])
    ).toEqual(['Focus'])
  })
})

describe('goneNote', () => {
  it('says what was left out and what to use instead', () => {
    expect(goneNote(FUNDING, ['Accepting applications?'])).toBe(
      'Accepting applications? was left out: that column is no longer in Airtable. Use Application status and Deadline instead.'
    )
    expect(goneNote(ADVISORS, ['Focus'])).toBe(
      'Focus was left out: that column is no longer in Airtable. Use Focus areas instead.'
    )
  })

  it('is empty when nothing was left out', () => {
    expect(goneNote(FUNDING, [])).toBe('')
  })
})

describe('goneOf', () => {
  it('reads the saved list, ignoring anything else', () => {
    expect(goneOf(['Focus', 3, null])).toEqual(['Focus'])
    expect(goneOf('Focus')).toEqual([])
    expect(goneOf(undefined)).toEqual([])
  })
})
