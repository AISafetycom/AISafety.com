import { describe, expect, it } from 'vitest'
import {
  displayFilterGroup,
  displayFilterValue,
  trackedFilterGroup,
  trackedFilterValue,
} from './filter-tracking'

describe('relabelled filter options', () => {
  it('logs the original label for a relabelled option', () => {
    expect(trackedFilterValue('Funding', 'Application status', 'Open')).toBe(
      'Yes'
    )
    expect(trackedFilterValue('Funding', 'Application status', 'Closed')).toBe(
      'No'
    )
  })

  it('shows the current label for a logged value', () => {
    expect(displayFilterValue('Funding', 'Application status', 'Yes')).toBe(
      'Open'
    )
    expect(displayFilterValue('Funding', 'Application status', 'No')).toBe(
      'Closed'
    )
  })

  it('round-trips every relabelled option', () => {
    for (const option of ['Open', 'Closed']) {
      const logged = trackedFilterValue('Funding', 'Application status', option)
      expect(displayFilterValue('Funding', 'Application status', logged)).toBe(
        option
      )
    }
  })

  it('leaves options and values that were never relabelled alone', () => {
    expect(trackedFilterValue('Funding', 'Type', 'Fund')).toBe('Fund')
    expect(displayFilterValue('Funding', 'Type', 'Fund')).toBe('Fund')
    expect(trackedFilterValue('Jobs', 'Application status', 'Open')).toBe(
      'Open'
    )
    expect(displayFilterValue('Training', 'Mode', 'Yes')).toBe('Yes')
  })
})

describe('relabelled filter groups', () => {
  it('logs the original title for a relabelled group', () => {
    expect(trackedFilterGroup('Jobs', 'Remote or on-site')).toBe(
      'Work location'
    )
  })

  it('shows the current title for a logged group', () => {
    expect(displayFilterGroup('Jobs', 'Work location')).toBe(
      'Remote or on-site'
    )
  })

  it('round-trips and leaves other groups alone', () => {
    expect(
      displayFilterGroup(
        'Jobs',
        trackedFilterGroup('Jobs', 'Remote or on-site')
      )
    ).toBe('Remote or on-site')
    expect(trackedFilterGroup('Jobs', 'Type')).toBe('Type')
    expect(displayFilterGroup('Jobs', 'Type')).toBe('Type')
    expect(trackedFilterGroup('Funding', 'Remote or on-site')).toBe(
      'Remote or on-site'
    )
  })

  it("keys a renamed group's options by the logged title", () => {
    // No Jobs options are relabelled, so values pass straight through under
    // the logged group title.
    expect(trackedFilterValue('Jobs', 'Work location', 'Remote')).toBe('Remote')
    expect(displayFilterValue('Jobs', 'Work location', 'Remote')).toBe('Remote')
  })
})
