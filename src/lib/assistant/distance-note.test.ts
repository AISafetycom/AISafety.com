import { describe, expect, it } from 'vitest'
import { distanceNote } from './distance-note'

describe('distanceNote', () => {
  it('names the searched city as the place distances are measured from', () => {
    // The real slip: a search around a bigger city near the visitor's guessed
    // town, with its distance repeated to them as "about 25 km away".
    const note = distanceNote({ city: 'Leuven', radiusKm: 150 }, true)
    expect(note).toContain('the center of "Leuven"')
    expect(note).toContain('only if they named that place themselves')
    expect(note).toContain('do NOT quote a distance')
  })

  it('says "coordinates" when the search was by lat and lng', () => {
    const note = distanceNote({ lat: 50.83, lng: 5.1, city: 'Leuven' }, true)
    expect(note).toContain('the coordinates you searched')
    expect(note).not.toContain('Leuven')
  })

  it('stays silent when the search was not a geo search', () => {
    expect(distanceNote(undefined, true)).toBeNull()
    expect(distanceNote({ radiusKm: 200 }, true)).toBeNull()
    expect(distanceNote({ city: '  ' }, true)).toBeNull()
  })

  it('stays silent when no result carries a distance', () => {
    // Listings without coordinates match on their location text instead.
    expect(distanceNote({ city: 'Berlin' }, false)).toBeNull()
  })
})
