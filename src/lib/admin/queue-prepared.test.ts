import { describe, expect, it } from 'vitest'
import {
  preparedFilesOf,
  preparedFor,
  preparedNamed,
  withPreparedPictures,
  type PreparedFile,
} from './queue-prepared'

const card = {
  id: 'att00000000000001',
  url: 'https://v5.airtableusercontent.com/v3/u/1/card',
  filename: 'heron.webp',
  size: 4000,
  width: 250,
  height: 120,
  type: 'image/webp',
}
const pin = {
  ...card,
  url: 'https://v5.airtableusercontent.com/v3/u/1/pin',
  filename: 'heron-map.webp',
  size: 3000,
}

describe('preparedFilesOf', () => {
  it('reads the files on the Prepared logo field', () => {
    expect(preparedFilesOf([card, pin]).map(f => f.filename)).toEqual([
      'heron.webp',
      'heron-map.webp',
    ])
    expect(preparedFilesOf([card])[0]).toEqual({
      url: card.url,
      filename: 'heron.webp',
      size: 4000,
      width: 250,
      height: 120,
      type: 'image/webp',
    })
  })

  it('leaves out what is not a file, and a link that has run out', () => {
    expect(preparedFilesOf(undefined)).toEqual([])
    expect(preparedFilesOf([{ url: 'x' }, 'heron.webp', null])).toEqual([])
    expect(preparedFilesOf([card, pin], u => u === card.url)).toHaveLength(1)
  })
})

describe('preparedFor', () => {
  const files = preparedFilesOf([pin, card])
  it('pairs the -map file with a map field and the other with the rest', () => {
    expect(preparedFor('Logo (for map)', files)?.filename).toBe(
      'heron-map.webp'
    )
    expect(preparedFor('Logo (for cards)', files)?.filename).toBe('heron.webp')
    expect(preparedFor('Logo', files)?.filename).toBe('heron.webp')
    expect(preparedFor('Logo (for map)', preparedFilesOf([card]))).toBeNull()
  })

  it('finds a file by name, and by size when both know it', () => {
    expect(preparedNamed('heron.webp', 4000, files)?.url).toBe(card.url)
    expect(preparedNamed('heron.webp', null, files)?.url).toBe(card.url)
    expect(preparedNamed('heron.webp', 5, files)).toBeNull()
    expect(preparedNamed('other.webp', null, files)).toBeNull()
  })
})

describe('withPreparedPictures', () => {
  const files: PreparedFile[] = preparedFilesOf([card, pin])
  const raw = 'https://heron.ai/logo.png'

  it("puts the prepared file in place of a change's raw picture", () => {
    const changes = [
      { field: 'Logo (for cards)', from: 'old.png', to: [{ url: raw }] },
      { field: 'Logo (for map)', from: null, to: { url: raw } },
      { field: 'Description', from: 'a', to: 'b' },
    ]
    expect(withPreparedPictures(changes, changes, files)).toEqual([
      {
        field: 'Logo (for cards)',
        from: 'old.png',
        to: [{ url: card.url, filename: 'heron.webp' }],
      },
      {
        field: 'Logo (for map)',
        from: null,
        to: [{ url: pin.url, filename: 'heron-map.webp' }],
      },
      { field: 'Description', from: 'a', to: 'b' },
    ])
  })

  it('leaves a picture copied from another listing as it is', () => {
    const copied = {
      field: 'Logo',
      from: 'old.png',
      to: [{ url: 'https://v5.airtableusercontent.com/other' }],
    }
    const rawChanges = [
      { ...copied, copy_from: { table: 'tblvzbGL9q9dOO9Nc', record: 'recX' } },
    ]
    expect(withPreparedPictures([copied], rawChanges, files)).toEqual([copied])
    // one hosted on this row (an embedded picture) reads fresh
    const hosted = [
      {
        ...copied,
        copy_from: { table: 'tblonlKwIFJ7Aa8QN', record: 'recRow' },
      },
    ]
    expect(withPreparedPictures([copied], hosted, files)[0].to).toEqual([
      { url: card.url, filename: 'heron.webp' },
    ])
  })

  it('changes nothing without prepared files, or for an emptied field', () => {
    const changes = [{ field: 'Logo', from: 'old.png', to: [{ url: raw }] }]
    expect(withPreparedPictures(changes, changes, [])).toBe(changes)
    const cleared = [{ field: 'Logo', from: 'old.png', to: null }]
    expect(withPreparedPictures(cleared, cleared, files)).toEqual(cleared)
  })
})
