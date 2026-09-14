/** Per-turn bookkeeping for the conversation log.
 *
 *  A conversation row's Data carries one entry per LOGGED TURN in `tools`,
 *  `turnTimes`, `pages`, `fallbackCards` and `turnIndices`, while `history`
 *  is a window of the visitor's message list (the last 50 messages). The two
 *  line up from the END — the window's last user message belongs to the last
 *  per-turn entry, and so on backwards — which only holds while every logged
 *  turn is a distinct turn of the transcript.
 *
 *  A re-sent message breaks that. The widget's Edit and Try again both cut
 *  the visitor's list back to an earlier position and send again, so the next
 *  write's history REPLACES the earlier text — but the per-turn arrays used
 *  to grow by one more entry regardless. They then outran the transcript and
 *  the viewer, aligning from the end, pinned every earlier turn's tool calls
 *  and times one turn too early (2 Sept 2026: a fellowship search showed
 *  under an unrelated question about the map, with a bogus "1 earlier turn
 *  not stored" divider). This module owns both halves of the fix: at write
 *  time, which earlier entries a new turn supersedes; at read time, which
 *  entry a stored message belongs to.
 */

/** The slice of a row's Data the alignment needs. */
export interface TurnAlignedData {
  history: { role: string }[]
  /** Each history message's position in the visitor's message list. */
  historyIndices?: unknown[]
  tools?: unknown[]
  turnTimes?: unknown[]
  /** Per logged turn: the position of that turn's REPLY in the visitor's
   *  message list — the same turnIndex the widget's delivery, rating and
   *  click reports key on. Recorded since 2 Sept 2026. */
  turnIndices?: unknown[]
}

/** Position, in the visitor's message list, of the reply a turn write
 *  appends — the last entry of the write's historyIndices. Null when the
 *  write carries no usable positions. */
export function replyIndexOf(
  historyIndices: unknown[] | undefined
): number | null {
  if (!Array.isArray(historyIndices) || historyIndices.length === 0) return null
  const last = historyIndices[historyIndices.length - 1]
  return typeof last === 'number' && Number.isInteger(last) && last >= 0
    ? last
    : null
}

/** How many of a row's logged turns survive a new turn whose reply lands at
 *  `replyIndex`: every turn logged at an EARLIER position. A turn at the same
 *  or a later position was re-sent (Edit / Try again cut the visitor's list
 *  back past it), so its entry is superseded. Turns from before positions
 *  were recorded — the leading entries a `turnIndices` shorter than `tools`
 *  leaves unlabelled — always survive, as does everything when the write
 *  has no position to compare. */
export function turnsToKeep(
  previous: { tools: unknown[]; turnIndices?: unknown[] },
  replyIndex: number | null
): number {
  const total = previous.tools.length
  const positions = previous.turnIndices
  if (
    replyIndex == null ||
    !Array.isArray(positions) ||
    positions.length === 0
  ) {
    return total
  }
  // turnIndices lines up with tools from the end, like every per-turn array.
  const offset = total - positions.length
  for (let j = 0; j < positions.length; j++) {
    const n = positions[j]
    if (typeof n === 'number' && n >= replyIndex) {
      return Math.max(0, offset + j)
    }
  }
  return total
}

/** A per-turn array cut down to the entries of the first `keep` of the
 *  row's `total` logged turns. The array may be shorter than `total` (rows
 *  that started before it was tracked), in which case its entries belong
 *  to the LAST turns — end alignment, as everywhere. */
export function slicePerTurn<T>(
  arr: T[] | undefined,
  total: number,
  keep: number
): T[] {
  if (!Array.isArray(arr)) return []
  const offset = total - arr.length
  return arr.slice(0, Math.max(0, keep - offset))
}

/** The number of turns the row has logged — the length of its per-turn
 *  arrays (turnTimes, else tools when it has the one-array-per-turn shape).
 *  0 for rows that predate both. */
export function loggedTurnCount(data: TurnAlignedData): number {
  if (Array.isArray(data.turnTimes) && data.turnTimes.length > 0) {
    return data.turnTimes.length
  }
  const tools = data.tools
  if (
    Array.isArray(tools) &&
    tools.length > 0 &&
    tools.every(t => Array.isArray(t))
  ) {
    return tools.length
  }
  return 0
}

/** True when the stored history is the visitor's WHOLE message list — it
 *  starts at position 0 and every message carries its position — so nothing
 *  was windowed or trimmed away. */
export function historyIsComplete(data: TurnAlignedData): boolean {
  const indices = data.historyIndices
  return (
    Array.isArray(indices) &&
    indices.length === data.history.length &&
    indices.length > 0 &&
    indices.every(n => typeof n === 'number' && Number.isInteger(n)) &&
    indices[0] === 0
  )
}

/** Which logged turn the stored message at `msgIdx` belongs to, counted
 *  from the END of the per-turn arrays (1 = the latest logged turn) — the
 *  one indexing that works for every per-turn array however early the row
 *  started recording it. A user message resolves to its own turn, a reply to
 *  the turn it answers. 0 when the message can't be placed.
 *
 *  Exact on rows that record each turn's reply position: a reply IS its
 *  position, and a question's reply sits at the next one (the widget appends
 *  the reply bubble right after it). Older rows fall back to counting user
 *  messages — from the START when the history is complete (a surplus of
 *  per-turn entries there is stale duplicates from re-sent turns, which sit
 *  at the end), from the END when the window dropped earlier turns. */
export function turnFromEnd(data: TurnAlignedData, msgIdx: number): number {
  const history = data.history
  const msg = history[msgIdx]
  if (!msg) return 0
  const positions = data.turnIndices
  const indices = data.historyIndices
  if (Array.isArray(positions) && Array.isArray(indices)) {
    const own = indices[msgIdx]
    if (typeof own === 'number') {
      const reply = msg.role === 'assistant' ? own : own + 1
      for (let j = positions.length - 1; j >= 0; j--) {
        if (positions[j] === reply) return positions.length - j
      }
    }
  }
  // User messages in the window up to and including this one: a question's
  // own turn, or the question a reply answers. A window that opens on a
  // reply counts 0 and resolves to the entry before its first user turn.
  const usersUpToHere = history
    .slice(0, msgIdx + 1)
    .filter(t => t.role === 'user').length
  if (historyIsComplete(data)) {
    return loggedTurnCount(data) - usersUpToHere + 1
  }
  const totalUsers = history.filter(t => t.role === 'user').length
  return totalUsers - usersUpToHere + 1
}

/** The entry `fromEnd` turns from the end of a per-turn array (1 = last).
 *  Undefined when the array doesn't reach that far back — or isn't one. */
export function entryFromEnd<T>(
  arr: T[] | undefined,
  fromEnd: number
): T | undefined {
  if (!Array.isArray(arr) || fromEnd < 1 || fromEnd > arr.length) {
    return undefined
  }
  return arr[arr.length - fromEnd]
}
