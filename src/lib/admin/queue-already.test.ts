import { describe, expect, it } from 'vitest'
import { alreadyRepliedOf } from './queue-already'

describe('alreadyRepliedOf', () => {
  it('reads the day of his reply and its Gmail link', () => {
    expect(
      alreadyRepliedOf({
        date: '7 September 2026',
        at: '2026-09-07T18:15:01Z',
        message: '1a07d14ad791f181',
        link: 'https://mail.google.com/mail/#all/1a07d14ad791f181',
      })
    ).toEqual({
      date: '7 September 2026',
      link: 'https://mail.google.com/mail/#all/1a07d14ad791f181',
    })
  })
  it('keeps only a Gmail link', () => {
    expect(
      alreadyRepliedOf({
        date: '7 September 2026',
        link: 'https://example.com/x',
      })
    ).toEqual({ date: '7 September 2026', link: null })
  })
  it('is null without a day', () => {
    expect(alreadyRepliedOf(undefined)).toBeNull()
    expect(alreadyRepliedOf('yes')).toBeNull()
    expect(alreadyRepliedOf({ date: '  ' })).toBeNull()
  })
})
