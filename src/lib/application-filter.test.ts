import { describe, expect, it } from 'vitest'
import {
  APPLICATION_FILTER_OPTIONS,
  applicationFilterValue,
} from './application-filter'

describe('applicationFilterValue', () => {
  it('gives each listing one of the filter options', () => {
    expect(
      applicationFilterValue({ applicationStatus: 'Open', notYetOpen: false })
    ).toBe('Open')
    expect(
      applicationFilterValue({ applicationStatus: 'Closed', notYetOpen: false })
    ).toBe('Closed')
  })

  it('puts a not-yet-open listing under Not yet open, not Closed', () => {
    // The data layer marks these Closed (src/lib/data/events.ts, training.ts).
    expect(
      applicationFilterValue({ applicationStatus: 'Closed', notYetOpen: true })
    ).toBe('Not yet open')
  })

  it('lists the options in the order the training list shows them', () => {
    expect(APPLICATION_FILTER_OPTIONS).toEqual([
      'Open',
      'Not yet open',
      'Closed',
    ])
  })
})
