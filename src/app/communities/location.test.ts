import { describe, expect, it } from 'vitest'
import { coveredCountries, locationCountries } from './location'

describe('locationCountries', () => {
  it('takes the country after the comma', () => {
    expect(locationCountries('London, UK')).toEqual(['UK'])
  })

  it('uses the text after the last comma when there are several', () => {
    expect(locationCountries('Seattle, WA, USA')).toEqual(['USA'])
  })

  it('uses a value with no comma whole', () => {
    expect(locationCountries('India')).toEqual(['India'])
  })

  it('leaves out regions', () => {
    expect(locationCountries('Latin America')).toEqual([])
    expect(locationCountries('East Africa')).toEqual([])
  })

  it('splits places joined with " & "', () => {
    expect(locationCountries('Australia & New Zealand')).toEqual([
      'Australia',
      'New Zealand',
    ])
    expect(locationCountries('Delft, Netherlands & Leuven, Belgium')).toEqual([
      'Netherlands',
      'Belgium',
    ])
  })

  it('lists a country once when two places share it', () => {
    expect(locationCountries('Delhi, India & Bengaluru, India')).toEqual([
      'India',
    ])
  })

  it('returns nothing for an online-only community', () => {
    expect(locationCountries(null)).toEqual([])
    expect(locationCountries('')).toEqual([])
  })
})

describe('coveredCountries', () => {
  it('expands a region to its member countries', () => {
    expect(coveredCountries('Europe')).toContain('Germany')
    expect(coveredCountries('Latin America')).toContain('Ecuador')
    expect(coveredCountries('East Africa')).toContain('Kenya')
  })

  it('keeps a plain country as it is', () => {
    expect(coveredCountries('Berlin, Germany')).toEqual(['Germany'])
  })

  it('returns nothing for an online-only community', () => {
    expect(coveredCountries(null)).toEqual([])
  })
})
