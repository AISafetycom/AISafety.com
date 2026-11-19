// Dictation in the Queue's Fable chat (Bryce, 5 Nov 2026: "For Queue Fable
// chat, can we add dictation using Command D, just like in the normal
// Claude Code app?"). The page records in the browser; the Mac agent turns
// the recording into words (~/Queue/dictate.py, whisper.cpp) and the words
// land in the chat box. These are the pure parts, kept apart for the tests.

/** Where the words go: at the caret (or over a selection), with a space
 *  either side when the text there has none. Returns the new text and where
 *  the caret goes, right after the words. */
export function insertDictated(
  text: string,
  start: number,
  end: number,
  words: string
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  const before = text.slice(0, from)
  const after = text.slice(to)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^\s/.test(after) ? ' ' : ''
  return {
    text: before + lead + words + trail + after,
    caret: before.length + lead.length + words.length,
  }
}

/** Why the microphone did not start, in words for the chat panel. */
export function micProblem(name: string): string {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The browser blocked the microphone. Allow it for this site (the icon at the right of the address bar), then try again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone found.'
    case 'NotReadableError':
      return 'The microphone is busy in another app.'
    default:
      return 'The microphone could not start.'
  }
}

// Words as he speaks (17 Nov 2026, Bryce: "make the dictation feature in Q
// show the text as I'm speaking, just like Claude Code does"). The page keeps
// the recording as plain 16 kHz samples, the rate the Mac's model reads, and
// about once a second sends what he has said so far; the words on screen
// catch up each time, though only with words that have stopped changing
// (`settledWords`, 19 Nov 2026). A long dictation is cut into pieces at a pause, so no
// one call gets slow: a piece's words are kept once it is cut, and only the
// open piece is sent again.

/** The rate the Mac's Whisper model reads. */
export const RATE = 16000
/** Loudness is measured over 20 ms frames. */
export const FRAME = RATE / 50

/** Mic audio at the browser's rate (44.1 or 48 kHz) down to 16 kHz, a chunk
 *  at a time: each new sample is the mean of the ones it stands for, which
 *  keeps speech clear. */
export class Downsampler {
  private readonly step: number
  /** Input samples seen, and where the current output sample ends. */
  private seen = 0
  private next: number
  private sum = 0
  private n = 0

  constructor(from: number, to = RATE) {
    this.step = Math.max(1, from / to)
    this.next = this.step
  }

  push(input: Float32Array): Float32Array {
    const out = new Float32Array(Math.ceil(input.length / this.step) + 1)
    let k = 0
    for (const v of input) {
      this.sum += v
      this.n++
      this.seen++
      if (this.seen >= this.next) {
        out[k++] = this.sum / this.n
        this.sum = 0
        this.n = 0
        this.next += this.step
      }
    }
    return out.slice(0, k)
  }
}

/** The recording at 16 kHz, with how loud each 20 ms frame was. Sample and
 *  frame numbers count from the start; audio before a cut can be let go. */
export class Recording {
  private chunks: Float32Array[] = []
  /** Sample number of chunks[0][0]. */
  private first = 0
  /** Samples so far. */
  end = 0
  /** Loudness (RMS, 0–1) of each whole frame so far. */
  readonly levels: number[] = []
  private frameSum = 0
  private frameN = 0

  push(samples: Float32Array) {
    if (!samples.length) return
    this.chunks.push(samples)
    this.end += samples.length
    for (const v of samples) {
      this.frameSum += v * v
      if (++this.frameN === FRAME) {
        this.levels.push(Math.sqrt(this.frameSum / FRAME))
        this.frameSum = 0
        this.frameN = 0
      }
    }
  }

  /** Samples from..to (still held). */
  slice(from: number, to = this.end): Float32Array {
    const a = Math.max(from, this.first)
    const b = Math.min(to, this.end)
    const out = new Float32Array(Math.max(0, b - a))
    let at = this.first
    let k = 0
    for (const c of this.chunks) {
      const cEnd = at + c.length
      if (cEnd > a && at < b) {
        const s = Math.max(a, at) - at
        const e = Math.min(b, cEnd) - at
        out.set(c.subarray(s, e), k)
        k += e - s
      }
      at = cEnd
      if (at >= b) break
    }
    return out
  }

  /** Let go of the audio before `sample` (its words are in). */
  dropBefore(sample: number) {
    while (this.chunks.length && this.first + this.chunks[0].length <= sample) {
      this.first += this.chunks[0].length
      this.chunks.shift()
    }
  }

  /** How many frames from `from` (a sample number) on are at `level` or
   *  louder: how much was said since then. */
  framesAtLeast(from: number, level: number): number {
    let n = 0
    for (
      let f = Math.max(0, Math.floor(from / FRAME));
      f < this.levels.length;
      f++
    )
      if (this.levels[f] >= level) n++
    return n
  }

  /** The loudest frame from..to (sample numbers); 0 when there is none. */
  loudest(from: number, to = this.end): number {
    let max = 0
    const last = Math.min(this.levels.length, Math.ceil(to / FRAME))
    for (let f = Math.max(0, Math.floor(from / FRAME)); f < last; f++)
      if (this.levels[f] > max) max = this.levels[f]
    return max
  }
}

/** Where to cut a long piece: the middle of the quietest `width` frames
 *  between frames `from` and `to` – a pause between words or sentences, so
 *  no word is split. The latest of equally quiet spots, so the piece is as
 *  long as it can be. */
export function quietestCut(
  levels: readonly number[],
  from: number,
  to: number,
  width = 15
): number {
  const a = Math.max(0, Math.floor(from))
  const b = Math.min(levels.length, Math.floor(to))
  if (b - a <= width) return Math.max(a, Math.floor((a + b) / 2))
  let sum = 0
  for (let i = a; i < a + width; i++) sum += levels[i]
  let best = sum
  let at = a
  for (let i = a + width; i < b; i++) {
    sum += levels[i] - levels[i - width]
    if (sum <= best) {
      best = sum
      at = i - width + 1
    }
  }
  return at + Math.floor(width / 2)
}

/** The open piece's words to show (19 Nov 2026, Bryce: "I don't like how
 *  it changes the whole time, because I think at first that it got it
 *  wrong, but then it changes it to correct", and "The quality of the
 *  transcription is priority"). Every guess is still made from the whole
 *  piece, so the words are as good as before; but a new word goes on screen
 *  only once two guesses in a row agree on it, and never while it is the
 *  newest guess's last word (often half-heard, or given a full stop at a
 *  pause). Words on screen are never taken back: new words are added after
 *  them while the guesses still match them (ignoring capitals and
 *  punctuation, and one word heard differently); when the guesses go
 *  another way, the screen waits. `shown` is what is on screen now,
 *  `before` and `now` the last two guesses. */
export function settledWords(
  shown: string,
  before: string,
  now: string
): string {
  const a = wordsOf(before)
  const b = wordsOf(now)
  const s = wordsOf(shown)
  let n = s.length
  while (n < a.length && n < b.length - 1 && a[n] === b[n]) n++
  if (n === s.length) return shown
  if (differences(s, a) > 1 || differences(s, b) > 1) return shown
  const out = [...s, ...b.slice(s.length, n)]
  // The last word's own punctuation was held back from the screen
  // (`onScreen`): now that words follow it, it takes the newest guess's.
  const last = s.length - 1
  if (last >= 0 && bare(s[last]) === bare(b[last])) {
    out[last] =
      s[last].replace(TRAILING, '') + (b[last].match(TRAILING)?.[0] ?? '')
  }
  return out.join(' ')
}

/** Punctuation at the end of a word. */
const TRAILING = /[.,!?;:]+$/

/** The words as the screen shows them while he speaks: the last word's
 *  punctuation waits until the next word comes, because a guess tends to
 *  end on a full stop wherever the audio stops. */
export function onScreen(parts: readonly string[]): string {
  return joinWords(parts).replace(TRAILING, '')
}

/** The final words, put in the box when he stops. Where they differ from
 *  the screen only in capitals or punctuation, the screen's words stay and
 *  the rest is added after them, so nothing he has seen changes for
 *  nothing. Where a word itself differs, the final words win: they are
 *  made from the whole recording, and the quality of the words comes
 *  first. */
export function finalWords(screen: string, final: string): string {
  const sw = wordsOf(screen)
  const fw = wordsOf(final)
  if (!sw.length || sw.length > fw.length) return final
  if (sw.some((w, i) => bare(w) !== bare(fw[i]))) return final
  const last = sw.length - 1
  // The last word on screen may still grow its punctuation (that only adds
  // to the end).
  const end = fw[last].startsWith(sw[last]) ? fw[last] : sw[last]
  return [...sw.slice(0, last), end, ...fw.slice(sw.length)].join(' ')
}

/** Where a piece is cut while words are on screen: the screen keeps what
 *  it shows, as `done` (the cut piece) and `rest` (past the cut, which the
 *  next piece's guesses carry on from). Only when the piece's own words
 *  went another way from the screen (more than one word) do they replace
 *  it. */
export function carryOver(
  screen: string,
  kept: string
): { done: string; rest: string } {
  const sw = wordsOf(screen)
  const kw = wordsOf(kept)
  if (differences(sw, kw) > 1) return { done: kept, rest: '' }
  if (sw.length >= kw.length) {
    return {
      done: sw.slice(0, kw.length).join(' '),
      rest: sw.slice(kw.length).join(' '),
    }
  }
  return { done: [...sw, ...kw.slice(sw.length)].join(' '), rest: '' }
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/** A word without its capitals and punctuation. */
function bare(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** How many of the words both have, side by side, differ. */
function differences(x: readonly string[], y: readonly string[]): number {
  let n = 0
  for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (bare(x[i]) !== bare(y[i])) n++
  return n
}

/** The pieces' words as one text. */
export function joinWords(pieces: readonly string[]): string {
  return pieces
    .map(p => p.trim())
    .filter(Boolean)
    .join(' ')
}

/** 16-bit mono WAV of the samples: what the Mac reads as it is, with no
 *  conversion. */
export function wavBytes(samples: Float32Array, rate = RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

/** Cmd+D on a Mac, Ctrl+D elsewhere: the key that starts and stops it, as
 *  in the Claude app. Ctrl+D on a Mac stays the text box's own
 *  delete-forward. */
export function isDictationKey(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  mac: boolean
): boolean {
  if (e.shiftKey || e.altKey || e.key.toLowerCase() !== 'd') return false
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}
