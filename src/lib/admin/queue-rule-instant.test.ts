import { describe, expect, it } from 'vitest'
import {
  POP_UP_FOR_MS,
  publicChoiceOf,
  rememberClosed,
  ruleInstantOf,
  rulePublicOf,
  ruleToPopUp,
  type PopUpCandidate,
} from './queue-rule-instant'

const NOW = Date.parse('2026-11-10T08:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

function rule(
  id: string,
  ready: string | null,
  over: Partial<PopUpCandidate> = {}
): PopUpCandidate {
  return {
    id,
    type: 'Rule',
    status: 'Pending',
    ruleInstant: {
      from: `from-${id}`,
      listing: 'A listing',
      page: '/events',
      ready,
    },
    ...over,
  }
}

describe('ruleInstantOf', () => {
  it('reads the block', () => {
    expect(
      ruleInstantOf({
        from: 'recA',
        listing: ' Mentor call ',
        page: '/training',
        ready: '2026-11-10T07:55:00Z',
        at: 'ignored',
      })
    ).toEqual({
      from: 'recA',
      listing: 'Mentor call',
      page: '/training',
      ready: '2026-11-10T07:55:00Z',
    })
  })

  it('keeps a rule that is not ready yet, with ready null', () => {
    expect(ruleInstantOf({ from: 'recA' })).toEqual({
      from: 'recA',
      listing: null,
      page: null,
      ready: null,
    })
  })

  it('is null for a nightly rule or an unreadable block', () => {
    expect(ruleInstantOf(undefined)).toBeNull()
    expect(ruleInstantOf('recA')).toBeNull()
    expect(ruleInstantOf({ listing: 'No row' })).toBeNull()
    expect(ruleInstantOf([{ from: 'recA' }])).toBeNull()
  })
})

describe('rulePublicOf', () => {
  const edits = [{ file: '~/Comb/listing-policy.md', find: 'a', replace: 'b' }]

  it('reads the wording and what it replaces', () => {
    expect(
      rulePublicOf({ edits, wording: 'New sentence.', was: 'Old.' })
    ).toEqual({
      wording: 'New sentence.',
      was: 'Old.',
    })
    expect(rulePublicOf({ edits, wording: 'New sentence.' })).toEqual({
      wording: 'New sentence.',
      was: null,
    })
  })

  it('counts a block that changes nothing as none', () => {
    expect(rulePublicOf({ edits: [], wording: 'New sentence.' })).toBeNull()
    expect(rulePublicOf({ wording: 'New sentence.' })).toBeNull()
    expect(rulePublicOf({ edits, wording: '  ' })).toBeNull()
    expect(rulePublicOf(null)).toBeNull()
  })
})

describe('publicChoiceOf', () => {
  it('takes only the two choices', () => {
    expect(publicChoiceOf('apply')).toBe('apply')
    expect(publicChoiceOf('internal')).toBe('internal')
    expect(publicChoiceOf('Apply')).toBeNull()
    expect(publicChoiceOf(true)).toBeNull()
    expect(publicChoiceOf(undefined)).toBeNull()
  })
})

describe('ruleToPopUp', () => {
  const none = new Set<string>()

  it('picks a waiting rule that became ready in the last hour', () => {
    const items = [rule('r1', ago(3))]
    expect(ruleToPopUp(items, none, NOW)?.id).toBe('r1')
  })

  it('shows the one ready longest first', () => {
    const items = [rule('newer', ago(2)), rule('older', ago(20))]
    expect(ruleToPopUp(items, none, NOW)?.id).toBe('older')
  })

  it('leaves out a rule he closed', () => {
    const items = [rule('older', ago(20)), rule('newer', ago(2))]
    expect(ruleToPopUp(items, new Set(['older']), NOW)?.id).toBe('newer')
  })

  it('leaves out a rule that is not ready, is too old, or is ready in the future', () => {
    expect(ruleToPopUp([rule('r1', null)], none, NOW)).toBeNull()
    expect(ruleToPopUp([rule('r1', 'soon')], none, NOW)).toBeNull()
    expect(
      ruleToPopUp(
        [rule('r1', new Date(NOW - POP_UP_FOR_MS - 1000).toISOString())],
        none,
        NOW
      )
    ).toBeNull()
    expect(ruleToPopUp([rule('r1', ago(-5))], none, NOW)).toBeNull()
  })

  it('leaves out nightly rules, decided rules and other kinds of item', () => {
    const items = [
      rule('nightly', ago(3), { ruleInstant: null }),
      rule('done', ago(3), { status: 'Applied' }),
      rule('add', ago(3), { type: 'Add' }),
    ]
    expect(ruleToPopUp(items, none, NOW)).toBeNull()
  })

  it('leaves out a rule whose decision is open again', () => {
    const items = [
      rule('r1', ago(3)),
      { id: 'from-r1', type: 'Add', status: 'Pending', ruleInstant: null },
    ]
    expect(ruleToPopUp(items, none, NOW)).toBeNull()
    items[1].status = 'Applied'
    expect(ruleToPopUp(items, none, NOW)?.id).toBe('r1')
  })
})

describe('rememberClosed', () => {
  it('adds the newest at the end, once', () => {
    expect(rememberClosed(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(rememberClosed(['a', 'b'], 'a')).toEqual(['b', 'a'])
  })

  it('keeps only the newest few', () => {
    expect(rememberClosed(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd'])
  })
})
