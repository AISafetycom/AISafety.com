import { describe, expect, it } from 'vitest'
import {
  placePopover,
  selectionLines,
  type Box,
  type PlaceInput,
} from './popover-placement'

const box = (
  left: number,
  top: number,
  right: number,
  bottom: number
): Box => ({
  left,
  top,
  right,
  bottom,
})

// A 1440 x 900 screen scrolled to the top, less a 96px nav bar and 16px
// margins.
const view = box(16, 96, 1424, 884)

function input(over: Partial<PlaceInput>): PlaceInput {
  const anchor = over.anchor ?? box(300, 200, 600, 300)
  return {
    anchor,
    first: anchor,
    last: anchor,
    width: 360,
    height: 400,
    view,
    gap: 12,
    caretInset: 24,
    ...over,
  }
}

describe('placePopover', () => {
  it('goes under the anchor when it fits, centered on its last line', () => {
    const last = box(300, 280, 400, 300)
    const p = placePopover(input({ last }))
    expect(p.side).toBe('below')
    expect(p.top).toBe(312)
    expect(p.left).toBe(350 - 180)
    expect(p.caret).toBe(180)
    expect(p.scroll).toBe(0)
  })

  it('goes above when there is no room under, pointing at the first line', () => {
    const anchor = box(300, 600, 600, 700)
    const first = box(450, 600, 600, 620)
    const p = placePopover(input({ anchor, first, last: anchor }))
    expect(p.side).toBe('above')
    expect(p.top).toBe(600 - 12 - 400)
    expect(p.caret).toBe(525 - p.left)
  })

  it('goes beside the text when neither above nor under fits', () => {
    // A long selection in the middle of the screen: 400px tall either side
    // won't fit, the right side has room.
    const anchor = box(300, 350, 600, 650)
    const last = box(300, 630, 500, 650)
    const p = placePopover(input({ anchor, last }))
    expect(p.side).toBe('right')
    expect(p.left).toBe(612)
    // Its middle level with the last line.
    expect(p.top).toBe(640 - 200)
    expect(p.caret).toBe(200)
  })

  it('beside the text, stays on screen and moves the caret instead', () => {
    const anchor = box(300, 350, 600, 860)
    const last = box(300, 840, 500, 860)
    const p = placePopover(input({ anchor, last }))
    expect(p.side).toBe('right')
    expect(p.top).toBe(884 - 400)
    expect(p.caret).toBe(850 - p.top)
  })

  it('goes to the left when only the left has room', () => {
    const anchor = box(900, 350, 1400, 650)
    const p = placePopover(input({ anchor }))
    expect(p.side).toBe('left')
    expect(p.left).toBe(900 - 12 - 360)
  })

  it('on a phone, goes under and scrolls the page to show it', () => {
    const phone = box(16, 96, 359, 796)
    const anchor = box(20, 400, 355, 700)
    const last = box(20, 680, 200, 700)
    const p = placePopover(
      input({ anchor, last, view: phone, width: 343, height: 450 })
    )
    expect(p.side).toBe('below')
    expect(p.top).toBe(712)
    expect(p.left).toBe(16)
    // 712 + 450 - 796 = 366 down, which keeps the last line (680) on screen
    // below the nav (96).
    expect(p.scroll).toBe(366)
  })

  it('never scrolls the last line under the nav bar', () => {
    const phone = box(16, 96, 359, 796)
    const anchor = box(20, 150, 355, 300)
    const p = placePopover(
      input({ anchor, view: phone, width: 343, height: 900 })
    )
    expect(p.side).toBe('below')
    expect(p.scroll).toBe(150 - 96)
  })

  it('keeps the side it opened on', () => {
    const p = placePopover(input({ side: 'above' }))
    expect(p.side).toBe('above')
  })

  it('keeps the caret off the rounded corners', () => {
    const last = box(16, 280, 30, 300)
    const p = placePopover(input({ last }))
    expect(p.left).toBe(16)
    expect(p.caret).toBe(24)
  })
})

describe('selectionLines', () => {
  it('finds the first and last lines', () => {
    const lines = selectionLines([
      box(120, 100, 400, 120),
      box(100, 120, 400, 140),
      box(100, 140, 250, 160),
    ])
    expect(lines).toEqual({
      first: box(120, 100, 400, 120),
      last: box(100, 140, 250, 160),
    })
  })

  it('joins the boxes on one line and leaves out a whole paragraph', () => {
    const lines = selectionLines([
      box(100, 100, 400, 160), // the <p> itself
      box(100, 100, 200, 120),
      box(200, 101, 300, 119), // a link on the same line
      box(100, 140, 150, 160),
      box(0, 0, 0, 0),
    ])
    expect(lines?.first).toEqual(box(100, 100, 300, 120))
    expect(lines?.last).toEqual(box(100, 140, 150, 160))
  })

  it('has nothing for an empty selection', () => {
    expect(selectionLines([])).toBeUndefined()
  })
})
