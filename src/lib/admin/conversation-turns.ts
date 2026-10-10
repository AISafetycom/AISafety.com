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
 *  time, which earlier entries a new turn supersedes — and, for a write that
 *  lands after a later turn's, where it slots in (placeTurn); at read time,
 *  which entry a stored message belongs to.
 *
 *  Entries stay in position order, which is also the order their turns
 *  arrived in, so a late write can slot in mid-array without moving any
 *  other turn: the readers place messages by position (turnIndices), and
 *  every per-turn array gets the same entry at the same spot.
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

/** Where one turn write goes among a row's logged turns. */
export interface TurnPlacement {
  /** The logged turns this write supersedes: the range [from, to) over the
   *  row's turns, counted from the START (one turn per `tools` entry). The
   *  write's own entry goes in at `from`. */
  from: number
  to: number
  /** False when the visitor's chat has already cut this turn away, so the
   *  write has nothing to add to what they saw. */
  insert: boolean
  /** True when no logged turn arrived after this one — the write is the
   *  conversation's newest, so its history, message, reply, latency and
   *  prompt version become the row's. False for a LATE write: a slow request
   *  that finished after the visitor had already sent a later message. */
  latest: boolean
  /** Set when the write is dropped (insert false): the logged turn that
   *  cut it away — sent after it, at its position or an earlier one — so
   *  the skip can be logged with both turns' positions and times. */
  supersededBy?: { position: number; turnAt: string }
}

/** Where a turn whose reply lands at `replyIndex`, and whose user message
 *  arrived at `turnAt`, belongs among the row's logged turns.
 *
 *  A logged turn is part of the visitor's current chat unless a turn sent
 *  AFTER it sits at the same or an earlier position: Try again re-sends at
 *  the same position, Edit at an earlier one, and either cuts the chat back
 *  past it. So:
 *
 *  - The newest write (no logged turn arrived later) supersedes every turn
 *    at its position or after — a re-send replacing what it re-sent — and
 *    becomes the last entry. The only case before late writes were handled.
 *  - A late write whose position a later turn has re-sent or edited away
 *    (any later turn at the same or an earlier position) is dropped.
 *  - Any other late write is a turn the visitor did move on from (its
 *    request outlived the browser's error, or its log write was just slow).
 *    It goes in at its own position, replacing only older entries there,
 *    and leaves the later turns alone. Before, it truncated them: a turn
 *    that errored at 43 s in the visitor's browser and finished at 69 s on
 *    the server erased the next turn, which had arrived in between (9 Sept
 *    2026).
 *
 *  Rows without positions append, as they always have; rows without turn
 *  times treat every write as the newest.
 *
 *  Everything here rests on turn times following the order the visitor sent
 *  their messages, so the chat route stamps `turnAt` the moment a request
 *  reaches it, before any slow setup: a turn stamped seconds late could
 *  look sent after the visitor's next message and get that message's turn
 *  dropped. */
export function placeTurn(
  previous: {
    tools: unknown[]
    turnIndices?: unknown[]
    turnTimes?: unknown[]
  } | null,
  replyIndex: number | null,
  turnAt: string
): TurnPlacement {
  if (!previous) return { from: 0, to: 0, insert: true, latest: true }
  const total = previous.tools.length
  const positions = previous.turnIndices
  if (
    replyIndex == null ||
    !Array.isArray(positions) ||
    positions.length === 0
  ) {
    return { from: total, to: total, insert: true, latest: true }
  }
  const from = turnsToKeep(previous, replyIndex)
  const newest = { from, to: total, insert: true, latest: true }
  const at = Date.parse(turnAt)
  const times = previous.turnTimes
  if (!Number.isFinite(at) || !Array.isArray(times)) return newest

  // Every per-turn array lines up with tools from the end.
  const positionOffset = total - positions.length
  const timeOffset = total - times.length
  let firstLater: number | null = null
  for (let g = Math.max(positionOffset, timeOffset, 0); g < total; g++) {
    const position = positions[g - positionOffset]
    const time = times[g - timeOffset]
    if (typeof position !== 'number' || typeof time !== 'string') continue
    const t = Date.parse(time)
    if (!Number.isFinite(t) || t <= at) continue
    // A later turn at this position or before it: re-sent or edited away.
    if (position <= replyIndex) {
      return {
        from: total,
        to: total,
        insert: false,
        latest: false,
        supersededBy: { position, turnAt: time },
      }
    }
    if (firstLater == null) firstLater = g
  }
  if (firstLater == null) return newest
  // Late but still in the chat: replace the older entries from this
  // position up to the first later turn — all of which arrived before this
  // one, so the chat has moved past them too — and keep the rest.
  return {
    from,
    to: Math.max(from, firstLater),
    insert: true,
    latest: false,
  }
}

/** A per-turn array with one write's `entry` placed: the entries of turns
 *  [from, to) out, the entry in at `from` (when the placement inserts). The
 *  array may be shorter than the row's `total` logged turns (rows that
 *  started before it was tracked), in which case its entries belong to the
 *  LAST turns — end alignment, as everywhere — and an entry for a turn
 *  before the array's start has nowhere to go. */
export function placePerTurn<T>(
  arr: T[] | undefined,
  total: number,
  placement: TurnPlacement,
  entry: T
): T[] {
  const list = Array.isArray(arr) ? arr : []
  if (!placement.insert) return list
  const offset = total - list.length
  const start = placement.from - offset
  const end = Math.max(start, placement.to - offset)
  if (start >= 0) return [...list.slice(0, start), entry, ...list.slice(end)]
  // The array starts after this turn. If the write supersedes everything
  // to the end, its entry is the new last turn — which the array does hold.
  if (placement.to >= total) return [entry]
  return list.slice(Math.max(0, end))
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
