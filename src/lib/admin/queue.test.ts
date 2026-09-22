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

import { getCatalog } from '@/lib/assistant/catalog'
import {
  acceptItem,
  asAttachmentWrite,
  closeHandledRows,
  handledOutside,
  queueTargets,
  undoItem,
  type QueueItem,
} from './queue'

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

describe('asAttachmentWrite', () => {
  const link = 'https://try.mangrove.one/logo-final/apple-touch-icon-180-b1.png'

  it('turns a picture link, as text or a list of text, into {url, filename}', () => {
    expect(asAttachmentWrite(link)).toEqual([
      { url: link, filename: 'apple-touch-icon-180-b1.png' },
    ])
    expect(asAttachmentWrite([link, 'https://x.org/a.webp'])).toEqual([
      { url: link, filename: 'apple-touch-icon-180-b1.png' },
      { url: 'https://x.org/a.webp', filename: 'a.webp' },
    ])
  })

  it('keeps a proposal\u2019s {url, filename} and a stored picture\u2019s {id}', () => {
    expect(asAttachmentWrite([{ url: link, filename: 'mark.png' }])).toEqual([
      { url: link, filename: 'mark.png' },
    ])
    expect(
      asAttachmentWrite([{ id: 'attTChgufrPH55BIp', filename: 'old.webp' }])
    ).toEqual([{ id: 'attTChgufrPH55BIp' }])
  })

  it('is nothing for text that is not a link, and empty for no picture', () => {
    expect(asAttachmentWrite('game-night-hackathon.webp (old badge)')).toBe(
      null
    )
    expect(asAttachmentWrite(['https://x.org/a.png', 'a description'])).toBe(
      null
    )
    expect(asAttachmentWrite(null)).toEqual([])
    expect(asAttachmentWrite([])).toEqual([])
  })
})

// Applying and undoing a change to a picture field, against a stand-in
// for Airtable: the base's schema (one meta read) and a patch log.
describe('picture fields on Apply and Undo', () => {
  const link = 'https://try.mangrove.one/logo-final/apple-touch-icon-180-b1.png'
  const blob =
    'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/queue-logos/mangrove-2026-09-22.png'
  let patches: { path: string; fields: Record<string, unknown> }[]

  beforeEach(() => {
    patches = []
    process.env.AIRTABLE_TOKEN = 'test-token'
    process.env.AIRTABLE_BASE_ID = 'appTest'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          tables: [
            {
              id: EVENTS,
              fields: [
                { id: 'fldName', name: 'Name', type: 'singleLineText' },
                { id: 'fldLogo', name: 'Logo', type: 'multipleAttachments' },
                { id: 'fldHost', name: 'Host name', type: 'singleLineText' },
              ],
            },
          ],
        })
      )
    )
    mocks.airtableRequest.mockReset()
    mocks.airtableRequest.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as {
            fields: Record<string, unknown>
          }
          patches.push({ path, fields: body.fields })
        }
        return new Response('{}', { status: 200 })
      }
    )
  })

  const logoChange = (over: Partial<QueueItem> = {}) =>
    item({
      type: 'Change',
      source: 'Broom',
      changes: [
        {
          field: 'Logo',
          from: 'game-night-hackathon.webp (old tree-in-circle badge)',
          to: link,
        },
      ],
      ...over,
    })

  it('writes a logo named by its link as an attachment, whether proposed or edited', async () => {
    await acceptItem(logoChange(), {})
    expect(patches[0]).toEqual({
      path: `${EVENTS}/${rid('live')}`,
      fields: {
        Logo: [{ url: link, filename: 'apple-touch-icon-180-b1.png' }],
      },
    })

    patches = []
    await acceptItem(logoChange(), { Logo: blob })
    expect(patches[0].fields).toEqual({
      Logo: [{ url: blob, filename: 'mangrove-2026-09-22.png' }],
    })
    // The row is marked Applied, not Failed.
    expect(patches[1].path).toBe(`${QUEUE}/${rid('q1')}`)
    expect(patches[1].fields[STATUS]).toBe('Applied')
  })

  it('refuses text that is not a picture, in plain words, before Airtable sees it', async () => {
    await expect(
      acceptItem(logoChange(), { Logo: 'the new arches mark' })
    ).rejects.toThrow(
      '"Logo" takes a picture link, and "the new arches mark" is not one.'
    )
    // Nothing reached the record; the row records the failure.
    expect(patches.map(p => p.path)).toEqual([`${QUEUE}/${rid('q1')}`])
    expect(patches[0].fields[STATUS]).toBe('Failed')
    expect(patches[0].fields[ERROR]).toContain('takes a picture link')
  })

  it('on Undo, puts the other fields back and leaves a logo whose old side is only described', async () => {
    await undoItem(
      logoChange({
        status: 'Applied',
        changes: [
          {
            field: 'Logo',
            from: 'game-night-hackathon.webp (old badge)',
            to: link,
          },
          { field: 'Host name', from: 'Mangrove', to: 'Mangrove Games' },
        ],
      })
    )
    expect(patches[0]).toEqual({
      path: `${EVENTS}/${rid('live')}`,
      fields: { 'Host name': 'Mangrove' },
    })
    expect(patches[1].fields[STATUS]).toBe('Pending')
  })
})

describe('queueTargets', () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockReset()
    mocks.listAll.mockReset()
  })

  it('answers each target’s logo and link from the site’s catalog', async () => {
    vi.mocked(getCatalog).mockResolvedValue({
      listings: [
        {
          id: `organization:${rid('org')}`,
          logo: 'https://v5.airtableusercontent.com/org.png',
          url: 'https://example.org/',
        },
        // a community without a join link: the catalog stands in a "#"
        {
          id: `community:${rid('comm')}`,
          logo: 'https://v5.airtableusercontent.com/comm.png',
          url: '#',
        },
        // an advisor reached by email, which is no link to open
        {
          id: `person:${rid('adv')}`,
          logo: null,
          url: 'mailto:someone@example.org',
        },
      ],
    } as never)
    const found = await queueTargets([
      { table: EVENTS, record: rid('org') },
      { table: EVENTS, record: rid('comm') },
      { table: EVENTS, record: rid('adv') },
      { table: EVENTS, record: rid('unknown') },
      { table: 'not-a-table', record: rid('org') },
    ])
    expect(found.links).toEqual({ [rid('org')]: 'https://example.org/' })
    expect(found.logos).toEqual({
      [rid('org')]: 'https://v5.airtableusercontent.com/org.png',
      [rid('comm')]: 'https://v5.airtableusercontent.com/comm.png',
    })
  })

  it('is empty when the catalog cannot be built', async () => {
    vi.mocked(getCatalog).mockRejectedValue(new Error('Airtable is down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const found = await queueTargets([{ table: EVENTS, record: rid('org') }])
    expect(found).toEqual({ logos: {}, links: {} })
    spy.mockRestore()
  })
})
