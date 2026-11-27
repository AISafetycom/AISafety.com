import { describe, expect, it } from 'vitest'
import { publishWaits, readDue, readStands } from './queue-record-read'

const fresh = { stale: false, expired: false }

describe('when the page reads a record', () => {
  it('reads one it has no read of', () => {
    expect(readDue(null, undefined, 0)).toBe(true)
  })
  it('leaves alone one whose read still holds', () => {
    expect(readDue(fresh, undefined, 0)).toBe(false)
    expect(readDue({ expired: false }, undefined, 3)).toBe(false)
  })
  it('reads again one it wrote to, or a chat reply may have changed', () => {
    expect(readDue({ ...fresh, stale: true }, undefined, 1)).toBe(true)
  })
  it('reads again one whose picture links have run out', () => {
    expect(readDue({ ...fresh, expired: true }, undefined, 0)).toBe(true)
  })
  it('starts no second read while the one it wants is on its way', () => {
    // The list was read again, or the row: nothing about the record moved.
    expect(readDue(null, 0, 0)).toBe(false)
    expect(readDue({ ...fresh, stale: true }, 1, 1)).toBe(false)
    expect(readDue({ ...fresh, expired: true }, 2, 2)).toBe(false)
  })
  it('starts a new one when the record may have moved since that read began', () => {
    expect(readDue({ ...fresh, stale: true }, 1, 2)).toBe(true)
    expect(readDue(null, 0, 1)).toBe(true)
  })
})

describe('a read that lands', () => {
  it('stands when nothing moved the record since it began', () => {
    expect(readStands(2, 2)).toBe(true)
  })
  it('is thrown away when something did', () => {
    expect(readStands(1, 2)).toBe(false)
  })
})

describe('whether Publish waits for the read', () => {
  const pressed = {
    publishes: true,
    inFocus: true,
    readFailed: false,
    shown: null,
  }
  it('waits while the item in focus has no read that holds', () => {
    expect(publishWaits(pressed)).toBe(true)
  })
  it('goes once the page holds a read', () => {
    expect(publishWaits({ ...pressed, shown: 'ab'.repeat(32) })).toBe(false)
  })
  it('does not wait for a read that failed: the site says what is wrong', () => {
    expect(publishWaits({ ...pressed, readFailed: true })).toBe(false)
  })
  it('does not hold an item that is not in focus, whose record nobody is reading', () => {
    expect(publishWaits({ ...pressed, inFocus: false })).toBe(false)
  })
  it('asks nothing of what publishes no record', () => {
    // A reject, a change, a rule, a decided item.
    expect(publishWaits({ ...pressed, publishes: false })).toBe(false)
  })
})
