import { beforeEach, describe, expect, it, vi } from 'vitest'

// The sync that closes queue rows handled in Airtable directly, against a
// stand-in for the Airtable client: a listing per table, a read per row
// that is missing from it, a patch per row it closes.
const mocks = vi.hoisted(() => ({
  listAll: vi.fn(),
  airtableRequest: vi.fn(),
}))
vi.mock('./airtable', () => ({
  airtableRequest: mocks.airtableRequest,
  listAll: mocks.listAll,
  isRecordId: (id: string) => /^rec[A-Za-z0-9]{14}$/.test(id),
}))
// The data layer wraps its Airtable reads in unstable_cache at import time.
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('./session', () => ({ sealToken: vi.fn() }))
vi.mock('@/lib/assistant/catalog', () => ({ getCatalog: vi.fn() }))

import { closeHandledRows, handledOutside, type QueueItem } from './queue'

const QUEUE = 'tblonlKwIFJ7Aa8QN'
const EVENTS = 'tblXbN9swwldwq8f7'
const FUNDING = 'tblzMTLDZWZKqTxrq'
const JOBS = 'tblyLelYCQjP6w3nV'
const STATUS = 'fldTXGYOoXcUApaI2'
const ERROR = 'fldrJcvFN3FCcyQPn'

const rid = (n: string) => `rec${n.padStart(14, '0')}`

function item(over: Partial<QueueItem>): QueueItem {
  return {
    id: rid('q1'),
    createdAt: '2026-09-17T00:00:00.000Z',
    title: 'A suggestion',
    type: 'Add',
    source: 'Comb',
    status: 'Pending',
    page: '/events',
    targetTable: EVENTS,
    targetRecord: rid('live'),
    issueRow: null,
    sourceLink: null,
    sourceExcerpt: null,
    logo: null,
    fields: null,
    name: null,
    url: null,
    changes: [],
    diff: null,
    summary: null,
    appliesTo: null,
    verdict: null,
    reasons: [],
    rejectChips: [],
    replyDraft: null,
    replyStatus: null,
    saidBy: null,
    replyTo: null,
    rejectReason: null,
    note: null,
    edits: null,
    decidedAt: null,
    appliedAt: null,
    error: null,
    ...over,
  }
}

describe('handledOutside', () => {
  it('names what happened to the record, in the Mac worker’s words', () => {
    expect(handledOutside(null)).toBe('Deleted outside the queue')
    expect(handledOutside({ fields: { 'Publish?': true } })).toBe(
      'Published outside the queue'
    )
    expect(handledOutside({ fields: { 'Hide?': true } })).toBe(
      'Hidden outside the queue'
    )
    expect(
      handledOutside({ fields: { 'Publish?': true, 'Hide?': true } })
    ).toBe('Hidden outside the queue')
  })
  it('is nothing while the record is still a suggestion', () => {
    expect(handledOutside({ fields: {} })).toBeNull()
    expect(
      handledOutside({ fields: { Name: 'x', 'Publish?': false } })
    ).toBeNull()
  })
})

describe('closeHandledRows', () => {
  // What each table lists as unpublished + unhidden, and what a read of a
  // record that is not among them answers (missing = gone).
  const live: Record<string, string[]> = { [EVENTS]: [rid('live')] }
  const records: Record<string, Record<string, unknown>> = {
    [`${EVENTS}/${rid('published')}`]: { 'Publish?': true },
    [`${EVENTS}/${rid('hidden')}`]: { 'Hide?': true },
    [`${EVENTS}/${rid('raced')}`]: { Name: 'added a moment ago' },
  }
  let patches: { path: string; fields: Record<string, unknown> }[]
  let listed: { table: string; formula: string | null; fields: string[] }[]

  beforeEach(() => {
    patches = []
    listed = []
    mocks.listAll.mockReset()
    mocks.airtableRequest.mockReset()
    mocks.listAll.mockImplementation(
      async (table: string, params: URLSearchParams) => {
        listed.push({
          table,
          formula: params.get('filterByFormula'),
          fields: params.getAll('fields[]'),
        })
        if (table === FUNDING) throw new Error('Airtable list failed: 503')
        return (live[table] ?? []).map(id => ({
          id,
          createdTime: '',
          fields: {},
        }))
      }
    )
    mocks.airtableRequest.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as {
            fields: Record<string, unknown>
          }
          patches.push({ path, fields: body.fields })
          return new Response('{}', { status: 200 })
        }
        const fields = records[path]
        if (!fields) return new Response('', { status: 404 })
        return new Response(JSON.stringify({ id: path, fields }), {
          status: 200,
        })
      }
    )
  })

  it('closes the open Add rows whose record is gone, published or hidden', async () => {
    const closed = await closeHandledRows([
      item({ id: rid('q1'), targetRecord: rid('live') }),
      item({ id: rid('q2'), targetRecord: rid('deleted'), title: 'Gone' }),
      item({
        id: rid('q3'),
        targetRecord: rid('published'),
        status: 'Revising',
      }),
      item({ id: rid('q4'), targetRecord: rid('hidden') }),
      item({ id: rid('q5'), targetRecord: rid('raced') }),
    ])
    expect(closed).toEqual([rid('q2'), rid('q3'), rid('q4')])
    expect(patches).toEqual([
      {
        path: `${QUEUE}/${rid('q2')}`,
        fields: { [STATUS]: 'Closed', [ERROR]: 'Deleted outside the queue' },
      },
      {
        path: `${QUEUE}/${rid('q3')}`,
        fields: { [STATUS]: 'Closed', [ERROR]: 'Published outside the queue' },
      },
      {
        path: `${QUEUE}/${rid('q4')}`,
        fields: { [STATUS]: 'Closed', [ERROR]: 'Hidden outside the queue' },
      },
    ])
    // One listing of the table, trimmed to one field; the live row is
    // never read on its own.
    expect(listed).toEqual([
      {
        table: EVENTS,
        formula: 'AND(NOT({Publish?}), NOT({Hide?}))',
        fields: ['Publish?'],
      },
    ])
    const reads = mocks.airtableRequest.mock.calls
      .filter(([, init]) => !(init as RequestInit | undefined)?.method)
      .map(([path]) => path)
    expect(reads).toEqual([
      `${EVENTS}/${rid('deleted')}`,
      `${EVENTS}/${rid('published')}`,
      `${EVENTS}/${rid('hidden')}`,
      `${EVENTS}/${rid('raced')}`,
    ])
  })

  it('leaves everything that is the worker’s or nobody’s business', async () => {
    const closed = await closeHandledRows([
      // Accepted: the worker turns it into Applied once it is published.
      item({ id: rid('q1'), targetRecord: rid('deleted'), status: 'Accepted' }),
      // Already decided.
      item({ id: rid('q2'), targetRecord: rid('deleted'), status: 'Rejected' }),
      // A Broom flag, not an addition.
      item({ id: rid('q3'), type: 'Change', targetRecord: rid('deleted') }),
      // Jobs rows come from a feed: no Publish?/Hide? to read.
      item({ id: rid('q4'), targetTable: JOBS, targetRecord: rid('deleted') }),
      // No target at all.
      item({ id: rid('q5'), targetTable: null, targetRecord: null }),
      item({ id: rid('q6'), targetRecord: 'not-a-record-id' }),
    ])
    expect(closed).toEqual([])
    expect(patches).toEqual([])
    expect(listed).toEqual([])
  })

  it('never throws: a table that cannot be listed is left for the worker', async () => {
    const closed = await closeHandledRows([
      item({
        id: rid('q1'),
        targetTable: FUNDING,
        targetRecord: rid('deleted'),
      }),
      item({ id: rid('q2'), targetRecord: rid('deleted') }),
    ])
    expect(closed).toEqual([rid('q2')])
    expect(patches.map(p => p.path)).toEqual([`${QUEUE}/${rid('q2')}`])
  })
})
