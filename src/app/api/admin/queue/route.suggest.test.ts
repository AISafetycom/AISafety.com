import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/admin/queue for each Queue mode, with the session and the
// Queue's writes replaced: someone whose decisions Bryce checks first can
// only suggest them, the rest of the page works for them as before, and a
// decision by someone with full edit on a suggested item is checked first.
// The check itself (requireSuggestionSeen) is the real one.

const h = vi.hoisted(() => ({
  email: 'someone@example.com',
  mode: 'suggest' as 'edit' | 'suggest' | 'view' | null,
  item: null as Record<string, unknown> | null,
  calls: [] as { fn: string; args: unknown[]; as: string | null }[],
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
    email: h.email,
  }),
}))
vi.mock('@/lib/admin/queue-map', () => ({ mapForStrip: vi.fn() }))
vi.mock('@/lib/admin/queue', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/admin/queue')>()
  const { actorEmail } = await import('@/lib/admin/queue-actor')
  const spy =
    (fn: string) =>
    async (...args: unknown[]) => {
      // Whose request it runs in: the address its History entry would carry.
      h.calls.push({ fn, args, as: actorEmail() })
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
    flagItem: spy('flagItem'),
    unflagItem: spy('unflagItem'),
  }
})

import { POST } from './route'
import { ROOT_ADMINS } from '@/lib/admin/users'
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

async function post(
  body: Record<string, unknown>,
  // As the page sends it.
  headers: Record<string, string> = { 'Content-Type': 'application/json' }
) {
  const res = await POST(
    new NextRequest('http://localhost/api/admin/queue', {
      method: 'POST',
      headers,
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
  h.email = 'someone@example.com'
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

describe('where a write may come from', () => {
  it('takes the page’s own JSON, and refuses a form or plain text', async () => {
    h.mode = 'edit'
    expect((await post({ action: 'wait', on: true })).status).toBe(200)
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
    ]) {
      const r = await post({ action: 'accept' }, { 'Content-Type': type })
      expect(r.status).toBe(403)
    }
    expect((await post({ action: 'accept' }, {})).status).toBe(403)
    // Only the first got through.
    expect(called()).toEqual(['waitItem'])
  })

  it('refuses another site, and another host under the same domain', async () => {
    h.mode = 'edit'
    const json = { 'Content-Type': 'application/json' }
    const elsewhere: Record<string, string>[] = [
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
      { Origin: 'https://evil.example' },
      { Origin: 'http://preview.localhost' },
    ]
    for (const headers of elsewhere) {
      const r = await post({ action: 'accept' }, { ...json, ...headers })
      expect(r.status).toBe(403)
    }
    expect(called()).toEqual([])
    expect(
      (
        await post(
          { action: 'wait', on: true },
          {
            ...json,
            'Sec-Fetch-Site': 'same-origin',
            Origin: 'http://localhost',
          }
        )
      ).status
    ).toBe(200)
  })
})

describe('a flag written from a reply in the chat', () => {
  const flag = { verdict: 'Unsure', reasons: ['The page is gone.'] }

  it('is named on the item’s history when the chat is a teammate’s', async () => {
    expect((await post({ action: 'flag', flag })).status).toBe(200)
    expect(called()).toEqual(['flagItem'])
    expect(h.calls[0].args[1]).toMatchObject(flag)
    // Whose chat: the name the History line carries.
    expect(h.calls[0].args[2]).toBe('Rob Grayson')
    await post({ action: 'flag', undo: true })
    expect(h.calls[1]).toMatchObject({ fn: 'unflagItem' })
    expect(h.calls[1].args[1]).toBe('Rob Grayson')
  })

  it('is named for a teammate who decides for themselves too', async () => {
    h.mode = 'edit'
    await post({ action: 'flag', flag })
    expect(h.calls[0].args[2]).toBe('Bryce')
  })

  it('leaves no line for the owner’s own chat, as before', async () => {
    h.mode = 'edit'
    h.email = ROOT_ADMINS[0].email
    await post({ action: 'flag', flag })
    await post({ action: 'flag', undo: true })
    expect(called()).toEqual(['flagItem', 'unflagItem'])
    expect(h.calls[0].args[2]).toBeUndefined()
    expect(h.calls[1].args[1]).toBeUndefined()
  })
})

describe('a decision on a change or a rule is made on what the page showed', () => {
  const SHOWN = 'ab'.repeat(32)
  const changeItem = () => ({
    id: 'recQUEUEROW000001',
    title: 'Careers Evening: deadline',
    type: 'Change',
    status: 'Pending',
    forBryce: null,
    print: PRINT,
    // The fingerprint of the row as the site reads it now.
    shown: SHOWN,
  })

  beforeEach(() => {
    h.mode = 'edit'
    h.item = changeItem()
  })

  it('goes through when the page sends the fingerprint the row has now', async () => {
    for (const action of ['accept', 'reject', 'later', 'delete']) {
      expect((await post({ action, shown: SHOWN })).status).toBe(200)
    }
    expect(called()).toEqual([
      'acceptItem',
      'rejectItem',
      'laterItem',
      'deleteItem',
    ])
  })

  it('is refused, with nothing written, when the row changed after the page read it', async () => {
    for (const action of ['accept', 'reject', 'later', 'delete']) {
      const r = await post({ action, shown: 'cd'.repeat(32) })
      expect(r.status).toBe(412)
      expect(r.body.error).toContain('not what your page showed')
    }
    expect(called()).toEqual([])
  })

  it('is refused when the page says nothing of what it showed', async () => {
    const r = await post({ action: 'accept' })
    expect(r.status).toBe(412)
    expect(r.body.error).toContain('Reload the page')
    expect((await post({ action: 'accept', shown: 7 })).status).toBe(412)
    expect(called()).toEqual([])
  })

  it('holds for a rule, by its edits', async () => {
    h.item = { ...changeItem(), type: 'Rule' }
    const refused = await post({ action: 'accept', shown: 'cd'.repeat(32) })
    expect(refused.status).toBe(412)
    expect(refused.body.error).toContain('rule’s edits')
    expect((await post({ action: 'accept', shown: SHOWN })).status).toBe(200)
    expect(called()).toEqual(['acceptItem'])
  })

  it('holds for a suggestion too', async () => {
    h.mode = 'suggest'
    expect(
      (await post({ action: 'suggest', did: 'accept', shown: 'cd'.repeat(32) }))
        .status
    ).toBe(412)
    expect((await post({ action: 'suggest', did: 'accept' })).status).toBe(412)
    expect(called()).toEqual([])
    expect(
      (await post({ action: 'suggest', did: 'accept', shown: SHOWN })).status
    ).toBe(200)
    expect(called()).toEqual(['suggestItem'])
  })

  it('asks nothing of an addition, or of what is not a decision', async () => {
    h.item = { ...changeItem(), type: 'Add', shown: undefined }
    expect((await post({ action: 'accept' })).status).toBe(200)
    h.item = changeItem()
    expect((await post({ action: 'wait', on: true })).status).toBe(200)
    expect((await post({ action: 'undo' })).status).toBe(200)
    expect(called()).toEqual(['acceptItem', 'waitItem', 'undoItem'])
  })
})

describe('whose address a History entry carries', () => {
  it('is the signed-in admin’s, for everything the request writes', async () => {
    h.mode = 'edit'
    h.email = 'Mel@Example.org'
    await post({ action: 'wait', on: true })
    await post({ action: 'accept' })
    expect(h.calls.map(c => c.as)).toEqual([
      'mel@example.org',
      'mel@example.org',
    ])
  })
})
