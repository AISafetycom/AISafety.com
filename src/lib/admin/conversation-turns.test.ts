import { describe, expect, it } from 'vitest'
import {
  entryFromEnd,
  historyIsComplete,
  loggedTurnCount,
  replyIndexOf,
  slicePerTurn,
  turnFromEnd,
  turnsToKeep,
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

describe('slicePerTurn', () => {
  it('cuts an array that spans every turn', () => {
    expect(slicePerTurn(['a', 'b', 'c'], 3, 2)).toEqual(['a', 'b'])
    expect(slicePerTurn(['a', 'b', 'c'], 3, 3)).toEqual(['a', 'b', 'c'])
    expect(slicePerTurn(['a', 'b', 'c'], 3, 0)).toEqual([])
  })
  it('respects end alignment on an array that started late', () => {
    // Four turns, the array covers only the last two.
    expect(slicePerTurn(['c', 'd'], 4, 3)).toEqual(['c'])
    expect(slicePerTurn(['c', 'd'], 4, 2)).toEqual([])
    expect(slicePerTurn(['c', 'd'], 4, 4)).toEqual(['c', 'd'])
  })
  it('is empty for a missing array', () => {
    expect(slicePerTurn(undefined, 3, 3)).toEqual([])
  })
})

describe('a re-sent turn, written the way upsertConversation writes', () => {
  // Mirrors the per-turn bookkeeping in upsertConversation: keep the turns
  // before this write's position, then append.
  function write(
    previous: { tools: unknown[]; turnIndices?: unknown[] } | null,
    historyIndices: number[],
    tools: unknown
  ) {
    const replyIndex = replyIndexOf(historyIndices)
    const total = previous?.tools.length ?? 0
    const keep = previous ? turnsToKeep(previous, replyIndex) : 0
    return {
      tools: [...slicePerTurn(previous?.tools, total, keep), tools],
      turnIndices: [
        ...slicePerTurn(previous?.turnIndices, total, keep),
        replyIndex,
      ],
    }
  }
  it('replaces the entry instead of adding one', () => {
    let row = write(null, [0, 1], ['search'])
    row = write(row, [0, 1, 2, 3], ['search', 'history'])
    // Try again on the second question: same positions, new tool calls.
    row = write(row, [0, 1, 2, 3], ['get_listing'])
    expect(row.tools).toEqual([['search'], ['get_listing']])
    expect(row.turnIndices).toEqual([1, 3])
    // Editing the first question starts the transcript over.
    row = write(row, [0, 1], [])
    expect(row.tools).toEqual([[]])
    expect(row.turnIndices).toEqual([1])
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
