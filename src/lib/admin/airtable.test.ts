import { afterEach, describe, expect, it, vi } from 'vitest'

// The module reads its credentials when it loads, so they are set first.
vi.hoisted(() => {
  process.env.AIRTABLE_TOKEN = 'test-token'
  process.env.AIRTABLE_BASE_ID = 'appTest'
})

import { airtableRequest, isRecordId } from './airtable'

const ORIGIN = 'https://api.airtable.com/v0/appTest/'

function stubFetch() {
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >(async () => Response.json({}))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('airtableRequest', () => {
  it('sends the path shapes the admin helpers build, under this base', async () => {
    const fetchMock = stubFetch()
    const params = new URLSearchParams()
    params.set('filterByFormula', `{fld1} = "a b"`)
    params.append('fields[]', 'fld2')
    params.set('offset', 'itrAbc/recXyz')
    const paths = [
      'tblonlKwIFJ7Aa8QN',
      `tblonlKwIFJ7Aa8QN?${params.toString()}`,
      'tblonlKwIFJ7Aa8QN/recEventTicked001',
      'tblonlKwIFJ7Aa8QN/recEventTicked001?returnFieldsByFieldId=true',
      'tblonlKwIFJ7Aa8QN/recEventTicked001/comments',
    ]
    for (const path of paths) await airtableRequest(path)
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(
      paths.map(path => ORIGIN + path)
    )
  })

  it('sends the token and keeps the caller’s method and body', async () => {
    const fetchMock = stubFetch()
    await airtableRequest('tblonlKwIFJ7Aa8QN/recEventTicked001', {
      method: 'PATCH',
      body: '{"fields":{}}',
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect(init.body).toBe('{"fields":{}}')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('refuses a path that is not a table or record of this base', async () => {
    const fetchMock = stubFetch()
    const paths = [
      '',
      'Conversations',
      'tblonlKwIFJ7Aa8QN/recEventTicked001/extra',
      'tblonlKwIFJ7Aa8QN/../other',
      'tblonlKwIFJ7Aa8QN?x=1#frag',
      'https://example.com/tblonlKwIFJ7Aa8QN',
      '//example.com/tblonlKwIFJ7Aa8QN',
    ]
    for (const path of paths) {
      await expect(airtableRequest(path)).rejects.toThrow(
        'Airtable request path escapes the base'
      )
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('isRecordId', () => {
  it('accepts "rec" plus 14 letters or digits and nothing else', () => {
    expect(isRecordId('recEventTicked001')).toBe(true)
    expect(isRecordId('recEventTicked00')).toBe(false)
    expect(isRecordId('recEventTicked0011')).toBe(false)
    expect(isRecordId('tblonlKwIFJ7Aa8QN')).toBe(false)
    expect(isRecordId('recEventTicked00/')).toBe(false)
  })
})
