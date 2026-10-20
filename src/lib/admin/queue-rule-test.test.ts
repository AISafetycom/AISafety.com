import { describe, expect, it } from 'vitest'
import {
  leadSentence,
  ruleTestHeadline,
  ruleTestOf,
  ruleTestShort,
} from './queue-rule-test'

const block = {
  for: 'rule:Comb/review-rules.md:abc123def456',
  at: '2026-10-09T09:48:01Z',
  checked: 50,
  pool: 'your past decisions on /events additions',
  taught: 3,
  counts: { fixes: 2, breaks: 0, keeps: 1, unclear: 1 },
  results: [
    {
      row: 'recKeep',
      title: 'Monitoring AI Risks',
      outcome: 'keeps',
      why: 'Still Don’t publish.',
      taught: false,
    },
    {
      row: 'recFix',
      title: 'La Fresque',
      outcome: 'fixes',
      why: 'Would say Don’t publish, as you did.',
      taught: true,
    },
    {
      row: 'recUnclear',
      title: 'AI 2027 in Spanish',
      outcome: 'unclear',
      why: 'Depends on how many registered.',
      taught: false,
    },
    {
      row: 'recFix2',
      title: 'AI Safety for Italy Meetup',
      outcome: 'fixes',
      why: 'Would name the language.',
      taught: false,
    },
  ],
  summary: 'Safe to accept.',
}

describe('ruleTestOf', () => {
  it('reads the replay block, the most worrying results first', () => {
    const t = ruleTestOf(block)
    expect(t?.checked).toBe(50)
    expect(t?.pool).toBe('your past decisions on /events additions')
    expect(t?.results.map(r => r.row)).toEqual([
      'recUnclear',
      'recFix',
      'recFix2',
      'recKeep',
    ])
    expect(t?.counts).toEqual({ breaks: 0, unclear: 1, fixes: 2, keeps: 1 })
    expect(t?.summary).toBe('Safe to accept.')
  })

  it('drops results it cannot show and counts only what is listed', () => {
    const t = ruleTestOf({
      ...block,
      results: [
        ...block.results,
        { row: 'recBad', title: 'x', outcome: 'maybe', why: 'y' },
        { row: 'recNoWhy', title: 'x', outcome: 'breaks', why: ' ' },
        'not a result',
      ],
    })
    expect(t?.results).toHaveLength(4)
    expect(t?.counts.breaks).toBe(0)
  })

  it('is null for a rule with no test, or a block it cannot read', () => {
    expect(ruleTestOf(undefined)).toBeNull()
    expect(ruleTestOf('tested')).toBeNull()
    expect(ruleTestOf({ ...block, checked: '50' })).toBeNull()
    expect(ruleTestOf({ ...block, pool: '' })).toBeNull()
  })
})

describe('ruleTestHeadline', () => {
  it('says what it fixes and that it never goes against him', () => {
    expect(ruleTestHeadline(ruleTestOf(block)!)).toBe(
      'Tested on 50 of your past decisions on /events additions: it fixes two the bots got wrong and never goes against you; one is unclear.'
    )
  })

  it('leads with going against him when it does', () => {
    const t = ruleTestOf({
      ...block,
      results: [
        { row: 'recA', title: 'A', outcome: 'breaks', why: 'Would hide it.' },
      ],
    })!
    expect(ruleTestHeadline(t)).toBe(
      'Tested on 50 of your past decisions on /events additions: it goes against you on one.'
    )
  })

  it('says so when there was nothing to test on', () => {
    const t = ruleTestOf({ ...block, checked: 0, results: [] })!
    expect(ruleTestHeadline(t)).toBe(
      'There are no past decisions to test it on yet.'
    )
  })
})

describe('ruleTestShort', () => {
  it('says how many and whether it ever goes against him', () => {
    const t = ruleTestOf(block)!
    expect(ruleTestShort(t)).toBe(
      'Tested on 50 past decisions, never against you'
    )
    const against = ruleTestOf({
      ...block,
      results: [{ row: 'recB', title: 'X', outcome: 'breaks', why: 'No.' }],
    })!
    expect(ruleTestShort(against)).toBe('Tested on 50 past decisions')
    expect(ruleTestShort({ ...t, checked: 1 })).toBe(
      'Tested on 1 past decision, never against you'
    )
    expect(ruleTestShort({ ...t, checked: 0 })).toBe(
      'No past decisions to test it on yet'
    )
  })
})

describe('leadSentence', () => {
  it('splits off the first sentence', () => {
    expect(
      leadSentence(
        'The sweep stops flagging dormant funders. It still asks for a paused note. Tightened after its test: more.'
      )
    ).toEqual({
      lead: 'The sweep stops flagging dormant funders.',
      rest: 'It still asks for a paused note. Tightened after its test: more.',
    })
  })

  it('keeps a one-sentence summary whole', () => {
    expect(leadSentence('  Only one sentence here.  ')).toEqual({
      lead: 'Only one sentence here.',
      rest: null,
    })
  })

  it('does not split inside a web address or a number', () => {
    expect(
      leadSentence(
        'It goes on aisafety.com/listing-policy as 2.5 lines. Then more.'
      )
    ).toEqual({
      lead: 'It goes on aisafety.com/listing-policy as 2.5 lines.',
      rest: 'Then more.',
    })
  })
})
