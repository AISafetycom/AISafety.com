'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { micProblem, recordingType } from '@/lib/admin/queue-dictation'

// Dictation for the Fable chat (5 Nov 2026): Cmd+D or the mic starts a
// recording, Cmd+D again stops it, the Mac turns it into words. Enter while
// it listens stops it and sends the message once the words are in; Esc
// throws the recording away.

export type DictationState = 'off' | 'starting' | 'listening' | 'transcribing'

/** The longest recording; past it the words go in by themselves. */
const MAX_MS = 10 * 60 * 1000
/** The loudest moment of a recording below this (RMS, 0–1) = nothing was
 *  said, so no call to the Mac. */
const SILENCE = 0.01

type How = 'stop' | 'send' | 'cancel'

interface Live {
  recorder: MediaRecorder
  stream: MediaStream
  ctx: AudioContext | null
  raf: number
  timer: ReturnType<typeof setTimeout>
  chunks: Blob[]
  /** Loudest moment so far; -1 when it can't be measured. */
  peak: number
  how: How
}

export function useDictation({
  transcribe,
  onWords,
  onProblem,
  meterRef,
}: {
  /** The recording to the Mac and back as words. */
  transcribe: (audio: Blob) => Promise<string>
  /** The words, and whether Enter asked for the message to go too. */
  onWords: (words: string, send: boolean) => void
  /** Something to tell Bryce; `retry` sends the same recording again. */
  onProblem: (message: string, retry?: () => void) => void
  /** Gets `--level` (0–1) as he speaks, for the mic's ring. */
  meterRef: React.RefObject<HTMLElement | null>
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
  const cb = useRef({ transcribe, onWords, onProblem })
  useEffect(() => {
    cb.current = { transcribe, onWords, onProblem }
  })

  // Try again sends the same recording through run once more.
  const runRef = useRef<(audio: Blob) => Promise<void>>(async () => {})
  const run = useCallback(
    async (audio: Blob) => {
      set('transcribing')
      let words: string
      try {
        words = await cb.current.transcribe(audio)
      } catch (e) {
        set('off')
        cb.current.onProblem(
          `Couldn't turn that into text – ${e instanceof Error ? e.message : 'the Mac agent did not answer.'}`,
          () => void runRef.current(audio)
        )
        return
      }
      set('off')
      if (words.trim()) cb.current.onWords(words.trim(), sendAfter.current)
      else cb.current.onProblem("Didn't catch any words.")
      sendAfter.current = false
    },
    [set]
  )

  useEffect(() => {
    runRef.current = run
  }, [run])

  const release = useCallback(
    (l: Live) => {
      clearTimeout(l.timer)
      cancelAnimationFrame(l.raf)
      for (const t of l.stream.getTracks()) t.stop()
      // Closing the meter's audio context can't fail in a way that matters.
      void l.ctx?.close().catch(() => {})
      meterRef.current?.style.removeProperty('--level')
    },
    [meterRef]
  )

  /** Stop listening: the words go in ('stop'), go in and send ('send'),
   *  or the recording is thrown away ('cancel'). False when there was
   *  nothing to stop. */
  const finish = useCallback((how: How): boolean => {
    const l = live.current
    if (l) {
      l.how = how
      if (l.recorder.state !== 'inactive') l.recorder.stop()
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
  }, [])

  const start = useCallback(async () => {
    if (stateRef.current !== 'off') return
    set('starting')
    early.current = null
    sendAfter.current = false
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
      cb.current.onProblem(micProblem(e instanceof DOMException ? e.name : ''))
      return
    }
    if (early.current) {
      for (const t of stream.getTracks()) t.stop()
      set('off')
      return
    }
    const type = recordingType(t => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : {})
    const l: Live = {
      recorder,
      stream,
      ctx: null,
      raf: 0,
      timer: setTimeout(() => finish('stop'), MAX_MS),
      chunks: [],
      peak: -1,
      how: 'stop',
    }
    live.current = l
    recorder.ondataavailable = e => {
      if (e.data.size > 0) l.chunks.push(e.data)
    }
    recorder.onstop = () => {
      release(l)
      if (live.current === l) live.current = null
      if (l.how === 'cancel') {
        set('off')
        return
      }
      const audio = new Blob(l.chunks, {
        type: recorder.mimeType || type || 'audio/webm',
      })
      if (audio.size === 0 || (l.peak >= 0 && l.peak < SILENCE)) {
        set('off')
        cb.current.onProblem(
          "Didn't hear anything – is the right microphone switched on?"
        )
        return
      }
      sendAfter.current = l.how === 'send'
      void run(audio)
    }
    // The mic was unplugged or switched off: keep what was said.
    for (const t of stream.getTracks()) {
      t.addEventListener('ended', () => finish('stop'))
    }
    // How loud he is, for the ring around the mic and the silence check.
    // Not essential: without it the recording still goes.
    try {
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      src.connect(an)
      const buf = new Float32Array(an.fftSize)
      l.ctx = ctx
      l.peak = 0
      const tick = () => {
        an.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        const rms = Math.sqrt(sum / buf.length)
        if (rms > l.peak) l.peak = rms
        meterRef.current?.style.setProperty(
          '--level',
          Math.min(1, rms * 8).toFixed(2)
        )
        l.raf = requestAnimationFrame(tick)
      }
      l.raf = requestAnimationFrame(tick)
    } catch {
      l.peak = -1
    }
    recorder.start(1000)
    set('listening')
  }, [finish, meterRef, release, run, set])

  // Leaving the item mid-recording keeps what was said: the words land in
  // that item's draft (Chat's onWords sees the panel has gone).
  useEffect(
    () => () => {
      const l = live.current
      if (l && l.recorder.state !== 'inactive') {
        l.how = 'stop'
        l.recorder.stop()
      }
      early.current = 'cancel'
    },
    []
  )

  const toggle = useCallback(() => {
    if (stateRef.current === 'off') void start()
    else if (stateRef.current !== 'transcribing') finish('stop')
  }, [finish, start])

  return { state, start, finish, toggle }
}
