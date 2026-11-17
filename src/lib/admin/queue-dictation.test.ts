import { describe, expect, it } from 'vitest'
import {
  Downsampler,
  FRAME,
  RATE,
  Recording,
  insertDictated,
  isDictationKey,
  joinWords,
  micProblem,
  quietestCut,
  wavBytes,
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

describe('Downsampler', () => {
  it('turns 48 kHz into 16 kHz, averaging each three samples', () => {
    const d = new Downsampler(48000)
    const out = d.push(Float32Array.from([0, 0.3, 0.6, 1, 1, 1]))
    expect(Array.from(out).map(v => +v.toFixed(3))).toEqual([0.3, 1])
  })

  it('carries a part-filled sample into the next chunk', () => {
    const d = new Downsampler(48000)
    expect(d.push(Float32Array.from([0.3, 0.3])).length).toBe(0)
    expect(Array.from(d.push(Float32Array.from([0.3])))).toEqual([
      Float32Array.from([0.3])[0],
    ])
  })

  it('keeps the right length at 44.1 kHz', () => {
    const d = new Downsampler(44100)
    let n = 0
    for (let i = 0; i < 100; i++) n += d.push(new Float32Array(441)).length
    expect(n).toBe(16000)
  })

  it('leaves 16 kHz as it is', () => {
    const d = new Downsampler(16000)
    expect(d.push(Float32Array.from([0.1, 0.2, 0.3])).length).toBe(3)
  })
})

describe('Recording', () => {
  const ramp = (from: number, n: number) =>
    Float32Array.from({ length: n }, (_, i) => (from + i) / 1e6)

  it('slices across chunks, by sample number from the start', () => {
    const r = new Recording()
    r.push(ramp(0, 100))
    r.push(ramp(100, 100))
    r.push(ramp(200, 100))
    expect(r.end).toBe(300)
    expect(Array.from(r.slice(95, 205))).toEqual(Array.from(ramp(95, 110)))
    expect(r.slice(250).length).toBe(50)
  })

  it('keeps sample numbers after the old audio is let go', () => {
    const r = new Recording()
    r.push(ramp(0, 100))
    r.push(ramp(100, 100))
    r.dropBefore(150)
    // The chunk holding 150 stays; the one before it goes.
    expect(Array.from(r.slice(150, 160))).toEqual(Array.from(ramp(150, 10)))
    expect(r.slice(0, 100).length).toBe(0)
    expect(r.end).toBe(200)
  })

  it('measures each 20 ms frame, across chunks', () => {
    const r = new Recording()
    r.push(new Float32Array(FRAME / 2).fill(0.5))
    r.push(new Float32Array(FRAME / 2).fill(0.5))
    r.push(new Float32Array(FRAME))
    r.push(new Float32Array(10).fill(1)) // not a whole frame yet
    expect(r.levels.map(v => +v.toFixed(3))).toEqual([0.5, 0])
    expect(r.loudest(0)).toBeCloseTo(0.5)
    expect(r.loudest(FRAME)).toBe(0)
  })
})

describe('quietestCut', () => {
  it('finds the pause between words', () => {
    const levels = [
      ...Array(50).fill(0.2),
      ...Array(20).fill(0.001),
      ...Array(50).fill(0.2),
    ]
    const cut = quietestCut(levels, 0, levels.length, 15)
    expect(cut).toBeGreaterThanOrEqual(50)
    expect(cut).toBeLessThan(70)
  })

  it('looks only inside the range it is given', () => {
    const levels = [...Array(20).fill(0), ...Array(100).fill(0.2)]
    levels[90] = 0.01
    const cut = quietestCut(levels, 40, 120, 1)
    expect(cut).toBe(90)
  })

  it('takes the latest of equally quiet spots', () => {
    expect(quietestCut(Array(100).fill(0), 0, 100, 10)).toBe(95)
  })

  it('copes with a range shorter than the window', () => {
    expect(quietestCut(Array(10).fill(0.1), 2, 8, 15)).toBe(5)
  })
})

describe('joinWords', () => {
  it('joins the pieces with one space, skipping empty ones', () => {
    expect(joinWords([' Check the deadline. ', '', 'Then the logo.'])).toBe(
      'Check the deadline. Then the logo.'
    )
    expect(joinWords([])).toBe('')
  })
})

describe('wavBytes', () => {
  it('writes a 16 kHz mono 16-bit WAV', () => {
    const w = wavBytes(Float32Array.from([0, 1, -1, 2]))
    const v = new DataView(w.buffer)
    const text = (at: number) =>
      String.fromCharCode(...Array.from(w.subarray(at, at + 4)))
    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(text(36)).toBe('data')
    expect(v.getUint32(24, true)).toBe(RATE)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(40, true)).toBe(8)
    expect(w.length).toBe(52)
    expect([0, 1, 2, 3].map(i => v.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32768, 32767,
    ])
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
