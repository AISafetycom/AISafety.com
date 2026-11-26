// The dependency-free part of the chatbot's dictation button
// (components/assistant/useDictation.ts): joining spoken words onto what is
// already in the message box, and the words shown when the browser's speech
// recognition fails. The recognition itself is the browser's own (the Web
// Speech API), so AISafety.com never receives any audio.

/** What the browser hands back while someone speaks: a growing list of
 *  phrases, each with its best guess first. Settled phrases stay put and the
 *  one being spoken keeps changing, so the list is re-read in full each time. */
export interface SpokenPhrases {
  length: number
  [index: number]: { length: number; [index: number]: { transcript: string } }
}

/** Everything heard so far in one dictation, as one line of text. */
export function spokenText(phrases: SpokenPhrases): string {
  let text = ''
  for (let i = 0; i < phrases.length; i++) {
    if (phrases[i].length > 0) text += phrases[i][0].transcript
  }
  return text.replace(/\s+/g, ' ').trim()
}

/** The message box's text with the dictated words added after what was
 *  already there, one space between them. */
export function joinDictation(before: string, spoken: string): string {
  if (!spoken) return before
  if (!before) return spoken
  return /\s$/.test(before) ? before + spoken : `${before} ${spoken}`
}

/** What to tell the visitor when dictation stops with one of the browser's
 *  error codes. null for the ones that need no message: silence, or the
 *  visitor stopping it themselves. */
export function dictationErrorMessage(code: string): string | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Dictation needs the microphone, and it is blocked for this site. Allow it in your browser’s site settings and try again.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Dictation couldn’t reach your browser’s speech service. Check your connection, or type your message instead.'
    case 'language-not-supported':
      return 'Dictation isn’t available in your browser’s language.'
    default:
      return 'Dictation stopped unexpectedly. Try again, or type your message instead.'
  }
}
