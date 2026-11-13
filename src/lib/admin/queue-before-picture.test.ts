import { describe, expect, it } from 'vitest'
import { beforePath, isSpent, storedPictures } from './queue-before-picture'

describe('beforePath', () => {
  it('names a copy by its bytes, with the extension its type gives', () => {
    const bytes = new TextEncoder().encode('<svg/>')
    const path = beforePath(bytes, 'image/svg+xml')
    expect(path).toMatch(/^queue\/before\/[0-9a-f]{16}\.svg$/)
    // The same file is the same copy; another file is another.
    expect(beforePath(bytes, 'image/svg+xml')).toBe(path)
    expect(
      beforePath(new TextEncoder().encode('<svg />'), 'image/svg+xml')
    ).not.toBe(path)
    expect(beforePath(bytes, 'image/jpeg; charset=binary')).toMatch(/\.jpg$/)
    expect(beforePath(bytes, '')).toMatch(/^queue\/before\/[0-9a-f]{16}$/)
  })
})

describe('storedPictures', () => {
  it('reads Airtable’s attachments in order, and nothing else', () => {
    expect(
      storedPictures([
        { id: 'att1', url: 'https://a/1.png', filename: '1.png', size: 5 },
        { id: 'att2' },
        'not a picture',
        { id: 'att3', url: 'https://a/3.png', filename: '' },
      ])
    ).toEqual([
      { url: 'https://a/1.png', filename: '1.png', type: undefined, size: 5 },
      {
        url: 'https://a/3.png',
        filename: 'image',
        type: undefined,
        size: undefined,
      },
    ])
    expect(storedPictures(null)).toEqual([])
    expect(storedPictures('aisum26.svg')).toEqual([])
  })
})

describe('isSpent', () => {
  it('is true only for an Airtable link that has run out', () => {
    const spent =
      'https://v5.airtableusercontent.com/v3/u/58/58/1700000000000/a/b/c'
    const fresh =
      'https://v5.airtableusercontent.com/v3/u/58/58/4102444800000/a/b/c'
    const blob =
      'https://store.public.blob.vercel-storage.com/queue/before/ab.svg'
    expect(isSpent([{ url: spent, filename: 'x.svg' }])).toBe(true)
    expect(isSpent([{ url: fresh, filename: 'x.svg' }])).toBe(false)
    expect(isSpent([{ url: blob, filename: 'x.svg' }])).toBe(false)
    expect(isSpent([])).toBe(false)
    expect(isSpent('aisum26.svg')).toBe(false)
  })
})
