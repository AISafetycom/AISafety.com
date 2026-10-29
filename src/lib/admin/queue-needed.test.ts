import { describe, expect, it } from 'vitest'

import {
  fillFirst,
  isEmptyValue,
  missingFields,
  neededLeft,
} from './queue-needed'

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

  it('wants a typical length, never a date, for a recurring program', () => {
    const recurring = {
      Name: 'x',
      URL: 'https://x.org',
      Description: 'y',
      Type: 'Fellowship',
      Mode: 'Hybrid',
      Location: 'Online & USA',
      Focus: ['Governance'],
      'Entry bar': 'Mid',
      'Time commitment': 'Full-time',
      Stipend: 'Stipend included',
      Logo: ['https://example.com/logo.png'],
    }
    expect(missingFields('/training', recurring, 'tblEEIbj6dW5oS4cX')).toEqual([
      'Typical length',
    ])
    expect(
      missingFields(
        '/training',
        { ...recurring, 'Typical length': '2 months' },
        'tblEEIbj6dW5oS4cX'
      )
    ).toEqual([])
    expect(
      missingFields(
        '/training',
        { ...recurring, Mode: 'In person', Location: '' },
        'tblEEIbj6dW5oS4cX'
      )
    ).toEqual(['Typical length', 'Location'])
    // The dated table still wants its start date.
    expect(missingFields('/training', recurring, 'tbli1YSCpIuNY2DvL')).toEqual([
      'Start date',
    ])
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
      'Application status': 'Applications open',
      'Who can apply': ['Individuals'],
    }
    expect(missingFields('/funding', funding)).toEqual([])
    expect(missingFields('/funding', { ...funding, Featured: '1' })).toEqual([
      'Featured tagline',
    ])
  })

  it('asks a funder for the fields its card draws, not the old ones', () => {
    // Nondualism and AI alignment microgrants, as Comb wrote it before the
    // October 2026 redesign: only the old status text and Type.
    const oldShape = {
      Name: 'x',
      Website: 'https://x.org',
      Description: 'y',
      Logo: ['https://example.com/logo.png'],
      Type: ['Grant program'],
      'Accepting applications?': 'Applications on a rolling basis',
    }
    expect(missingFields('/funding', oldShape)).toEqual([
      'Application status',
      'Who can apply',
    ])
    // No Grant size or Deadline: the card hides the line, and rolling is fine.
    expect(
      missingFields('/funding', {
        ...oldShape,
        'Application status': 'Invite only, no applications',
        'Who can apply': ['Nonprofits', 'Universities'],
      })
    ).toEqual([])
  })

  it('asks an advisor for who it is for, focus areas and applications', () => {
    const advisor = {
      Name: 'x',
      Link: 'https://x.org',
      Description: 'y',
      Logo: ['https://example.com/logo.png'],
      Focus: ['Career/contribution'],
      Status: 'Active',
    }
    expect(missingFields('/advisors', advisor)).toEqual([
      "Who it's for",
      'Focus areas',
      'Applications',
    ])
    expect(
      missingFields('/advisors', {
        ...advisor,
        Focus: null,
        "Who it's for": ['Newcomers'],
        'Focus areas': ['Career', 'Well-being'],
        Applications: 'Accepts everyone',
      })
    ).toEqual([])
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

describe('neededLeft', () => {
  const columns = Object.keys(EVENT).map(name => ({ name }))
  const noCostNoLogo: Record<string, unknown> = { ...EVENT }
  delete noCostNoLogo.Cost
  delete noCostNoLogo.Logo

  it('goes by the record with the edits in', () => {
    expect(neededLeft('/events', null, noCostNoLogo, {}, columns)).toEqual([
      'Cost',
      'Logo',
    ])
    expect(
      neededLeft('/events', null, noCostNoLogo, { Cost: 'Free' }, columns)
    ).toEqual(['Logo'])
    expect(neededLeft('/events', null, EVENT, { Cost: '' }, columns)).toEqual([
      'Cost',
    ])
  })

  it('reads an edit of "false" as an unticked box', () => {
    expect(
      neededLeft(
        '/communities',
        null,
        { Featured: true },
        { Featured: 'false' },
        [{ name: 'Featured' }, { name: 'Featured tagline' }]
      )
    ).toEqual([])
  })

  it('never asks for a field the table does not have', () => {
    const noCost = columns.filter(c => c.name !== 'Cost')
    expect(neededLeft('/events', null, noCostNoLogo, {}, noCost)).toEqual([
      'Logo',
    ])
  })

  it('counts every needed field until the field list is known', () => {
    expect(neededLeft('/events', null, noCostNoLogo, {}, [])).toEqual([
      'Cost',
      'Logo',
    ])
  })
})

describe('fillFirst', () => {
  it('names what is left, with an Oxford comma', () => {
    expect(fillFirst(['Cost'])).toBe('Fill in Cost first')
    expect(fillFirst(['Cost', 'Logo'])).toBe('Fill in Cost and Logo first')
    expect(fillFirst(['Cost', 'Logo', 'Mode'])).toBe(
      'Fill in Cost, Logo, and Mode first'
    )
  })
})
