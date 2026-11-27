// A change to a published listing that someone proposed in the team's
// Fable chat. That chat never writes a live listing itself: it files a
// Change row of its own (~/Queue/propose_change.py), which then waits in
// the Queue like any request.
//
// Such a row says so in two places. Its Source is "Queue chat", or, until
// the Queue's Source field has that choice, "Comb" as a stand-in. And its
// Proposal carries `chat: {by, email, row, at}`: who asked the chat (the
// address is who they are; the name is the label beside it), from which
// item, and when. The Mac writes both; the site only reads them. Either
// one makes the row a chat proposal, so it reads the same before and after
// the choice exists.
//
// Dependency-free but for the name rule, so the page and the server share
// it.
import { tidyName } from './queue-team-chat'

/** The row's Source, as Airtable holds it and as the page calls it. */
export const CHAT_SOURCE = 'Queue chat'

/** What the page says over such a row's own words. */
export const CHAT_HEADING = 'Proposed in the Queue chat'

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Whether the row was proposed in the chat, and by whom. Null for every
 *  other row. `by` is the teammate's name as the row carries it, cut down
 *  to what a name may hold (queue-team-chat.ts: it began as a profile name
 *  its owner wrote); null when the row names nobody. */
export function chatProposed(
  source: string | null,
  proposal: unknown
): { by: string | null } | null {
  const mark = isRecord(proposal) ? proposal.chat : undefined
  if (source !== CHAT_SOURCE && !isRecord(mark)) return null
  const by = isRecord(mark) && typeof mark.by === 'string' ? mark.by : ''
  return { by: tidyName(by) || null }
}

/** The heading over the row's words: "Proposed in the Queue chat", with
 *  the teammate's name beside it when the row carries one. */
export function chatHeading(by: string | null | undefined): string {
  return by ? `${CHAT_HEADING} · by ${by}` : CHAT_HEADING
}
