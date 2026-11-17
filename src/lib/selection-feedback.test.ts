import { describe, expect, it } from 'vitest'
import {
  MAX_QUOTE_LENGTH,
  quoteForForm,
  selectionFormLink,
} from './selection-feedback'

const params = (link: string) => new URL(link).searchParams

describe('quoteForForm', () => {
  it('puts the text on one line', () => {
    expect(quoteForForm('  75-minute course\n  covering   alignment ')).toBe(
      '75-minute course covering alignment'
    )
  })

  it('cuts a very long selection at a word boundary', () => {
    const quote = quoteForForm('word '.repeat(300))
    expect(quote.length).toBeLessThanOrEqual(MAX_QUOTE_LENGTH)
    expect(quote.endsWith('word')).toBe(true)
  })
})

describe('selectionFormLink', () => {
  it('opens the corrections form for text on a card, filled in', () => {
    const link = selectionFormLink({
      text: '75-minute course',
      path: '/self-study',
      link: 'https://aisafety.com/self-study#rec123',
      listingName: 'DeepMind AGI Safety Short Course',
    })
    expect(link).toContain('/pagndDvdya1DSqoxN/form?')
    expect(params(link).get('prefill_Resource')).toBe('Self-study')
    expect(params(link).get('prefill_Listing name')).toBe(
      'DeepMind AGI Safety Short Course'
    )
    expect(params(link).get('prefill_Correction')).toBe(
      '"75-minute course"\nhttps://aisafety.com/self-study#rec123\n\n'
    )
  })

  it("picks the recurring choice on Training's recurring view", () => {
    const source = {
      text: 'Weekly',
      path: '/training',
      link: 'https://aisafety.com/training',
      listingName: 'A program',
    }
    expect(params(selectionFormLink(source)).get('prefill_Resource')).toBe(
      'Training programs'
    )
    expect(
      params(selectionFormLink({ ...source, view: 'recurring' })).get(
        'prefill_Resource'
      )
    ).toBe('Recurring training programs')
  })

  it('leaves Resource out on a page the form has no choice for', () => {
    const link = selectionFormLink({
      text: 'Research Engineer',
      path: '/jobs',
      link: 'https://aisafety.com/jobs',
      listingName: 'Research Engineer',
    })
    expect(params(link).has('prefill_Resource')).toBe(false)
  })

  it('opens the feedback form for text that is not on a card', () => {
    const link = selectionFormLink({
      text: 'A directory of resources',
      path: '/',
      link: 'https://aisafety.com/',
    })
    expect(link).toContain('/pageXZp18w3Sqm1Z7/form?')
    expect(params(link).get('prefill_Page')).toBe('home')
    expect(params(link).get('hide_Page')).toBe('true')
    expect(params(link).get('prefill_Feedback')).toBe(
      '"A directory of resources"\nhttps://aisafety.com/\n\n'
    )
  })
})
