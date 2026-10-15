import { describe, expect, it } from 'vitest'
import { LEFT_OUT_KEY, leftOutOf, withLeftOut } from './queue-left-out'

describe('leftOutOf', () => {
  const proposed = ['Deadline', 'Stipend', 'Description']

  it('reads the saved names in the proposal’s order, once each', () => {
    expect(leftOutOf(['Description', 'Stipend', 'Stipend'], proposed)).toEqual([
      'Stipend',
      'Description',
    ])
  })

  it('drops a name the item no longer proposes, and anything not a name', () => {
    expect(leftOutOf(['Logo', 'Stipend', 3, null], proposed)).toEqual([
      'Stipend',
    ])
  })

  it('is empty for nothing saved, or something that is not a list', () => {
    expect(leftOutOf(undefined, proposed)).toEqual([])
    expect(leftOutOf('Stipend', proposed)).toEqual([])
  })
})

describe('withLeftOut', () => {
  it('adds the list under its own key', () => {
    expect(withLeftOut({ Deadline: '21 October 2026' }, ['Stipend'])).toEqual({
      Deadline: '21 October 2026',
      [LEFT_OUT_KEY]: ['Stipend'],
    })
  })

  it('leaves the edits as they are when nothing is left out', () => {
    const edits = { Deadline: '21 October 2026' }
    expect(withLeftOut(edits, [])).toBe(edits)
  })
})
