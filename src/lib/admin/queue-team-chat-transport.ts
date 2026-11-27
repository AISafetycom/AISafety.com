// The page's end of the team's Fable chat (queue-team-chat.ts has the
// picture): one call that looks, to the chat panel, like the fetch it makes
// to the owner's Mac agent. It leaves the request with the site, then reads
// the answer back in pieces and hands the panel a Response with the agent's
// own status and the agent's own bytes as a stream, so the panel's parsing,
// its 202 "the message waits its turn" and its cut-off handling are the
// same code for both chats. No Node imports: this runs in the browser.
import type { TeamChunk, TeamPoll } from './queue-team-chat'

const ROUTE = '/api/admin/queue/chat'

/** The site could not be reached for several reads in a row. */
export const TEAM_LOST = 'The connection to the site dropped. Try again.'

/** Reads of one answer are at least this far apart: a reply that comes a
 *  few words at a time is read four times a second, not forty. */
export const READ_GAP_MS = 250

export interface TransportDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A file's type as the page may show it: a picture, a PDF or plain text
 *  keeps its type; anything else (a web page above all) becomes a plain
 *  download, because the page opens these in a tab of its own. */
export function safeFileType(type: unknown): string {
  const t = typeof type === 'string' ? type.trim().toLowerCase() : ''
  return /^image\/[a-z0-9.+-]+$/.test(t) ||
    t === 'application/pdf' ||
    t === 'text/plain'
    ? t
    : 'application/octet-stream'
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Send one of the chat panel's calls through the site to the server's
 *  agent. Resolves once the agent's status is known, with a Response whose
 *  body streams the rest as it comes; a request nobody answered resolves to
 *  an error Response ({ error }) instead, as the Mac agent's own refusals
 *  do. A stream that breaks partway errors, which the panel reads as a
 *  reply that was cut off. */
export async function teamChatFetch(
  path: string,
  body: Record<string, unknown>,
  deps: TransportDeps = {}
): Promise<Response> {
  const f = deps.fetch ?? fetch
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const sent = await f(ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, body }),
    cache: 'no-store',
  })
  // Refused by the site (signed out, too big, too many): its own answer.
  if (!sent.ok) return sent
  const id = ((await sent.json().catch(() => null)) as { id?: unknown } | null)
    ?.id
  if (typeof id !== 'string' || !id) {
    return jsonResponse(
      { ok: false, error: 'The site did not take the request.' },
      502
    )
  }

  let after = -1
  let status: number | undefined
  let done = false
  let cancelled = false
  let readAt = 0
  const ctrl = new AbortController()

  /** One read of what has come since the last. A dropped connection is
   *  tried again (the read is the same read: `after` says where it is),
   *  and so is one the site put off because too many were asked at once. */
  const read = async (): Promise<{ texts: string[]; error?: string }> => {
    let putOff = 0
    for (let tries = 0; ; tries++) {
      try {
        const early = readAt + READ_GAP_MS - now()
        if (readAt && early > 0) await sleep(early)
        readAt = now()
        const res = await f(
          `${ROUTE}?id=${encodeURIComponent(id)}&after=${after}${status === undefined ? '' : '&started=1'}`,
          { cache: 'no-store', signal: ctrl.signal }
        )
        const data = (await res.json().catch(() => null)) as
          | (Partial<TeamPoll> & { error?: string })
          | null
        if (res.ok && data && Array.isArray(data.chunks)) {
          const fresh = (data.chunks as TeamChunk[])
            .filter(c => typeof c?.seq === 'number' && c.seq > after)
            .sort((a, b) => a.seq - b.seq)
          if (fresh.length) after = fresh[fresh.length - 1].seq
          if (status === undefined && typeof data.status === 'number') {
            status = data.status
          }
          if (data.done) done = true
          return {
            texts: fresh.map(c => (typeof c.text === 'string' ? c.text : '')),
            ...(data.error ? { error: data.error } : {}),
          }
        }
        // Too many reads at once: wait and ask again, a few times.
        if (res.status === 429 && putOff < 5) {
          putOff++
          tries--
          await sleep(2000)
          continue
        }
        // The site said no (signed out, the request is gone): final.
        if (res.status >= 400 && res.status < 500) {
          done = true
          return { texts: [], error: data?.error ?? `HTTP ${res.status}` }
        }
        throw new Error(`HTTP ${res.status}`)
      } catch {
        if (cancelled || tries >= 3) {
          done = true
          return { texts: [], error: TEAM_LOST }
        }
        await sleep(1000 * (tries + 1))
      }
    }
  }

  // Until the agent's status is known there is no Response to give.
  const head: string[] = []
  while (status === undefined && !done) {
    const got = await read()
    head.push(...got.texts)
    if (got.error) return jsonResponse({ ok: false, error: got.error }, 504)
  }
  if (status === undefined || status < 200 || status > 599) {
    return jsonResponse(
      { ok: false, error: "The chat's server sent no answer." },
      502
    )
  }

  // A file comes as one JSON object, {ok, type, data: base64}, because the
  // pieces carry text: turned back into the file's bytes here.
  if (path === '/chat/file') {
    let text = head.join('')
    while (!done) {
      const got = await read()
      text += got.texts.join('')
      if (got.error) return jsonResponse({ ok: false, error: got.error }, 502)
    }
    if (status !== 200) return jsonResponse(parsed(text), status)
    const file = parsed(text) as { type?: unknown; data?: unknown }
    if (typeof file.data !== 'string') {
      return jsonResponse(
        { ok: false, error: 'The file did not come through.' },
        502
      )
    }
    try {
      return new Response(bytesOf(file.data), {
        status: 200,
        headers: { 'Content-Type': safeFileType(file.type) },
      })
    } catch {
      return jsonResponse(
        { ok: false, error: 'The file did not come through.' },
        502
      )
    }
  }

  const headers = {
    'Content-Type':
      path === '/chat' && status === 200
        ? 'text/event-stream; charset=utf-8'
        : 'application/json',
  }
  // Statuses that may not carry a body.
  if (status === 204 || status === 205 || status === 304) {
    ctrl.abort()
    return new Response(null, { status, headers })
  }
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const t of head) if (t) c.enqueue(enc.encode(t))
      if (done) c.close()
    },
    async pull(c) {
      // Read until there is something to hand on, or the answer ends.
      while (!done && !cancelled) {
        const got = await read()
        let any = false
        for (const t of got.texts) {
          if (!t) continue
          c.enqueue(enc.encode(t))
          any = true
        }
        if (got.error) {
          c.error(new Error(got.error))
          return
        }
        if (done) c.close()
        if (any) return
      }
    },
    cancel() {
      // The panel let go (it moved to another item): stop reading. The
      // server's agent carries on and keeps the reply, as the Mac does.
      cancelled = true
      ctrl.abort()
    },
  })
  return new Response(stream, { status, headers })
}

function parsed(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
  } catch {
    // not JSON: answered below
  }
  return { ok: false, error: "The chat's server sent no answer." }
}
