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

/** The recording format: Opus in WebM where the browser has it (Chrome,
 *  Firefox), else whatever it offers first. '' = the browser's default. */
export function recordingType(supported: (type: string) => boolean): string {
  return (
    [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ].find(t => supported(t)) ?? ''
  )
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
