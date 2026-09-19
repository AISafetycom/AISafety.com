import { describe, expect, it } from 'vitest'

import { isEmptyValue, missingFields } from './queue-needed'

// An event as Comb writes one, every needed field filled.
const EVENT = {
  Name: 'PauseAI South Korea',
  URL: 'https://luma.com/pauseai-smi8',
  Description: 'Casual session for people concerned about AI risk.',
  Type: ['Meetup'],
  Mode: 'Online',
  'Start date': '2026-10-07',
  'End date': '2026-10-07',
  'Host name': 'PauseAI',
  Cost: 'Free',
  Logo: ['https://example.com/logo.svg'],
  'Publish?': false,
  'Hide?': false,
  Featured: null,
}

describe('missingFields', () => {
  it('names the needed field an event leaves empty', () => {
    expect(missingFields('/events', { ...EVENT, Cost: null })).toEqual(['Cost'])
    expect(missingFields('/events', { ...EVENT, Cost: '  ' })).toEqual(['Cost'])
    expect(missingFields('/events', EVENT)).toEqual([])
  })

  it('never asks for housekeeping or an unknown page', () => {
    expect(missingFields('/events', EVENT)).not.toContain('Publish?')
    expect(missingFields('/events', EVENT)).not.toContain('Featured')
    expect(missingFields(null, {})).toEqual([])
    expect(missingFields('/jobs', {})).toEqual([])
  })

  it('wants a location only once the event is in person', () => {
    expect(missingFields('/events', EVENT)).not.toContain('Location')
    expect(missingFields('/events', { ...EVENT, Mode: 'In person' })).toEqual([
      'Location',
    ])
    expect(missingFields('/events', { ...EVENT, Mode: 'Hybrid' })).toEqual([
      'Location',
    ])
    expect(
      missingFields('/events', {
        ...EVENT,
        Mode: 'Hybrid',
        Location: 'Seoul, South Korea',
      })
    ).toEqual([])
  })

  it('wants a deadline and its type together', () => {
    expect(
      missingFields('/events', { ...EVENT, 'Deadline type': 'Register' })
    ).toEqual(['Deadline'])
    expect(
      missingFields('/events', { ...EVENT, Deadline: '2026-10-07' })
    ).toEqual(['Deadline type'])
  })

  it('lists every gap in the page’s order, matching names loosely', () => {
    expect(
      missingFields('/events', {
        name: 'x',
        url: 'https://x.org',
        mode: 'In person',
      })
    ).toEqual([
      'Description',
      'Type',
      'Start date',
      'End date',
      'Host name',
      'Cost',
      'Logo',
      'Location',
    ])
  })

  it('takes an approximate start date for a training program', () => {
    const training = {
      Name: 'x',
      URL: 'https://x.org',
      Description: 'y',
      Type: ['Course'],
      Mode: 'Online',
      Focus: ['Technical'],
      'Entry bar': 'Low',
      'Time commitment': 'Part-time',
      Stipend: 'No stipend',
      Logo: ['https://example.com/logo.png'],
    }
    expect(missingFields('/training', training)).toEqual(['Start date'])
    expect(
      missingFields('/training', {
        ...training,
        'Start date (approximate)': 'Early 2027',
      })
    ).toEqual([])
    expect(
      missingFields('/training', { ...training, 'Start date': '2027-01-10' })
    ).toEqual([])
  })

  it('wants a place and coordinates only for a local community', () => {
    const community = {
      Name: 'x',
      Link: 'https://x.org',
      Description: 'y',
      Logo: ['https://example.com/logo.png'],
      Platform: ['Discord'],
      Type: ['Discussion'],
      'Activity level': 'High',
      Focus: 'General',
    }
    expect(missingFields('/communities', community)).toEqual([])
    expect(
      missingFields('/communities', { ...community, Platform: ['Local'] })
    ).toEqual(['Location (if in-person)', 'Latitude', 'Longitude'])
    expect(
      missingFields('/communities', {
        ...community,
        Platform: ['Local'],
        'Location (if in-person)': 'Seoul, South Korea',
        Latitude: 37.5665,
        Longitude: 126.978,
      })
    ).toEqual([])
  })

  it('wants a tagline only once the record is featured', () => {
    const funding = {
      Name: 'x',
      Website: 'https://x.org',
      Description: 'y',
      Logo: ['https://example.com/logo.png'],
      Type: ['Grant'],
      'Accepting applications?': 'Yes',
    }
    expect(missingFields('/funding', funding)).toEqual([])
    expect(missingFields('/funding', { ...funding, Featured: '1' })).toEqual([
      'Featured tagline',
    ])
  })

  it('counts zero as a value, for the map’s x and y', () => {
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue(false)).toBe(true)
    expect(isEmptyValue([])).toBe(true)
    expect(isEmptyValue(' ')).toBe(true)
    expect(
      missingFields('/map', {
        'Long name': 'x',
        'Short name': 'x',
        Description: 'y',
        Category: ['Research'],
        Link: 'https://x.org',
        'Logo (for cards)': ['https://example.com/a.png'],
        'Logo (for map)': ['https://example.com/b.png'],
        x: 0,
        y: 12.5,
      })
    ).toEqual([])
  })
})
