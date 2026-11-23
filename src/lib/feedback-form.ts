// Opens the site's correction and feedback form (FeedbackPopover, mounted
// once in the root layout) from anywhere: the selection menu, the footer's
// links, a page's "Suggest a correction" button, the Field map's "Suggest
// correction" item, links in a page's text (FeedbackFormLink), the chatbot's
// correction and feedback buttons. Each sends a window event
// with what it knows, so none of them has to hold the form itself.

import type { PageBox } from '@/components/Popover'
import type { FeedbackKind } from '@/lib/site-feedback'

/** Where the form was opened from, for analytics. */
export type FeedbackEntry =
  | 'selection'
  | 'footer'
  | 'contribute'
  | 'map'
  | 'page'
  | 'chatbot'

export interface FeedbackRequest {
  kind: FeedbackKind
  entry: FeedbackEntry
  /** The button or link that opened it: focus goes back to it on Escape, and
   *  pressing it again doesn't count as a click outside the form. An item
   *  on the Field map's picture is an SVG element. */
  trigger: HTMLElement | SVGElement
  /** What the form hangs from: the selected text, or the trigger's own box
   *  when left out. */
  anchor?: PageBox
  /** The selected text, from the selection menu. */
  quote?: string
  /** Where that text is on the page: it stays marked while the form is
   *  open, and the form's caret points at its first or last line. */
  range?: Range
  /** The card's listing, when the text was on one. */
  listing?: { name: string; id?: string }
  /** The corrections table's Resource choice, when the page tells it. */
  resource?: string
  /** The Airtable form the same button used to open: offered if sending
   *  fails, and still where Cmd-click or a middle click goes. */
  fallbackHref: string
}

export const FEEDBACK_FORM_EVENT = 'aisafety:feedback-form'

export function openFeedbackForm(request: FeedbackRequest): void {
  window.dispatchEvent(
    new CustomEvent<FeedbackRequest>(FEEDBACK_FORM_EVENT, { detail: request })
  )
}

/** A click that should open the form in place: a plain left click. Cmd,
 *  Ctrl, Shift or a middle click keeps the link's own behavior (the Airtable
 *  form in a new tab or window). */
export function isPlainClick(e: {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}
