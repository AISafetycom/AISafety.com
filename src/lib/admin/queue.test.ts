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
  asAttachmentPreview,
  asAttachmentWrite,
  closeHandledRows,
  extraEdits,
  handledOutside,
  mergeEdits,
  queueTargets,
  noReplyOf,
  rejectReplyOf,
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
    ruleWording: null,
    ruleWas: null,
    verdict: null,
    reasons: [],
    rejectChips: [],
    replyDraft: null,
    replyStatus: null,
    saidBy: null,
    replyTo: null,
    noReply: null,
    rejectReply: null,
    rejectDrafts: {},
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
  const EDITS = 'fldzCgKQbopgcbrwq'
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

  // Threading the Needle, 7 Oct 2026: Fable put finished logos on the
  // record from the chat, and Apply would have written Broom's raw file
  // and a "dark version of the same new mark" placeholder back over them.
  it('leaves a field Fable already changed, and Undo leaves it too', async () => {
    const twoLogos = logoChange({
      changes: [
        { field: 'Logo', from: 'old.jpg', to: 'dark version of the new mark' },
        { field: 'Host name', from: 'Mangrove', to: 'Mangrove Games' },
      ],
    })
    await acceptItem(twoLogos, {}, null, ['Logo', 'Name'])
    expect(patches[0]).toEqual({
      path: `${EVENTS}/${rid('live')}`,
      fields: { 'Host name': 'Mangrove Games' },
    })
    expect(patches[1].fields[STATUS]).toBe('Applied')
    // Only proposed fields are kept; the row remembers which.
    expect(JSON.parse(String(patches[1].fields[EDITS]))).toEqual({
      '(kept by Fable)': ['Logo'],
    })

    patches = []
    await undoItem({
      ...twoLogos,
      status: 'Applied',
      keptByFable: ['Logo'],
      changes: [
        { field: 'Logo', from: [{ url: link }], to: blob },
        { field: 'Host name', from: 'Mangrove', to: 'Mangrove Games' },
      ],
    })
    expect(patches[0]).toEqual({
      path: `${EVENTS}/${rid('live')}`,
      fields: { 'Host name': 'Mangrove' },
    })
    expect(patches[1].fields[STATUS]).toBe('Pending')
    expect(patches[1].fields[EDITS]).toBeNull()
  })

  it('clears the flag and writes nothing when Fable changed every proposed field', async () => {
    await acceptItem(logoChange({ issueRow: rid('issue') }), {}, null, ['Logo'])
    expect(patches.map(p => p.path)).toEqual([`${QUEUE}/${rid('q1')}`])
    expect(patches[0].fields[STATUS]).toBe('Applied')
  })
})

// A change with fields edited beyond its proposal (Bryce, 5 Oct 2026: "I
// want a way of editing other random fields too"): Accept writes them with
// the proposed ones and keeps what they held; Undo puts that back.
describe('fields edited beyond a change’s proposal', () => {
  const ROW = 'fldzCgKQbopgcbrwq'
  const schema = [
    { id: 'fldName', name: 'Name', type: 'singleLineText' },
    { id: 'fldDesc', name: 'Description', type: 'multilineText' },
    { id: 'fldOpen', name: 'Open?', type: 'checkbox' },
    { id: 'fldLogo', name: 'Logo', type: 'multipleAttachments' },
    { id: 'fldOrgs', name: 'Organizations', type: 'multipleRecordLinks' },
    { id: 'fldAge', name: 'Age', type: 'formula' },
  ]
  let patches: { path: string; fields: Record<string, unknown> }[]

  beforeEach(() => {
    patches = []
    process.env.AIRTABLE_TOKEN = 'test-token'
    process.env.AIRTABLE_BASE_ID = 'appTest'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ tables: [{ id: FUNDING, fields: schema }] })
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
          return new Response('{}', { status: 200 })
        }
        // the record as it is before Accept: an unticked box is absent
        return Response.json({
          id: rid('fund'),
          fields: { Name: 'Old name', Description: 'Old words' },
        })
      }
    )
  })

  const change = (over: Partial<QueueItem> = {}) =>
    item({
      type: 'Change',
      source: 'Broom',
      page: '/funding',
      targetTable: FUNDING,
      targetRecord: rid('fund'),
      changes: [{ field: 'Name', from: 'Old name', to: 'New name' }],
      ...over,
    })

  it('keeps only the fields that can be written', () => {
    expect(
      extraEdits(
        change(),
        {
          Name: 'Typed name',
          Description: 'Fresh words',
          'Open?': true,
          'Publish?': true,
          Logo: 'https://x.org/a.png',
          Organizations: ['recA'],
          Age: '3',
        },
        schema
      )
    ).toEqual({ Description: 'Fresh words', 'Open?': true })
  })

  it('writes them with the proposed fields and keeps what they held', async () => {
    const edits = { Description: 'Fresh words', 'Open?': true }
    await acceptItem(change(), edits)
    expect(patches[0]).toEqual({
      path: `${FUNDING}/${rid('fund')}`,
      fields: {
        Name: 'New name',
        Description: 'Fresh words',
        'Open?': true,
      },
    })
    expect(patches[1].fields[STATUS]).toBe('Applied')
    expect(JSON.parse(String(patches[1].fields[ROW]))).toEqual({
      ...edits,
      '(before)': { Description: 'Old words', 'Open?': false },
    })
  })

  it('writes them on a flag with nothing proposed', async () => {
    await acceptItem(change({ changes: [] }), { Description: 'Fresh words' })
    expect(patches[0].fields).toEqual({ Description: 'Fresh words' })
  })

  it('reads nothing more when only proposed fields were edited', async () => {
    await acceptItem(change(), { Name: 'Typed name' })
    expect(patches[0].fields).toEqual({ Name: 'Typed name' })
    expect(JSON.parse(String(patches[1].fields[ROW]))).toEqual({
      Name: 'Typed name',
    })
    expect(
      mocks.airtableRequest.mock.calls.every(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH'
      )
    ).toBe(true)
  })

  it('writes a proposed Hide? or Publish? box, as a real true or false', async () => {
    await acceptItem(
      change({
        changes: [
          { field: 'Hide?', from: false, to: true },
          { field: 'Publish?', from: 'true', to: 'false (untick it)' },
        ],
      }),
      {}
    )
    expect(patches[0]).toEqual({
      path: `${FUNDING}/${rid('fund')}`,
      fields: { 'Hide?': true, 'Publish?': false },
    })
    expect(patches[1].fields[STATUS]).toBe('Applied')
  })

  it('still never writes Hide? or Publish? typed in beyond the proposal', async () => {
    await acceptItem(change(), { 'Hide?': true, 'Publish?': false })
    expect(patches[0].fields).toEqual({ Name: 'New name' })
  })

  it('on Undo, puts a proposed Hide? box back as it was', async () => {
    await undoItem(
      change({
        status: 'Applied',
        changes: [{ field: 'Hide?', from: null, to: true }],
      })
    )
    expect(patches[0]).toEqual({
      path: `${FUNDING}/${rid('fund')}`,
      fields: { 'Hide?': false },
    })
    expect(patches[1].fields[STATUS]).toBe('Pending')
  })

  it('on Undo, puts them back too and keeps the edits as the draft', async () => {
    await undoItem(
      change({
        status: 'Applied',
        edits: { Description: 'Fresh words', 'Open?': true },
        before: { Description: 'Old words', 'Open?': false },
      })
    )
    expect(patches[0]).toEqual({
      path: `${FUNDING}/${rid('fund')}`,
      fields: { Name: 'Old name', Description: 'Old words', 'Open?': false },
    })
    expect(patches[1].fields[STATUS]).toBe('Pending')
    expect(JSON.parse(String(patches[1].fields[ROW]))).toEqual({
      Description: 'Fresh words',
      'Open?': true,
    })
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
          meta: {},
        },
        // a community without a join link: the catalog stands in a "#"
        {
          id: `community:${rid('comm')}`,
          logo: 'https://v5.airtableusercontent.com/comm.png',
          url: '#',
          meta: {},
        },
        // an advisor reached by email, which is no link to open
        {
          id: `person:${rid('adv')}`,
          logo: null,
          url: 'mailto:someone@example.org',
          meta: {},
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
    expect(found.dates).toEqual({})
  })

  it('answers a published event’s start date and deadline', async () => {
    vi.mocked(getCatalog).mockResolvedValue({
      listings: [
        {
          id: `event:${rid('event')}`,
          logo: null,
          url: 'https://luma.com/x',
          meta: { startDate: '2026-10-09', applicationsClose: '2026-10-08' },
        },
        {
          id: `training:${rid('course')}`,
          logo: null,
          url: 'https://example.org/course',
          meta: { startDate: '2026-11-02' },
        },
      ],
    } as never)
    const found = await queueTargets([
      { table: EVENTS, record: rid('event') },
      { table: EVENTS, record: rid('course') },
    ])
    expect(found.dates).toEqual({
      [rid('event')]: { start: '2026-10-09', closes: '2026-10-08' },
      [rid('course')]: { start: '2026-11-02', closes: null },
    })
  })

  it('is empty when the catalog cannot be built', async () => {
    vi.mocked(getCatalog).mockRejectedValue(new Error('Airtable is down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const found = await queueTargets([{ table: EVENTS, record: rid('org') }])
    expect(found).toEqual({ logos: {}, links: {}, dates: {} })
    spy.mockRestore()
  })
})

describe('asAttachmentPreview', () => {
  const link = 'https://generality.org/assets/logo-glyph.svg'

  it('shows a picture named by its link on the card, one or several', () => {
    expect(asAttachmentPreview(link)).toEqual([
      { url: link, filename: 'logo-glyph.svg' },
    ])
    expect(asAttachmentPreview(`${link}, https://x.org/a.webp`)).toEqual([
      { url: link, filename: 'logo-glyph.svg' },
      { url: 'https://x.org/a.webp', filename: 'a.webp' },
    ])
    expect(asAttachmentPreview([{ url: link, filename: 'mark.svg' }])).toEqual([
      { url: link, filename: 'mark.svg' },
    ])
  })

  it('leaves anything that is not a picture link as it came', () => {
    expect(asAttachmentPreview('old badge, replaced')).toBe(
      'old badge, replaced'
    )
    expect(asAttachmentPreview(null)).toBe(null)
    expect(asAttachmentPreview([])).toEqual([])
  })
})

describe('mergeEdits', () => {
  const onRow = {
    'Short name': 'Generality Labs',
    'Logo (for cards)': 'https://generality.org/assets/logo-glyph.svg',
  }

  it('moves only the keys the page touched, keeping the rest of the row', () => {
    // A page that read the row before the logo edit landed edits Short name.
    expect(
      mergeEdits(onRow, { 'Short name': 'Generality' }, ['Short name'])
    ).toEqual({
      'Short name': 'Generality',
      'Logo (for cards)': 'https://generality.org/assets/logo-glyph.svg',
    })
    // An edit taken back on the page drops off the row.
    expect(mergeEdits(onRow, {}, ['Short name'])).toEqual({
      'Logo (for cards)': 'https://generality.org/assets/logo-glyph.svg',
    })
  })

  it('replaces the row\u2019s edits when no keys are named', () => {
    expect(mergeEdits(onRow, { Scale: 'Medium' })).toEqual({ Scale: 'Medium' })
    expect(mergeEdits(null, { Scale: 'Medium' }, ['Scale'])).toEqual({
      Scale: 'Medium',
    })
  })
})

describe('rejectReplyOf', () => {
  const decided = '2026-10-04T12:00:00.000Z'
  it('reads a saved rejection reply for this decision', () => {
    expect(
      rejectReplyOf(
        { since: decided, text: 'Thanks – not this one.', draft: 'r-1' },
        decided
      )
    ).toEqual({ text: 'Thanks – not this one.', state: 'saved', error: null })
  })
  it('reads a Discord decline kept to copy', () => {
    expect(
      rejectReplyOf(
        { since: decided, text: 'From Fable:\n>>> Thanks', ready: decided },
        decided
      )
    ).toEqual({
      text: 'From Fable:\n>>> Thanks',
      state: 'ready',
      error: null,
    })
  })
  it('reports one being written, or one that failed', () => {
    expect(
      rejectReplyOf({ since: decided, writing: decided }, decided)?.state
    ).toBe('writing')
    expect(
      rejectReplyOf({ since: decided, failed: 'Gmail said no' }, decided)
    ).toEqual({ text: null, state: 'failed', error: 'Gmail said no' })
  })
  it('ignores a reply from an earlier rejection (Undo, then Reject again)', () => {
    expect(
      rejectReplyOf(
        { since: '2026-10-04T11:00:00.000Z', text: 'old', draft: 'r-0' },
        decided
      )
    ).toBeNull()
  })
})

describe('noReplyOf', () => {
  it('reads why a Form row has no reply draft', () => {
    expect(noReplyOf({ kind: 'add', no_reply: 'no email' })).toBe('no email')
    expect(noReplyOf({ no_reply: 'no notification' })).toBe('no notification')
  })
  it('gives way to a reply block, and is null when no reason is given', () => {
    expect(
      noReplyOf({ no_reply: 'no email', reply: { to: 'a@example.com' } })
    ).toBeNull()
    expect(noReplyOf({ kind: 'add' })).toBeNull()
  })
  it('warns about a reason it does not know', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(noReplyOf({ no_reply: 'mailbox full' })).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
