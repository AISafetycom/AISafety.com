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
  carryOver,
  finalWords,
  onScreen,
  quietestCut,
  settledWords,
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

describe('Recording.framesAtLeast', () => {
  it('counts the loud frames since a point', () => {
    const rec = new Recording()
    const frame = (v: number) => new Float32Array(FRAME).fill(v)
    for (const v of [0.2, 0.2, 0.001, 0.001, 0.2]) rec.push(frame(v))
    expect(rec.framesAtLeast(0, 0.03)).toBe(3)
    expect(rec.framesAtLeast(2 * FRAME, 0.03)).toBe(1)
    expect(rec.framesAtLeast(5 * FRAME, 0.03)).toBe(0)
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

describe('settledWords', () => {
  it('shows nothing from a single guess', () => {
    expect(settledWords('', '', 'Please shorten the description')).toBe('')
  })

  it('shows the words two guesses agree on, but not the newest last word', () => {
    expect(
      settledWords(
        '',
        'Please shorten the description.',
        'Please shorten the description so it'
      )
    ).toBe('Please shorten the')
    expect(settledWords('', 'Please shorten the', 'Please shorten the')).toBe(
      'Please shorten'
    )
  })

  it('holds back a full stop given at a pause', () => {
    const atPause = 'so it fits under the cap.'
    expect(settledWords('so it fits', atPause, atPause)).toBe(
      'so it fits under the'
    )
  })

  it('never takes words back', () => {
    // One word heard differently: it stays as shown, new words follow it.
    expect(
      settledWords(
        'Please shorten the',
        'Please shorten a description so',
        'Please shorten a description so it'
      )
    ).toBe('Please shorten the description so')
    // Capitals and punctuation do not count as a difference (and the last
    // word's comma had been held back, so it takes the newest guess's).
    expect(
      settledWords(
        'Check the Events page,',
        'check the events page and the',
        'check the events page and the map'
      )
    ).toBe('Check the Events page and the')
    // The guesses went another way (words shifted): the screen waits.
    expect(
      settledWords(
        'You can not miss the',
        'You cannot miss the deadline on',
        'You cannot miss the deadline on Friday'
      )
    ).toBe('You can not miss the')
    // Fewer agreed words than are on screen: the screen stays.
    expect(
      settledWords('Please shorten the', 'Please short', 'Please shorten')
    ).toBe('Please shorten the')
  })

  it('grows when the guesses carry on from what is shown', () => {
    expect(
      settledWords(
        'Please shorten the',
        'Please shorten the description so it fits',
        'Please shorten the description so it fits under'
      )
    ).toBe('Please shorten the description so it fits')
  })

  it('only ever grows over a run of guesses', () => {
    const guesses = [
      'Please',
      'Please shorten the.',
      'Please shorten the description.',
      'Please shorten the description so it.',
      'Please shorten the description, so it fits under the cab.',
      'Please shorten the description so it fits under the cap,',
      'Please shorten the description so it fits under the cap, and check.',
    ]
    let shown = ''
    let before = ''
    for (const now of guesses) {
      const next = settledWords(shown, before, now)
      expect(next.startsWith(shown)).toBe(true)
      // The one-off mishearing never reached the screen.
      expect(next).not.toContain('cab')
      shown = next
      before = now
    }
    expect(shown).toBe(
      'Please shorten the description so it fits under the cap,'
    )
  })
})

describe('onScreen', () => {
  it('holds back the last word punctuation', () => {
    expect(onScreen(['Check the deadline.', 'Then the'])).toBe(
      'Check the deadline. Then the'
    )
    expect(onScreen(['Please shorten the description.'])).toBe(
      'Please shorten the description'
    )
    expect(onScreen(['', ''])).toBe('')
  })

  it('takes the next guess punctuation once words follow it', () => {
    // On screen: "Please shorten the description" (its full stop held back).
    expect(
      settledWords(
        'Please shorten the description.',
        'Please shorten the description so it fits',
        'Please shorten the description so it fits under'
      )
    ).toBe('Please shorten the description so it fits')
  })
})

describe('finalWords', () => {
  it('keeps the screen where only capitals or punctuation differ', () => {
    expect(
      finalWords(
        'Please shorten the description so it fits under the cap and',
        'Please shorten the description so it fits under the cap, and check it.'
      )
    ).toBe(
      'Please shorten the description so it fits under the cap and check it.'
    )
  })

  it('lets the last word on screen gain its punctuation', () => {
    expect(finalWords('Check the 4th of', 'Check the 4th of February.')).toBe(
      'Check the 4th of February.'
    )
    expect(finalWords('Thank them', 'Thank them.')).toBe('Thank them.')
  })

  it('takes the final words where a word differs', () => {
    expect(finalWords('fits under the cab', 'fits under the cap.')).toBe(
      'fits under the cap.'
    )
  })

  it('takes the final words when nothing was on screen', () => {
    expect(finalWords('', 'Check it.')).toBe('Check it.')
  })
})

describe('carryOver', () => {
  it('keeps the screen as it is across a cut, past the cut too', () => {
    expect(
      carryOver(
        'Check the Events page. If it is not, trim',
        'Check the events page.'
      )
    ).toEqual({ done: 'Check the Events page.', rest: 'If it is not, trim' })
  })

  it('adds the piece words the screen had not shown yet', () => {
    expect(carryOver('Check the', 'Check the events page.')).toEqual({
      done: 'Check the events page.',
      rest: '',
    })
  })

  it('lets the piece words win when the screen went another way', () => {
    expect(
      carryOver('You can not miss the', 'You cannot miss the deadline.')
    ).toEqual({ done: 'You cannot miss the deadline.', rest: '' })
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
