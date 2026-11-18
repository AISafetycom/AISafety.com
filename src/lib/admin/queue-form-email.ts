/*
  The form email of an item he has dealt with (Bryce, 18 Nov 2026, on a
  Suggest a Correction email still unread minutes after he accepted its
  change: "when I accept a change, or indeed reject it, basically do
  anything with it, then the email that caused the change … if it doesn't
  have a submitter's email, it should be marked as read").

  Every form submission also lands in his Gmail as "Airtable forms: someone
  has responded to …". When the form left an address, he answers in that
  thread and the email is his to deal with. When it left none, the Queue
  item is all there is to do, so once he has dealt with the item the page
  asks the Mac agent to mark that one email read (~/Queue actions.py,
  `mark_read`). The Mac re-reads the row and decides for itself; this only
  says when to ask. An Undo asks again, and the Mac marks the email unread
  again. The Mac's worker does the same within minutes when the agent is
  not reachable.
*/

/** What the page does to an item that counts as dealing with it, plus the
 *  Undo that takes one of them back. */
const FOLLOWED = new Set(['accept', 'reject', 'later', 'delete', 'undo'])

/** Pure: whether the Mac should look at this item's form email after
 *  `action` landed. Only a form submission with nobody to reply to. */
export function formEmailFollows(
  item: { source: string; replyTo?: string | null },
  action: string
): boolean {
  return item.source === 'Form' && !item.replyTo && FOLLOWED.has(action)
}
