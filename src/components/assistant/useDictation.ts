'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  dictationErrorMessage,
  joinDictation,
  spokenText,
  type SpokenPhrases,
} from '@/lib/assistant/dictation'

// Dictation for the chatbot's message box: press the microphone, speak, and
// the words appear in the box as they are heard. Nothing is sent until the
// visitor presses Send, so a misheard word can be fixed first.
//
// It uses the browser's own speech recognition (the Web Speech API). The
// audio goes from the browser to its maker's speech service (Google for
// Chrome, Apple for Safari, Microsoft for Edge) and never to AISafety.com.
// Firefox has no such service, so the button isn't offered there. It is also
// left off phones and tablets, whose keyboards already have a dictation key.

/** The parts of the browser's SpeechRecognition this hook uses. TypeScript's
 *  own DOM types don't include it yet. */
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: { results: SpokenPhrases }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type RecognitionConstructor = new () => Recognition

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

interface Options {
  /** The message box's whole new text, each time more words are heard. */
  onText: (text: string) => void
  /** Dictation started, or stopped with an error (`reason` is the browser's
   *  error code). For analytics. */
  onEvent?: (outcome: 'start' | 'error', reason?: string) => void
}

export interface Dictation {
  /** Whether to show the button at all: the browser can do it and the device
   *  has a mouse or trackpad. False until the page has loaded in the browser,
   *  so the server and the browser draw the same thing first. */
  supported: boolean
  listening: boolean
  /** Shown under the message box after a failure; null otherwise. */
  error: string | null
  /** Start listening. `before` is what is already in the box; the spoken
   *  words go after it. */
  start: (before: string) => void
  /** Stop listening and keep everything heard, the last words included. */
  stop: () => void
  /** Stop at once and take no more words: the visitor has sent the message
   *  or started typing, so nothing spoken may change the box any more. */
  cancel: () => void
}

/** Whether this browser, on this device, gets the button. Nothing about it
 *  changes while the page is open, so there is nothing to subscribe to. */
function canDictate(): boolean {
  return (
    recognitionConstructor() !== null &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  )
}
const neverChanges = () => () => {}

export function useDictation({ onText, onEvent }: Options): Dictation {
  // False on the server and for the browser's first draw, then the real
  // answer.
  const supported = useSyncExternalStore(neverChanges, canDictate, () => false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<Recognition | null>(null)
  // Latest callbacks in refs, so a recognition already running calls the
  // current ones.
  const onTextRef = useRef(onText)
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onTextRef.current = onText
    onEventRef.current = onEvent
  }, [onText, onEvent])

  const cancel = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) return
    recognitionRef.current = null
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.abort()
    setListening(false)
  }, [])

  const stop = useCallback(() => {
    // The browser hands over the last words, then fires `onend`, which
    // clears the listening state.
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(
    (before: string) => {
      const Constructor = recognitionConstructor()
      if (!Constructor) return
      cancel()
      setError(null)
      const recognition = new Constructor()
      recognition.lang = navigator.language || 'en-US'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onresult = event => {
        if (recognitionRef.current !== recognition) return
        onTextRef.current(joinDictation(before, spokenText(event.results)))
      }
      recognition.onerror = event => {
        if (recognitionRef.current !== recognition) return
        const message = dictationErrorMessage(event.error)
        if (message) {
          setError(message)
          onEventRef.current?.('error', event.error)
        }
      }
      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return
        recognitionRef.current = null
        setListening(false)
      }
      recognitionRef.current = recognition
      try {
        recognition.start()
      } catch (err) {
        // start() throws when the browser refuses outright (a recognition
        // already running in another tab, a blocked feature policy).
        console.warn('[assistant] dictation could not start', err)
        recognitionRef.current = null
        setError(dictationErrorMessage('unknown'))
        onEventRef.current?.('error', 'start-failed')
        return
      }
      setListening(true)
      onEventRef.current?.('start')
    },
    [cancel]
  )

  // Never leave the microphone on after the chat is gone from the page.
  useEffect(() => cancel, [cancel])

  return { supported, listening, error, start, stop, cancel }
}
