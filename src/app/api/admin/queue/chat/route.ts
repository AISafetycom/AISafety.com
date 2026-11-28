/*
  The page's side of the team's Fable chat (queue-team-chat.ts has the
  picture). The chat itself runs on a server that takes no inbound
  connections, so the page leaves its request here and reads the answer
  back in pieces. For anyone who can work the Queue ('edit' or 'suggest');
  signed out answers 401, a viewer 403. Off (503) while
  QUEUE_TEAM_AGENT_SECRET is not set. Both calls must come from the admin's
  own page (own-page.ts): a write as JSON, and neither from another site
  nor from another host under the same domain.

  POST /api/admin/queue/chat  body { path, body }  → { id }
       `path` is one of the agent paths the chat panel calls
       (TEAM_CHAT_PATHS); anything else is refused. `body` is what the
       panel would send the owner's Mac agent, at most 3.5 MB for a
       message with its files and 64 KB for the rest. Any `token`
       or `who` in it is dropped: the agent is told who asked (`who`:
       email, a cleaned name and 'edit' or 'suggest') from the session,
       beside the body, and the request is signed so that only the site
       could have made it (signRequest). Per person and minute: 30
       messages, 240 other requests, 30 MB.
  GET  /api/admin/queue/chat?id=<id>&after=<seq>[&started=1]
       → { status?, chunks: [{ seq, text }], done, error? }
       Waits up to 20 seconds for pieces after `after`. `status` is the
       agent's HTTP status and `text` the bytes of its answer, in order;
       one read carries 3 MB at most, and `done` comes with the last of
       them. Only the person who made the request may read it, two reads
       of one request at a time, 600 a minute. With no agent within 30
       seconds: done, with an error to show.

  Nothing here logs a body or a piece of an answer.
*/

import { NextRequest } from 'next/server'
import { currentAdmin, queueMode } from '@/lib/admin/auth'
import { notOwnPageRequest } from '@/lib/admin/own-page'
import {
  budgetOf,
  byteLength,
  isTeamChatPath,
  teamBody,
  teamWho,
  TEAM_BODY_MAX_BYTES,
  TEAM_TOO_BIG,
  type TeamWho,
} from '@/lib/admin/queue-team-chat'
import {
  RelayError,
  relayErrorText,
  teamAgentSecret,
  teamRelay,
} from '@/lib/admin/queue-team-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// One read waits up to 20 seconds for the agent's next piece.
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

/** Who is asking, or the refusal to answer with. */
async function asker(
  req: NextRequest,
  write: boolean
): Promise<TeamWho | Response> {
  if (notOwnPageRequest(req, { json: write })) {
    return json(
      { error: 'That request did not come from the Queue page.' },
      403
    )
  }
  const me = await currentAdmin()
  if (!me) return json({ error: 'unauthorized' }, 401)
  const mode = await queueMode()
  if (mode !== 'edit' && mode !== 'suggest') {
    return json({ error: 'The chat is for people who work the Queue.' }, 403)
  }
  if (!teamAgentSecret()) {
    return json({ error: 'The team chat is not set up on this site.' }, 503)
  }
  return teamWho(me, mode)
}

function failure(e: unknown): Response {
  if (e instanceof RelayError) {
    return json({ ...e.extra, error: e.message }, e.status)
  }
  // Never the error as it is: the store's client quotes what it was
  // storing, which here is somebody's message.
  console.error('[queue-team-chat]', relayErrorText(e))
  return json(
    { error: 'The chat could not do that; details are in the server log.' },
    502
  )
}

/** The paths worth a log line: the ones that do something. Reading the
 *  thread or a file is not (the page reads the thread every few seconds
 *  while a reply is being written). */
const LOGGED = new Set(['/chat', '/chat/clear', '/chat/interrupt'])

export async function POST(req: NextRequest) {
  const who = await asker(req, true)
  if (who instanceof Response) return who
  let raw = ''
  try {
    raw = await req.text()
  } catch {
    return json({ error: 'The request could not be read.' }, 400)
  }
  // The envelope around the body is a few bytes; past this the body is
  // over its cap whatever else is in there.
  if (byteLength(raw) > TEAM_BODY_MAX_BYTES + 1024) {
    return json({ error: TEAM_TOO_BIG }, 413)
  }
  let sent: { path?: unknown; body?: unknown } = {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') sent = parsed
  } catch {
    return json({ error: 'The request is not JSON.' }, 400)
  }
  if (!isTeamChatPath(sent.path)) {
    return json({ error: 'The chat does not do that.' }, 400)
  }
  const safe = teamBody(sent.path, sent.body)
  if (!safe.ok) return json({ error: safe.error }, safe.status)
  try {
    const relay = teamRelay()
    const over = await relay.limit(who.email, budgetOf(sent.path), safe.bytes)
    if (over) return json({ error: over }, 429)
    const { id } = await relay.create(sent.path, safe.text, who)
    if (LOGGED.has(sent.path)) {
      console.log(
        `[queue-team-chat] ${sent.path} by ${who.email} (${who.mode}), ${safe.bytes} bytes`
      )
    }
    return json({ id })
  } catch (e) {
    return failure(e)
  }
}

export async function GET(req: NextRequest) {
  const who = await asker(req, false)
  if (who instanceof Response) return who
  const q = req.nextUrl.searchParams
  const after = q.get('after')
  const seq = after === null || after === '' ? -1 : Number(after)
  if (!Number.isSafeInteger(seq)) {
    return json({ error: 'after must be a number.' }, 400)
  }
  try {
    const relay = teamRelay()
    const over = await relay.limit(who.email, 'poll')
    if (over) return json({ error: over, code: 'rate' }, 429)
    return json(
      await relay.poll(q.get('id') ?? '', who.email, {
        after: seq,
        started: q.get('started') === '1',
        aborted: () => req.signal.aborted,
      })
    )
  } catch (e) {
    return failure(e)
  }
}
