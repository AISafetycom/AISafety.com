import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Bryce checks first" end to end against a stand-in for Airtable: one
// Queue row and its listing held in memory, every request recorded. A
// suggestion, taking it back, confirming it (with both names kept), the
// check that stops a confirm once the item has changed, and a question
// with its answer. No request ever leaves the test.

const mocks = vi.hoisted(() => ({
  listAll: vi.fn(),
  airtableRequest: vi.fn(),
}))
vi.mock('@vercel/blob', () => ({ put: vi.fn(), list: vi.fn() }))
vi.mock('./airtable', () => ({
  airtableRequest: mocks.airtableRequest,
  listAll: mocks.listAll,
  isRecordId: (id: string) => /^rec[A-Za-z0-9]{14}$/.test(id),
}))
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('./session', () => ({ sealToken: vi.fn() }))
vi.mock('@/lib/assistant/catalog', () => ({ getCatalog: vi.fn() }))

import {
  acceptItem,
  answerItem,
  askItem,
  deleteItem,
  getQueueItem,
  laterItem,
  LIST_FORMULA,
  listQueue,
  rejectItem,
  requireSuggestionSeen,
  saveEdits,
  suggestItem,
  withdrawItem,
  type QueueItem,
  type SuggestInput,
} from './queue'

const QUEUE = 'tblonlKwIFJ7Aa8QN'
const EVENTS = 'tblXbN9swwldwq8f7'
const ID = 'recQUEUEROW000001'
const RECORD = 'recLISTING0000001'
const F = {
  title: 'fldeRsOE3DM3R2vbX',
  type: 'fldBc9YIDhjmu58f3',
  source: 'flddKkVy62MAZ8M0J',
  status: 'fldTXGYOoXcUApaI2',
  page: 'fldAMyLjM8CnXSRPX',
  targetTable: 'fld45SUjstUZROuXl',
  targetRecord: 'fldszXtLdUijgFG4l',
  proposal: 'fldgl9Ny2jnu8T0Da',
  verdict: 'fld835yJytaSRAuvB',
  replyDraft: 'fld8lCAVyjDEVZ8VV',
  rejectReason: 'fldYa0cnc5rQxAfAa',
  rejectReply: 'fldUQqwJn7btv6EBP',
  edits: 'fldzCgKQbopgcbrwq',
  decidedAt: 'fldtt7z4lYvAR5t94',
  reviewAgainOn: 'fldm9eFBj0iWuN23P',
  error: 'fldrJcvFN3FCcyQPn',
  history: 'fldjRsqYJAwR6CXpA',
  forBryce: 'fldWFnmC0u06GNC6B',
}
const ROB = 'Rob Grayson'
const BRYCE = 'Bryce'

let row: Record<string, unknown>
let listing: Record<string, unknown>
let writes: { method: string; path: string; fields?: Record<string, unknown> }[]

beforeEach(() => {
  process.env.AIRTABLE_TOKEN = 'test-token'
  process.env.AIRTABLE_BASE_ID = 'appTest'
  // The table's columns, for the needed-field check.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        tables: [
          {
            id: EVENTS,
            primaryFieldId: 'fldName',
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
  row = {
    [F.title]: 'AI Safety Forum',
    [F.type]: 'Add',
    [F.source]: 'Form',
    [F.status]: 'Pending',
    [F.page]: '/events',
    [F.targetTable]: EVENTS,
    [F.targetRecord]: RECORD,
    [F.verdict]: 'Publish',
    [F.replyDraft]: 'Thanks, it is listed now.',
    [F.edits]: JSON.stringify({ Name: 'AI Safety Forum' }),
    [F.proposal]: JSON.stringify({
      fields: { Name: 'AI Safety Forum' },
      reply: { to: 'host@example.org', name: 'Host' },
    }),
  }
  listing = {
    Name: 'AI Safety Forum',
    'Host name': 'Forum team',
    Logo: [{ url: 'https://example.org/logo.png' }],
  }
  writes = []
  mocks.listAll.mockReset()
  mocks.listAll.mockResolvedValue([])
  mocks.airtableRequest.mockReset()
  mocks.airtableRequest.mockImplementation(
    async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { fields: Record<string, unknown> })
        : null
      if (method !== 'GET') writes.push({ method, path, fields: body?.fields })
      if (path.startsWith(`${QUEUE}/${ID}`)) {
        for (const [k, v] of Object.entries(body?.fields ?? {})) {
          if (v === null) delete row[k]
          else row[k] = v
        }
        return Response.json({
          id: ID,
          createdTime: '2026-11-29T00:00:00.000Z',
          fields: row,
        })
      }
      if (path.startsWith(`${EVENTS}/${RECORD}`)) {
        Object.assign(listing, body?.fields ?? {})
        return Response.json({ id: RECORD, fields: listing })
      }
      return new Response('not here', { status: 404 })
    }
  )
})

const current = async (): Promise<QueueItem> => {
  const i = await getQueueItem(ID)
  if (!i) throw new Error('row gone')
  return i
}
const history = () =>
  JSON.parse(String(row[F.history] ?? '[]')) as {
    did: string
    by: string | null
    suggested?: { by: string | null; did: string }
  }[]
const last = () => history()[history().length - 1]

function suggestion(over: Partial<SuggestInput> = {}): SuggestInput {
  return {
    did: 'accept',
    edits: { Name: 'AI Safety Forum 2027' },
    replyDraft: 'Thanks, it is on /events now.',
    keep: [],
    publicWording: null,
    reason: 'In scope and every field checks out',
    rejectReply: null,
    ...over,
  }
}

describe('a suggestion', () => {
  it('leaves the row Pending and writes nothing but the row’s own fields', async () => {
    await suggestItem(await current(), suggestion(), ROB)
    // One write, to the Queue row: no Publish?, no status, no decision.
    expect(writes.map(w => `${w.method} ${w.path.split('?')[0]}`)).toEqual([
      `PATCH ${QUEUE}/${ID}`,
    ])
    expect(Object.keys(writes[0].fields ?? {}).sort()).toEqual(
      [F.edits, F.replyDraft, F.forBryce, F.history].sort()
    )
    expect(listing['Publish?']).toBeUndefined()
    const now = await current()
    expect(now.status).toBe('Pending')
    expect(now.decidedAt).toBeNull()
    expect(now.edits).toEqual({ Name: 'AI Safety Forum 2027' })
    expect(now.replyDraft).toBe('Thanks, it is on /events now.')
    expect(now.forBryce).toMatchObject({
      kind: 'suggest',
      by: ROB,
      did: 'accept',
      reason: 'In scope and every field checks out',
      edited: ['Name'],
    })
    expect(last()).toMatchObject({
      did: 'suggest',
      by: ROB,
      suggested: { by: ROB, did: 'accept' },
    })
  })

  it('runs the decision’s own checks at once and writes nothing on a refusal', async () => {
    delete listing['Host name']
    await expect(
      suggestItem(await current(), suggestion(), ROB)
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Host name'),
    })
    expect(writes).toEqual([])
    // Delete is refused on a live listing, as Delete itself is.
    listing['Host name'] = 'Forum team'
    listing['Publish?'] = true
    await expect(
      suggestItem(await current(), suggestion({ did: 'delete' }), ROB)
    ).rejects.toMatchObject({ status: 409 })
    expect(writes).toEqual([])
  })

  it('refuses a second one while the first waits, and a decided item', async () => {
    await suggestItem(await current(), suggestion(), ROB)
    await expect(
      suggestItem(await current(), suggestion({ did: 'reject' }), ROB)
    ).rejects.toMatchObject({ status: 409 })
    row[F.status] = 'Applied'
    delete row[F.forBryce]
    await expect(
      suggestItem(await current(), suggestion(), ROB)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('can be taken back by its author until someone acts', async () => {
    await suggestItem(await current(), suggestion({ did: 'later' }), ROB)
    // Another teammate whose decisions are checked first can't take it back.
    await expect(
      withdrawItem(await current(), 'Sam Lee', false)
    ).rejects.toMatchObject({ status: 403 })
    await withdrawItem(await current(), ROB, false)
    const now = await current()
    expect(now.forBryce).toBeNull()
    expect(now.status).toBe('Pending')
    expect(now.reviewAgainOn).toBeNull()
    expect(last()).toMatchObject({
      did: 'withdraw',
      by: ROB,
      suggested: { by: ROB, did: 'later' },
    })
    // Nothing left to take back.
    await expect(
      withdrawItem(await current(), ROB, false)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('can be dismissed by someone with full edit, on a row a bot closed', async () => {
    await suggestItem(await current(), suggestion(), ROB)
    row[F.status] = 'Closed'
    row[F.error] = 'Published outside the queue'
    await withdrawItem(await current(), BRYCE, true)
    expect((await current()).forBryce).toBeNull()
    expect(last()).toMatchObject({
      did: 'withdraw',
      by: BRYCE,
      suggested: { by: ROB, did: 'accept' },
    })
  })

  it('locks the item for its author: edits wait until it is taken back', async () => {
    await suggestItem(await current(), suggestion(), ROB)
    await expect(
      saveEdits(await current(), { Name: 'Changed' }, undefined, ['Name'], {
        by: ROB,
        checkFirst: true,
      })
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('confirming a suggestion', () => {
  it('Publish: goes live, clears For Bryce in the same write, keeps both names', async () => {
    await suggestItem(await current(), suggestion(), ROB)
    const item = await current()
    const s = item.forBryce
    if (s?.kind !== 'suggest') throw new Error('no suggestion')
    requireSuggestionSeen(item, s.at)
    writes = []
    await acceptItem(item, item.edits ?? {}, item.replyDraft, [], null, BRYCE)
    expect(listing['Publish?']).toBe(true)
    const rowWrites = writes.filter(w => w.path.startsWith(QUEUE))
    const final = rowWrites[rowWrites.length - 1].fields ?? {}
    expect(final[F.status]).toBe('Applied')
    expect(final[F.forBryce]).toBeNull()
    expect(F.history in final).toBe(true)
    expect((await current()).forBryce).toBeNull()
    expect(last()).toMatchObject({
      did: 'accept',
      by: BRYCE,
      suggested: { by: ROB, did: 'accept' },
    })
  })

  it('Reject: as suggested, with the decider’s and the suggester’s names', async () => {
    await suggestItem(
      await current(),
      suggestion({
        did: 'reject',
        reason: 'Not about AI safety',
        rejectReply: 'Thanks, but it is outside what the site lists.',
      }),
      ROB
    )
    const item = await current()
    requireSuggestionSeen(item, item.forBryce?.at ?? null)
    expect(item.forBryce).toMatchObject({
      reason: 'Not about AI safety',
      rejectReply: 'Thanks, but it is outside what the site lists.',
    })
    await rejectItem(
      item,
      'Not about AI safety',
      'Thanks, but it is outside what the site lists.',
      BRYCE
    )
    const now = await current()
    expect(now.status).toBe('Rejected')
    expect(now.rejectReason).toBe('Not about AI safety')
    expect(now.forBryce).toBeNull()
    expect(last()).toMatchObject({
      did: 'reject',
      by: BRYCE,
      suggested: { by: ROB, did: 'reject' },
    })
  })

  it('deciding differently keeps what was suggested', async () => {
    await suggestItem(await current(), suggestion(), ROB)
    const item = await current()
    requireSuggestionSeen(item, item.forBryce?.at ?? null)
    await laterItem(item, BRYCE)
    expect((await current()).forBryce).toBeNull()
    expect(last()).toMatchObject({
      did: 'later',
      by: BRYCE,
      suggested: { by: ROB, did: 'accept' },
    })
  })

  it('Delete: closes the row and clears For Bryce', async () => {
    await suggestItem(await current(), suggestion({ did: 'delete' }), ROB)
    const item = await current()
    await deleteItem(item, BRYCE)
    const now = await current()
    expect(now.status).toBe('Closed')
    expect(now.forBryce).toBeNull()
    expect(last()).toMatchObject({ did: 'delete', suggested: { by: ROB } })
  })
})

describe('the check before a confirm (412)', () => {
  const suggested = async () => {
    await suggestItem(await current(), suggestion(), ROB)
    const s = (await current()).forBryce
    if (s?.kind !== 'suggest') throw new Error('no suggestion')
    return s.at
  }
  const refusal = async (seen: string | null) => {
    try {
      requireSuggestionSeen(await current(), seen)
      return null
    } catch (e) {
      return e as { status: number; message: string }
    }
  }

  it('passes when the page showed this suggestion on the item as it is', async () => {
    const at = await suggested()
    expect(await refusal(at)).toBeNull()
  })

  it('refuses a page that loaded before the suggestion', async () => {
    await suggested()
    expect(await refusal(null)).toMatchObject({
      status: 412,
      message: expect.stringContaining('Rob suggested Publish'),
    })
    expect(await refusal('2026-11-01T00:00:00.000Z')).toMatchObject({
      status: 412,
    })
  })

  it('refuses once the verdict, the edits or the reply draft changed', async () => {
    const at = await suggested()
    row[F.verdict] = 'Unsure'
    expect(await refusal(at)).toMatchObject({
      status: 412,
      message: expect.stringContaining('Its verdict changed'),
    })
    row[F.verdict] = 'Publish'
    row[F.edits] = JSON.stringify({ Name: 'Something else' })
    expect(await refusal(at)).toMatchObject({
      status: 412,
      message: expect.stringContaining('The edits changed'),
    })
    row[F.edits] = JSON.stringify({ Name: 'AI Safety Forum 2027' })
    row[F.replyDraft] = 'A different reply'
    expect((await refusal(at))?.message).toContain('The reply draft changed')
    row[F.replyDraft] = 'Thanks, it is on /events now.'
    row[F.targetRecord] = 'recSOMETHINGELSE1'
    expect((await refusal(at))?.message).toContain(
      'The listing it is about changed'
    )
  })

  it('ignores what the bots rewrite on the Proposal all day', async () => {
    const at = await suggested()
    const proposal = JSON.parse(String(row[F.proposal]))
    row[F.proposal] = JSON.stringify({
      ...proposal,
      placed: { at: '2026-11-30T04:00:00.000Z' },
      field_flags: { flags: [] },
    })
    expect(await refusal(at)).toBeNull()
    // Edits stored in another key order are the same edits.
    expect(await refusal(at)).toBeNull()
  })

  it('follows the decider’s own edits, so their confirm still goes', async () => {
    const at = await suggested()
    await saveEdits(
      await current(),
      { Name: 'AI Safety Forum, 2027' },
      'Thanks! It is on the site now.',
      ['Name'],
      { by: BRYCE, checkFirst: false }
    )
    expect(await refusal(at)).toBeNull()
    expect((await current()).edits).toEqual({ Name: 'AI Safety Forum, 2027' })
  })

  it('but not over a change from elsewhere first', async () => {
    const at = await suggested()
    row[F.edits] = JSON.stringify({ Name: 'Changed by the chat' })
    await saveEdits(
      await current(),
      { Name: 'AI Safety Forum, 2027' },
      undefined,
      ['Name'],
      { by: BRYCE, checkFirst: false }
    )
    expect((await refusal(at))?.status).toBe(412)
  })
})

describe('Ask Bryce', () => {
  it('asks on a decided item and gets an answer back on it', async () => {
    row[F.status] = 'Applied'
    row[F.decidedAt] = '2026-11-28T00:00:00.000Z'
    await askItem(await current(), 'Should the logo be the dark one?', ROB)
    expect((await current()).forBryce).toMatchObject({
      kind: 'ask',
      by: ROB,
      question: 'Should the logo be the dark one?',
      answer: null,
    })
    expect(last()).toMatchObject({ did: 'ask', by: ROB })
    await expect(
      askItem(await current(), 'And another?', ROB)
    ).rejects.toMatchObject({ status: 409 })
    await answerItem(await current(), 'Yes, the dark one.', BRYCE)
    expect((await current()).forBryce).toMatchObject({
      kind: 'ask',
      answer: 'Yes, the dark one.',
      answeredBy: BRYCE,
    })
    expect(last()).toMatchObject({
      did: 'answer',
      by: BRYCE,
      suggested: { by: ROB, did: 'ask' },
    })
    // Nothing left to answer; Got it clears it without another line.
    await expect(
      answerItem(await current(), 'Again', BRYCE)
    ).rejects.toMatchObject({ status: 409 })
    const lines = history().length
    await withdrawItem(await current(), ROB, false)
    expect((await current()).forBryce).toBeNull()
    expect(history().length).toBe(lines)
  })

  it('is answered by deciding the item, too', async () => {
    await askItem(await current(), 'Is this in scope?', ROB)
    const item = await current()
    // A question is no suggestion: nothing to check before deciding.
    requireSuggestionSeen(item, null)
    await rejectItem(item, 'Not in scope', null, BRYCE)
    expect((await current()).forBryce).toBeNull()
    expect(last()).toMatchObject({
      did: 'reject',
      suggested: { by: ROB, did: 'ask' },
    })
  })

  it('wants words', async () => {
    await expect(askItem(await current(), '   ', ROB)).rejects.toMatchObject({
      status: 400,
    })
    expect(writes).toEqual([])
  })
})

describe('the list', () => {
  it('also reads every row whose For Bryce holds something, by field id', async () => {
    expect(LIST_FORMULA.startsWith('OR(')).toBe(true)
    expect(LIST_FORMULA.endsWith(`,{${F.forBryce}}!='')`)).toBe(true)
    expect(LIST_FORMULA).not.toContain('For Bryce')
    await listQueue()
    const params = mocks.listAll.mock.calls[0][1] as URLSearchParams
    expect(params.get('filterByFormula')).toBe(LIST_FORMULA)
  })

  it('gives a row read by itself its fingerprint, and the list none', async () => {
    expect((await current()).print).toMatchObject({
      verdict: expect.stringMatching(/^[0-9a-f]{8}$/),
    })
    mocks.listAll.mockResolvedValue([
      { id: ID, createdTime: '2026-11-29T00:00:00.000Z', fields: row },
    ])
    const [listed] = await listQueue()
    expect(listed.print).toBeUndefined()
  })
})
