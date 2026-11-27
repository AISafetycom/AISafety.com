import { describe, expect, it } from 'vitest'
import {
  editChanges,
  ruleEditsOf,
  ruleMarkOf,
  shownEdit,
} from './queue-rule-edits'

describe('ruleMarkOf', () => {
  it('reads a rule proposed in a teammate’s chat, with the name beside it', () => {
    expect(
      ruleMarkOf({
        why: 'Proposed in the Queue chat by Rob Grayson (rob@example.org): …',
        rows: [],
        at: '2026-11-30T03:00:00Z',
        chat: 'rob@example.org',
        name: 'Rob Grayson',
      })
    ).toEqual({ chat: true, name: 'Rob Grayson' })
  })
  it('reads one drafted from a teammate’s decision', () => {
    expect(ruleMarkOf({ why: 'x', rows: ['recA'], at: 'y' })).toEqual({
      chat: false,
      name: null,
    })
  })
  it('never reads the address out, and shows a name as a name', () => {
    const mark = ruleMarkOf({ chat: 'rob@example.org', name: 'Rob <b>"x"</b>' })
    expect(mark).toEqual({ chat: true, name: 'Rob b x b' })
    expect(JSON.stringify(mark)).not.toContain('@')
    expect(ruleMarkOf({ chat: 'rob@example.org', name: 7 })?.name).toBeNull()
  })
  it('is nothing for a rule with no mark', () => {
    for (const none of [undefined, null, true, 'yes', ['x']]) {
      expect(ruleMarkOf(none)).toBeNull()
    }
  })
})

describe('ruleEditsOf', () => {
  it('reads the edits the worker would carry out', () => {
    const edits = [{ file: '~/Comb/review-rules.md', find: 'a', replace: 'b' }]
    expect(ruleEditsOf(edits)).toEqual(edits)
    // Only what an edit is: nothing else rides along.
    expect(ruleEditsOf([{ ...edits[0], note: 'x' }])).toEqual(edits)
  })
  it('is null when there are none, or one is not an edit', () => {
    for (const bad of [
      undefined,
      null,
      [],
      'edits',
      [{ file: 'f', find: 'a' }],
      [{ file: 'f', find: 'a', replace: 7 }],
      [{ file: 'f', find: 'a', replace: 'b' }, 'x'],
    ]) {
      expect(ruleEditsOf(bad)).toBeNull()
    }
  })
})

describe('shownEdit', () => {
  it('shows the lines an edit adds, leaving out the lines that only place it', () => {
    expect(
      shownEdit({
        file: '~/Queue/chat-lessons.md',
        find: '## Dates\n',
        replace: '## Dates\n- Write 4 February 2026, never "Feb 4".\n',
      })
    ).toEqual({
      file: 'Queue/chat-lessons.md',
      out: '',
      in: '- Write 4 February 2026, never "Feb 4".',
    })
  })
  it('shows what a rewrite takes out and what it puts in', () => {
    expect(
      shownEdit({
        file: '~/Comb/review-rules.md',
        find: 'Before.\n- List every meetup.\n- Skip paid courses.\nAfter.',
        replace:
          'Before.\n- List every public meetup.\n- List paid courses too.\n- Never list a private group.\nAfter.',
      })
    ).toEqual({
      file: 'Comb/review-rules.md',
      out: '- List every meetup.\n- Skip paid courses.',
      in: '- List every public meetup.\n- List paid courses too.\n- Never list a private group.',
    })
  })
  it('shows a line changed in the middle as the whole old and new line', () => {
    expect(
      shownEdit({
        file: 'f.md',
        find: 'a\nLimit 180.\nc',
        replace: 'a\nLimit 220.\nc',
      })
    ).toEqual({ file: 'f.md', out: 'Limit 180.', in: 'Limit 220.' })
  })
  it('shows an edit that only takes words out', () => {
    expect(
      shownEdit({
        file: 'f.md',
        find: 'keep\ndrop this\nkeep too',
        replace: 'keep\nkeep too',
      })
    ).toEqual({ file: 'f.md', out: 'drop this', in: '' })
  })
  it('hides nothing that changes', () => {
    // A line that both texts start and end with is counted once: the
    // middle is what differs.
    expect(
      shownEdit({ file: 'f.md', find: 'x\nx', replace: 'x\nnew\nx' })
    ).toEqual({ file: 'f.md', out: '', in: 'new' })
    expect(
      shownEdit({ file: 'f', find: 'same\nsame\nsame', replace: 'same\nsame' })
    ).toEqual({ file: 'f', out: 'same', in: '' })
    // Nothing in common: the whole of both.
    expect(
      shownEdit({ file: 'f', find: 'one line', replace: 'another line' })
    ).toEqual({ file: 'f', out: 'one line', in: 'another line' })
    expect(
      shownEdit({ file: 'f', find: '', replace: 'all new\ntext' })
    ).toEqual({
      file: 'f',
      out: '',
      in: 'all new\ntext',
    })
    // What is left out is the same on both sides: with the cut lines put
    // back around them, `out` and `in` are the edit's own two texts.
    const edit = {
      file: 'f',
      find: 'a\nb\nc\nd\ne',
      replace: 'a\nB\nC\nC2\nd\ne',
    }
    const shown = shownEdit(edit)
    expect(`a\n${shown.out}\nd\ne`).toBe(edit.find)
    expect(`a\n${shown.in}\nd\ne`).toBe(edit.replace)
  })
})

describe('editChanges', () => {
  it('says when an edit would change nothing', () => {
    expect(editChanges({ file: 'f', find: 'a', replace: 'a' })).toBe(false)
    expect(editChanges({ file: 'f', find: 'a', replace: 'a ' })).toBe(true)
  })
})
