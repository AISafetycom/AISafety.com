import { describe, expect, it } from 'vitest'
import {
  dictationErrorMessage,
  dictationShortcutLabel,
  isDictationShortcut,
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

describe('isDictationShortcut', () => {
  const press = (
    key: string,
    mods: Partial<
      Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>
    > = {},
    code = `Key${key.toUpperCase()}`
  ) => ({
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  })

  it('is ⌘D on a Mac', () => {
    expect(isDictationShortcut(press('d', { metaKey: true }), true)).toBe(true)
    expect(isDictationShortcut(press('D', { metaKey: true }), true)).toBe(true)
  })

  it('leaves Ctrl+D alone on a Mac, where it deletes the next letter', () => {
    expect(isDictationShortcut(press('d', { ctrlKey: true }), true)).toBe(false)
  })

  it('is Ctrl+D off a Mac, and not the Windows key with D', () => {
    expect(isDictationShortcut(press('d', { ctrlKey: true }), false)).toBe(true)
    expect(isDictationShortcut(press('d', { metaKey: true }), false)).toBe(
      false
    )
  })

  it('ignores D with Shift or Alt added, and a plain D', () => {
    expect(
      isDictationShortcut(press('d', { metaKey: true, shiftKey: true }), true)
    ).toBe(false)
    expect(
      isDictationShortcut(press('d', { metaKey: true, altKey: true }), true)
    ).toBe(false)
    expect(isDictationShortcut(press('d'), true)).toBe(false)
  })

  it('counts the D key on a keyboard where it types another letter', () => {
    // Russian layout: the D key types в.
    expect(
      isDictationShortcut(press('в', { metaKey: true }, 'KeyD'), true)
    ).toBe(true)
    // But not a Latin letter that merely sits on that key (Dvorak's E).
    expect(
      isDictationShortcut(press('e', { metaKey: true }, 'KeyD'), true)
    ).toBe(false)
  })

  it('is written the way each system writes it', () => {
    expect(dictationShortcutLabel(true)).toBe('⌘D')
    expect(dictationShortcutLabel(false)).toBe('Ctrl+D')
  })
})
