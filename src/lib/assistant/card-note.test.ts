import { describe, expect, it } from 'vitest'
import { cleanCardNote } from './card-note'

describe('cleanCardNote', () => {
  it('leaves a plain note alone', () => {
    expect(cleanCardNote('Remote, fully entry-level')).toBe(
      'Remote, fully entry-level'
    )
  })

  it('drops a stray closing curly bracket at the end', () => {
    // The real slip: [[card:community:rec…|Dinner discussions open to policy people}]]
    expect(cleanCardNote('Dinner discussions open to policy people}')).toBe(
      'Dinner discussions open to policy people'
    )
  })

  it('drops stray brackets and spaces at either end', () => {
    expect(cleanCardNote(' {Weekly reading group ] ')).toBe(
      'Weekly reading group'
    )
    expect(cleanCardNote('[Funded fellowship')).toBe('Funded fellowship')
    expect(cleanCardNote('} Online only {')).toBe('Online only')
    expect(cleanCardNote('Monthly socials}]')).toBe('Monthly socials')
  })

  it('keeps brackets that form a pair inside the note', () => {
    expect(cleanCardNote('Weekly meetups [online]')).toBe(
      'Weekly meetups [online]'
    )
    expect(cleanCardNote('{Remote} research role')).toBe(
      '{Remote} research role'
    )
  })

  it('drops only the extra bracket when a pair is followed by a stray one', () => {
    expect(cleanCardNote('Weekly meetups [online]]')).toBe(
      'Weekly meetups [online]'
    )
  })

  it('still flattens a Markdown link to its label', () => {
    expect(
      cleanCardNote(
        'No link of its own, find it on [Communities](/communities)'
      )
    ).toBe('No link of its own, find it on Communities')
  })

  it('returns an empty string when only brackets and spaces are left', () => {
    expect(cleanCardNote(' }] ')).toBe('')
    expect(cleanCardNote('')).toBe('')
  })
})
