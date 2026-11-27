import { describe, expect, it } from 'vitest'
import {
  CHAT_HEADING,
  CHAT_SOURCE,
  chatHeading,
  chatProposed,
} from './queue-chat-source'

// The mark as ~/Queue/queue_lib.py (chat_change_item) writes it.
const MARK = {
  by: 'Rob Grayson',
  email: 'rob@example.org',
  row: 'recAAAAAAAAAAAAAA',
  at: '2026-11-30T03:00:00Z',
}
const change = (over: object = {}) => ({
  kind: 'change',
  table: 'tblXbN9swwldwq8f7',
  record: 'recBBBBBBBBBBBBBB',
  changes: [{ field: 'Deadline', from: null, to: '2026-12-12' }],
  ...over,
})

describe('chatProposed', () => {
  it('reads a row filed under Source "Queue chat", with who asked', () => {
    expect(chatProposed('Queue chat', change({ chat: MARK }))).toEqual({
      by: 'Rob Grayson',
    })
  })
  it('reads one filed under Comb until the Source field has the choice', () => {
    expect(chatProposed('Comb', change({ chat: MARK }))).toEqual({
      by: 'Rob Grayson',
    })
  })
  it('is nothing for every other row', () => {
    expect(chatProposed('Comb', change())).toBeNull()
    expect(chatProposed('Email', change())).toBeNull()
    expect(chatProposed('Broom', null)).toBeNull()
    expect(chatProposed(null, 'not json')).toBeNull()
    // A key called chat that is not the mark.
    for (const chat of ['Rob', 7, true, null, ['Rob']]) {
      expect(chatProposed('Comb', change({ chat }))).toBeNull()
    }
    // Who asked a rule is elsewhere (bryce_applies), not this mark.
    expect(
      chatProposed('Teach', {
        kind: 'rule',
        bryce_applies: { chat: 'rob@x.org' },
      })
    ).toBeNull()
  })
  it('names nobody when the row does not', () => {
    expect(chatProposed('Queue chat', change())).toEqual({ by: null })
    expect(chatProposed('Queue chat', null)).toEqual({ by: null })
    const { by: _left, ...noName } = MARK
    void _left
    expect(chatProposed('Queue chat', change({ chat: noName }))).toEqual({
      by: null,
    })
    for (const by of ['', '   ', 7, null, { name: 'Rob' }, '12345 !!!']) {
      expect(chatProposed('Comb', change({ chat: { ...MARK, by } }))).toEqual({
        by: null,
      })
    }
  })
  it('shows a name as a name, whatever the row holds', () => {
    expect(
      chatProposed(
        'Queue chat',
        change({ chat: { ...MARK, by: "  Zoë   O'Neil-Smith Jr. " } })
      )
    ).toEqual({ by: "Zoë O'Neil-Smith Jr." })
    expect(
      chatProposed(
        'Queue chat',
        change({ chat: { ...MARK, by: 'Rob <img src=x onerror=alert(1)>' } })
      )
    ).toEqual({ by: 'Rob img src x onerror alert' })
    expect(
      chatProposed(
        'Queue chat',
        change({ chat: { ...MARK, by: 'a'.repeat(90) } })
      )?.by
    ).toHaveLength(40)
  })
  it('never shows the address in place of a name', () => {
    expect(
      chatProposed('Queue chat', change({ chat: { email: 'rob@example.org' } }))
    ).toEqual({ by: null })
  })
})

describe('chatHeading', () => {
  it('says where the change was proposed, with the name beside it', () => {
    expect(CHAT_SOURCE).toBe('Queue chat')
    expect(chatHeading('Rob Grayson')).toBe(
      'Proposed in the Queue chat · by Rob Grayson'
    )
  })
  it('falls back to no name', () => {
    expect(chatHeading(null)).toBe(CHAT_HEADING)
    expect(chatHeading(undefined)).toBe('Proposed in the Queue chat')
    expect(chatHeading('')).toBe('Proposed in the Queue chat')
  })
})
