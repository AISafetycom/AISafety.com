import { describe, expect, it } from 'vitest'
import {
  historyOf,
  lineText,
  namesItself,
  rowLines,
  withEntry,
  type HistoryEntry,
  type HistoryRow,
} from './queue-history'

// The History lines "Bryce checks first" adds (queue-suggest.ts): a
// suggestion, taking one back or dismissing it, a question and its answer,
// and a decision that keeps the suggester's name beside the decider's.

const AT = '2026-11-30T03:00:00.000Z'
const LATER = '2026-11-30T05:00:00.000Z'

function row(history: HistoryEntry[], over: Partial<HistoryRow> = {}) {
  return {
    id: 'rec00000000000001',
    type: 'Add' as const,
    source: 'Comb',
    status: 'Pending',
    decidedAt: null,
    declined: false,
    reviewAgainOn: null,
    history,
    written: [],
    proposed: [],
    ...over,
  }
}

const text = (h: HistoryEntry[], over: Partial<HistoryRow> = {}) =>
  rowLines(row(h, over)).map(lineText)

describe('history lines for suggestions and questions', () => {
  it('keeps the new kinds, with who suggested what', () => {
    const stored = withEntry([], {
      at: AT,
      by: 'Rob Grayson',
      did: 'suggest',
      suggested: { by: 'Rob Grayson', did: 'accept' },
    })
    expect(historyOf(stored)).toEqual([
      {
        at: AT,
        by: 'Rob Grayson',
        did: 'suggest',
        suggested: { by: 'Rob Grayson', did: 'accept' },
      },
    ])
    // Something it does not know is left off, not guessed at.
    expect(
      historyOf([
        { at: AT, by: 'x', did: 'accept', suggested: { did: 'publish' } },
      ])
    ).toEqual([{ at: AT, by: 'x', did: 'accept' }])
  })

  it('reads "Rob suggested Publish", naming the author in the words', () => {
    const h: HistoryEntry[] = [
      {
        at: AT,
        by: 'Rob Grayson',
        did: 'suggest',
        suggested: { by: 'Rob Grayson', did: 'accept' },
      },
    ]
    expect(text(h)).toEqual(['Rob suggested Publish'])
    expect(namesItself(h[0])).toBe(true)
    expect(
      text(
        [
          {
            at: AT,
            by: 'Rob Grayson',
            did: 'suggest',
            suggested: { by: 'Rob Grayson', did: 'later' },
          },
        ],
        { type: 'Change' }
      )
    ).toEqual(['Rob suggested Review again in a week'])
  })

  it('keeps both names on a decision that confirmed or overrode one', () => {
    const decided = { status: 'Applied', decidedAt: LATER }
    const confirm: HistoryEntry = {
      at: LATER,
      by: 'Bryce',
      did: 'accept',
      suggested: { by: 'Rob Grayson', did: 'accept' },
    }
    expect(text([confirm], decided)).toEqual(['Published · suggested by Rob'])
    expect(namesItself(confirm)).toBe(false)
    expect(
      text([{ ...confirm, did: 'reject' }], {
        status: 'Rejected',
        decidedAt: LATER,
      })
    ).toEqual(['Rejected · Rob suggested Publish'])
    expect(
      text(
        [{ ...confirm, suggested: { by: 'Rob Grayson', did: 'ask' } }],
        decided
      )
    ).toEqual(['Published · Rob had asked'])
  })

  it('tells taking a suggestion back from dismissing someone else’s', () => {
    const s = { by: 'Rob Grayson', did: 'reject' as const }
    expect(
      text([{ at: AT, by: 'Rob Grayson', did: 'withdraw', suggested: s }])
    ).toEqual(['Took back the suggestion (Reject)'])
    expect(
      text([{ at: AT, by: 'Bryce', did: 'withdraw', suggested: s }])
    ).toEqual(["Dismissed Rob's suggestion (Reject)"])
    expect(
      text([
        {
          at: AT,
          by: 'Rob Grayson',
          did: 'withdraw',
          suggested: { by: 'Rob Grayson', did: 'ask' },
        },
      ])
    ).toEqual(['Took back the question'])
  })

  it('reads a question and its answer', () => {
    expect(
      text([
        { at: AT, by: 'Rob Grayson', did: 'ask' },
        {
          at: LATER,
          by: 'Bryce',
          did: 'answer',
          suggested: { by: 'Rob Grayson', did: 'ask' },
        },
      ])
    ).toEqual(['Rob asked a question', "Answered Rob's question"])
  })
})
