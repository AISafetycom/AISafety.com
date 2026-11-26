import { describe, expect, it } from 'vitest'
import {
  dictationErrorMessage,
  joinDictation,
  spokenText,
  type SpokenPhrases,
} from './dictation'

/** The browser's result list, built from plain strings. */
function phrases(...spoken: string[]): SpokenPhrases {
  const list: SpokenPhrases = { length: spoken.length }
  spoken.forEach((transcript, i) => {
    list[i] = { length: 1, 0: { transcript } }
  })
  return list
}

describe('spokenText', () => {
  it('joins the phrases heard so far into one line', () => {
    expect(spokenText(phrases('I work in ', ' machine learning', ' and'))).toBe(
      'I work in machine learning and'
    )
  })

  it('is empty before anything is heard', () => {
    expect(spokenText(phrases())).toBe('')
    expect(spokenText({ length: 1, 0: { length: 0 } })).toBe('')
  })
})

describe('joinDictation', () => {
  it('puts the spoken words after what was typed, one space between', () => {
    expect(joinDictation('Hi there.', 'any jobs in Berlin')).toBe(
      'Hi there. any jobs in Berlin'
    )
  })

  it('adds no second space after text that already ends in one', () => {
    expect(joinDictation('Hi there. ', 'any jobs')).toBe('Hi there. any jobs')
    expect(joinDictation('Line one\n', 'line two')).toBe('Line one\nline two')
  })

  it('is just the spoken words in an empty box', () => {
    expect(joinDictation('', 'any jobs')).toBe('any jobs')
  })

  it('leaves the box alone until something is heard', () => {
    expect(joinDictation('Hi there.', '')).toBe('Hi there.')
  })
})

describe('dictationErrorMessage', () => {
  it('says nothing for silence or the visitor stopping it', () => {
    expect(dictationErrorMessage('no-speech')).toBeNull()
    expect(dictationErrorMessage('aborted')).toBeNull()
  })

  it('explains a blocked microphone', () => {
    expect(dictationErrorMessage('not-allowed')).toContain('blocked')
    expect(dictationErrorMessage('service-not-allowed')).toContain('blocked')
  })

  it('has a message for any other code', () => {
    expect(dictationErrorMessage('network')).toContain('speech service')
    expect(dictationErrorMessage('something-new')).toContain('unexpectedly')
  })
})
