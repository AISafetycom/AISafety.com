import { describe, expect, it } from 'vitest'

import {
  parseRejectDrafts,
  rejectReplyFor,
  shownDeclineChip,
} from './queue-decline'

const chips = ['Covered by PauseAI', 'Bare WhatsApp link', 'Local chapter']
const drafts = {
  'Covered by PauseAI': 'Thanks – the PauseAI listing covers it.',
  'Local chapter': 'Thanks – we list PauseAI as a whole.',
}

describe('parseRejectDrafts', () => {
  it('reads the JSON the worker writes', () => {
    expect(parseRejectDrafts(JSON.stringify(drafts))).toEqual(drafts)
  })
  it('treats anything else as none', () => {
    expect(parseRejectDrafts(null)).toEqual({})
    expect(parseRejectDrafts('')).toEqual({})
    expect(parseRejectDrafts('not json')).toEqual({})
    expect(parseRejectDrafts('["a"]')).toEqual({})
  })
  it('drops empty replies and trims the rest', () => {
    expect(parseRejectDrafts('{"a": "  hi  ", "b": " ", "c": 3}')).toEqual({
      a: 'hi',
    })
  })
})

describe('shownDeclineChip', () => {
  it('shows the first reason that has a reply', () => {
    expect(shownDeclineChip(chips, drafts)).toBe('Covered by PauseAI')
    expect(shownDeclineChip(chips, { 'Local chapter': 'x' })).toBe(
      'Local chapter'
    )
  })
  it('follows the reason in focus when it has a reply', () => {
    expect(shownDeclineChip(chips, drafts, 'Local chapter')).toBe(
      'Local chapter'
    )
    expect(shownDeclineChip(chips, drafts, 'Bare WhatsApp link')).toBe(
      'Covered by PauseAI'
    )
  })
  it('is null with no replies yet', () => {
    expect(shownDeclineChip(chips, {})).toBeNull()
  })
})

describe('rejectReplyFor', () => {
  const base = { chips, drafts, edited: null, chip: null, typed: '' }
  it("sends the chosen reason's reply", () => {
    expect(rejectReplyFor({ ...base, chip: 'Local chapter' })).toBe(
      drafts['Local chapter']
    )
  })
  it('sends nothing for a reason with no reply, so Fable writes one', () => {
    expect(rejectReplyFor({ ...base, chip: 'Bare WhatsApp link' })).toBeNull()
  })
  it('lets a typed reason have Fable write the reply', () => {
    expect(rejectReplyFor({ ...base, typed: 'Already on /map' })).toBeNull()
  })
  it('sends the reply on show when no reason is given', () => {
    expect(rejectReplyFor(base)).toBe(drafts['Covered by PauseAI'])
  })
  it('sends an edited reply whatever the reason', () => {
    const edited = 'Thanks Matěj – not this time.'
    expect(rejectReplyFor({ ...base, edited, chip: 'Local chapter' })).toBe(
      edited
    )
    expect(rejectReplyFor({ ...base, edited, typed: 'x' })).toBe(edited)
    expect(rejectReplyFor({ ...base, edited: '   ' })).toBeNull()
  })
})
