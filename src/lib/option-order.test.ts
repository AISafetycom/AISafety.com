import { describe, expect, it } from 'vitest'
import { inOptionOrder } from './option-order'

describe('inOptionOrder', () => {
  const options = ['Individuals', 'Nonprofits', 'For-profits', 'Universities']

  it('puts the values in the order of the options', () => {
    expect(inOptionOrder(['Universities', 'Nonprofits'], options)).toEqual([
      'Nonprofits',
      'Universities',
    ])
  })

  it('puts unknown values last, in their own order', () => {
    expect(
      inOptionOrder(['Zeta', 'Universities', 'Alpha', 'Individuals'], options)
    ).toEqual(['Individuals', 'Universities', 'Zeta', 'Alpha'])
  })

  it('leaves the original array alone', () => {
    const values = ['Universities', 'Nonprofits']
    inOptionOrder(values, options)
    expect(values).toEqual(['Universities', 'Nonprofits'])
  })
})
