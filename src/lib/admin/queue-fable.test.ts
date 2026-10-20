import { describe, expect, it } from 'vitest'
import { fableChangesOf, wentOut, wentOutNote } from './queue-fable'

describe('fableChangesOf', () => {
  it('keeps the first "before" and the last "after" of a field', () => {
    const list = fableChangesOf([
      { changed: [{ field: 'Name', from: 'A', to: 'B' }] },
      {},
      { changed: [{ field: 'Name', from: 'B', to: 'C' }] },
    ])
    expect(list).toEqual([{ field: 'Name', from: 'A', to: 'C' }])
  })

  it('drops a field changed and then changed back', () => {
    const list = fableChangesOf([
      { changed: [{ field: 'Name', from: 'A', to: 'B' }] },
      { changed: [{ field: 'Name', from: 'B', to: 'A' }] },
    ])
    expect(list).toEqual([])
  })

  it('compares pictures by their Airtable ids, not their links', () => {
    const old = [{ id: 'att1', url: 'https://x/1?sig=a', filename: 'a.png' }]
    const again = [{ id: 'att1', url: 'https://x/1?sig=b', filename: 'a.png' }]
    const fresh = [{ id: 'att2', url: 'https://x/2', filename: 'b.webp' }]
    expect(
      fableChangesOf([
        { changed: [{ field: 'Logo', from: old, to: fresh }] },
        { changed: [{ field: 'Logo', from: fresh, to: again }] },
      ])
    ).toEqual([])
    expect(
      fableChangesOf([{ changed: [{ field: 'Logo', from: old, to: fresh }] }])
    ).toHaveLength(1)
  })
})

describe('wentOut', () => {
  it('names the fields whose value is the one the row saved', () => {
    expect(
      wentOut(
        { Description: 'New words.', Name: 'Panel' },
        { Description: 'New words.', Name: 'Tech Policy Panel' }
      )
    ).toEqual(['Description'])
  })

  it('ignores spaces at the ends and around commas', () => {
    expect(
      wentOut(
        { Description: ' New words. ', Type: 'Talk,Panel' },
        { Description: 'New words.', Type: 'Talk, Panel' }
      )
    ).toEqual(['Description', 'Type'])
  })

  it('counts nothing when the row saved no edits', () => {
    expect(wentOut({ Description: 'New words.' }, {})).toEqual([])
  })
})

describe('wentOutNote', () => {
  it('says the edits went out with the decision', () => {
    expect(wentOutNote(['Description'], ['Description'], 'Publish')).toBe(
      'Went out with Publish'
    )
  })

  it('says they were not applied', () => {
    expect(wentOutNote(['Description'], [], 'Publish')).toBe('Not applied')
  })

  it('names which went out and which did not', () => {
    expect(
      wentOutNote(['Name', 'Description', 'Cost'], ['Description'], 'Publish')
    ).toBe('Description went out with Publish; Name and Cost were not applied')
    expect(
      wentOutNote(
        ['Name', 'Description', 'Cost', 'Type'],
        ['Name', 'Description', 'Cost'],
        'Apply change'
      )
    ).toBe(
      'Name, Description, and Cost went out with Apply change; Type was not applied'
    )
  })
})
