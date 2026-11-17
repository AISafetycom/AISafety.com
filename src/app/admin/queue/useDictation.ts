'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Downsampler,
  FRAME,
  RATE,
  Recording,
  joinWords,
  micProblem,
  quietestCut,
  wavBytes,
} from '@/lib/admin/queue-dictation'

// Dictation for the Fable chat (5 Nov 2026): Cmd+D or the mic starts a
// recording, Cmd+D again stops it, the Mac turns it into words. Enter while
// it listens stops it and sends the message once the words are in; Esc
// throws the recording away. The reject panel's "Other reason…" box uses it
// too (16 Nov 2026), with Enter there rejecting instead of sending.
//
// Since 17 Nov 2026 (Bryce: "show the text as I'm speaking, just like Claude
// Code does") the words show as he talks: about once a second what he has
// said so far goes to the Mac and `onLive` gets the words back. A long
// dictation is cut at a pause every ~20 s; a cut piece's words are kept and
// only the open piece is sent again, so each call stays quick. And as in
// the Claude app, holding ⌘ after ⌘D is hold-to-talk: letting go puts the
// words in.

export type DictationState = 'off' | 'starting' | 'listening' | 'transcribing'

/** The longest recording; past it the words go in by themselves. */
const MAX_MS = 10 * 60 * 1000
/** The loudest moment of a recording below this (RMS, 0–1) = nothing was
 *  said, so no call to the Mac. */
const SILENCE = 0.01
/** The words on screen catch up at most this often. */
const LIVE_EVERY_MS = 600
/** New audio needed before the words are asked for again. */
const LIVE_NEW_S = 0.3
/** A piece is cut once it is this long, at the quietest spot after
 *  PIECE_MIN_S, so each call to the Mac stays under ~30 s of audio. */
const PIECE_S = 20
const PIECE_MIN_S = 10
/** After a call that failed, wait this long before the next. */
const BACKOFF_MS = 3000
/** ⌘ still down this long after ⌘D started it = hold-to-talk. */
const HOLD_MS = 400

type How = 'stop' | 'send' | 'cancel'

/** Runs on the audio thread: hands the mic's samples over in batches of
 *  2048 (~43 ms). */
const WORKLET = `registerProcessor('queue-mic', class extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf, [this.buf.buffer])
        this.buf = new Float32Array(2048)
        this.n = 0
      }
    }
    return true
  }
})`

interface Callbacks {
  transcribe: (
    audio: Blob,
    how: { context: string; partial: boolean }
  ) => Promise<string>
  onLive?: (words: string) => void
}

interface Live {
  stream: MediaStream
  ctx: AudioContext
  node: AudioWorkletNode
  timer: ReturnType<typeof setTimeout>
  down: Downsampler
  rec: Recording
  /** Loudest moment so far (RMS). */
  peak: number
  /** Words of the pieces already cut, and where the open piece starts. */
  done: string[]
  from: number
  /** The open piece's words as last heard. */
  partial: string
  /** The call to the Mac now going, if any. */
  asking: Promise<void> | null
  /** When the next call may go, and how far the last one heard. */
  nextAsk: number
  heardTo: number
  how: How | null
}

function wav(samples: Float32Array): Blob {
  return new Blob([wavBytes(samples) as BlobPart], { type: 'audio/wav' })
}

function show(l: Live, cb: Callbacks) {
  if (!l.how) cb.onLive?.(joinWords([...l.done, l.partial]))
}

/** While he speaks: cut a long piece, or ask for the open piece's words.
 *  One call to the Mac at a time. */
function pump(l: Live, cbRef: { current: Callbacks }) {
  if (l.how || l.asking || performance.now() < l.nextAsk) return
  const { rec } = l
  const from = l.from
  const ask = (audio: Blob, then: (words: string) => void, what: string) => {
    l.nextAsk = performance.now() + LIVE_EVERY_MS
    l.asking = (async () => {
      try {
        then(
          await cbRef.current.transcribe(audio, {
            context: joinWords(l.done),
            partial: true,
          })
        )
      } catch (e) {
        // The words on screen wait; the call when he stops tries again.
        console.warn(`Queue dictation: ${what} did not come back`, e)
        l.nextAsk = performance.now() + BACKOFF_MS
      } finally {
        l.asking = null
      }
    })()
  }

  if (rec.end - from >= PIECE_S * RATE) {
    // Long enough: cut it at a pause and keep its words.
    const cut =
      quietestCut(
        rec.levels,
        (from + PIECE_MIN_S * RATE) / FRAME,
        (rec.end - 0.4 * RATE) / FRAME
      ) * FRAME
    const close = (words: string) => {
      if (words.trim()) l.done.push(words.trim())
      l.from = cut
      l.partial = ''
      rec.dropBefore(cut)
    }
    if (rec.loudest(from, cut) < SILENCE) {
      close('')
      return
    }
    ask(
      wav(rec.slice(from, cut)),
      words => {
        // Kept even when he has just stopped: the last call waits for it.
        if (l.from !== from) return
        close(words)
        show(l, cbRef.current)
      },
      'a piece'
    )
    return
  }
  if (rec.end - l.heardTo < LIVE_NEW_S * RATE) return
  if (rec.loudest(from) < SILENCE) return
  l.heardTo = rec.end
  ask(
    wav(rec.slice(from)),
    words => {
      if (l.how || l.from !== from) return
      l.partial = words.trim()
      show(l, cbRef.current)
    },
    'the words so far'
  )
}

export function useDictation({
  transcribe,
  warm,
  onLive,
  onWords,
  onProblem,
  meterRef,
  leave = 'keep',
}: {
  /** A recording to the Mac and back as words. `context` is what he said
   *  before it; `partial` marks the calls made while he speaks. */
  transcribe: Callbacks['transcribe']
  /** Gets the Mac's model ready as the mic starts. */
  warm?: () => void
  /** The words so far, as he speaks; '' when they come out again (thrown
   *  away, or nothing was heard). */
  onLive?: (words: string) => void
  /** The words, and whether Enter asked for the message to go too. */
  onWords: (words: string, send: boolean) => void
  /** Something to tell Bryce; `retry` sends the same recording again. */
  onProblem: (message: string, retry?: () => void) => void
  /** Gets `--level` (0–1) as he speaks, for the mic's ring. */
  meterRef: React.RefObject<HTMLElement | null>
  /** Unmounted mid-recording: 'keep' turns what was said into words (the
   *  chat puts them in that item's draft), 'cancel' throws it away (the
   *  reject box, closed with Cancel or by leaving the item). */
  leave?: 'keep' | 'cancel'
}) {
  const [state, setState] = useState<DictationState>('off')
  const stateRef = useRef<DictationState>('off')
  const set = useCallback((s: DictationState) => {
    stateRef.current = s
    setState(s)
  }, [])
  const live = useRef<Live | null>(null)
  // Pressed while the browser was still asking for the microphone.
  const early = useRef<How | null>(null)
  // Enter while the words were on their way: send them when they come.
  const sendAfter = useRef(false)
  // ⌘D started it and ⌘ is still down: since when.
  const held = useRef<number | null>(null)
  const [holding, setHolding] = useState(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cb = useRef({ transcribe, warm, onLive, onWords, onProblem, leave })
  useEffect(() => {
    cb.current = { transcribe, warm, onLive, onWords, onProblem, leave }
  })

  const letGoOfHold = useCallback(() => {
    held.current = null
    clearTimeout(holdTimer.current)
    setHolding(false)
  }, [])

  /** The last piece to the Mac, then the words in. Try again runs it once
   *  more with the same audio. */
  const lastRef = useRef<(done: string[], rest: Float32Array) => void>(() => {})
  const last = useCallback(
    async (done: string[], rest: Float32Array) => {
      set('transcribing')
      let words = ''
      // A rest with nothing said in it (a pause before Cmd+D) needs no call.
      let loud = 0
      for (const v of rest) loud = Math.max(loud, Math.abs(v))
      if (rest.length && loud >= SILENCE) {
        try {
          words = await cb.current.transcribe(wav(rest), {
            context: joinWords(done),
            partial: false,
          })
        } catch (e) {
          set('off')
          sendAfter.current = false
          cb.current.onLive?.('')
          cb.current.onProblem(
            `Couldn't turn that into text – ${e instanceof Error ? e.message : 'the Mac agent did not answer.'}`,
            () => lastRef.current(done, rest)
          )
          return
        }
      }
      set('off')
      const all = joinWords([...done, words])
      if (all) cb.current.onWords(all, sendAfter.current)
      else {
        cb.current.onLive?.('')
        cb.current.onProblem("Didn't catch any words.")
      }
      sendAfter.current = false
    },
    [set]
  )
  useEffect(() => {
    lastRef.current = (done, rest) => void last(done, rest)
  }, [last])

  const release = useCallback(
    (l: Live) => {
      clearTimeout(l.timer)
      l.node.port.onmessage = null
      l.node.disconnect()
      for (const t of l.stream.getTracks()) t.stop()
      // Closing the audio context can't fail in a way that matters.
      void l.ctx.close().catch(() => {})
      meterRef.current?.style.removeProperty('--level')
    },
    [meterRef]
  )

  /** The mic is off: throw it away, or wait for a piece on its way and
   *  send the rest. */
  const wrapUp = useCallback(
    async (l: Live) => {
      release(l)
      if (live.current === l) live.current = null
      if (l.how === 'cancel') {
        set('off')
        cb.current.onLive?.('')
        return
      }
      if (l.rec.end === 0 || l.peak < SILENCE) {
        set('off')
        cb.current.onLive?.('')
        cb.current.onProblem(
          "Didn't hear anything – is the right microphone switched on?"
        )
        return
      }
      sendAfter.current = l.how === 'send'
      set('transcribing')
      if (l.asking) await l.asking
      await last([...l.done], l.rec.slice(l.from))
    },
    [last, release, set]
  )
  const wrapUpRef = useRef(wrapUp)
  useEffect(() => {
    wrapUpRef.current = wrapUp
  }, [wrapUp])

  /** Stop listening: the words go in ('stop'), go in and send ('send'),
   *  or the recording is thrown away ('cancel'). False when there was
   *  nothing to stop. */
  const finish = useCallback(
    (how: How): boolean => {
      letGoOfHold()
      const l = live.current
      if (l) {
        if (!l.how) {
          l.how = how
          void wrapUp(l)
        }
        return true
      }
      if (stateRef.current === 'starting') {
        early.current = 'cancel'
        return true
      }
      if (stateRef.current === 'transcribing' && how === 'send') {
        sendAfter.current = true
        return true
      }
      return false
    },
    [letGoOfHold, wrapUp]
  )

  const start = useCallback(async () => {
    if (stateRef.current !== 'off') return
    set('starting')
    early.current = null
    sendAfter.current = false
    cb.current.warm?.()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (e) {
      set('off')
      letGoOfHold()
      cb.current.onProblem(micProblem(e instanceof DOMException ? e.name : ''))
      return
    }
    let ctx: AudioContext | null = null
    const giveUp = () => {
      for (const t of stream.getTracks()) t.stop()
      // Closing the audio context can't fail in a way that matters.
      void ctx?.close().catch(() => {})
      set('off')
    }
    if (early.current) {
      giveUp()
      return
    }
    let node: AudioWorkletNode
    try {
      ctx = new AudioContext()
      const url = URL.createObjectURL(
        new Blob([WORKLET], { type: 'text/javascript' })
      )
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      node = new AudioWorkletNode(ctx, 'queue-mic')
      ctx.createMediaStreamSource(stream).connect(node)
      // Its output is silence; connected so the browser keeps it running.
      node.connect(ctx.destination)
      if (ctx.state === 'suspended') await ctx.resume()
    } catch (e) {
      giveUp()
      letGoOfHold()
      console.warn('Queue dictation: the recorder did not start', e)
      cb.current.onProblem(
        'The recorder could not start. Reload the page and try again.'
      )
      return
    }
    if (early.current) {
      giveUp()
      return
    }
    const l: Live = {
      stream,
      ctx,
      node,
      timer: setTimeout(() => finish('stop'), MAX_MS),
      down: new Downsampler(ctx.sampleRate),
      rec: new Recording(),
      peak: 0,
      done: [],
      from: 0,
      partial: '',
      asking: null,
      nextAsk: 0,
      heardTo: 0,
      how: null,
    }
    live.current = l
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (l.how) return
      const input = e.data
      let sum = 0
      for (const v of input) sum += v * v
      const rms = Math.sqrt(sum / (input.length || 1))
      if (rms > l.peak) l.peak = rms
      meterRef.current?.style.setProperty(
        '--level',
        Math.min(1, rms * 8).toFixed(2)
      )
      l.rec.push(l.down.push(input))
      pump(l, cb)
    }
    // The mic was unplugged or switched off: keep what was said.
    for (const t of stream.getTracks()) {
      t.addEventListener('ended', () => finish('stop'))
    }
    set('listening')
  }, [finish, letGoOfHold, meterRef, set])

  // Leaving the item mid-recording keeps what was said: the words land in
  // that item's draft (Chat's onWords sees the panel has gone). With
  // leave: 'cancel' the recording is thrown away instead.
  useEffect(
    () => () => {
      const l = live.current
      if (l && !l.how) {
        l.how = cb.current.leave === 'cancel' ? 'cancel' : 'stop'
        void wrapUpRef.current(l)
      }
      early.current = 'cancel'
      clearTimeout(holdTimer.current)
    },
    []
  )

  const toggle = useCallback(() => {
    if (stateRef.current === 'off') void start()
    else if (stateRef.current !== 'transcribing') finish('stop')
  }, [finish, start])

  /** ⌘D (Ctrl+D off a Mac): starts or stops it. Started this way with ⌘
   *  still down after HOLD_MS, it is hold-to-talk: letting go of ⌘ puts the
   *  words in. A quick ⌘D leaves it listening until the next one. */
  const press = useCallback(() => {
    if (stateRef.current === 'off') {
      held.current = performance.now()
      clearTimeout(holdTimer.current)
      holdTimer.current = setTimeout(() => {
        if (held.current !== null) setHolding(true)
      }, HOLD_MS)
    }
    toggle()
  }, [toggle])

  useEffect(() => {
    const letGo = () => {
      const since = held.current
      if (since === null) return
      letGoOfHold()
      if (performance.now() - since >= HOLD_MS) finish('stop')
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') letGo()
    }
    // Switching away while holding counts as letting go: the key-up would
    // never come.
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', letGo)
    return () => {
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', letGo)
    }
  }, [finish, letGoOfHold])

  return { state, holding, start, finish, toggle, press }
}
