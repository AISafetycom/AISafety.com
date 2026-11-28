// The page's read of an item's record: when it is made, and when Publish
// waits for it.
//
// The Queue page reads the record behind the item in focus (an addition's
// unpublished record, a change's listing) and keeps that read by item. An
// addition is published on that read (queue-shown.ts), so the read has to
// be the record as it is: it is made again after anything that may have
// moved the record (the page's own write to it, a chat reply that ended,
// a refused Publish), and a Publish pressed while that read is still on its
// way waits for it.
//
// One read at a time per record. The page's state moves for many reasons
// that say nothing about the record (the list is read again every minute,
// the row is read again when a reply ends): none of them starts a second
// read of a record whose read is already on its way. Until 28 Nov 2026
// each one dropped the read under way and began another.
//
// Each thing that may have moved a record bumps its number (a
// "generation"). A read belongs to the generation it began in; one that
// lands after a later bump is not the record as it is now, and is thrown
// away.
//
// Pure, so the rules can be tested; the page keeps the state.

/** What the page holds of a record. */
export interface HeldRead {
  /** The page has written to the record since, or a chat may have: it is
   *  to be read again. */
  stale?: boolean
  /** One of its picture links has run out (the page was left open for
   *  hours). */
  expired: boolean
}

/** Whether a read of the record is to begin now: there is none that still
 *  holds, and none on its way for the record as it now is. `reading` is
 *  the generation of the read on its way, if any. */
export function readDue(
  held: HeldRead | null,
  reading: number | undefined,
  generation: number
): boolean {
  if (held && !held.stale && !held.expired) return false
  return reading !== generation
}

/** Whether a read that began in `began` is still the record as it is when
 *  it lands. */
export function readStands(began: number, generation: number): boolean {
  return began === generation
}

/** Whether Publish (or the suggestion of it) waits for the page's read of
 *  the record. Only on the item in focus, whose record is being read;
 *  never after a read that failed (the record is gone, the site did not
 *  answer): then the site is asked, and says what is wrong. */
export function publishWaits(s: {
  /** The action publishes an open addition that has a record. */
  publishes: boolean
  /** The item is the one in focus. */
  inFocus: boolean
  /** The last read of its record failed. */
  readFailed: boolean
  /** The fingerprint of the read the page holds, when it still holds. */
  shown: string | null
}): boolean {
  return s.publishes && s.inFocus && !s.readFailed && !s.shown
}

/** Said under the buttons when Publish was pressed in that moment: a
 *  line, not an error, and the item stays where it is. */
export const RECORD_NOT_READ =
  'Not done yet: this page was still reading the listing’s record. Look at it as it is now, then decide.'
