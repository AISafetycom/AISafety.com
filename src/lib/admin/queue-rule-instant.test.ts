import { describe, expect, it } from 'vitest'
import {
  mayTeach,
  POP_UP_FOR_MS,
  publicChoiceOf,
  RULE_WATCH_MS,
  ruleDraftStateOf,
  settleRuleWatch,
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

describe('rules at the time of the decision (17 Nov 2026)', () => {
  it('asks the Mac about a Publish or Reject on an addition or a change', () => {
    expect(mayTeach('Add', 'accept')).toBe(true)
    expect(mayTeach('Change', 'reject')).toBe(true)
  })

  it('never about a rule, a Delete or a Review again', () => {
    expect(mayTeach('Rule', 'accept')).toBe(false)
    expect(mayTeach('Add', 'delete')).toBe(false)
    expect(mayTeach('Add', 'later')).toBe(false)
  })

  it('reads anything unknown as still drafting', () => {
    expect(ruleDraftStateOf('rule')).toBe('rule')
    expect(ruleDraftStateOf('nothing')).toBe('nothing')
    expect(ruleDraftStateOf(undefined)).toBe('drafting')
    expect(ruleDraftStateOf('started')).toBe('drafting')
  })

  it('reads the list again for a written rule and stops asking about it', () => {
    const watch = { recA: NOW - 60_000, recB: NOW - 60_000 }
    const out = settleRuleWatch(watch, { recA: 'rule', recB: 'drafting' }, NOW)
    expect(out.written).toEqual(['recA'])
    expect(out.watch).toEqual({ recB: NOW - 60_000 })
  })

  it('lets go of a decision that taught nothing or failed', () => {
    const watch = { recA: NOW, recB: NOW }
    const out = settleRuleWatch(watch, { recA: 'nothing', recB: 'error' }, NOW)
    expect(out).toEqual({ watch: {}, written: [] })
  })

  it('keeps asking while the Mac is unreachable, but not for ever', () => {
    const fresh = { recA: NOW - 60_000 }
    expect(settleRuleWatch(fresh, {}, NOW).watch).toEqual(fresh)
    const old = { recA: NOW - RULE_WATCH_MS - 1 }
    expect(settleRuleWatch(old, {}, NOW).watch).toEqual({})
  })
})
