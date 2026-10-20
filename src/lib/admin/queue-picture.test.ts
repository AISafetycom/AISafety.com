import { describe, expect, it } from 'vitest'
import {
  fileNameOf,
  hasExpiredPicture,
  isImageLink,
  namedFile,
  pictureOf,
  pictureUrl,
  touchesPicture,
} from './queue-picture'

// An Airtable link good for years, and one that ran out long ago.
const FRESH =
  'https://v5.airtableusercontent.com/v3/u/57/57/4102444800000/abc/def/ghi'
const DEAD =
  'https://v5.airtableusercontent.com/v3/u/57/57/1600000000000/abc/def/ghi'
const NEW_LOGO =
  'https://framerusercontent.com/images/6Cu8G9oIe8KZYR5vetb8hCcpo.png'

const liveLogo = (filename: string, url = FRESH, id = 'attcr29u6rPwhL4aQ') => [
  { id, filename, url },
]

describe('isImageLink / pictureUrl', () => {
  it('takes web links to pictures', () => {
    expect(isImageLink(NEW_LOGO)).toBe(true)
    expect(pictureUrl([{ url: NEW_LOGO, filename: 'x.png' }])).toBe(NEW_LOGO)
  })

  it('never takes a bare file name as a link', () => {
    // BASE Fellowship: Fall 2026, 30 Sept 2026 – shown as a broken picture.
    expect(isImageLink('10936428450340_1940eff4f75f04040399_88.webp')).toBe(
      false
    )
    expect(pictureUrl('arcadia_impact_logo-min.webp')).toBeNull()
  })
})

describe('namedFile / fileNameOf', () => {
  it('reads the file a text names', () => {
    expect(namedFile('1 (1) (1).png')).toBe('1 (1) (1).png')
    expect(namedFile('game-night.webp (old tree-in-circle badge)')).toBe(
      'game-night.webp'
    )
    expect(namedFile(NEW_LOGO)).toBeNull()
    expect(namedFile('A new logo')).toBeNull()
  })

  it('gives no name for an Airtable link (its path ends in a code)', () => {
    expect(fileNameOf(FRESH)).toBeNull()
    expect(fileNameOf(NEW_LOGO)).toBe('6Cu8G9oIe8KZYR5vetb8hCcpo.png')
  })
})

describe('pictureOf', () => {
  it("shows the record's picture for a bare file name that matches it", () => {
    const pic = pictureOf(
      'arcadia_impact_logo-min.webp',
      liveLogo('arcadia_impact_logo-min.webp'),
      { pictureField: true }
    )
    expect(pic).toEqual({
      url: FRESH,
      fallback: null,
      name: 'arcadia_impact_logo-min.webp',
    })
  })

  it('treats a bare file name as a picture before the live read arrives', () => {
    expect(pictureOf('logo.webp', undefined, { pictureField: true })).toEqual({
      url: null,
      fallback: null,
      name: 'logo.webp',
    })
  })

  it('leaves a bare file name as text in a field that holds no picture', () => {
    expect(pictureOf('notes.png is the old one', 'text')).toBeNull()
  })

  it('does not show the new picture as the old one after an Apply', () => {
    const pic = pictureOf(
      '10936428450340_1940eff4f75f04040399_88.webp',
      liveLogo('ChatGPT+Image+Sep+28,+2026,+09_59_55+AM.png'),
      { pictureField: true, open: false }
    )
    expect(pic).toEqual({
      url: null,
      fallback: null,
      name: '10936428450340_1940eff4f75f04040399_88.webp',
    })
  })

  it('matches by attachment id first', () => {
    const pic = pictureOf(
      [{ id: 'attcr29u6rPwhL4aQ', filename: 'old-name.webp' }],
      liveLogo('renamed.webp')
    )
    expect(pic?.url).toBe(FRESH)
  })

  it('swaps an expired link for the record picture while the item is open', () => {
    expect(pictureOf([DEAD], liveLogo('logo.png'))).toEqual({
      url: FRESH,
      fallback: null,
      name: 'logo.png',
    })
    // Once decided, the record may hold the new picture: the plain box.
    expect(pictureOf([DEAD], liveLogo('logo.png'), { open: false })).toEqual({
      url: null,
      fallback: null,
      name: null,
    })
  })

  it("keeps a working link and holds the record's picture in reserve", () => {
    const own = 'https://example.org/old-logo.png'
    expect(
      pictureOf([{ url: own, filename: 'logo.png' }], liveLogo('logo.png'))
    ).toEqual({ url: own, fallback: FRESH, name: 'logo.png' })
  })

  it('never offers an expired record link', () => {
    expect(
      pictureOf('logo.png', liveLogo('logo.png', DEAD), { pictureField: true })
    ).toEqual({ url: null, fallback: null, name: 'logo.png' })
  })

  it('takes any web link on the new side of a picture field', () => {
    expect(
      pictureOf('https://example.org/brand/mark', null, { pictureField: true })
        ?.url
    ).toBe('https://example.org/brand/mark')
  })
})

describe('text with a link in it', () => {
  it('shows the link in a note on the new side of a picture field', () => {
    // Threading the Needle on /map, 30 Sept 2026.
    const to =
      'new Substack publication logo – https://substackcdn.com/image/fetch/w_1024,h_1024,c_fill,f_auto,q_auto:good/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6aae100e-8d3f-403c-906f-c6baa6a5b00c_1230x1230.png'
    const pic = pictureOf(to, null, { pictureField: true })
    expect(pic?.url).toBe(to.slice(to.indexOf('https://')))
    expect(pic?.name).toBe('6aae100e-8d3f-403c-906f-c6baa6a5b00c_1230x1230.png')
  })

  it('leaves the note as text outside a picture field', () => {
    expect(pictureOf('see https://example.org/a.png for it', null)).toBeNull()
  })
})

describe('touchesPicture', () => {
  it('knows a picture field by its name', () => {
    expect(
      touchesPicture({ field: 'Logo (for cards)', from: 'a', to: 'b' })
    ).toBe(true)
    expect(touchesPicture({ field: 'Description', from: 'a', to: 'b' })).toBe(
      false
    )
  })

  it('spots a logo swap whose old side is a bare file name', () => {
    expect(touchesPicture({ from: 'logo.webp', to: NEW_LOGO })).toBe(true)
  })

  it('ignores a text change', () => {
    expect(touchesPicture({ from: 'Old name', to: 'New name' })).toBe(false)
  })
})

describe('hasExpiredPicture', () => {
  it('finds a run-out link in any shape', () => {
    expect(hasExpiredPicture({ Logo: [DEAD] })).toBe(true)
    expect(hasExpiredPicture({ Logo: [{ url: DEAD }] })).toBe(true)
    expect(hasExpiredPicture({ Logo: [FRESH], Name: 'x' })).toBe(false)
  })
})
