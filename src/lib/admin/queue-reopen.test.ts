import { describe, expect, it } from 'vitest'
import {
  declinedBeforeOf,
  pushbackOf,
  reopenedOf,
  reopeningLabel,
  reopeningOf,
  wasDeclined,
  withReopenMarker,
  type DecisionFacts,
} from './queue-reopen'

const declined: DecisionFacts = {
  type: 'Add',
  status: 'Applied',
  decidedAt: '2026-10-13T09:46:27.169Z',
  appliedAt: '2026-10-14T09:50:16.000Z',
  rejectReason: 'Expressions of interest only, no application open yet',
  rejectReplied: true,
  error: null,
}

describe('wasDeclined', () => {
  it('counts a rejected addition the Mac deleted (AI Safety Essentials Fellowship)', () => {
    expect(wasDeclined(declined)).toBe(true)
  })
  it('counts one rejected without a reason or reply by the day between', () => {
    expect(
      wasDeclined({ ...declined, rejectReason: null, rejectReplied: false })
    ).toBe(true)
  })
  it('does not count a publish', () => {
    expect(
      wasDeclined({
        ...declined,
        rejectReason: null,
        rejectReplied: false,
        appliedAt: declined.decidedAt,
      })
    ).toBe(false)
  })
  it('counts a rejection still in the undo window', () => {
    expect(
      wasDeclined({ ...declined, status: 'Rejected', appliedAt: null })
    ).toBe(true)
  })
  it('counts a closed row only when its record had gone', () => {
    expect(
      wasDeclined({
        ...declined,
        status: 'Closed',
        error: 'Record already deleted',
      })
    ).toBe(true)
    expect(
      wasDeclined({
        ...declined,
        status: 'Closed',
        error: 'Published outside the queue',
      })
    ).toBe(false)
  })
  it('never counts a change, a rule or an open item', () => {
    expect(wasDeclined({ ...declined, type: 'Change' })).toBe(false)
    expect(wasDeclined({ ...declined, type: 'Rule' })).toBe(false)
    expect(
      wasDeclined({ ...declined, status: 'Pending', decidedAt: null })
    ).toBe(false)
  })
})

describe('the proposal keys', () => {
  it('reads the marker, failed or on its way', () => {
    expect(reopeningOf({ at: '2026-10-20T10:00:00Z', by: 'page' })).toEqual({
      at: '2026-10-20T10:00:00Z',
      by: 'page',
      error: null,
    })
    expect(reopeningOf({ at: 'x', by: 'reply', error: 'boom' })?.error).toBe(
      'boom'
    )
    expect(reopeningOf(null)).toBeNull()
  })
  it('reads their reply and keeps only a Gmail link', () => {
    expect(
      pushbackOf({
        from: 'joseph@example.org',
        name: 'Joseph',
        at: '2026-10-13T16:12:43Z',
        link: 'https://mail.google.com/mail/?authuser=x#all/1a1360a0cf246784',
        text: 'The expression of interest form IS the application.',
        take: 'Yes – the form is the application.',
        changes: 'yes',
      })
    ).toEqual({
      from: 'joseph@example.org',
      name: 'Joseph',
      at: '2026-10-13T16:12:43Z',
      link: 'https://mail.google.com/mail/?authuser=x#all/1a1360a0cf246784',
      text: 'The expression of interest form IS the application.',
      take: 'Yes – the form is the application.',
      changes: 'yes',
    })
    const odd = pushbackOf({
      text: 'hi',
      link: 'https://evil.example',
      changes: 'maybe',
    })
    expect(odd?.link).toBeNull()
    expect(odd?.changes).toBeNull()
    expect(odd?.take).toBeNull()
    expect(pushbackOf({ text: '  ' })).toBeNull()
  })
  it('reads how it came back', () => {
    expect(
      reopenedOf({ at: 'x', by: 'page', rebuilt: true, logo: 'site' })
    ).toEqual({ at: 'x', by: 'page', rebuilt: true, logo: 'site' })
  })
  it('knows the decline they have when nothing came from them since', () => {
    const reply = {
      to: 'a@b.org',
      declined: {
        date: '13 October 2026',
        reason: 'EOI only',
        text: 'Thanks…',
      },
    }
    expect(declinedBeforeOf(reply, null)).toEqual({
      date: '13 October 2026',
      reason: 'EOI only',
      text: 'Thanks…',
    })
    expect(
      declinedBeforeOf(reply, pushbackOf({ text: 'But it is open!' }))
    ).toBeNull()
    expect(declinedBeforeOf({ to: 'a@b.org' }, null)).toBeNull()
  })
})

describe('withReopenMarker', () => {
  it('writes the marker and keeps the rest', () => {
    expect(withReopenMarker({ kind: 'add', name: 'X' }, 'now')).toEqual({
      kind: 'add',
      name: 'X',
      reopen: { at: 'now', by: 'page' },
    })
  })
  it('keeps a record a failed attempt made, and drops the error', () => {
    expect(
      withReopenMarker(
        {
          reopen: {
            at: 'then',
            by: 'page',
            new: 'recNEWNEWNEWNEWNE',
            error: 'boom',
            tries: 3,
          },
        },
        'now'
      ).reopen
    ).toEqual({ new: 'recNEWNEWNEWNEWNE', at: 'now', by: 'page' })
  })
})

describe('reopeningLabel', () => {
  it('says what is happening', () => {
    expect(reopeningLabel({ at: null, by: 'page', error: null })).toBe(
      'Bringing it back'
    )
    expect(reopeningLabel({ at: null, by: 'reply', error: null })).toBe(
      'They replied · bringing it back'
    )
    expect(reopeningLabel({ at: null, by: 'page', error: 'boom' })).toBe(
      'Could not bring it back · boom'
    )
  })
})
