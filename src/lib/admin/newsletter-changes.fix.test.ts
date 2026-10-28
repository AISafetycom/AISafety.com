import { beforeEach, describe, expect, it, vi } from 'vitest'

// The newsletter's Fix button on a Broom item, run against a stand-in for
// Airtable (the listing, the Queue row and the table's columns) with the
// email's cards and the site's card previews stubbed out: what it writes,
// and what it tells the admin.
const mocks = vi.hoisted(() => ({
  airtableRequest: vi.fn(),
  draftCardGroups: vi.fn(),
}))
vi.mock('./airtable', () => ({
  airtableRequest: mocks.airtableRequest,
  listAll: vi.fn(async () => []),
  isRecordId: (id: string) => /^rec[A-Za-z0-9]{14}$/.test(id),
}))
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('./session', () => ({ sealToken: vi.fn() }))
vi.mock('@/lib/assistant/catalog', () => ({ getCatalog: vi.fn() }))
vi.mock('./newsletter', async importOriginal => ({
  ...(await importOriginal<typeof import('./newsletter')>()),
  draftCardGroups: mocks.draftCardGroups,
}))
vi.mock('./queue', async importOriginal => ({
  ...(await importOriginal<typeof import('./queue')>()),
  listQueue: vi.fn(async () => []),
  getPreviewListings: vi.fn(async () => ({})),
}))

import { fixListing } from './newsletter-changes'
import { GONE_KEY } from './queue-retired'

const QUEUE = 'tblonlKwIFJ7Aa8QN'
const FUNDING = 'tblzMTLDZWZKqTxrq'
const F = {
  type: 'fldBc9YIDhjmu58f3',
  source: 'flddKkVy62MAZ8M0J',
  status: 'fldTXGYOoXcUApaI2',
  proposal: 'fldgl9Ny2jnu8T0Da',
  edits: 'fldzCgKQbopgcbrwq',
  targetTable: 'fld45SUjstUZROuXl',
  targetRecord: 'fldszXtLdUijgFG4l',
}
const rid = (n: string) => `rec${n.padStart(14, '0')}`
const ID = rid('broom')
const FUND = rid('fund')
const OLD = 'Accepting applications?'
const NEW_COLUMNS = [
  { id: 'fldsFpgVduYnNuYkN', name: 'Name', type: 'singleLineText' },
  { id: 'fldD8GVcdVy4Vonaa', name: 'Application status', type: 'singleSelect' },
  { id: 'fldv6IKA9WMDJNTbT', name: 'Deadline', type: 'date' },
]
const OLD_COLUMN = {
  id: 'fld398tQjtRGz0Pk1',
  name: OLD,
  type: 'singleLineText',
}

describe('fixListing on a Broom item that names a deleted column', () => {
  let columns: typeof NEW_COLUMNS
  let listing: Record<string, unknown>
  let row: Record<string, unknown>
  let writes: { path: string; fields: Record<string, unknown> }[]

  beforeEach(() => {
    columns = NEW_COLUMNS
    listing = { Name: 'A fund', 'Application status': 'Applications open' }
    // Broom's usual proposal: both values filled in.
    row = {
      [F.type]: 'Change',
      [F.source]: 'Broom',
      [F.status]: 'Pending',
      [F.proposal]: JSON.stringify({
        kind: 'change',
        table: FUNDING,
        record: FUND,
        page: '/funding',
        changes: [
          {
            field: OLD,
            from: 'Applications close 23 October 2026',
            to: 'Not accepting applications',
          },
          {
            field: 'Application status',
            from: 'Applications open',
            to: 'Not currently accepting applications',
          },
        ],
      }),
      [F.targetTable]: FUNDING,
      [F.targetRecord]: FUND,
    }
    writes = []
    mocks.draftCardGroups.mockResolvedValue([
      {
        id: 'g0',
        label: 'Closing soon',
        cards: [
          {
            key: FUND,
            title: 'A fund',
            logo: null,
            fit: null,
            pipelineFit: null,
            fields: [],
            site: false,
          },
        ],
      },
    ])
    process.env.AIRTABLE_TOKEN = 'test-token'
    process.env.AIRTABLE_BASE_ID = 'appTest'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          tables: [
            { id: FUNDING, primaryFieldId: NEW_COLUMNS[0].id, fields: columns },
          ],
        })
      )
    )
    mocks.airtableRequest.mockReset()
    mocks.airtableRequest.mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          const { fields } = JSON.parse(String(init.body)) as {
            fields: Record<string, unknown>
          }
          if (path.startsWith(`${QUEUE}/${ID}`)) {
            for (const [k, v] of Object.entries(fields)) {
              if (v === null) delete row[k]
              else row[k] = v
            }
            return new Response('{}', { status: 200 })
          }
          // Airtable itself: a field it does not have fails the whole write.
          const unknown = Object.keys(fields).find(
            k => !columns.some(c => c.name === k)
          )
          if (unknown) {
            return Response.json(
              {
                error: {
                  type: 'UNKNOWN_FIELD_NAME',
                  message: `Unknown field name: "${unknown}"`,
                },
              },
              { status: 422 }
            )
          }
          writes.push({ path, fields })
          return new Response('{}', { status: 200 })
        }
        if (path.startsWith(`${QUEUE}/${ID}`)) {
          return Response.json({
            id: ID,
            createdTime: '2026-10-20T00:00:00.000Z',
            fields: row,
          })
        }
        // The listing as it is now: a deleted column is simply absent.
        return Response.json({ id: FUND, fields: listing })
      }
    )
  })

  const saved = () => JSON.parse(String(row[F.edits])) as unknown

  it('says the field was left out because its column is gone, and applies the rest', async () => {
    const res = await fixListing('draft1', FUND, ID)
    expect(res.applied).toBe(true)
    expect(res.note).toBe(
      'Accepting applications? was left out: that column is no longer in Airtable. Use Application status and Deadline instead.'
    )
    expect(res.note).not.toContain('someone changed it')
    expect(writes).toEqual([
      {
        path: `${FUNDING}/${FUND}`,
        fields: {
          'Application status': 'Not currently accepting applications',
        },
      },
    ])
    expect(row[F.status]).toBe('Applied')
    expect(saved()).toEqual({ [GONE_KEY]: [OLD] })
  })

  it('writes it as before while the column is still there', async () => {
    columns = [...NEW_COLUMNS, OLD_COLUMN]
    listing = { ...listing, [OLD]: 'Applications close 23 October 2026' }
    const res = await fixListing('draft1', FUND, ID)
    expect(res.note).toBeNull()
    expect(writes).toEqual([
      {
        path: `${FUNDING}/${FUND}`,
        fields: {
          [OLD]: 'Not accepting applications',
          'Application status': 'Not currently accepting applications',
        },
      },
    ])
  })

  it('still leaves a field someone changed by hand while its column is there', async () => {
    columns = [...NEW_COLUMNS, OLD_COLUMN]
    listing = { ...listing, [OLD]: 'Applications on a rolling basis' }
    const res = await fixListing('draft1', FUND, ID)
    expect(res.note).toBe(
      'Left Accepting applications? as it is: someone changed it on the listing after Broom’s check.'
    )
    expect(writes).toEqual([
      {
        path: `${FUNDING}/${FUND}`,
        fields: {
          'Application status': 'Not currently accepting applications',
        },
      },
    ])
    expect(saved()).toEqual({ '(kept by Fable)': [OLD] })
  })
})
