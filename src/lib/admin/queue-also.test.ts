import { describe, expect, it } from 'vitest'
import { replyAlsoOf, replyWho } from './queue-also'

describe('replyAlsoOf', () => {
  it('reads each block as name <address> or address', () => {
    expect(
      replyAlsoOf([
        { to: 'lachlan@mercial.uk', name: '' },
        { to: 'ann@example.org', name: 'Ann' },
        { to: '', name: 'Nobody' },
        'not a block',
      ])
    ).toEqual(['lachlan@mercial.uk', 'Ann <ann@example.org>'])
  })

  it('is empty without a list', () => {
    expect(replyAlsoOf(undefined)).toEqual([])
    expect(replyAlsoOf({ to: 'a@b.org' })).toEqual([])
  })
})

describe('replyWho', () => {
  it('names everyone, Oxford comma for three', () => {
    expect(replyWho({ replyTo: 'matt@x.me', replyAlso: [] })).toBe('matt@x.me')
    expect(
      replyWho({ replyTo: 'matt@x.me', replyAlso: ['lachlan@mercial.uk'] })
    ).toBe('matt@x.me and lachlan@mercial.uk')
    expect(
      replyWho({ replyTo: 'a@x.org', replyAlso: ['b@x.org', 'c@x.org'] })
    ).toBe('a@x.org, b@x.org, and c@x.org')
  })

  it('is null with no one to reply to', () => {
    expect(replyWho({ replyTo: null, replyAlso: ['b@x.org'] })).toBeNull()
  })
})
