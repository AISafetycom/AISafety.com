import { describe, expect, it } from 'vitest'
import { fableChangesOf } from './queue-fable'

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
