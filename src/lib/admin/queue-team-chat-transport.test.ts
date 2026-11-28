import { describe, expect, it } from 'vitest'
import type { TeamPoll } from './queue-team-chat'
import {
  READ_GAP_MS,
  safeFileType,
  TEAM_LOST,
  teamChatFetch,
} from './queue-team-chat-transport'

// The page's end of the team chat against a scripted site: what the chat
// panel gets back must be the Response the owner's Mac agent would give
// (same status, same bytes, as a stream), whatever the pieces looked like
// on the way.

type Step = TeamPoll | Error | { http: number; body?: unknown }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function site(polls: Step[], post: Response = json({ id: 'request-id-1' })) {
  const calls: { url: string; method: string; body: unknown }[] = []
  const slept: number[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({
      url: String(input),
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    if (method === 'POST') return post
    if (init?.signal?.aborted) throw new Error('aborted')
    const step = polls.shift()
    if (!step) throw new Error('the test scripted no more reads')
    if (step instanceof Error) throw step
    if ('http' in step) return json(step.body ?? {}, step.http)
    return json(step)
  }) as typeof fetch
  // A clock that only waiting moves.
  let t = 1_000_000
  const deps = {
    fetch: f,
    sleep: async (ms: number) => {
      slept.push(ms)
      t += ms
    },
    now: () => t,
  }
  return {
    deps,
    calls,
    slept,
    reads: () => calls.filter(c => c.method === 'GET'),
  }
}

describe('teamChatFetch', () => {
  it('leaves the request with the site as { path, body }', async () => {
    const s = site([
      { status: 200, chunks: [{ seq: 0, text: '{}' }], done: true },
    ])
    await teamChatFetch('/chat/history', { id: 'recA' }, s.deps)
    expect(s.calls[0]).toEqual({
      url: '/api/admin/queue/chat',
      method: 'POST',
      body: { path: '/chat/history', body: { id: 'recA' } },
    })
  })

  it('gives back the agent’s answer: its status and its bytes', async () => {
    const s = site([
      { chunks: [], done: false },
      {
        status: 200,
        chunks: [{ seq: 0, text: '{"ok":true,"messages":[],' }],
        done: false,
      },
      { chunks: [{ seq: 1, text: '"pending":false}' }], done: true },
    ])
    const res = await teamChatFetch('/chat/history', { id: 'recA' }, s.deps)
    expect(res.status).toBe(200)
    expect(res.ok).toBe(true)
    expect(await res.json()).toEqual({ ok: true, messages: [], pending: false })
    expect(s.reads().map(c => c.url)).toEqual([
      '/api/admin/queue/chat?id=request-id-1&after=-1',
      '/api/admin/queue/chat?id=request-id-1&after=-1',
      '/api/admin/queue/chat?id=request-id-1&after=0&started=1',
    ])
  })

  it('streams a reply as it comes, piece by piece', async () => {
    const s = site([
      {
        status: 200,
        chunks: [{ seq: 1, text: 'data: {"type":"start"}\n\n' }],
        done: false,
      },
      { chunks: [], done: false },
      {
        chunks: [
          { seq: 2, text: ': ping\n\n' },
          { seq: 3, text: 'data: {"type":"text","text":"Hé' },
        ],
        done: false,
      },
      { chunks: [{ seq: 4, text: 'llo – 你好"}\n\n' }], done: false },
      { chunks: [{ seq: 5, text: 'data: {"type":"done"}\n\n' }], done: true },
    ])
    const res = await teamChatFetch(
      '/chat',
      { id: 'recA', message: 'hi' },
      s.deps
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    // The Response is there after the first read: the rest has not been
    // asked for yet.
    expect(s.reads()).toHaveLength(1)
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    const first = await reader.read()
    expect(dec.decode(first.value)).toBe('data: {"type":"start"}\n\n')
    let rest = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      rest += dec.decode(value, { stream: true })
    }
    expect(rest).toBe(
      ': ping\n\ndata: {"type":"text","text":"Héllo – 你好"}\n\ndata: {"type":"done"}\n\n'
    )
    expect(s.reads()).toHaveLength(5)
  })

  it('passes a 202 through: the message waits its turn on the server', async () => {
    const text = '{"ok":true,"waiting":true,"at":"2026-11-30T03:00:00.000Z"}'
    const s = site([{ status: 202, chunks: [{ seq: 0, text }], done: true }])
    const res = await teamChatFetch(
      '/chat',
      { id: 'recA', message: 'hi' },
      s.deps
    )
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ waiting: true })
  })

  it('passes the agent’s own refusals through', async () => {
    const s = site([
      {
        status: 409,
        chunks: [
          { seq: 0, text: '{"ok":false,"error":"Fable is still answering."}' },
        ],
        done: true,
      },
    ])
    const res = await teamChatFetch('/chat/clear', { id: 'recA' }, s.deps)
    expect(res.status).toBe(409)
    expect(res.ok).toBe(false)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'Fable is still answering.',
    })
  })

  it('hands back the site’s own refusal without reading further', async () => {
    const s = site([], json({ error: 'Too many chat requests.' }, 429))
    const res = await teamChatFetch('/chat', { id: 'recA' }, s.deps)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Too many chat requests.' })
    expect(s.reads()).toHaveLength(0)
  })

  it('answers an error when nobody picked the request up', async () => {
    const s = site([
      { chunks: [], done: false },
      { chunks: [], done: true, error: 'The chat’s server isn’t answering.' },
    ])
    const res = await teamChatFetch('/chat/history', { id: 'recA' }, s.deps)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({
      ok: false,
      error: 'The chat’s server isn’t answering.',
    })
  })

  it('answers an error when the answer ends with no status', async () => {
    const s = site([{ chunks: [], done: true }])
    const res = await teamChatFetch('/chat/history', { id: 'recA' }, s.deps)
    expect(res.status).toBe(502)
  })

  it('breaks the stream when the server stops partway', async () => {
    const s = site([
      {
        status: 200,
        chunks: [{ seq: 0, text: 'data: {"type":"start"}\n\n' }],
        done: false,
      },
      { status: 200, chunks: [], done: true, error: 'stopped answering' },
    ])
    const res = await teamChatFetch(
      '/chat',
      { id: 'recA', message: 'hi' },
      s.deps
    )
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    await reader.read()
    await expect(reader.read()).rejects.toThrow('stopped answering')
  })

  it('reads again after a dropped connection, from where it was', async () => {
    const s = site([
      { status: 200, chunks: [{ seq: 0, text: 'a' }], done: false },
      new Error('network'),
      { http: 502 },
      { chunks: [{ seq: 1, text: 'b' }], done: true },
    ])
    const res = await teamChatFetch(
      '/chat',
      { id: 'recA', message: 'hi' },
      s.deps
    )
    expect(await res.text()).toBe('ab')
    expect(s.slept.filter(ms => ms !== READ_GAP_MS)).toEqual([1000, 2000])
    expect(s.reads().map(c => c.url.split('&after=')[1])).toEqual([
      '-1',
      '0&started=1',
      '0&started=1',
      '0&started=1',
    ])
  })

  it('gives up after four failed reads in a row', async () => {
    const down = () => [1, 2, 3, 4].map(() => new Error('network'))
    const before = site(down())
    const res = await teamChatFetch(
      '/chat/history',
      { id: 'recA' },
      before.deps
    )
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ ok: false, error: TEAM_LOST })

    const during = site([
      { status: 200, chunks: [{ seq: 0, text: 'a' }], done: false },
      ...down(),
    ])
    const cut = await teamChatFetch('/chat', { id: 'recA' }, during.deps)
    await expect(cut.text()).rejects.toThrow(TEAM_LOST)
  })

  it('stops at once when the site says the request is gone or not theirs', async () => {
    const s = site([{ http: 403, body: { error: 'someone else’s' } }])
    const res = await teamChatFetch('/chat/history', { id: 'recA' }, s.deps)
    expect(res.ok).toBe(false)
    expect(await res.json()).toMatchObject({ error: 'someone else’s' })
    expect(s.slept.filter(ms => ms !== READ_GAP_MS)).toEqual([])
  })

  it('leaves a quarter of a second between its reads', async () => {
    const s = site([
      { status: 200, chunks: [{ seq: 0, text: 'a' }], done: false },
      { chunks: [{ seq: 1, text: 'b' }], done: false },
      { chunks: [{ seq: 2, text: 'c' }], done: true },
    ])
    const res = await teamChatFetch('/chat', { id: 'recA' }, s.deps)
    // None before the first.
    expect(s.slept).toEqual([])
    expect(await res.text()).toBe('abc')
    expect(s.slept).toEqual([READ_GAP_MS, READ_GAP_MS])
  })

  it('waits and asks again when the site puts a read off', async () => {
    const busy = { http: 429, body: { error: 'Too many', code: 'rate' } }
    const s = site([
      { status: 200, chunks: [{ seq: 0, text: 'a' }], done: false },
      busy,
      busy,
      { chunks: [{ seq: 1, text: 'b' }], done: true },
    ])
    const res = await teamChatFetch('/chat', { id: 'recA' }, s.deps)
    expect(await res.text()).toBe('ab')
    expect(s.slept.filter(ms => ms !== READ_GAP_MS)).toEqual([2000, 2000])
  })

  it('gives up on a read the site keeps putting off', async () => {
    const busy = { http: 429, body: { error: 'Too many chat requests.' } }
    const s = site([
      { status: 200, chunks: [{ seq: 0, text: 'a' }], done: false },
      ...[1, 2, 3, 4, 5, 6].map(() => busy),
    ])
    const res = await teamChatFetch('/chat', { id: 'recA' }, s.deps)
    await expect(res.text()).rejects.toThrow('Too many chat requests.')
  })

  it('never shows a piece twice, whatever the site sends', async () => {
    const s = site([
      {
        status: 200,
        chunks: [
          { seq: 0, text: 'a' },
          { seq: 1, text: 'b' },
        ],
        done: false,
      },
      {
        chunks: [
          { seq: 3, text: 'd' },
          { seq: 1, text: 'b' },
          { seq: 2, text: 'c' },
        ],
        done: true,
      },
    ])
    const res = await teamChatFetch('/chat', { id: 'recA' }, s.deps)
    expect(await res.text()).toBe('abcd')
  })

  it('stops reading when the panel lets go of the stream', async () => {
    const s = site([
      { status: 200, chunks: [{ seq: 0, text: 'a' }], done: false },
      { chunks: [{ seq: 1, text: 'b' }], done: false },
      { chunks: [{ seq: 2, text: 'c' }], done: false },
    ])
    const res = await teamChatFetch('/chat', { id: 'recA' }, s.deps)
    await res.body!.cancel()
    await new Promise(r => setTimeout(r, 0))
    expect(s.reads().length).toBeLessThanOrEqual(2)
  })

  it('turns a file back into its bytes, with its type', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 10, 13])
    const text = JSON.stringify({
      ok: true,
      type: 'image/png',
      data: Buffer.from(bytes).toString('base64'),
    })
    const s = site([
      {
        status: 200,
        chunks: [{ seq: 0, text: text.slice(0, 20) }],
        done: false,
      },
      { chunks: [{ seq: 1, text: text.slice(20) }], done: true },
    ])
    const res = await teamChatFetch(
      '/chat/file',
      { id: 'recA', file: 'a.png' },
      s.deps
    )
    expect(res.status).toBe(200)
    const blob = await res.blob()
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
  })

  it('never serves a file as a web page', async () => {
    const text = JSON.stringify({
      ok: true,
      type: 'text/html',
      data: Buffer.from('<script>alert(1)</script>').toString('base64'),
    })
    const s = site([{ status: 200, chunks: [{ seq: 0, text }], done: true }])
    const res = await teamChatFetch(
      '/chat/file',
      { id: 'recA', file: 'a.html' },
      s.deps
    )
    expect((await res.blob()).type).toBe('application/octet-stream')
    expect(safeFileType('image/svg+xml')).toBe('image/svg+xml')
    expect(safeFileType('application/pdf')).toBe('application/pdf')
    expect(safeFileType('TEXT/HTML; charset=utf-8')).toBe(
      'application/octet-stream'
    )
    expect(safeFileType(undefined)).toBe('application/octet-stream')
  })

  it('passes on "no such file", and refuses a file that did not come whole', async () => {
    const gone = site([
      {
        status: 404,
        chunks: [{ seq: 0, text: '{"ok":false,"error":"No such file."}' }],
        done: true,
      },
    ])
    const res = await teamChatFetch(
      '/chat/file',
      { id: 'recA', file: 'x' },
      gone.deps
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: 'No such file.' })

    const half = site([
      {
        status: 200,
        chunks: [{ seq: 0, text: '{"ok":true,"type":"image/p' }],
        done: true,
      },
    ])
    expect(
      (await teamChatFetch('/chat/file', { id: 'recA', file: 'x' }, half.deps))
        .status
    ).toBe(502)
  })
})
