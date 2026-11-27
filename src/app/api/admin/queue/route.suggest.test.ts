import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/admin/queue for each Queue mode, with the session and the
// Queue's writes replaced: someone whose decisions Bryce checks first can
// only suggest them, the rest of the page works for them as before, and a
// decision by someone with full edit on a suggested item is checked first.
// The check itself (requireSuggestionSeen) is the real one.

const h = vi.hoisted(() => ({
  mode: 'suggest' as 'edit' | 'suggest' | 'view' | null,
  item: null as Record<string, unknown> | null,
  calls: [] as { fn: string; args: unknown[] }[],
}))

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('@/lib/admin/auth', () => ({
  queueMode: async () => h.mode,
  canViewQueue: async () => h.mode !== null,
  canWorkQueue: async () => h.mode === 'edit' || h.mode === 'suggest',
  currentAdmin: async () => ({
    name: h.mode === 'suggest' ? 'Rob Grayson' : 'Bryce',
    email: 'someone@example.com',
  }),
}))
vi.mock('@/lib/admin/queue-map', () => ({ mapForStrip: vi.fn() }))
vi.mock('@/lib/admin/queue', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/admin/queue')>()
  const spy =
    (fn: string) =>
    async (...args: unknown[]) => {
      h.calls.push({ fn, args })
      return fn === 'undoItem' ? [] : undefined
    }
  return {
    ...real,
    getQueueItem: async () => h.item,
    acceptItem: spy('acceptItem'),
    rejectItem: spy('rejectItem'),
    deleteItem: spy('deleteItem'),
    laterItem: spy('laterItem'),
    waitItem: spy('waitItem'),
    undoItem: spy('undoItem'),
    fixItem: spy('fixItem'),
    saveEdits: spy('saveEdits'),
    suggestItem: spy('suggestItem'),
    withdrawItem: spy('withdrawItem'),
    askItem: spy('askItem'),
    answerItem: spy('answerItem'),
  }
})

import { POST } from './route'
import { makePrint } from '@/lib/admin/queue-suggest'

const PRINT = makePrint({
  verdict: 'Publish',
  changes: null,
  table: 'tblXbN9swwldwq8f7',
  record: 'recLISTING0000001',
  edits: null,
  reply: null,
})
const AT = '2026-11-30T03:00:00.000Z'

async function post(body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest('http://localhost/api/admin/queue', {
      method: 'POST',
      body: JSON.stringify({ id: 'recQUEUEROW000001', ...body }),
    })
  )
  return {
    status: res.status,
    body: (await res.json()) as {
      error?: string
      recheck?: { at: string; print?: unknown; moved?: string[] }
    },
  }
}
const called = () => h.calls.map(c => c.fn)

beforeEach(() => {
  h.calls = []
  h.mode = 'suggest'
  h.item = {
    id: 'recQUEUEROW000001',
    title: 'AI Safety Forum',
    type: 'Add',
    status: 'Pending',
    forBryce: null,
    print: PRINT,
  }
})

describe('with "Bryce checks first"', () => {
  it('refuses every decision sent as itself, and writes nothing', async () => {
    for (const action of ['accept', 'reject', 'delete', 'later', 'answer']) {
      const r = await post({ action })
      expect(r.status).toBe(403)
    }
    expect(called()).toEqual([])
    // Saying plainly that nothing happened: an old tab must not read it as
    // a suggestion saved.
    expect((await post({ action: 'accept' })).body.error).toBe(
      'Bryce checks your decisions first, so nothing was decided. Reload the page, then send it as a suggestion.'
    )
  })

  it('saves a suggestion, with what the decision would take', async () => {
    const r = await post({
      action: 'suggest',
      did: 'reject',
      reason: 'Not about AI safety',
      rejectReply: 'Sorry',
      edits: { Name: 'X' },
    })
    expect(r.status).toBe(200)
    expect(called()).toEqual(['suggestItem'])
    expect(h.calls[0].args[1]).toMatchObject({
      did: 'reject',
      reason: 'Not about AI safety',
      rejectReply: 'Sorry',
      edits: { Name: 'X' },
    })
    expect(h.calls[0].args[2]).toBe('Rob Grayson')
    expect((await post({ action: 'suggest', did: 'publish' })).status).toBe(400)
  })

  it('works the rest of the page as before', async () => {
    await post({ action: 'wait', on: true })
    await post({ action: 'undo' })
    await post({ action: 'fix', edits: { Name: 'Y' } })
    await post({ action: 'edit', edits: { Name: 'Z' }, keys: ['Name'] })
    await post({ action: 'withdraw' })
    await post({ action: 'ask', question: 'In scope?' })
    expect(called()).toEqual([
      'waitItem',
      'undoItem',
      'fixItem',
      'saveEdits',
      'withdrawItem',
      'askItem',
    ])
    // Edits say who is saving, so their own suggestion can lock the item.
    expect(h.calls[3].args[4]).toEqual({ by: 'Rob Grayson', checkFirst: true })
    // Taking back: only their own.
    expect(h.calls[4].args[2]).toBe(false)
  })
})

describe('with full edit', () => {
  beforeEach(() => {
    h.mode = 'edit'
  })

  it('has no suggestion to make, and may answer and dismiss', async () => {
    expect((await post({ action: 'suggest', did: 'accept' })).status).toBe(400)
    await post({ action: 'answer', answer: 'Yes' })
    await post({ action: 'withdraw' })
    expect(called()).toEqual(['answerItem', 'withdrawItem'])
    expect(h.calls[1].args[2]).toBe(true)
  })

  it('decides an item with no suggestion as before', async () => {
    expect((await post({ action: 'accept' })).status).toBe(200)
    expect(called()).toEqual(['acceptItem'])
  })

  it('confirms a suggestion only as the page showed it', async () => {
    h.item = {
      ...h.item,
      forBryce: {
        kind: 'suggest',
        by: 'Rob Grayson',
        at: AT,
        did: 'accept',
        reason: null,
        rejectReply: null,
        keep: [],
        publicChoice: null,
        edited: [],
        print: PRINT,
        asked: null,
      },
    }
    const stale = await post({ action: 'accept' })
    expect(stale.status).toBe(412)
    expect(stale.body.error).toContain('Rob suggested Publish')
    expect(called()).toEqual([])
    expect((await post({ action: 'reject', suggested: AT })).status).toBe(200)
    expect(called()).toEqual(['rejectItem'])
    // The item changed since: refused, nothing written, with the item's
    // fingerprint now for the page to send back once it has read it again.
    h.calls = []
    const now = { ...PRINT, verdict: 'deadbeef' }
    h.item = { ...h.item, print: now }
    const changed = await post({ action: 'accept', suggested: AT })
    expect(changed.status).toBe(412)
    expect(changed.body.recheck).toEqual({
      at: AT,
      print: now,
      moved: ['verdict'],
    })
    expect(called()).toEqual([])
    // Sent back: the decision goes. A malformed one counts as none.
    expect(
      (await post({ action: 'accept', suggested: AT, suggestedPrint: now }))
        .status
    ).toBe(200)
    expect(called()).toEqual(['acceptItem'])
    expect(
      (
        await post({
          action: 'accept',
          suggested: AT,
          suggestedPrint: { verdict: 'deadbeef' },
        })
      ).status
    ).toBe(412)
  })
})

describe('view only', () => {
  it('writes nothing at all', async () => {
    h.mode = 'view'
    for (const action of ['suggest', 'ask', 'accept', 'withdraw']) {
      expect((await post({ action })).status).toBe(401)
    }
    expect(called()).toEqual([])
  })
})
