import { describe, expect, it } from 'vitest'
import { formEmailFollows } from './queue-form-email'

const noEmail = { source: 'Form', replyTo: null }

describe('formEmailFollows', () => {
  it('asks after every way of dealing with a form item nobody waits on', () => {
    for (const action of ['accept', 'reject', 'later', 'delete']) {
      expect(formEmailFollows(noEmail, action)).toBe(true)
    }
  })
  it('asks again after an Undo, so the email goes back to unread', () => {
    expect(formEmailFollows(noEmail, 'undo')).toBe(true)
  })
  it('leaves an item with someone to reply to: he answers in the thread', () => {
    const withEmail = { source: 'Form', replyTo: 'ann@example.org' }
    for (const action of ['accept', 'reject', 'later', 'delete', 'undo']) {
      expect(formEmailFollows(withEmail, action)).toBe(false)
    }
  })
  it('is only for form submissions', () => {
    for (const source of ['Email', 'Discord', 'Comb', 'Broom', 'Teach']) {
      expect(formEmailFollows({ source, replyTo: null }, 'accept')).toBe(false)
    }
  })
  it('does not ask for an edit, a flag, a fix, or a reopen', () => {
    for (const action of ['edit', 'flag', 'fix', 'reopen']) {
      expect(formEmailFollows(noEmail, action)).toBe(false)
    }
  })
  it('treats a missing or empty address as nobody to reply to', () => {
    expect(formEmailFollows({ source: 'Form' }, 'accept')).toBe(true)
    expect(formEmailFollows({ source: 'Form', replyTo: '' }, 'accept')).toBe(
      true
    )
  })
})
