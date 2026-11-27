// A chat reply under way on an item, and what the page does about it.
//
// Fable's chat can change what an item is about while it answers: the
// unpublished record of an addition, a change's proposed values, a rule's
// edits, the flag. A decision pressed while a reply is still being written
// would be made on a page the reply is about to overtake. So the page
// holds decisions on an item for as long as a reply for it is under way
// there, and reads the item again (the row and its record) when the reply
// ends, so what is decided next is what the chat left (28 Nov 2026).
//
// "Under way" is what this page can see: its own chat panel for the item
// (sending, streaming, a reply the server is still writing after a reload,
// messages waiting their turn), and for the owner the Mac's word on which
// items Fable is answering, which also covers a reply that carries on
// after he moved to another item.
//
// Pure, so the rules can be tested; the page keeps the state.

/** What a chat panel knows of its own thread. */
export interface PanelState {
  /** The thread has been read (or could not be): until then the panel
   *  does not know whether a reply is still being written. */
  loaded: boolean
  /** A message of this page's is being sent or its reply streamed. */
  busy: boolean
  /** The server is still answering an earlier message, or holds some. */
  pending: boolean
  /** Messages typed here that wait for the reply ahead of them. */
  queued: number
}

/** Whether a reply is under way in this panel; null while it cannot tell
 *  yet (its thread is still loading), which changes nothing. */
export function panelReplying(s: PanelState): boolean | null {
  if (s.busy || s.queued > 0) return true
  if (!s.loaded) return null
  return s.pending
}

/** Each item's chat panel's last word on whether a reply is under way in
 *  it. A panel that closes mid-reply leaves its "yes" behind (he moved on,
 *  the reply carries on): it says again when he comes back. One that
 *  closes with nothing under way takes its word with it, so the Mac's word
 *  counts for that item again. */
export type Replying = Readonly<Record<string, boolean>>

/** The words after one panel spoke: yes, no, or null for "gone, with
 *  nothing under way". The same object when nothing changed, so the page
 *  does not draw again for it. */
export function withPanelWord(
  prev: Replying,
  id: string,
  on: boolean | null
): Replying {
  if (on === null) {
    if (!(id in prev)) return prev
    const next = { ...prev }
    delete next[id]
    return next
  }
  return prev[id] === on ? prev : { ...prev, [id]: on }
}

/** The Mac's word on each item's chat: whether Fable is answering there
 *  now (and when it last answered, which is not looked at here). */
export type Answering = Readonly<
  Record<string, { answering?: boolean; last?: string } | undefined>
>

/** Whether decisions on this item wait. Its own panel's word comes first:
 *  it reads the thread itself and knows the moment a reply ends, where the
 *  Mac's word is asked only every few seconds. With no word from a panel
 *  (the item is not open, or its thread is still loading), the Mac's word
 *  on whether Fable is answering there. */
export function holdsDecisions(
  id: string,
  panels: Replying,
  answering: Answering
): boolean {
  const word = panels[id]
  return word === undefined ? Boolean(answering[id]?.answering) : word
}

/** The ids held in `before` and no longer in `now`: their reply has
 *  ended, and the page reads each of them again. */
export function repliesEnded(
  before: ReadonlySet<string>,
  now: ReadonlySet<string>
): string[] {
  return [...before].filter(id => !now.has(id))
}

/** Every id that holds decisions now. */
export function heldIds(panels: Replying, answering: Answering): Set<string> {
  const out = new Set<string>()
  for (const id of new Set([
    ...Object.keys(panels),
    ...Object.keys(answering),
  ])) {
    if (holdsDecisions(id, panels, answering)) out.add(id)
  }
  return out
}

/** Said under the buttons while they wait, and when a key asks anyway. */
export const REPLY_HOLDS =
  'Fable is still replying on this item. You can decide when the reply is done.'

/** An addition whose record this page has not finished reading: Publish
 *  waits for the read. */
export const RECORD_NOT_READ =
  'Not done yet: this page was still reading the listing’s record. Look at it as it is now, then decide.'
