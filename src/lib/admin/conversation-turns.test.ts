import { describe, expect, it } from 'vitest'
import {
  entryFromEnd,
  historyIsComplete,
  loggedTurnCount,
  placePerTurn,
  placeTurn,
  replyIndexOf,
  turnFromEnd,
  turnsToKeep,
  type TurnPlacement,
} from './conversation-turns'

const u = { role: 'user' }
const a = { role: 'assistant' }

describe('replyIndexOf', () => {
  it('is the last position of the write', () => {
    expect(replyIndexOf([0, 1, 2, 3])).toBe(3)
  })
  it('is null without a usable position', () => {
    expect(replyIndexOf(undefined)).toBeNull()
    expect(replyIndexOf([])).toBeNull()
    expect(replyIndexOf([0, 'x'])).toBeNull()
    expect(replyIndexOf([0, -1])).toBeNull()
  })
})

describe('turnsToKeep', () => {
  const previous = { tools: [[], [], [], []], turnIndices: [1, 3, 5, 7] }
  it('keeps every turn when the new one comes after them all', () => {
    expect(turnsToKeep(previous, 9)).toBe(4)
  })
  it('replaces a turn re-sent at the same position', () => {
    expect(turnsToKeep(previous, 7)).toBe(3)
  })
  it('drops every turn from an edited earlier message onward', () => {
    expect(turnsToKeep(previous, 3)).toBe(1)
    expect(turnsToKeep(previous, 1)).toBe(0)
  })
  it('keeps everything on rows without positions or writes without one', () => {
    expect(turnsToKeep({ tools: [[], []] }, 3)).toBe(2)
    expect(turnsToKeep({ tools: [[], []], turnIndices: [] }, 3)).toBe(2)
    expect(turnsToKeep(previous, null)).toBe(4)
  })
  it('never touches turns logged before positions were recorded', () => {
    // Four turns, positions only for the last two (end-aligned).
    const partial = { tools: [[], [], [], []], turnIndices: [5, 7] }
    expect(turnsToKeep(partial, 7)).toBe(3)
    expect(turnsToKeep(partial, 5)).toBe(2)
    expect(turnsToKeep(partial, 3)).toBe(2)
    expect(turnsToKeep(partial, 9)).toBe(4)
  })
})

/** A turn time `n` minutes into the conversation. */
const at = (n: number) => new Date(Date.UTC(2026, 8, 9, 2, n)).toISOString()
const atSec = (s: number) =>
  new Date(Date.UTC(2026, 8, 9, 2, 0, s)).toISOString()

describe('placePerTurn', () => {
  const place = (from: number, to: number, insert = true): TurnPlacement => ({
    from,
    to,
    insert,
    latest: true,
  })
  it('cuts an array that spans every turn, then appends', () => {
    expect(placePerTurn(['a', 'b', 'c'], 3, place(2, 3), 'n')).toEqual([
      'a',
      'b',
      'n',
    ])
    expect(placePerTurn(['a', 'b', 'c'], 3, place(3, 3), 'n')).toEqual([
      'a',
      'b',
      'c',
      'n',
    ])
    expect(placePerTurn(['a', 'b', 'c'], 3, place(0, 3), 'n')).toEqual(['n'])
  })
  it('slots an entry in mid-array, replacing only the range given', () => {
    expect(placePerTurn(['a', 'b', 'd'], 3, place(2, 2), 'c')).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    expect(placePerTurn(['a', 'x', 'd'], 3, place(1, 2), 'b')).toEqual([
      'a',
      'b',
      'd',
    ])
  })
  it('respects end alignment on an array that started late', () => {
    // Four turns, the array covers only the last two.
    expect(placePerTurn(['c', 'd'], 4, place(3, 4), 'n')).toEqual(['c', 'n'])
    expect(placePerTurn(['c', 'd'], 4, place(2, 4), 'n')).toEqual(['n'])
    expect(placePerTurn(['c', 'd'], 4, place(1, 4), 'n')).toEqual(['n'])
    expect(placePerTurn(['c', 'd'], 4, place(4, 4), 'n')).toEqual([
      'c',
      'd',
      'n',
    ])
    expect(placePerTurn(['c', 'd'], 4, place(3, 3), 'n')).toEqual([
      'c',
      'n',
      'd',
    ])
    // A turn from before the array started has no slot in it.
    expect(placePerTurn(['c', 'd'], 4, place(1, 1), 'n')).toEqual(['c', 'd'])
  })
  it('starts a missing array with the newest entry only', () => {
    expect(placePerTurn(undefined, 3, place(3, 3), 'n')).toEqual(['n'])
    expect(placePerTurn(undefined, 3, place(1, 1), 'n')).toEqual([])
  })
  it('leaves the array alone when the write is dropped', () => {
    expect(placePerTurn(['a', 'b'], 2, place(2, 2, false), 'n')).toEqual([
      'a',
      'b',
    ])
  })
})

describe('placeTurn', () => {
  // Turns at reply positions 1, 3, 5, 7, sent at minutes 0, 1, 2, 3.
  const row = {
    tools: [[], [], [], []],
    turnIndices: [1, 3, 5, 7],
    turnTimes: [at(0), at(1), at(2), at(3)],
  }
  it('appends a new turn after the others', () => {
    expect(placeTurn(row, 9, at(4))).toEqual({
      from: 4,
      to: 4,
      insert: true,
      latest: true,
    })
  })
  it('lets a Try again replace its turn', () => {
    expect(placeTurn(row, 7, at(4))).toEqual({
      from: 3,
      to: 4,
      insert: true,
      latest: true,
    })
  })
  it('lets an Edit of an earlier message drop every later turn', () => {
    expect(placeTurn(row, 3, at(4))).toEqual({
      from: 1,
      to: 4,
      insert: true,
      latest: true,
    })
  })
  it('slots a late turn in before the newer one instead of truncating', () => {
    // Turn 7's write is late: the next turn (9) landed first.
    const raced = {
      tools: [[], [], [], []],
      turnIndices: [1, 3, 5, 9],
      turnTimes: [at(0), at(1), at(2), at(4)],
    }
    expect(placeTurn(raced, 7, at(3))).toEqual({
      from: 3,
      to: 3,
      insert: true,
      latest: false,
    })
  })
  it('drops a late turn the visitor has since re-sent or edited away', () => {
    // A Try again on turn 7, sent at minute 4, landed before the original.
    const retried = { ...row, turnTimes: [at(0), at(1), at(2), at(4)] }
    expect(placeTurn(retried, 7, at(3))).toEqual({
      from: 4,
      to: 4,
      insert: false,
      latest: false,
      // Named so the skip can be logged with both turns.
      supersededBy: { position: 7, turnAt: at(4) },
    })
    // An Edit of the message behind turn 3, sent at minute 4.
    const edited = {
      tools: [[], []],
      turnIndices: [1, 3],
      turnTimes: [at(0), at(4)],
    }
    expect(placeTurn(edited, 7, at(3))).toMatchObject({
      insert: false,
      latest: false,
      supersededBy: { position: 3, turnAt: at(4) },
    })
  })
  it('keeps the next message after a stopped turn, stamped on arrival', () => {
    // Turn 13 reached the server at 100 s, was stopped at 101 s and logged
    // at once as abandoned, on an instance still loading the catalog. The
    // visitor's next message reached a warm instance at 103 s. Its time is
    // its arrival, not the end of that slow load, so it reads as sent
    // after turn 13 — whether it moves on (reply 15) or edits message 12
    // and re-sends it (reply 13).
    const stopped = {
      tools: [[], []],
      turnIndices: [11, 13],
      turnTimes: [atSec(0), atSec(100)],
    }
    expect(placeTurn(stopped, 15, atSec(103))).toEqual({
      from: 2,
      to: 2,
      insert: true,
      latest: true,
    })
    expect(placeTurn(stopped, 13, atSec(103))).toEqual({
      from: 1,
      to: 2,
      insert: true,
      latest: true,
    })
  })
  it('handles new rows, legacy rows and writes without a position', () => {
    expect(placeTurn(null, 1, at(0))).toEqual({
      from: 0,
      to: 0,
      insert: true,
      latest: true,
    })
    // No positions: append, as before 2 Sept 2026.
    const noPositions = { tools: [[], []], turnTimes: [at(0), at(5)] }
    expect(placeTurn(noPositions, 3, at(1))).toEqual({
      from: 2,
      to: 2,
      insert: true,
      latest: true,
    })
    // No turn times: every write counts as the newest.
    const noTimes = { tools: [[], [], []], turnIndices: [1, 3, 5] }
    expect(placeTurn(noTimes, 3, at(0))).toEqual({
      from: 1,
      to: 3,
      insert: true,
      latest: true,
    })
    expect(placeTurn(row, null, at(1))).toEqual({
      from: 4,
      to: 4,
      insert: true,
      latest: true,
    })
  })
  it('ignores turns logged before positions were recorded', () => {
    // Four turns, positions and times only for the last two.
    const partial = {
      tools: [[], [], [], []],
      turnIndices: [5, 9],
      turnTimes: [at(2), at(4)],
    }
    expect(placeTurn(partial, 7, at(3))).toEqual({
      from: 3,
      to: 3,
      insert: true,
      latest: false,
    })
  })
})

describe('turn writes, applied the way upsertConversation applies them', () => {
  interface Row {
    tools: unknown[]
    turnIndices?: unknown[]
    turnTimes?: unknown[]
  }
  // Mirrors the per-turn bookkeeping in upsertConversation (and its
  // late-write branch): place the write, then splice every array alike.
  function write(
    previous: Row | null,
    historyIndices: number[],
    turnAt: string | undefined,
    tools: unknown
  ): Row {
    const replyIndex = replyIndexOf(historyIndices)
    const total = previous?.tools.length ?? 0
    const placement = placeTurn(previous, replyIndex, turnAt ?? '')
    const row: Row = {
      tools: placePerTurn(previous?.tools, total, placement, tools),
    }
    if (previous?.turnIndices || !previous) {
      row.turnIndices = placePerTurn(
        previous?.turnIndices,
        total,
        placement,
        replyIndex
      )
    }
    if (turnAt !== undefined) {
      row.turnTimes = placePerTurn(
        previous?.turnTimes,
        total,
        placement,
        turnAt
      )
    }
    return row
  }
  const upTo = (n: number) => Array.from({ length: n + 1 }, (_, i) => i)

  it('replaces a re-sent entry instead of adding one', () => {
    let row = write(null, upTo(1), at(0), ['search'])
    row = write(row, upTo(3), at(1), ['search', 'history'])
    // Try again on the second question: same positions, new tool calls.
    row = write(row, upTo(3), at(2), ['get_listing'])
    expect(row.tools).toEqual([['search'], ['get_listing']])
    expect(row.turnIndices).toEqual([1, 3])
    // Editing the first question starts the transcript over.
    row = write(row, upTo(1), at(3), [])
    expect(row.tools).toEqual([[]])
    expect(row.turnIndices).toEqual([1])
    expect(row.turnTimes).toEqual([at(3)])
  })
  it('keeps the newer turn when an earlier one is written late', () => {
    // The 9 Sept 2026 row: turn 13 errored in the visitor's browser, they
    // sent the next message (reply 15), and turn 13's write landed last.
    let row = write(null, upTo(11), at(0), ['t11'])
    row = write(row, upTo(15), at(3), ['t15'])
    row = write(row, upTo(13), at(2), ['t13'])
    expect(row.tools).toEqual([['t11'], ['t13'], ['t15']])
    expect(row.turnIndices).toEqual([11, 13, 15])
    expect(row.turnTimes).toEqual([at(0), at(2), at(3)])
    // A Try again on turn 13 afterwards is a real re-send: turn 15 goes.
    row = write(row, upTo(13), at(4), ['t13 again'])
    expect(row.tools).toEqual([['t11'], ['t13 again']])
  })
  it('keeps a stopped turn and the message sent after it', () => {
    // Turn 13 is stopped and logged at once; the next message follows.
    let row = write(null, upTo(11), atSec(0), ['t11'])
    row = write(row, upTo(13), atSec(100), [])
    row = write(row, upTo(15), atSec(103), ['t15'])
    expect(row.tools).toEqual([['t11'], [], ['t15']])
    expect(row.turnIndices).toEqual([11, 13, 15])
  })
  it('lets a late Try again replace the entry it re-sent, keeping later turns', () => {
    let row = write(null, upTo(1), at(0), ['t1'])
    row = write(row, upTo(3), at(1), ['t3'])
    // Try again on turn 3 (minute 2) is slow; the visitor moves on to
    // turn 5 (minute 3) before its write lands.
    row = write(row, upTo(5), at(3), ['t5'])
    row = write(row, upTo(3), at(2), ['t3 retry'])
    expect(row.tools).toEqual([['t1'], ['t3 retry'], ['t5']])
    expect(row.turnTimes).toEqual([at(0), at(2), at(3)])
  })
  it('drops a late turn that a Try again already replaced', () => {
    let row = write(null, upTo(1), at(0), ['t1'])
    // Turn 3 (minute 1) errors in the browser; Try again (minute 2) lands
    // first, then the original's write arrives.
    row = write(row, upTo(3), at(2), ['retry'])
    row = write(row, upTo(3), at(1), ['original'])
    expect(row.tools).toEqual([['t1'], ['retry']])
    expect(row.turnTimes).toEqual([at(0), at(2)])
  })
  it('behaves as before on legacy rows without positions or times', () => {
    // No positions: every write appends.
    const legacy: Row = { tools: [['a'], ['b']] }
    expect(write(legacy, upTo(3), undefined, ['c']).tools).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ])
    // Positions but no times: a write at a logged position re-sends it.
    const noTimes: Row = { tools: [['a'], ['b']], turnIndices: [1, 3] }
    expect(write(noTimes, upTo(3), undefined, ['b2']).tools).toEqual([
      ['a'],
      ['b2'],
    ])
  })
  it('keeps every message on its own entry after a mid-array insert', () => {
    let row = write(null, upTo(1), at(0), ['t1'])
    row = write(row, upTo(5), at(2), ['t5'])
    row = write(row, upTo(3), at(1), ['t3'])
    const data = {
      history: [u, a, u, a, u, a],
      historyIndices: upTo(5),
      tools: row.tools,
      turnTimes: row.turnTimes,
      turnIndices: row.turnIndices,
    }
    expect(entryFromEnd(data.tools, turnFromEnd(data, 1))).toEqual(['t1'])
    expect(entryFromEnd(data.tools, turnFromEnd(data, 3))).toEqual(['t3'])
    expect(entryFromEnd(data.turnTimes, turnFromEnd(data, 2))).toBe(at(1))
    expect(entryFromEnd(data.tools, turnFromEnd(data, 5))).toEqual(['t5'])
    expect(loggedTurnCount(data)).toBe(3)
  })
})

describe('turnFromEnd', () => {
  it('places messages exactly on rows that record reply positions', () => {
    const data = {
      history: [u, a, u, a, u, a],
      historyIndices: [0, 1, 2, 3, 4, 5],
      tools: [['t0'], ['t1'], ['t2']],
      turnIndices: [1, 3, 5],
    }
    expect(entryFromEnd(data.tools, turnFromEnd(data, 0))).toEqual(['t0'])
    expect(entryFromEnd(data.tools, turnFromEnd(data, 1))).toEqual(['t0'])
    expect(entryFromEnd(data.tools, turnFromEnd(data, 2))).toEqual(['t1'])
    expect(entryFromEnd(data.tools, turnFromEnd(data, 5))).toEqual(['t2'])
  })
  it('still places a windowed history exactly', () => {
    // A long chat: the window holds turns 5 and 6 of seven.
    const data = {
      history: [u, a, u, a],
      historyIndices: [10, 11, 12, 13],
      tools: [[], [], [], [], [], ['t5'], ['t6']],
      turnIndices: [1, 3, 5, 7, 9, 11, 13],
    }
    expect(entryFromEnd(data.tools, turnFromEnd(data, 1))).toEqual(['t5'])
    expect(entryFromEnd(data.tools, turnFromEnd(data, 3))).toEqual(['t6'])
  })
  it('lines a complete legacy history up from the start, past stale duplicates', () => {
    // The 2 Sept 2026 row: four exchanges, the last one logged twice.
    const data = {
      history: [u, a, u, a, u, a, u, a],
      historyIndices: [0, 1, 2, 3, 4, 5, 6, 7],
      tools: [[], ['fellowship search'], [], ['first try'], ['retry']],
      turnTimes: ['t0', 't1', 't2', 't3', 't3b'],
    }
    expect(entryFromEnd(data.tools, turnFromEnd(data, 1))).toEqual([])
    expect(entryFromEnd(data.tools, turnFromEnd(data, 3))).toEqual([
      'fellowship search',
    ])
    expect(entryFromEnd(data.turnTimes, turnFromEnd(data, 0))).toBe('t0')
    expect(entryFromEnd(data.turnTimes, turnFromEnd(data, 2))).toBe('t1')
    expect(entryFromEnd(data.tools, turnFromEnd(data, 7))).toEqual([
      'first try',
    ])
  })
  it('lines a windowed legacy history up from the end', () => {
    const data = {
      history: [u, a, u, a],
      historyIndices: [6, 7, 8, 9],
      tools: [['t0'], ['t1'], ['t2'], ['t3'], ['t4']],
    }
    expect(entryFromEnd(data.tools, turnFromEnd(data, 1))).toEqual(['t3'])
    expect(entryFromEnd(data.tools, turnFromEnd(data, 2))).toEqual(['t4'])
    expect(entryFromEnd(data.tools, turnFromEnd(data, 3))).toEqual(['t4'])
  })
  it('resolves a window that opens on a reply to the turn before it', () => {
    const data = {
      history: [a, u, a],
      tools: [['t0'], ['t1'], ['t2']],
    }
    expect(entryFromEnd(data.tools, turnFromEnd(data, 0))).toEqual(['t1'])
    expect(entryFromEnd(data.tools, turnFromEnd(data, 2))).toEqual(['t2'])
  })
  it('is 0 for a message that is not there', () => {
    expect(turnFromEnd({ history: [u, a], tools: [[]] }, 5)).toBe(0)
  })
})

describe('loggedTurnCount and historyIsComplete', () => {
  it('prefers turnTimes, then per-turn tools', () => {
    expect(loggedTurnCount({ history: [], turnTimes: ['a', 'b'] })).toBe(2)
    expect(loggedTurnCount({ history: [], tools: [[], [], []] })).toBe(3)
    expect(loggedTurnCount({ history: [], tools: [{ name: 'x' }] })).toBe(0)
    expect(loggedTurnCount({ history: [] })).toBe(0)
  })
  it('knows a complete history from a windowed or unmapped one', () => {
    expect(historyIsComplete({ history: [u, a], historyIndices: [0, 1] })).toBe(
      true
    )
    expect(historyIsComplete({ history: [u, a], historyIndices: [4, 5] })).toBe(
      false
    )
    expect(historyIsComplete({ history: [u, a], historyIndices: [0] })).toBe(
      false
    )
    expect(historyIsComplete({ history: [u, a] })).toBe(false)
    expect(historyIsComplete({ history: [], historyIndices: [] })).toBe(false)
  })
})

describe('entryFromEnd', () => {
  it('counts from the end and stays in bounds', () => {
    expect(entryFromEnd(['a', 'b', 'c'], 1)).toBe('c')
    expect(entryFromEnd(['a', 'b', 'c'], 3)).toBe('a')
    expect(entryFromEnd(['a', 'b', 'c'], 4)).toBeUndefined()
    expect(entryFromEnd(['a', 'b', 'c'], 0)).toBeUndefined()
    expect(entryFromEnd(undefined, 1)).toBeUndefined()
  })
})
