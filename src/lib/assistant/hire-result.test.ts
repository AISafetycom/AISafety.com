import { describe, expect, it } from 'vitest'
import { deriveHireResult } from './hire-result'
import type { CitationRef } from './types'

function candidate(overrides: Partial<CitationRef> = {}): CitationRef {
  return {
    id: 'candidate:priya-natarajan',
    type: 'candidate',
    name: 'Priya Natarajan',
    url: 'https://priya.dev',
    pageUrl: '/hire',
    description: 'Evals and interpretability.',
    meta: { focusArea: 'Evals, Interpretability', country: 'UK' },
    ...overrides,
  }
}

const hannah = candidate({
  id: 'candidate:hannah-becker',
  meta: { focusArea: 'Evals, Agent safety', country: 'Germany' },
})
const meiLin = candidate({
  id: 'candidate:mei-lin-chen',
  meta: { focusArea: 'Interpretability', country: 'Canada' },
})

describe('deriveHireResult', () => {
  it('strips the candidate: id prefix', () => {
    const result = deriveHireResult([[candidate()]])
    expect(result.primaryCandidateIds).toEqual(['priya-natarajan'])
  })

  it('puts the first round in primary and later rounds in other', () => {
    const result = deriveHireResult([[candidate()], [hannah, meiLin]])
    expect(result.primaryCandidateIds).toEqual(['priya-natarajan'])
    expect(result.otherCandidateIds).toEqual(['hannah-becker', 'mei-lin-chen'])
  })

  it('promotes the first non-empty round to primary when the first round is empty', () => {
    const result = deriveHireResult([[], [hannah], [meiLin]])
    expect(result.primaryCandidateIds).toEqual(['hannah-becker'])
    expect(result.otherCandidateIds).toEqual(['mei-lin-chen'])
  })

  it('derives focusAreas/countries from the primary tier only', () => {
    const result = deriveHireResult([[candidate()], [hannah, meiLin]])
    expect(result.focusAreas.sort()).toEqual(
      ['Evals', 'Interpretability'].sort()
    )
    expect(result.countries).toEqual(['UK'])
  })

  it('handles a listing with no meta.country without crashing', () => {
    const result = deriveHireResult([
      [candidate({ meta: { focusArea: 'Evals' } })],
    ])
    expect(result.countries).toEqual([])
  })

  it('returns empty tiers when every round was empty', () => {
    expect(deriveHireResult([[], []])).toEqual({
      primaryCandidateIds: [],
      otherCandidateIds: [],
      focusAreas: [],
      countries: [],
    })
  })

  it('returns empty tiers for no rounds at all', () => {
    expect(deriveHireResult([])).toEqual({
      primaryCandidateIds: [],
      otherCandidateIds: [],
      focusAreas: [],
      countries: [],
    })
  })
})
