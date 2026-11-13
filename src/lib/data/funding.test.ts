import { describe, expect, it } from 'vitest'
import { funderFromRecord } from './funding'

// Data API v1 keeps serving acceptingApplications with the values it served
// while the "Accepting applications?" field existed; since 28 October 2026
// they are worked out from Application status and Deadline.
function record(fields: Record<string, unknown>) {
  return {
    id: 'recFunder000000001',
    createdTime: '2026-10-01T00:00:00.000Z',
    fields: { fldsFpgVduYnNuYkN: 'A fund', ...fields }, // Name
  }
}

const STATUS = 'fldD8GVcdVy4Vonaa' // Application status
const DEADLINE = 'fldv6IKA9WMDJNTbT' // Deadline
const OLD = 'fld398tQjtRGz0Pk1' // Accepting applications? (deleted)

describe('funderFromRecord: acceptingApplications', () => {
  it('words an open funder with a Deadline ahead as its closing date', () => {
    const f = funderFromRecord(
      record({ [STATUS]: 'Applications open', [DEADLINE]: '2999-10-31' })
    )
    expect(f?.acceptingApplications).toBe('Applications close 31 October 2999')
    expect(f?.applicationStatus).toBe('Applications open')
  })

  it('reads a passed Deadline as not accepting, like the status', () => {
    const f = funderFromRecord(
      record({ [STATUS]: 'Applications open', [DEADLINE]: '2020-01-31' })
    )
    expect(f?.acceptingApplications).toBe('Not accepting applications')
    expect(f?.applicationStatus).toBe('Not currently accepting applications')
  })

  it('words an open funder with no Deadline as rolling', () => {
    expect(
      funderFromRecord(record({ [STATUS]: 'Applications open' }))
        ?.acceptingApplications
    ).toBe('Applications on a rolling basis')
  })

  it('gives both closed statuses the closed wording', () => {
    for (const status of [
      'Not currently accepting applications',
      'Invite only, no applications',
    ]) {
      expect(
        funderFromRecord(record({ [STATUS]: status }))?.acceptingApplications
      ).toBe('Not accepting applications')
    }
  })

  it('gives a funder with no status an empty one', () => {
    expect(funderFromRecord(record({}))?.acceptingApplications).toBe('')
  })

  it('no longer reads the old field', () => {
    const f = funderFromRecord(
      record({ [STATUS]: 'Applications open', [OLD]: 'Accepting applications' })
    )
    expect(f?.acceptingApplications).toBe('Applications on a rolling basis')
  })
})
