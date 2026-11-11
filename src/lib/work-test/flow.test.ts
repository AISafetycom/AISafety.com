import { describe, expect, it } from 'vitest'
import {
  checkSave,
  isComplete,
  missingKeys,
  stageOf,
  stampFor,
  stateFor,
  type Answer,
  type Candidate,
  type ItemRow,
  type Part,
} from './flow'

const SECRET_REASON = 'OUR-REASON-MARKER'

function item(key: string, part: Part, answerKey = 'Reject'): ItemRow {
  return {
    key,
    part,
    order: Number(key.slice(-2)) || 1,
    name: `Item ${key}`,
    page: '/events',
    link: 'https://example.org',
    decidedOn: '2026-09-24',
    description: 'A description.',
    fields: { Type: 'Talk' },
    source: 'Found by Comb.',
    related: 'None.',
    fableVerdict: 'Publish',
    fableReasons: ['One reason.'],
    prompt: '',
    answerKey,
    ourReason: `${SECRET_REASON} ${key}`,
  }
}

const ITEMS: ItemRow[] = [
  item('B-01', 'Briefing', 'Publish'),
  item('R1-02', 'Round one', 'Publish'),
  item('R1-01', 'Round one'),
  item('R2-01', 'Round two', 'Ask Bryce'),
  item('C-1', 'Change check', 'Apply'),
  item('D-1', 'Description', ''),
  item('M-1', 'Reply', ''),
  item('P-1', 'Push back', ''),
]

const NEW: Candidate = {
  code: 'A',
  startedAt: null,
  roundOneAt: null,
  roundTwoStartedAt: null,
  roundTwoAt: null,
  finishedAt: null,
}
const T = '2026-11-12T00:00:00.000Z'
const ROUND1: Candidate = { ...NEW, startedAt: T }
const REVIEW: Candidate = { ...ROUND1, roundOneAt: T }
const ROUND2: Candidate = { ...REVIEW, roundTwoStartedAt: T }
const PART4: Candidate = { ...ROUND2, roundTwoAt: T }
const DONE: Candidate = { ...PART4, finishedAt: T }

const ANSWERS: Record<string, Answer> = {
  'R1-01': { answer: 'Publish', text: 'Looks on topic.' },
  'R1-02': { answer: 'Publish', text: 'Fine.' },
  'R2-01': { answer: 'Reject', text: 'Out of scope.' },
}

describe('stageOf', () => {
  it('follows the timestamps in order', () => {
    expect(stageOf(NEW)).toBe('intro')
    expect(stageOf(ROUND1)).toBe('round1')
    expect(stageOf(REVIEW)).toBe('review')
    expect(stageOf(ROUND2)).toBe('round2')
    expect(stageOf(PART4)).toBe('part4')
    expect(stageOf(DONE)).toBe('done')
  })
})

describe('stateFor', () => {
  it('shows the briefing and no items before the start', () => {
    const state = stateFor(NEW, ITEMS, {})
    expect(state.items).toEqual([])
    expect(state.briefing.map(b => b.key)).toEqual(['B-01'])
    expect(state.review).toEqual([])
  })

  it('shows round one in order, with no trace of our decisions', () => {
    const state = stateFor(ROUND1, ITEMS, ANSWERS)
    expect(state.items.map(i => i.key)).toEqual(['R1-01', 'R1-02'])
    expect(state.review).toEqual([])
    // Only the briefing may carry our reasons at this stage.
    const sent = JSON.stringify({ items: state.items, answers: state.answers })
    expect(sent).not.toContain(SECRET_REASON)
    expect(sent).not.toContain('answerKey')
    expect(sent).not.toContain('ourReason')
  })

  it('keeps answers from other stages off the page', () => {
    expect(
      Object.keys(stateFor(ROUND1, ITEMS, ANSWERS).answers).sort()
    ).toEqual(['R1-01', 'R1-02'])
  })

  it('reveals round one only once it is submitted', () => {
    const review = stateFor(REVIEW, ITEMS, ANSWERS)
    expect(review.items).toEqual([])
    expect(review.review).toEqual([
      {
        key: 'R1-01',
        name: 'Item R1-01',
        page: '/events',
        yourAnswer: 'Publish',
        yourReason: 'Looks on topic.',
        ourAnswer: 'Reject',
        ourReason: `${SECRET_REASON} R1-01`,
      },
      expect.objectContaining({ key: 'R1-02', ourAnswer: 'Publish' }),
    ])
  })

  it('never reveals round two or part four', () => {
    for (const candidate of [ROUND2, PART4, DONE]) {
      const state = stateFor(candidate, ITEMS, ANSWERS)
      const sent = JSON.stringify({ ...state, briefing: [] })
      expect(sent).not.toContain(`${SECRET_REASON} R2-01`)
      expect(sent).not.toContain(`${SECRET_REASON} C-1`)
      expect(sent).not.toContain('Ask Bryce')
    }
  })

  it('keeps the round one review to hand during round two only', () => {
    expect(stateFor(ROUND2, ITEMS, ANSWERS).review).toHaveLength(2)
    expect(stateFor(PART4, ITEMS, ANSWERS).review).toEqual([])
  })

  it('opens the four last parts together', () => {
    expect(stateFor(PART4, ITEMS, {}).items.map(i => i.key)).toEqual([
      'C-1',
      'D-1',
      'M-1',
      'P-1',
    ])
  })

  it('shows nothing once finished', () => {
    const state = stateFor(DONE, ITEMS, ANSWERS)
    expect(state.items).toEqual([])
    expect(state.briefing).toEqual([])
  })
})

describe('checkSave', () => {
  const r1 = ITEMS.find(i => i.key === 'R1-01')
  const c1 = ITEMS.find(i => i.key === 'C-1')
  const d1 = ITEMS.find(i => i.key === 'D-1')

  it('takes a decision and a reason for an open item', () => {
    expect(checkSave('round1', r1, 'Ask Bryce', 'why')).toEqual({
      ok: true,
      answer: 'Ask Bryce',
      text: 'why',
    })
  })

  it('takes a reason typed before the decision', () => {
    expect(checkSave('round1', r1, '', 'thinking')).toMatchObject({ ok: true })
  })

  it('refuses an item that is not open, so a submitted round is locked', () => {
    expect(checkSave('review', r1, 'Publish', 'x').ok).toBe(false)
    expect(checkSave('round2', r1, 'Publish', 'x').ok).toBe(false)
    expect(checkSave('round1', c1, 'Apply', 'x').ok).toBe(false)
    expect(checkSave('round1', undefined, 'Publish', 'x').ok).toBe(false)
  })

  it('refuses a choice the item does not offer', () => {
    expect(checkSave('round1', r1, 'Apply', 'x').ok).toBe(false)
    expect(checkSave('part4', c1, 'Publish', 'x').ok).toBe(false)
    expect(checkSave('part4', d1, 'Publish', 'x').ok).toBe(false)
    expect(checkSave('part4', c1, 'Apply', 'x').ok).toBe(true)
    expect(checkSave('part4', d1, '', 'A new description.').ok).toBe(true)
  })

  it('refuses text that is too long, and anything that is not text', () => {
    expect(checkSave('round1', r1, 'Publish', 'x'.repeat(4001)).ok).toBe(false)
    expect(checkSave('round1', r1, 'Publish', 5)).toEqual({
      ok: true,
      answer: 'Publish',
      text: '',
    })
  })
})

describe('isComplete and missingKeys', () => {
  it('needs both a decision and a reason on a decision item', () => {
    const r1 = { part: 'Round one' as Part }
    expect(isComplete(r1, undefined)).toBe(false)
    expect(isComplete(r1, { answer: 'Publish', text: '  ' })).toBe(false)
    expect(isComplete(r1, { answer: '', text: 'why' })).toBe(false)
    expect(isComplete(r1, { answer: 'Publish', text: 'why' })).toBe(true)
  })

  it('needs only the text on a writing item', () => {
    expect(isComplete({ part: 'Reply' }, { answer: '', text: 'Hi' })).toBe(true)
    expect(isComplete({ part: 'Reply' }, { answer: '', text: '' })).toBe(false)
  })

  it('lists what a submit is still waiting on, in order', () => {
    expect(missingKeys('round1', ITEMS, {})).toEqual(['R1-01', 'R1-02'])
    expect(missingKeys('round1', ITEMS, ANSWERS)).toEqual([])
    expect(missingKeys('part4', ITEMS, ANSWERS)).toEqual([
      'C-1',
      'D-1',
      'M-1',
      'P-1',
    ])
  })
})

describe('stampFor', () => {
  it('allows each move only at its own stage', () => {
    expect(stampFor('intro', 'start')).toBe('startedAt')
    expect(stampFor('round1', 'submit')).toBe('roundOneAt')
    expect(stampFor('review', 'next')).toBe('roundTwoStartedAt')
    expect(stampFor('round2', 'submit')).toBe('roundTwoAt')
    expect(stampFor('part4', 'submit')).toBe('finishedAt')
    expect(stampFor('round1', 'start')).toBeNull()
    expect(stampFor('review', 'submit')).toBeNull()
    expect(stampFor('done', 'submit')).toBeNull()
    expect(stampFor('intro', 'next')).toBeNull()
  })
})
