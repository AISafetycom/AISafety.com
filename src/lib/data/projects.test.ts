import { describe, expect, it } from 'vitest'
import { projectFromRecord } from './projects'

function record(status: string) {
  return {
    id: 'rec1',
    createdTime: '2026-10-01T00:00:00.000Z',
    fields: {
      fldtfqsPSKc5ubNs4: 'Some project',
      fld57KJsNvSKFLoHT: status,
      fldejiM6qWUfXAeqO: 'Jane Doe',
      fldNhMihsnXhsHMnc: 'jane@example.com',
    },
  }
}

describe('projectFromRecord', () => {
  it('keeps the contact on an active project', () => {
    const p = projectFromRecord(record('Active'))
    expect(p?.contact).toBe('Jane Doe')
    expect(p?.email).toBe('jane@example.com')
  })

  it('drops the contact on a project seeking an owner', () => {
    const p = projectFromRecord(record('Seeking owner'))
    expect(p?.contact).toBe('')
    expect(p?.email).toBeNull()
    expect(p?.status).toBe('Seeking owner')
  })
})
