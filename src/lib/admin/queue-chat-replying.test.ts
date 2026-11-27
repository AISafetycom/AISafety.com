import { describe, expect, it } from 'vitest'
import {
  heldIds,
  holdsDecisions,
  panelReplying,
  repliesEnded,
  withPanelWord,
} from './queue-chat-replying'

const idle = { loaded: true, busy: false, pending: false, queued: 0 }

describe('whether a chat panel has a reply under way', () => {
  it('has none when its thread is read and nothing is being written', () => {
    expect(panelReplying(idle)).toBe(false)
  })
  it('has one while a message is sent or its reply streamed', () => {
    expect(panelReplying({ ...idle, busy: true })).toBe(true)
  })
  it('has one while the server still answers an earlier message', () => {
    // After a reload, or a message the server holds for its turn.
    expect(panelReplying({ ...idle, pending: true })).toBe(true)
  })
  it('has one while messages typed here wait their turn', () => {
    expect(panelReplying({ ...idle, queued: 2 })).toBe(true)
  })
  it('cannot tell before its thread is read, unless it is sending itself', () => {
    expect(panelReplying({ ...idle, loaded: false })).toBeNull()
    expect(panelReplying({ ...idle, loaded: false, pending: true })).toBeNull()
    expect(panelReplying({ ...idle, loaded: false, busy: true })).toBe(true)
    expect(panelReplying({ ...idle, loaded: false, queued: 1 })).toBe(true)
  })
})

describe('the items the page holds decisions on', () => {
  it('keeps each panel’s last word, yes or no', () => {
    const one = withPanelWord({}, 'recA', true)
    expect(one).toEqual({ recA: true })
    const two = withPanelWord(one, 'recB', true)
    expect(two).toEqual({ recA: true, recB: true })
    expect(withPanelWord(two, 'recA', false)).toEqual({
      recA: false,
      recB: true,
    })
  })
  it('forgets the word of a panel that closed with nothing under way', () => {
    const said = withPanelWord({ recB: true }, 'recA', false)
    expect(withPanelWord(said, 'recA', null)).toEqual({ recB: true })
  })
  it('keeps the same words when a panel repeats itself', () => {
    const one = withPanelWord({}, 'recA', true)
    expect(withPanelWord(one, 'recA', true)).toBe(one)
    expect(withPanelWord(one, 'recB', null)).toBe(one)
  })
  it('goes by the item’s own panel when it has spoken', () => {
    const rows = { recA: { answering: true }, recB: {} }
    // The reply just ended in the panel; the Mac's word is seconds old.
    expect(holdsDecisions('recA', { recA: false }, rows)).toBe(false)
    expect(holdsDecisions('recB', { recB: true }, rows)).toBe(true)
  })
  it('goes by the Mac for an item no panel has spoken on', () => {
    const rows = { recB: { answering: true }, recC: { last: 'x' } }
    expect(holdsDecisions('recB', {}, rows)).toBe(true)
    // Answered, not answering: free.
    expect(holdsDecisions('recC', {}, rows)).toBe(false)
    expect(holdsDecisions('recD', { recA: true }, rows)).toBe(false)
  })
  it('lists every held item once', () => {
    expect(
      [
        ...heldIds(
          { recA: true, recD: false },
          {
            recA: { answering: true },
            recB: { answering: true },
            recC: {},
            recD: { answering: true },
          }
        ),
      ].sort()
    ).toEqual(['recA', 'recB'])
  })
})

describe('when a reply has ended', () => {
  it('names the items held before and free now', () => {
    expect(
      repliesEnded(new Set(['recA', 'recB']), new Set(['recB', 'recC']))
    ).toEqual(['recA'])
  })
  it('names none while they are all still held, or none were', () => {
    expect(repliesEnded(new Set(['recA']), new Set(['recA']))).toEqual([])
    expect(repliesEnded(new Set(), new Set(['recA']))).toEqual([])
  })
  it('does not end for an item its panel leaves while the Mac still says answering', () => {
    // He moved on after the panel said the reply was done, and a message
    // he had queued is now being answered in the background.
    const before = heldIds({ recA: true }, { recA: { answering: true } })
    const now = heldIds(withPanelWord({ recA: true }, 'recA', null), {
      recA: { answering: true },
    })
    expect(repliesEnded(before, now)).toEqual([])
  })
  it('ends the moment the panel says so, whatever the Mac last said', () => {
    const rows = { recA: { answering: true } }
    const before = heldIds({ recA: true }, rows)
    const now = heldIds({ recA: false }, rows)
    expect(repliesEnded(before, now)).toEqual(['recA'])
  })
})
