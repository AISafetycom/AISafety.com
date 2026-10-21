/*
  Leaving out a proposed field (Bryce, 15 Oct 2026: "I want to be able to
  delete a suggested field change"). The cross on a change's proposed row
  takes that field out of what Accept writes, so the listing keeps what it
  holds there. The names travel with the page's edits under a key that is
  never a field name: saved on the row like any edit (still there after a
  reload, and for the chat to read), and kept on an applied row so the
  Done view shows them and Undo leaves them alone.
*/

/** The key in a row's saved edits (JSON) that lists the proposed fields
 *  the admin left out; never a field name. */
export const LEFT_OUT_KEY = '(left out)'

/** The left-out names in a saved value, kept to the fields the item still
 *  proposes, in the proposal's order, once each. */
export function leftOutOf(value: unknown, proposed: string[]): string[] {
  if (!Array.isArray(value)) return []
  const names = new Set(value.filter(k => typeof k === 'string'))
  return proposed.filter((f, i) => names.has(f) && proposed.indexOf(f) === i)
}

/** The page's edits as saved or sent with Accept: with the left-out list
 *  under its key when there is one. */
export function withLeftOut<T>(
  edits: Record<string, T>,
  leftOut: string[]
): Record<string, T | string[]> {
  return leftOut.length ? { ...edits, [LEFT_OUT_KEY]: leftOut } : edits
}
