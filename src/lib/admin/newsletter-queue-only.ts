// A Broom item the newsletter page's Fix leaves to the Queue.
//
// The newsletter page lists a Broom item as Broom's own changes, field by
// field (newsletter-changes.ts), and Fix applies them. A row can hold more
// than that, though, which only the Queue page shows: edits someone saved
// on it there (a value typed over Broom's, another field added, a proposed
// field left out with the cross), or a teammate's suggested decision or
// question waiting on it. Applying such a row from a line that shows none
// of it would write, or settle, something the person pressing Fix never
// saw. So Fix refuses those rows with nothing written (28 Nov 2026), and
// the panel says so before the click: the button is off, with a line
// saying why and a link that opens the item in the Queue.
//
// Pure, so the page and the server word it the same way.
import { isWaiting, type ForBryce } from './queue-suggest'

/** Why the item is decided in the Queue and not with Fix. */
export type QueueOnly = 'edits' | 'suggestion' | 'question'

/** The parts of a Queue item this goes by. */
export interface QueueOnlyRow {
  edits?: Record<string, unknown> | null
  leftOut?: string[] | null
  forBryce?: ForBryce | null
}

/** Why this open Queue item is decided in the Queue, or null when Fix may
 *  apply it. Someone waiting on it comes first: their suggestion usually
 *  brought the edits. */
export function queueOnlyOf(row: QueueOnlyRow): QueueOnly | null {
  const fb = row.forBryce ?? null
  if (fb && isWaiting(fb))
    return fb.kind === 'suggest' ? 'suggestion' : 'question'
  if (Object.keys(row.edits ?? {}).length > 0) return 'edits'
  if ((row.leftOut?.length ?? 0) > 0) return 'edits'
  return null
}

const WHY: Record<QueueOnly, string> = {
  edits: 'This item has edits saved in the Queue',
  suggestion: 'This item has a suggestion waiting in the Queue',
  question: 'This item has a question waiting in the Queue',
}

/** The words before the link: "…, so it’s decided there". */
export function queueOnlyLead(why: QueueOnly): string {
  return `${WHY[why]}, so it’s decided there`
}

/** What the link says. */
export const QUEUE_ONLY_LINK = 'open it in the Queue'

/** The whole line as plain text, for a refusal or a tooltip. */
export function queueOnlyText(why: QueueOnly): string {
  return `${queueOnlyLead(why)}: ${QUEUE_ONLY_LINK}.`
}

/** The Queue page opened on one item (it reads the row's id from the
 *  hash). */
export function queueItemHref(id: string): string {
  return `/admin/queue#${encodeURIComponent(id)}`
}
