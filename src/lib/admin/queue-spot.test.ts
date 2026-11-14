import { describe, expect, it } from 'vitest'
import { MAP_TABLE_ID } from './map-editor-core'
import { spotOf, tidySpot, wantsSpot, withSpot } from './queue-spot'

describe('wantsSpot', () => {
  it('is for additions to the Field map only', () => {
    expect(wantsSpot({ type: 'Add', targetTable: MAP_TABLE_ID })).toBe(true)
    expect(wantsSpot({ type: 'Change', targetTable: MAP_TABLE_ID })).toBe(false)
    expect(wantsSpot({ type: 'Add', targetTable: 'tblOther' })).toBe(false)
    expect(wantsSpot({ type: 'Add', targetTable: null })).toBe(false)
  })
})

describe('spotOf', () => {
  it('reads the record, with the edits over it', () => {
    expect(spotOf({ x: 3, y: 4 }, {})).toEqual({ x: 3, y: 4 })
    expect(spotOf({ x: 3, y: 4 }, { x: '5.5' })).toEqual({ x: 5.5, y: 4 })
    expect(spotOf({}, { x: '0', y: '12.3' })).toEqual({ x: 0, y: 12.3 })
  })

  it('is null while either is missing', () => {
    expect(spotOf({}, {})).toBeNull()
    expect(spotOf({ x: 3, y: null }, {})).toBeNull()
    expect(spotOf({ x: 3, y: 4 }, { y: '' })).toBeNull()
    expect(spotOf({}, { x: 'left', y: '2' })).toBeNull()
  })
})

describe('withSpot', () => {
  const suggested = { x: 34.8, y: 19.2 }

  it('fills an unplaced listing with the suggested spot', () => {
    expect(withSpot({ Description: 'New' }, {}, suggested)).toEqual({
      Description: 'New',
      x: '34.8',
      y: '19.2',
    })
  })

  it('leaves a place the record or the edits already hold', () => {
    expect(withSpot({}, { x: 1, y: 2 }, suggested)).toEqual({})
    const dragged = { x: '10', y: '11' }
    expect(withSpot(dragged, {}, suggested)).toEqual(dragged)
  })

  it('fills only the half that is missing', () => {
    expect(withSpot({ x: '10' }, {}, suggested)).toEqual({ x: '10', y: '19.2' })
  })

  it('changes nothing without a suggestion', () => {
    const edits = { Description: 'New' }
    expect(withSpot(edits, {}, null)).toBe(edits)
  })
})

describe('tidySpot', () => {
  it('rounds to one decimal and stays on the map', () => {
    expect(tidySpot(12.34, 5.67)).toEqual({ x: 12.3, y: 5.7 })
    expect(tidySpot(-4, 99)).toEqual({ x: 0, y: 32.7 })
  })
})
