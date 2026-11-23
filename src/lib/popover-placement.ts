// Where a floating <Popover> goes next to what opened it, and where its caret
// points. Pure geometry in page coordinates (scroll included), so it can be
// tested without a browser; Popover.tsx measures and applies it.
//
// The popover never covers what it hangs from (Melissa, 23 November 2026:
// the selected text stays in view). It tries, in order: under it, above it,
// to its right, to its left. When none fits on screen (a tall form by a long
// selection on a phone), it goes under it and the page scrolls to show it,
// keeping the last line of the selection in view.

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

export type Side = 'below' | 'above' | 'right' | 'left'

export interface PlaceInput {
  /** What it hangs from and must not cover: a selection's whole box, or a
   *  button's. */
  anchor: Box
  /** The first and last lines of a selection (the anchor itself for a
   *  button): the caret points at the last line from below or beside, and at
   *  the first from above. */
  first: Box
  last: Box
  /** The popover's own size. */
  width: number
  height: number
  /** The part of the page on screen that it may use: the window less the
   *  nav bar and a margin. */
  view: Box
  /** Space between the anchor and the popover's edge (the caret sits in
   *  it). */
  gap: number
  /** Space kept between the caret and the popover's corners. */
  caretInset: number
  /** The side it opened on: it stays there while open, so a form growing as
   *  it's typed in doesn't jump. */
  side?: Side
}

export interface Placement {
  side: Side
  left: number
  top: number
  /** The caret's spot along its edge: from the popover's left for 'below'
   *  and 'above', from its top for 'right' and 'left'. */
  caret: number
  /** How far to scroll the page down to bring it on screen (0 when it
   *  already is). */
  scroll: number
}

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(n, max))
const centerX = (b: Box) => (b.left + b.right) / 2
const centerY = (b: Box) => (b.top + b.bottom) / 2

/** The side that fits, in order of preference; 'below' when none does. */
function pickSide(p: PlaceInput): Side {
  const { anchor, width, height, view, gap } = p
  const tallEnough = height <= view.bottom - view.top
  if (anchor.bottom + gap + height <= view.bottom) return 'below'
  if (anchor.top - gap - height >= view.top) return 'above'
  if (tallEnough && anchor.right + gap + width <= view.right) return 'right'
  if (tallEnough && anchor.left - gap - width >= view.left) return 'left'
  return 'below'
}

export function placePopover(p: PlaceInput): Placement {
  const { anchor, first, last, width, height, view, gap, caretInset } = p
  const side = p.side ?? pickSide(p)

  if (side === 'below' || side === 'above') {
    // Centered on the line it points at, kept on screen sideways.
    const line = side === 'below' ? last : first
    const maxLeft = Math.max(view.left, view.right - width)
    const left = clamp(centerX(line) - width / 2, view.left, maxLeft)
    const caret = clamp(
      centerX(line) - left,
      caretInset,
      Math.max(caretInset, width - caretInset)
    )
    const top =
      side === 'below' ? anchor.bottom + gap : anchor.top - gap - height
    // Off the bottom of the screen: scroll down to show it, but never so far
    // that the last line goes under the nav bar.
    const overflow = top + height - view.bottom
    const scroll =
      side === 'below' && overflow > 0
        ? Math.max(0, Math.min(overflow, last.top - view.top))
        : 0
    return { side, left, top, caret, scroll }
  }

  // Beside it, level with the last line, kept on screen up and down.
  const maxTop = Math.max(view.top, view.bottom - height)
  const top = clamp(centerY(last) - height / 2, view.top, maxTop)
  const caret = clamp(
    centerY(last) - top,
    caretInset,
    Math.max(caretInset, height - caretInset)
  )
  const left = side === 'right' ? anchor.right + gap : anchor.left - gap - width
  return { side, left, top, caret, scroll: 0 }
}

/** A selection's first and last lines, from its range's boxes (in screen
 *  coordinates, as getClientRects gives them). Boxes taller than a line
 *  (a whole paragraph the selection covers) are left out. */
export function selectionLines(
  rects: readonly Box[]
): { first: Box; last: Box } | undefined {
  const boxes = rects.filter(r => r.right > r.left && r.bottom > r.top)
  if (boxes.length === 0) return undefined
  const lineHeight = Math.min(...boxes.map(r => r.bottom - r.top))
  const lines = boxes.filter(r => r.bottom - r.top < lineHeight * 1.5)
  const top = Math.min(...lines.map(r => r.top))
  const bottom = Math.max(...lines.map(r => r.bottom))
  // The boxes on a line: those whose middle is within half a line of it.
  const row = (onLine: (r: Box) => boolean): Box => {
    const on = lines.filter(onLine)
    return {
      left: Math.min(...on.map(r => r.left)),
      right: Math.max(...on.map(r => r.right)),
      top: Math.min(...on.map(r => r.top)),
      bottom: Math.max(...on.map(r => r.bottom)),
    }
  }
  return {
    first: row(r => centerY(r) < top + lineHeight),
    last: row(r => centerY(r) > bottom - lineHeight),
  }
}
