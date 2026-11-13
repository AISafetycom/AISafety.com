// Tidies the model's one-line card note (the text after the pipe in
// `[[card:ID|note]]`) before it is shown. Notes render as plain text, so any
// markup the model slips in would otherwise reach the visitor as-is.

const OPENER_FOR: Record<string, string> = { '}': '{', ']': '[' }
const CLOSER_FOR: Record<string, string> = { '{': '}', '[': ']' }

function count(text: string, char: string): number {
  return text.split(char).length - 1
}

/** A Markdown link the model smuggled into a note (e.g. "find it on
 *  [Communities](/communities)") would show raw. Keep the link's label, drop
 *  its destination. */
function flattenNoteLinks(note: string): string {
  return note.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
}

/** Drops bracket characters left dangling at either end of a note, such as
 *  the "}" in "Dinner discussions open to policy people}" (a slip while
 *  closing the card code). A bracket that closes or opens a pair inside the
 *  note, as in "Weekly meetups [online]", is part of the text and stays. */
function trimStrayBrackets(note: string): string {
  let out = note.trim()
  while (out) {
    const last = out[out.length - 1]
    const first = out[0]
    const strayEnd =
      last in CLOSER_FOR ||
      (last in OPENER_FOR && count(out, last) > count(out, OPENER_FOR[last]))
    if (strayEnd) {
      out = out.slice(0, -1).trimEnd()
      continue
    }
    const strayStart =
      first in OPENER_FOR ||
      (first in CLOSER_FOR && count(out, first) > count(out, CLOSER_FOR[first]))
    if (strayStart) {
      out = out.slice(1).trimStart()
      continue
    }
    break
  }
  return out
}

/** The note as the visitor should see it: links flattened to their label,
 *  dangling brackets and surrounding spaces removed. Empty when nothing
 *  readable is left. */
export function cleanCardNote(raw: string): string {
  return trimStrayBrackets(flattenNoteLinks(raw))
}
