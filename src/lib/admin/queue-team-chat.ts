// The team's Fable chat in the Queue: the parts the page and the server
// share. No Node imports, no network, so the browser can import it.
//
// The owner's chat panel talks straight to the agent on his Mac
// (~/Queue/agent.py on 127.0.0.1), which nobody else's browser can reach.
// Everyone else who works the Queue gets the same chat program, run on a
// server that accepts no inbound connections (27 November 2026, for a new
// teammate working from another country). So the site relays:
//
//   browser ──POST {path, body}──▶ /api/admin/queue/chat        (this person's
//   browser ◀──long-poll chunks── /api/admin/queue/chat?id=…     admin session)
//   server agent ──{op:'next'}──▶ /api/admin/queue/chat/agent    (a sealed
//   server agent ──{op:'chunks'}─▶ /api/admin/queue/chat/agent    token)
//
// The server's agent only ever calls out: it asks the site for waiting
// requests, runs each as the Mac agent would, and posts the reply's bytes
// back in pieces. The page turns those pieces back into the same kind of
// Response the Mac returns (queue-team-chat-transport.ts), so everything
// after the fetch in Chat.tsx is the same code for both chats. The relay
// itself is queue-team-relay.ts.

// ─── Who gets which chat ────────────────────────────────────────────────────

export type ChatKind = 'mac' | 'team'

/** The people whose chat is the one on the owner's Mac: QUEUE_CHAT_OWNERS
 *  (a comma list of emails), else the root admins, which is the same
 *  default ~/Queue/chat.py's OWNERS has. */
export function chatOwners(
  raw: string | undefined,
  roots: readonly string[]
): Set<string> {
  const listed = (raw ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
  return new Set(
    listed.length ? listed : roots.map(e => e.trim().toLowerCase())
  )
}

/** Which chat panel this person's Queue page mounts. An owner keeps the
 *  Mac chat exactly as before (the Mac's own owner check stays the real
 *  gate, and the page still mounts it only when the Mac answers). Everyone
 *  else who can work the Queue gets the team chat when the site holds the
 *  team agent's secret. A viewer gets none. */
export function chatKind(who: {
  email: string
  owners: ReadonlySet<string>
  canWork: boolean
  teamOn: boolean
}): ChatKind | null {
  if (who.owners.has(who.email.trim().toLowerCase())) return 'mac'
  return who.canWork && who.teamOn ? 'team' : null
}

// ─── What the page may ask the server's agent ───────────────────────────────

/** The agent paths the chat panel itself calls (Chat.tsx): send a message
 *  and stream the reply, read the thread, Stop, take a waiting message off
 *  the list, Start over, and fetch a file sent earlier. Nothing else is
 *  relayed: not /act (the side effects of a decision), not /ping, not
 *  dictation, not the rule routes, not /chat/status. */
export const TEAM_CHAT_PATHS = [
  '/chat',
  '/chat/history',
  '/chat/interrupt',
  '/chat/unqueue',
  '/chat/clear',
  '/chat/file',
] as const

export type TeamChatPath = (typeof TEAM_CHAT_PATHS)[number]

export function isTeamChatPath(path: unknown): path is TeamChatPath {
  return (
    typeof path === 'string' &&
    (TEAM_CHAT_PATHS as readonly string[]).includes(path)
  )
}

/** The most one request's body may be, serialised: Vercel takes 4.5 MB per
 *  request, and the relay hands the body on inside another envelope. */
export const TEAM_BODY_MAX_BYTES = 3.5 * 1024 * 1024

/** Every path but a message carries a few words at most (an item's id, a
 *  file's name): the Mac agent's own limit for them. */
export const TEAM_SMALL_BODY_MAX_BYTES = 64 * 1024

/** What the files of one message may add up to on the page, before base64
 *  (which makes them a third bigger) and the message around them. */
export const TEAM_FILES_MAX_BYTES = 2.5 * 1024 * 1024

/** Who sent a request, as the server's agent is told: from the admin
 *  session, never from the browser's own body. `mode` is 'suggest' for
 *  someone whose decisions the owner checks first. */
export interface TeamWho {
  email: string
  name: string
  mode: 'edit' | 'suggest'
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** The body the page sent, made safe to hand on: an object, without any
 *  `token` or `who` the browser put there (the site says who it is), and
 *  no bigger than the cap: 3.5 MB for a message with its files, 64 KB for
 *  everything else. */
export function teamBody(
  path: TeamChatPath,
  raw: unknown
):
  | { ok: true; body: Record<string, unknown>; bytes: number }
  | { ok: false; status: number; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'The request has no body.' }
  }
  const body: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  delete body.token
  delete body.who
  const bytes = byteLength(JSON.stringify(body))
  if (bytes > TEAM_BODY_MAX_BYTES) {
    return { ok: false, status: 413, error: TEAM_TOO_BIG }
  }
  if (path !== '/chat' && bytes > TEAM_SMALL_BODY_MAX_BYTES) {
    return { ok: false, status: 413, error: 'That request is too big.' }
  }
  return { ok: true, body, bytes }
}

// ─── Words the page shows ───────────────────────────────────────────────────

export const TEAM_TOO_BIG =
  'That message and its files are over 3.5 MB, the most the chat can take at once. Send smaller or fewer files.'

/** No agent took the request within 30 seconds. */
export const TEAM_NOT_ANSWERING =
  "The chat's server isn't answering. Try again in a minute."

/** An agent took the request, then went quiet. */
export const TEAM_STOPPED =
  "The chat's server stopped answering partway through. Try again in a minute."

/** The panel's line while the server's agent has not been seen lately. */
export const TEAM_OFFLINE =
  "The chat's server is offline right now, so Fable can't answer here. Messages you send will not go through until it is back."

export const TEAM_BUSY = 'Too many chat requests at once. Wait a minute.'

// ─── The pieces of a reply ──────────────────────────────────────────────────

/** One piece of the agent's HTTP response body, in order. */
export interface TeamChunk {
  seq: number
  text: string
}

/** What one long-poll of a request answers. */
export interface TeamPoll {
  /** The agent's HTTP status, once its first piece has come. */
  status?: number
  chunks: TeamChunk[]
  done: boolean
  error?: string
}
