import { describe, expect, it } from 'vitest'
import {
  QUEUE_ONLY_LINK,
  queueItemHref,
  queueOnlyLead,
  queueOnlyOf,
  queueOnlyText,
} from './newsletter-queue-only'
import type { ForBryce } from './queue-suggest'

const AT = '2026-11-28T03:00:00.000Z'
const PRINT = {
  verdict: 'a',
  changes: 'b',
  target: 'c',
  edits: 'd',
  reply: 'e',
}
const suggestion: ForBryce = {
  kind: 'suggest',
  by: 'Rob Grayson',
  at: AT,
  did: 'accept',
  reason: null,
  rejectReply: null,
  keep: [],
  publicChoice: null,
  edited: [],
  print: PRINT,
  asked: null,
}
const question = (answer: string | null): ForBryce => ({
  kind: 'ask',
  by: 'Rob Grayson',
  at: AT,
  question: 'Is this the right date?',
  answer,
  answeredBy: answer ? 'Bryce' : null,
  answeredAt: answer ? AT : null,
})

describe('which Broom items the newsletter’s Fix leaves to the Queue', () => {
  it('applies a row that holds Broom’s changes and nothing else', () => {
    expect(queueOnlyOf({})).toBeNull()
    expect(
      queueOnlyOf({ edits: null, leftOut: null, forBryce: null })
    ).toBeNull()
    expect(queueOnlyOf({ edits: {}, leftOut: [] })).toBeNull()
  })

  it('leaves one with edits saved in the Queue', () => {
    // A value typed over Broom's, or another field added.
    expect(queueOnlyOf({ edits: { Deadline: '2026-12-12' } })).toBe('edits')
    // A value cleared is an edit too.
    expect(queueOnlyOf({ edits: { Deadline: null } })).toBe('edits')
    // A proposed field left out with the cross.
    expect(queueOnlyOf({ edits: {}, leftOut: ['Deadline'] })).toBe('edits')
  })

  it('leaves one a teammate’s suggestion or open question waits on', () => {
    expect(queueOnlyOf({ forBryce: suggestion })).toBe('suggestion')
    expect(queueOnlyOf({ forBryce: question(null) })).toBe('question')
    // Who waits comes first: a suggestion usually brought the edits.
    expect(
      queueOnlyOf({ forBryce: suggestion, edits: { Deadline: '2026-12-12' } })
    ).toBe('suggestion')
  })

  it('applies one whose question was answered, which waits on nobody', () => {
    expect(queueOnlyOf({ forBryce: question('Yes.') })).toBeNull()
    // Unless edits were saved on it as well.
    expect(
      queueOnlyOf({ forBryce: question('Yes.'), edits: { Name: 'x' } })
    ).toBe('edits')
  })
})

describe('how it is said', () => {
  it('says why, and that the Queue is where it is decided', () => {
    expect(queueOnlyText('edits')).toBe(
      'This item has edits saved in the Queue, so it’s decided there: open it in the Queue.'
    )
    expect(queueOnlyText('suggestion')).toBe(
      'This item has a suggestion waiting in the Queue, so it’s decided there: open it in the Queue.'
    )
    expect(queueOnlyText('question')).toBe(
      'This item has a question waiting in the Queue, so it’s decided there: open it in the Queue.'
    )
  })

  it('splits into the words and the link the panel draws', () => {
    for (const why of ['edits', 'suggestion', 'question'] as const)
      expect(`${queueOnlyLead(why)}: ${QUEUE_ONLY_LINK}.`).toBe(
        queueOnlyText(why)
      )
  })

  it('links to the item on the Queue page', () => {
    expect(queueItemHref('recBROOMROW000001')).toBe(
      '/admin/queue#recBROOMROW000001'
    )
  })
})
