import { describe, expect, it } from 'vitest'
import {
  insertDictated,
  isDictationKey,
  micProblem,
  recordingType,
} from './queue-dictation'

describe('insertDictated', () => {
  it('fills an empty box', () => {
    expect(insertDictated('', 0, 0, 'Shorten it.')).toEqual({
      text: 'Shorten it.',
      caret: 11,
    })
  })

  it('adds a space after what was typed', () => {
    expect(insertDictated('Hi Fable,', 9, 9, 'shorten it.')).toEqual({
      text: 'Hi Fable, shorten it.',
      caret: 21,
    })
  })

  it('keeps a space that is already there', () => {
    expect(insertDictated('Hi Fable, ', 10, 10, 'shorten it.').text).toBe(
      'Hi Fable, shorten it.'
    )
  })

  it('goes in at the caret, spaced on both sides', () => {
    const r = insertDictated('Check the deadline.', 9, 9, 'new')
    expect(r.text).toBe('Check the new deadline.')
    expect(r.caret).toBe(13)
  })

  it('replaces a selection', () => {
    expect(insertDictated('Use the old name.', 8, 11, 'new').text).toBe(
      'Use the new name.'
    )
  })

  it('clamps a caret past the end', () => {
    expect(insertDictated('Hi', 40, 50, 'there').text).toBe('Hi there')
  })
})

describe('isDictationKey', () => {
  const key = (k: Partial<KeyboardEvent>) => ({
    key: 'd',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...k,
  })

  it('is Cmd+D on a Mac', () => {
    expect(isDictationKey(key({ metaKey: true }), true)).toBe(true)
    expect(isDictationKey(key({ metaKey: true, key: 'D' }), true)).toBe(true)
  })

  it('leaves Ctrl+D to the text box on a Mac', () => {
    expect(isDictationKey(key({ ctrlKey: true }), true)).toBe(false)
  })

  it('is Ctrl+D elsewhere', () => {
    expect(isDictationKey(key({ ctrlKey: true }), false)).toBe(true)
    expect(isDictationKey(key({ metaKey: true }), false)).toBe(false)
  })

  it('ignores Shift, Alt, and plain D', () => {
    expect(isDictationKey(key({ metaKey: true, shiftKey: true }), true)).toBe(
      false
    )
    expect(isDictationKey(key({ metaKey: true, altKey: true }), true)).toBe(
      false
    )
    expect(isDictationKey(key({}), true)).toBe(false)
  })
})

describe('recordingType', () => {
  it('prefers Opus in WebM', () => {
    expect(recordingType(() => true)).toBe('audio/webm;codecs=opus')
  })

  it('falls back to MP4 (Safari)', () => {
    expect(recordingType(t => t === 'audio/mp4')).toBe('audio/mp4')
  })

  it('leaves it to the browser when it offers none of them', () => {
    expect(recordingType(() => false)).toBe('')
  })
})

describe('micProblem', () => {
  it('says how to unblock a refused microphone', () => {
    expect(micProblem('NotAllowedError')).toMatch(/Allow it for this site/)
  })

  it('has a plain fallback', () => {
    expect(micProblem('AbortError')).toBe('The microphone could not start.')
  })
})
