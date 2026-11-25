import { describe, expect, it } from 'vitest'
import { matchSuggestions } from './suggestions'

const list = [
  { value: 'Global EA Summit' },
  { value: 'EA Summit: Paris 2026' },
  { value: 'Teams summit' },
  { value: 'EA Summit: Boston 2026', detail: 'Events' },
]

describe('matchSuggestions', () => {
  it('puts names starting with the text first, then word starts, then the rest', () => {
    const names = [
      { value: 'Teamsummit' },
      { value: 'Global EA Summit' },
      { value: 'Summit Series' },
    ]
    expect(matchSuggestions(names, 'summit').map(s => s.value)).toEqual([
      'Summit Series',
      'Global EA Summit',
      'Teamsummit',
    ])
  })

  it('ignores case and spaces at the ends', () => {
    expect(matchSuggestions(list, '  ea sum ').map(s => s.value)).toEqual([
      'EA Summit: Paris 2026',
      'EA Summit: Boston 2026',
      'Global EA Summit',
    ])
  })

  it('keeps the detail line', () => {
    expect(matchSuggestions(list, 'boston')).toEqual([
      { value: 'EA Summit: Boston 2026', detail: 'Events' },
    ])
  })

  it('shows at most max, and nothing for an empty box', () => {
    expect(matchSuggestions(list, 'e', 2)).toHaveLength(2)
    expect(matchSuggestions(list, '  ')).toEqual([])
  })
})
