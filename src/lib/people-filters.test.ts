import { describe, expect, it } from 'vitest'
import {
  EMPTY_PEOPLE_FILTERS,
  describePeopleFilters,
  hoursBucketFor,
  matchesPeopleFilters,
  peopleFilterOptions,
  regionForTimeZone,
  sanitizePeopleFilters,
  trackRecordFor,
} from './people-filters'

const aisha = {
  focusAreas: ['Agent safety', 'Forecasting & strategy'],
  hoursBucket: '20+ hours',
  region: 'Asia',
  track: ['Completed a project', 'Has public artifacts'],
}
const jonas = {
  focusAreas: ['Interpretability'],
  hoursBucket: null,
  region: 'Europe',
  track: ['Led a project'],
}
// Kenya isn't a Region — REGIONS is the fixed continent bucket (`regionForTimeZone`
// would map Africa/Nairobi to 'Africa'), and "Ton of evals for AI safety work"
// isn't a TrackRecord option (TRACK_RECORD_OPTIONS is fixed too, not free text).
// Both fixed to real option values so tim actually exercises the filters below.
const tim = {
  focusAreas: ['Evals'],
  hoursBucket: null,
  region: 'Africa',
  track: ['Completed a project', 'Has public artifacts'],
}
const options = peopleFilterOptions([aisha, jonas])

describe('derived facets', () => {
  it('buckets hours per week and leaves unknown capacity out of every bucket', () => {
    expect(hoursBucketFor(5)).toBe('Up to 10 hours')
    expect(hoursBucketFor(10)).toBe('Up to 10 hours')
    expect(hoursBucketFor(15)).toBe('10–20 hours')
    expect(hoursBucketFor(29)).toBe('20+ hours')
    expect(hoursBucketFor(null)).toBeNull()
  })

  it('maps IANA zones to the coarse regions', () => {
    expect(regionForTimeZone('Europe/London')).toBe('Europe')
    expect(regionForTimeZone('America/Los_Angeles')).toBe('Americas')
    expect(regionForTimeZone('Asia/Singapore')).toBe('Asia')
    expect(regionForTimeZone('Australia/Sydney')).toBe('Australia & Pacific')
  })

  it('reads a track record off the project history', () => {
    const projects = [
      { status: 'Completed', role: 'Project member', artifacts: [] },
      { status: 'Active', role: 'Project lead', artifacts: [{}] },
    ]
    expect(trackRecordFor(projects, 0)).toEqual([
      'Led a project',
      'Completed a project',
      'Has public artifacts',
    ])
    expect(trackRecordFor([], 0)).toEqual([])
    expect(trackRecordFor([], 2)).toEqual(['Has public artifacts'])
  })
})

describe('peopleFilterOptions', () => {
  it('lists focus labels by frequency and only regions that occur', () => {
    expect(options.focus).toEqual([
      'Agent safety',
      'Forecasting & strategy',
      'Interpretability',
    ])
    expect(options.region).toEqual(['Europe', 'Asia'])
    expect(options.hours).toHaveLength(3)
  })

  it("picks up a new person's focus area and region", () => {
    const withTim = peopleFilterOptions([aisha, jonas, tim])
    expect(withTim.focus).toContain('Evals')
    // REGIONS order (Europe, Americas, Asia, Australia & Pacific, Africa),
    // filtered to what's present — not insertion order.
    expect(withTim.region).toEqual(['Europe', 'Asia', 'Africa'])
  })
})

describe('matchesPeopleFilters', () => {
  it('passes everyone when nothing is selected', () => {
    expect(matchesPeopleFilters(aisha, EMPTY_PEOPLE_FILTERS)).toBe(true)
  })

  it('ORs within a group and ANDs across groups', () => {
    expect(
      matchesPeopleFilters(aisha, {
        ...EMPTY_PEOPLE_FILTERS,
        focus: ['Interpretability', 'Agent safety'],
        region: ['Asia'],
      })
    ).toBe(true)
    expect(
      matchesPeopleFilters(aisha, {
        ...EMPTY_PEOPLE_FILTERS,
        focus: ['Agent safety'],
        region: ['Europe'],
      })
    ).toBe(false)
  })

  it('never matches an hours bucket for someone with unknown capacity', () => {
    const filters = { ...EMPTY_PEOPLE_FILTERS, hours: ['Up to 10 hours'] }
    expect(matchesPeopleFilters(jonas, filters)).toBe(false)
    expect(matchesPeopleFilters(jonas, filters, 'hours')).toBe(true)
  })

  it('matches on a track record with more than one entry', () => {
    expect(
      matchesPeopleFilters(tim, {
        ...EMPTY_PEOPLE_FILTERS,
        focus: ['Evals'],
        region: ['Africa'],
        track: ['Has public artifacts'],
      })
    ).toBe(true)
    expect(
      matchesPeopleFilters(tim, { ...EMPTY_PEOPLE_FILTERS, region: ['Europe'] })
    ).toBe(false)
  })
})

describe('sanitizePeopleFilters', () => {
  it('drops values that are not option labels and unknown keys', () => {
    expect(
      sanitizePeopleFilters(
        {
          focus: ['Agent safety', 'agent safety', 'quantum'],
          region: 'Europe',
          colour: ['red'],
        },
        options
      )
    ).toEqual({ focus: ['Agent safety'], region: ['Europe'] })
  })

  it('keeps an explicit empty array (a clear) and omits untouched keys', () => {
    expect(sanitizePeopleFilters({ track: [] }, options)).toEqual({ track: [] })
    expect(sanitizePeopleFilters(null, options)).toEqual({})
  })
})

describe('describePeopleFilters', () => {
  it('describes a filter set the way the tool pill shows it', () => {
    expect(
      describePeopleFilters({
        focus: ['Agent safety'],
        region: [],
        track: ['Led a project'],
      })
    ).toBe('Focus: Agent safety · Location: any · Track record: Led a project')
  })
})
