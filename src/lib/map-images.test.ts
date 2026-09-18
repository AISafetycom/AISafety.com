import { describe, expect, it } from 'vitest'
import { MAP_BACKGROUND_URL, isPlacedOnMap, mapImageUrls } from './map-images'

const placed = (mapLogo: string | null) => ({ x: 10, y: 20, mapLogo })

describe('isPlacedOnMap', () => {
  it('needs both coordinates', () => {
    expect(isPlacedOnMap(placed('https://cdn.test/a.png'))).toBe(true)
    expect(isPlacedOnMap({ x: 10, y: null, mapLogo: null })).toBe(false)
    expect(isPlacedOnMap({ x: null, y: 20, mapLogo: null })).toBe(false)
  })

  it('treats zero as a real coordinate', () => {
    expect(isPlacedOnMap({ x: 0, y: 0, mapLogo: null })).toBe(true)
  })
})

describe('mapImageUrls', () => {
  it('starts with the background, then the placed logos in order', () => {
    expect(
      mapImageUrls([
        placed('https://cdn.test/a.png'),
        placed('https://cdn.test/b.svg'),
      ])
    ).toEqual([
      MAP_BACKGROUND_URL,
      'https://cdn.test/a.png',
      'https://cdn.test/b.svg',
    ])
  })

  it('skips listings the map does not draw and listings without a logo', () => {
    expect(
      mapImageUrls([
        { x: null, y: null, mapLogo: 'https://cdn.test/unplaced.png' },
        placed(null),
        placed('https://cdn.test/a.png'),
      ])
    ).toEqual([MAP_BACKGROUND_URL, 'https://cdn.test/a.png'])
  })

  it('lists a shared logo once', () => {
    expect(
      mapImageUrls([
        placed('https://cdn.test/a.png'),
        placed('https://cdn.test/a.png'),
      ])
    ).toEqual([MAP_BACKGROUND_URL, 'https://cdn.test/a.png'])
  })
})
