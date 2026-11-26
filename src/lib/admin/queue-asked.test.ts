import { describe, expect, it } from 'vitest'
import {
  WAIT_DAYS,
  answeredReview,
  askedOf,
  askedState,
  elsewhereOf,
  latestAsked,
  reviewStage,
  waitEnds,
  type Asked,
} from './queue-asked'

const SAVED = '2026-11-16T10:50:00Z'
const SENT = '2026-11-16T10:56:44Z'
const DAY = 24 * 60 * 60 * 1000

function asked(over: Partial<Asked> = {}): Asked {
  return {
    at: SAVED,
    text: 'To what extent does the group address x-risk?',
    to: 'group@example.org',
    sentAt: null,
    sentLink: null,
    answer: null,
    elsewhere: false,
    ...over,
  }
}

const item = (a: Asked | null, over: Record<string, unknown> = {}) => ({
  status: 'Pending',
  asked: a,
  passed: null,
  alreadyReplied: null,
  ...over,
})

describe('askedOf', () => {
  it('reads a question still in drafts', () => {
    expect(
      askedOf({ at: SAVED, draft: 'r1', text: ' Q? ', to: 'group@example.org' })
    ).toEqual(asked({ text: 'Q?' }))
  })

  it('reads the sent question and their answer', () => {
    const got = askedOf({
      at: SAVED,
      text: 'Q?',
      to: 'group@example.org',
      sent: { at: SENT, link: 'https://mail.google.com/mail/#all/q1' },
      answer: {
        at: '2026-11-17T08:00:00Z',
        from: 'group@example.org',
        name: 'Yarne',
        text: 'One of three themes.',
        link: 'https://mail.google.com/mail/#all/a1',
        reviewed: '2026-11-17T08:06:00Z',
      },
    })
    expect(got?.sentAt).toBe(SENT)
    expect(got?.sentLink).toBe('https://mail.google.com/mail/#all/q1')
    expect(got?.answer).toEqual({
      at: '2026-11-17T08:00:00Z',
      who: 'Yarne',
      text: 'One of three themes.',
      link: 'https://mail.google.com/mail/#all/a1',
      reviewed: true,
      reviewedAt: '2026-11-17T08:06:00Z',
      review: null,
    })
  })

  it('names them by address when the email gave no name', () => {
    const got = askedOf({
      at: SAVED,
      answer: { from: 'group@example.org', name: '', text: 'Yes.' },
    })
    expect(got?.answer?.who).toBe('group@example.org')
    expect(got?.answer?.reviewed).toBe(false)
  })

  it('keeps only Gmail links', () => {
    const got = askedOf({
      at: SAVED,
      sent: { at: SENT, link: 'https://evil.example/x' },
      answer: { text: 'Hi', link: 'javascript:alert(1)' },
    })
    expect(got?.sentLink).toBeNull()
    expect(got?.answer?.link).toBeNull()
  })

  it('reads the review before their answer and the one with it', () => {
    const got = askedOf({
      at: SAVED,
      answer: {
        text: 'About 60%.',
        reviewed: '2026-11-25T07:03:06Z',
        review: {
          before: { verdict: 'Unsure', reasons: [' Waiting on them '] },
          after: {
            verdict: 'Publish',
            reasons: ['Their answer settles it.'],
            chips: ['Not focused on AI x-risk'],
          },
        },
      },
    })
    expect(got?.answer?.reviewedAt).toBe('2026-11-25T07:03:06Z')
    expect(got?.answer?.review).toEqual({
      before: { verdict: 'Unsure', reasons: ['Waiting on them'], chips: null },
      after: {
        verdict: 'Publish',
        reasons: ['Their answer settles it.'],
        chips: ['Not focused on AI x-risk'],
      },
    })
  })

  it('drops a kept review that is not a whole pair', () => {
    const read = (review: unknown) =>
      askedOf({ at: SAVED, answer: { text: 'Yes', review } })?.answer?.review
    const after = { verdict: 'Publish', reasons: ['Fine.'] }
    expect(read({ after })).toBeNull()
    expect(read({ before: { verdict: 'Maybe', reasons: ['x'] }, after })).toBe(
      null
    )
    expect(read({ before: { verdict: 'Unsure', reasons: [] }, after })).toBe(
      null
    )
    expect(read({ before: { verdict: 'Unsure', reasons: [3] }, after })).toBe(
      null
    )
    expect(read('both')).toBeNull()
  })

  it('is null without a readable time, or for anything but a block', () => {
    expect(askedOf({ text: 'Q?' })).toBeNull()
    expect(askedOf({ at: 'soon', text: 'Q?' })).toBeNull()
    expect(askedOf(null)).toBeNull()
    expect(askedOf('asked')).toBeNull()
    expect(askedOf([])).toBeNull()
  })

  it('takes a sent block with a bad time as not sent', () => {
    expect(askedOf({ at: SAVED, sent: { at: 'x' } })?.sentAt).toBeNull()
  })
})

describe('askedState', () => {
  const sentAt = Date.parse(SENT)

  it('has no state without a question', () => {
    expect(askedState(item(null), sentAt)).toBeNull()
  })

  it('is a draft until it is sent', () => {
    expect(askedState(item(asked()), sentAt)).toBe('draft')
  })

  it('waits for two weeks once sent, then comes back silent', () => {
    const a = asked({ sentAt: SENT })
    expect(askedState(item(a), sentAt + 1000)).toBe('waiting')
    expect(askedState(item(a), sentAt + WAIT_DAYS * DAY - 1)).toBe('waiting')
    expect(askedState(item(a), sentAt + WAIT_DAYS * DAY)).toBe('silent')
  })

  it('is answered whenever they have answered, however late', () => {
    const a = asked({
      sentAt: SENT,
      answer: {
        at: null,
        who: 'Yarne',
        text: 'Yes',
        link: null,
        reviewed: false,
        reviewedAt: null,
        review: null,
      },
    })
    expect(askedState(item(a), sentAt + 60 * DAY)).toBe('answered')
  })

  it('is settled once he has replied to their answer', () => {
    const a = asked({
      sentAt: SENT,
      answer: {
        at: null,
        who: 'Yarne',
        text: 'Yes',
        link: null,
        reviewed: false,
        reviewedAt: null,
        review: null,
      },
    })
    expect(
      askedState(
        item(a, { alreadyReplied: { date: '18 November 2026' } }),
        sentAt
      )
    ).toBeNull()
  })

  it('never keeps a passed item waiting', () => {
    const a = asked({ sentAt: SENT })
    expect(
      askedState(
        item(a, { passed: { how: 'ended', on: '2026-11-17' } }),
        sentAt + DAY
      )
    ).toBe('silent')
  })

  it('means nothing on a decided item', () => {
    const a = asked({ sentAt: SENT })
    for (const status of ['Applied', 'Accepted', 'Rejected', 'Closed']) {
      expect(askedState(item(a, { status }), sentAt + DAY)).toBeNull()
    }
    expect(askedState(item(a, { status: 'Failed' }), sentAt + DAY)).toBe(
      'waiting'
    )
  })
})

describe('waitEnds', () => {
  it('is two weeks after it was sent', () => {
    expect(waitEnds(asked({ sentAt: SENT }))).toBe('2026-11-30T10:56:44.000Z')
  })

  it('is null for a draft', () => {
    expect(waitEnds(asked())).toBeNull()
  })
})

describe('reviewStage', () => {
  const answered = (reviewed: boolean) =>
    asked({
      sentAt: SENT,
      answer: {
        at: '2026-11-17T08:00:00Z',
        who: 'Yarne',
        text: 'Yes',
        link: null,
        reviewed,
        reviewedAt: reviewed ? '2026-11-17T08:06:00Z' : null,
        review: null,
      },
    })
  const at = Date.parse('2026-11-17T08:00:00Z')

  it('is done once Fable has reviewed it again', () => {
    expect(reviewStage({ type: 'Add', asked: answered(true) }, at + DAY)).toBe(
      'done'
    )
  })

  it('is running for the first hour, then goes quiet', () => {
    const item = { type: 'Add', asked: answered(false) }
    expect(reviewStage(item, at + 5 * 60 * 1000)).toBe('running')
    expect(reviewStage(item, at + 61 * 60 * 1000)).toBeNull()
  })

  it('is only for an addition with an answer', () => {
    expect(
      reviewStage({ type: 'Change', asked: answered(true) }, at)
    ).toBeNull()
    expect(
      reviewStage({ type: 'Add', asked: asked({ sentAt: SENT }) }, at)
    ).toBeNull()
    expect(reviewStage({ type: 'Add', asked: null }, at)).toBeNull()
  })
})

describe('answeredReview', () => {
  const before = { verdict: 'Unsure' as const, reasons: ['Ask'], chips: null }
  const after = { verdict: 'Publish' as const, reasons: ['Fine'], chips: null }
  const answered = (over: Record<string, unknown>) =>
    asked({
      sentAt: SENT,
      answer: {
        at: '2026-11-17T08:00:00Z',
        who: 'Yarne',
        text: 'Yes',
        link: null,
        reviewed: true,
        reviewedAt: '2026-11-17T08:06:00Z',
        review: { before, after },
        ...over,
      },
    })

  it('gives both reviews once Fable has reviewed it again', () => {
    expect(answeredReview({ type: 'Add', asked: answered({}) })).toEqual({
      at: '2026-11-17T08:06:00Z',
      who: 'Yarne',
      before,
      after,
    })
  })

  it('is null before the review, without the kept pair, or on a change', () => {
    expect(
      answeredReview({ type: 'Add', asked: answered({ reviewed: false }) })
    ).toBeNull()
    expect(
      answeredReview({ type: 'Add', asked: answered({ review: null }) })
    ).toBeNull()
    expect(answeredReview({ type: 'Change', asked: answered({}) })).toBeNull()
    expect(answeredReview({ type: 'Add', asked: null })).toBeNull()
  })
})

// Asked outside email (Bryce, 26 Nov 2026, Common Ground: AI Safety,
// translated: he messaged the host on Luma, and the item stayed in the list).
const LUMA = '2026-11-26T09:30:00Z'

describe('elsewhereOf', () => {
  it('reads a question asked outside email as sent, with no Gmail link', () => {
    expect(
      elsewhereOf({ at: LUMA, text: ' Whether it covers x-risk ', by: 'Bryce' })
    ).toEqual({
      at: LUMA,
      text: 'Whether it covers x-risk',
      to: null,
      sentAt: LUMA,
      sentLink: null,
      answer: null,
      elsewhere: true,
    })
  })

  it('reads the answer he pasted into the chat', () => {
    const got = elsewhereOf({
      at: LUMA,
      text: '',
      answer: { at: '2026-11-28T08:00:00Z', text: 'Yes, loss of control.' },
    })
    expect(got?.answer).toEqual({
      at: '2026-11-28T08:00:00Z',
      who: null,
      text: 'Yes, loss of control.',
      link: null,
      reviewed: false,
      reviewedAt: null,
      review: null,
    })
  })

  it('is null without a readable time', () => {
    expect(elsewhereOf({ text: 'x' })).toBeNull()
    expect(elsewhereOf('x')).toBeNull()
    expect(elsewhereOf(null)).toBeNull()
  })
})

describe('latestAsked', () => {
  const emailed = asked({ sentAt: SENT })
  const outside = elsewhereOf({ at: LUMA, text: 'x' }) as Asked

  it('takes whichever question is later', () => {
    expect(latestAsked(emailed, outside)).toBe(outside)
    const older = elsewhereOf({ at: '2026-11-01T00:00:00Z' }) as Asked
    expect(latestAsked(emailed, older)).toBe(emailed)
  })

  it('takes the one there is', () => {
    expect(latestAsked(null, outside)).toBe(outside)
    expect(latestAsked(emailed, null)).toBe(emailed)
    expect(latestAsked(null, null)).toBeNull()
  })
})

describe('the wait for an addition with a date', () => {
  const outside = elsewhereOf({ at: LUMA, text: 'x' }) as Asked
  const now = Date.parse(LUMA)

  it('comes back once its date would make it urgent', () => {
    // The event and its deadline are on 8 Dec: back on 4 Dec, not 10 Dec.
    const dates = { start: '2026-12-08', closes: '2026-12-08' }
    expect(waitEnds(outside, dates)).toBe('2026-12-04T00:00:00.000Z')
    const it = { ...item(outside), dates }
    expect(askedState(it, Date.parse('2026-12-03T23:00:00Z'))).toBe('waiting')
    expect(askedState(it, Date.parse('2026-12-04T00:00:00Z'))).toBe('silent')
  })

  it('takes the sooner of the start date and the deadline', () => {
    expect(
      waitEnds(outside, { start: '2026-12-20', closes: '2026-12-05' })
    ).toBe('2026-12-01T00:00:00.000Z')
  })

  it('still waits two weeks when the date is further off', () => {
    expect(waitEnds(outside, { start: '2027-02-01' })).toBe(
      new Date(now + WAIT_DAYS * DAY).toISOString()
    )
  })

  it('waits at least a day when the date is very near', () => {
    expect(waitEnds(outside, { start: '2026-11-28' })).toBe(
      new Date(now + DAY).toISOString()
    )
  })

  it('ignores a date already gone or unreadable', () => {
    const twoWeeks = new Date(now + WAIT_DAYS * DAY).toISOString()
    expect(waitEnds(outside, { start: '2026-11-20' })).toBe(twoWeeks)
    expect(waitEnds(outside, { start: 'soon', closes: null })).toBe(twoWeeks)
    expect(waitEnds(outside, {})).toBe(twoWeeks)
  })

  it('brings an emailed question back early too', () => {
    const emailed = asked({ sentAt: LUMA })
    expect(waitEnds(emailed, { start: '2026-12-08' })).toBe(
      '2026-12-04T00:00:00.000Z'
    )
  })
})

describe('an answer pasted into the chat', () => {
  it('is answered, with no second review announced', () => {
    const a = elsewhereOf({
      at: LUMA,
      answer: { at: '2026-11-28T08:00:00Z', text: 'Yes' },
    })
    expect(askedState(item(a), Date.parse('2026-11-28T09:00:00Z'))).toBe(
      'answered'
    )
    expect(
      reviewStage({ type: 'Add', asked: a }, Date.parse('2026-11-28T08:10:00Z'))
    ).toBeNull()
  })
})
