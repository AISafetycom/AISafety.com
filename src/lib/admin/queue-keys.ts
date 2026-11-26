// When the Queue page's single-key shortcuts may act (17 Nov 2026). The
// page's key handler asks these before it does anything, so a key never
// decides an item that is not the one on screen, a held key decides once,
// and a letter typed into a dropdown stays a letter. Pure, for the tests.

/** The keys that go on working while held down: they only move through
 *  the list. */
const HELD_KEYS = new Set(['Tab', 'ArrowDown', 'ArrowUp'])

/** A key press the keyboard made by itself because the key is being held,
 *  for a key that must act once per press. Holding X asked "delete?" and
 *  the first repeat answered yes, then the page moved on and the next
 *  repeats deleted the items after it; A and W went through the list the
 *  same way. */
export function heldRepeat(e: { key: string; repeat: boolean }): boolean {
  return e.repeat && !HELD_KEYS.has(e.key)
}

/** Whether a key press in this element is typing, so no shortcut reads it.
 *  A dropdown counts: a letter there picks the option that starts with it. */
export function takesTyping(
  el: { tagName: string; isContentEditable?: boolean } | null | undefined
): boolean {
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  )
}

/** How much of the item in focus is on screen: all of it (`detail`), its
 *  row marked in the list of decisions (`row`), or nothing, because the
 *  pane shows something else: Done today with another item marked or none,
 *  a listing found by its record ID, or no item at all (`hidden`). */
export type ItemView = 'detail' | 'row' | 'hidden'

export interface KeyScene {
  /** The "?" card is up. */
  help: boolean
  view: ItemView
  /** A field editor is open on the item. */
  editing: boolean
}

/** What each key that acts on the item in focus needs first. A key not
 *  listed here does not act on that item (moving, search, Done today, Undo
 *  of the last decision, the rule that popped up). */
const NEEDS: Record<string, { view: 'detail' | 'row'; noEditor: boolean }> = {
  // Decide the item, or change what goes out with it.
  a: { view: 'detail', noEditor: true },
  Enter: { view: 'detail', noEditor: true },
  x: { view: 'detail', noEditor: true },
  w: { view: 'detail', noEditor: true },
  g: { view: 'detail', noEditor: true },
  r: { view: 'detail', noEditor: true },
  c: { view: 'detail', noEditor: true },
  '1': { view: 'detail', noEditor: true },
  '2': { view: 'detail', noEditor: true },
  '3': { view: 'detail', noEditor: true },
  // Open something on its detail: Fable's box, the Position list, the
  // field picker.
  f: { view: 'detail', noEditor: false },
  p: { view: 'detail', noEditor: false },
  e: { view: 'detail', noEditor: false },
  // Bring a declined one back, from its detail or its marked row.
  b: { view: 'row', noEditor: true },
  // Its links, from either.
  s: { view: 'row', noEditor: false },
  q: { view: 'row', noEditor: false },
  d: { view: 'row', noEditor: false },
}

/** Whether a shortcut key may act now. With the "?" card up only the keys
 *  that close it and the ones that move do anything. A key that decides
 *  the item waits until its detail is what the pane shows and no field
 *  editor is open on it. */
export function shortcutAllowed(key: string, scene: KeyScene): boolean {
  if (key === '?' || key === 'Escape') return true
  if (scene.help) return HELD_KEYS.has(key)
  const needs = NEEDS[key]
  if (!needs) return true
  if (scene.view === 'hidden') return false
  if (needs.view === 'detail' && scene.view !== 'detail') return false
  return !(needs.noEditor && scene.editing)
}

/** What a key does while a new rule's card is up over the dimmed page. The
 *  card takes the standard keys (Bryce, 19 Nov 2026: "like A for apply and
 *  R for reject"): A applies it, R shows its reasons and a number picks
 *  one, V opens it on the Rules tab, Esc backs out of the reasons or puts
 *  the card away. U (Undo, on the toast above the shade) and "?" go on as
 *  usual (`pass`); every other key does nothing (`none`), so nothing
 *  changes unseen behind the card. */
export type RulePopKey =
  | { do: 'apply' }
  | { do: 'reasons' }
  | { do: 'reject'; chip: number }
  | { do: 'view' }
  | { do: 'back' }
  | { do: 'pass' }
  | { do: 'none' }

export function rulePopKey(
  key: string,
  card: { rejecting: boolean; busy: boolean }
): RulePopKey {
  const idle = !card.rejecting && !card.busy
  switch (key) {
    case 'a':
      return idle ? { do: 'apply' } : { do: 'none' }
    case 'r':
      return idle ? { do: 'reasons' } : { do: 'none' }
    case 'v':
      return { do: 'view' }
    case 'Escape':
      return { do: 'back' }
    case 'u':
    case '?':
      return { do: 'pass' }
  }
  if (/^[1-9]$/.test(key) && card.rejecting && !card.busy) {
    return { do: 'reject', chip: Number(key) - 1 }
  }
  return { do: 'none' }
}
