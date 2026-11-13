import { describe, expect, it } from 'vitest'
import { advisorFromRecord } from './advisors'

// Data API v1 keeps serving focus with the values it served while the old
// Focus field existed; since 28 October 2026 they are worked out from Focus
// areas.
function record(fields: Record<string, unknown>) {
  return {
    id: 'recAdvisor00000001',
    createdTime: '2026-10-01T00:00:00.000Z',
    fields: { fldDCHQmcF8HLOz5S: 'An advisor', ...fields }, // Name
  }
}

const AREAS = 'fldKAVyL9lBOFy8Ht' // Focus areas
const OLD = 'fldJw9XfXOInZ7mCq' // Focus (deleted)

describe('advisorFromRecord: focus', () => {
  it('is Career/contribution for career or founding advice', () => {
    expect(advisorFromRecord(record({ [AREAS]: ['Career'] }))?.focus).toBe(
      'Career/contribution'
    )
    expect(
      advisorFromRecord(record({ [AREAS]: ['Research', 'Founding'] }))?.focus
    ).toBe('Career/contribution')
  })

  it('is Other for the rest', () => {
    expect(
      advisorFromRecord(record({ [AREAS]: ['Well-being', 'Legal'] }))?.focus
    ).toBe('Other')
  })

  it('is empty with no focus areas', () => {
    expect(advisorFromRecord(record({}))?.focus).toBe('')
  })

  it('no longer reads the old field', () => {
    expect(
      advisorFromRecord(
        record({ [AREAS]: ['Visas'], [OLD]: ['Career/contribution'] })
      )?.focus
    ).toBe('Other')
  })
})
