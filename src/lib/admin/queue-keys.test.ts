import { describe, expect, it } from 'vitest'
import {
  heldRepeat,
  rulePopKey,
  shortcutAllowed,
  takesTyping,
  type KeyScene,
} from './queue-keys'

describe('heldRepeat', () => {
  it('is every repeat of a key that decides or toggles', () => {
    for (const key of ['x', 'a', 'w', 'g', 'r', 'u', 'Enter', 't', '?', 'z']) {
      expect(heldRepeat({ key, repeat: true })).toBe(true)
    }
  })

  it('lets Tab and the arrows go on moving while held', () => {
    for (const key of ['Tab', 'ArrowDown', 'ArrowUp']) {
      expect(heldRepeat({ key, repeat: true })).toBe(false)
    }
  })

  it('is never the press itself', () => {
    for (const key of ['x', 'a', 'Tab']) {
      expect(heldRepeat({ key, repeat: false })).toBe(false)
    }
  })
})

describe('takesTyping', () => {
  it('is a text box, a dropdown or editable text', () => {
    expect(takesTyping({ tagName: 'INPUT' })).toBe(true)
    expect(takesTyping({ tagName: 'TEXTAREA' })).toBe(true)
    expect(takesTyping({ tagName: 'SELECT' })).toBe(true)
    expect(takesTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('is not a button, the page or nothing', () => {
    expect(takesTyping({ tagName: 'BUTTON', isContentEditable: false })).toBe(
      false
    )
    expect(takesTyping({ tagName: 'BODY' })).toBe(false)
    expect(takesTyping(null)).toBe(false)
  })
})

describe('shortcutAllowed', () => {
  const detail: KeyScene = { help: false, view: 'detail', editing: false }
  const DECIDE = ['a', 'Enter', 'x', 'w', 'g', 'r', 'c', '1', '2', '3']
  const OPEN = ['f', 'p', 'e']
  const LINKS = ['s', 'q', 'd']
  const ELSEWHERE = ['Tab', 'ArrowDown', 'ArrowUp', 't', '/', 'u', 'v']

  it('lets every key through on an item whose detail is showing', () => {
    for (const key of [...DECIDE, ...OPEN, ...LINKS, 'b', ...ELSEWHERE]) {
      expect(shortcutAllowed(key, detail)).toBe(true)
    }
  })

  it('keeps every key off an item that is not on screen', () => {
    // Done today with another item marked or none, or a found listing.
    const hidden: KeyScene = { ...detail, view: 'hidden' }
    for (const key of [...DECIDE, ...OPEN, ...LINKS, 'b']) {
      expect(shortcutAllowed(key, hidden)).toBe(false)
    }
    for (const key of [...ELSEWHERE, '?', 'Escape']) {
      expect(shortcutAllowed(key, hidden)).toBe(true)
    }
  })

  it('on a row marked in the list of decisions, opens its links and brings it back, no more', () => {
    const row: KeyScene = { ...detail, view: 'row' }
    for (const key of [...LINKS, 'b']) {
      expect(shortcutAllowed(key, row)).toBe(true)
    }
    for (const key of [...DECIDE, ...OPEN]) {
      expect(shortcutAllowed(key, row)).toBe(false)
    }
  })

  it('decides nothing while a field editor is open', () => {
    const editing: KeyScene = { ...detail, editing: true }
    for (const key of [...DECIDE, 'b']) {
      expect(shortcutAllowed(key, editing)).toBe(false)
    }
    // Esc closes the editor; the rest change nothing on the item.
    for (const key of ['Escape', ...OPEN, ...LINKS, ...ELSEWHERE]) {
      expect(shortcutAllowed(key, editing)).toBe(true)
    }
  })

  it('with the "?" card up, only closes it or moves', () => {
    const help: KeyScene = { ...detail, help: true }
    for (const key of ['?', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp']) {
      expect(shortcutAllowed(key, help)).toBe(true)
    }
    for (const key of [
      ...DECIDE,
      ...OPEN,
      ...LINKS,
      'b',
      't',
      '/',
      'u',
      'g',
      'v',
    ]) {
      expect(shortcutAllowed(key, help)).toBe(false)
    }
  })
})

describe('rulePopKey', () => {
  const idle = { rejecting: false, busy: false }
  const reasons = { rejecting: true, busy: false }

  it('A applies and R shows the reasons on an idle card', () => {
    expect(rulePopKey('a', idle)).toEqual({ do: 'apply' })
    expect(rulePopKey('r', idle)).toEqual({ do: 'reasons' })
  })

  it('a number picks a reason only while the reasons show', () => {
    expect(rulePopKey('1', reasons)).toEqual({ do: 'reject', chip: 0 })
    expect(rulePopKey('3', reasons)).toEqual({ do: 'reject', chip: 2 })
    expect(rulePopKey('1', idle)).toEqual({ do: 'none' })
    expect(rulePopKey('0', reasons)).toEqual({ do: 'none' })
  })

  it('A does not apply while the reasons show or a decision is on its way', () => {
    expect(rulePopKey('a', reasons)).toEqual({ do: 'none' })
    expect(rulePopKey('a', { rejecting: false, busy: true })).toEqual({
      do: 'none',
    })
    expect(rulePopKey('1', { rejecting: true, busy: true })).toEqual({
      do: 'none',
    })
  })

  it('V views, Esc backs out, U and ? go on as usual', () => {
    expect(rulePopKey('v', idle)).toEqual({ do: 'view' })
    expect(rulePopKey('Escape', reasons)).toEqual({ do: 'back' })
    expect(rulePopKey('u', idle)).toEqual({ do: 'pass' })
    expect(rulePopKey('?', idle)).toEqual({ do: 'pass' })
  })

  it('every other key does nothing behind the card', () => {
    for (const key of ['x', 'w', 'Tab', 'ArrowDown', 'Enter', 'g', 't', '/']) {
      expect(rulePopKey(key, idle)).toEqual({ do: 'none' })
    }
  })
})
