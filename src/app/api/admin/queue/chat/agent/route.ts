/*
  The server agent's side of the team's Fable chat (queue-team-chat.ts has
  the picture). The agent runs where nothing can connect to it, so it calls
  here: first for the requests people's pages have left, then with each
  answer in pieces. No admin session: every call carries
  `Authorization: Bearer <token>`, sealed with QUEUE_TEAM_AGENT_SECRET
  (checkAgentToken; a token is taken only in the two minutes before it
  ends). Without the secret on the site, or with one shorter than 32
  characters, every call answers 503.

  POST /api/admin/queue/chat/agent
       { op: 'next', wait }
            → { requests: [{ id, path, who, at, bodyText, sig, body? }] }
            The requests waiting for an agent. With none, waits up to
            `wait` seconds (20 at most) for one. `bodyText` is the page's
            body as text and `sig` the site's signature over the request
            (signRequest, with a test vector): the agent checks it and
            reads `bodyText`. `body`, the same thing parsed, comes only
            with a `bodyText` of up to 1.5 MB. A request is offered again,
            to a later call, every 10 seconds until the agent's first
            `chunks` call for it, so the agent says it has one at once (an
            empty `chunks: []` will do) and ignores an id it already has.
            One answer is 4 MB at most. Every call marks the agent as
            seen: the page calls the chat's server online while the last
            call is under a minute old.
       { op: 'chunks', id, status?, chunks: [{ seq, text }], done? }
            → { ok: true }
            The next pieces of the agent's HTTP answer to request `id`:
            `text` is the answer's own bytes, in order, and `status` (with
            the first call) its HTTP status. A seq at or below the last one
            kept is taken as a call sent twice and dropped. One that skips
            ahead is refused, 409 { error, code: 'seq_gap', last }, and
            the agent sends again from last + 1 (the first seq is 0 or 1).
            One call is at most 1 MB. Also refused: an id that is unknown
            (404, code 'unknown') or finished (409, code 'finished'), one
            the agent left silent for 90 seconds (409, code 'stalled'),
            and a first call that comes more than 29 seconds after the
            page asked (409, code 'expired': the page has been told nobody
            answered, so the agent must not run that request).

  Nothing here logs a body or a piece of an answer.
*/

import { NextRequest } from 'next/server'
import { byteLength } from '@/lib/admin/queue-team-chat'
import {
  checkAgentToken,
  CHUNKS_MAX_BYTES,
  NEXT_MAX_WAIT_S,
  RelayError,
  relayErrorText,
  teamAgentSecret,
  teamRelay,
} from '@/lib/admin/queue-team-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// `next` waits up to 20 seconds for a request.
export const maxDuration = 60

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

// The same refusal is logged once per ten minutes, so an agent with the
// wrong secret asking every few seconds does not fill the log.
const refusedAt = new Map<string, number>()
function logRefusal(why: string) {
  const last = refusedAt.get(why) ?? 0
  if (Date.now() - last < 10 * 60 * 1000) return
  refusedAt.set(why, Date.now())
  console.warn(`[queue-team-chat] agent call refused: ${why}`)
}

export async function POST(req: NextRequest) {
  const secret = teamAgentSecret()
  if (!secret) {
    return json({ error: 'The team chat is not set up on this site.' }, 503)
  }
  const token = checkAgentToken(req.headers.get('authorization'), secret)
  if (!token.ok) {
    logRefusal(token.why)
    return json({ error: 'The token was not accepted.' }, 401)
  }
  let raw = ''
  try {
    raw = await req.text()
  } catch {
    return json({ error: 'The request could not be read.' }, 400)
  }
  if (byteLength(raw) > CHUNKS_MAX_BYTES) {
    return json({ error: 'One call may be 1 MB at most.' }, 413)
  }
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    return json({ error: 'The request is not JSON.' }, 400)
  }
  try {
    const relay = teamRelay()
    if (body.op === 'next') {
      const wait = Number(body.wait)
      const requests = await relay.next(
        Number.isFinite(wait) ? Math.min(wait, NEXT_MAX_WAIT_S) : 0,
        () => req.signal.aborted
      )
      return json({ requests })
    }
    if (body.op === 'chunks') {
      await relay.chunks(typeof body.id === 'string' ? body.id : '', body)
      return json({ ok: true })
    }
    return json({ error: 'unknown op' }, 400)
  } catch (e) {
    if (e instanceof RelayError) {
      return json({ ...e.extra, error: e.message }, e.status)
    }
    // Never the error as it is: the store's client quotes what it was
    // storing, which here is a request or a piece of a reply.
    console.error('[queue-team-chat]', relayErrorText(e))
    return json({ error: 'The relay could not do that.' }, 502)
  }
}
