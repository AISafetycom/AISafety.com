import { describe, expect, it } from 'vitest'
import {
  ALIKE_LIMITS,
  alikePrompt,
  readAlike,
  readAlikeRequest,
  type AlikeText,
} from './map-alike'

const among: AlikeText[] = [
  {
    id: 'recA',
    name: 'Redwood Research',
    description: 'Nonprofit researching AI control.',
    category: 'Empirical research',
  },
  {
    id: 'recB',
    name: 'Goodfire',
    description: null,
    category: 'Empirical research, Capabilities research',
  },
  {
    id: 'recC',
    name: 'TruthfulAI',
    description: 'Researching deception.',
    category: 'Empirical research',
  },
  {
    id: 'recD',
    name: 'METR',
    description: 'Evaluations.',
    category: 'Empirical research',
  },
]
const listing = {
  name: 'Poseidon Research',
  description: 'Studies   deception\nin AI systems.',
  category: 'Empirical research',
}

describe('alikePrompt', () => {
  it('numbers the listings from 1 and names the area', () => {
    const prompt = alikePrompt(listing, among, 'Empirical Escarpment')
    expect(prompt).toContain('the Empirical Escarpment area')
    expect(prompt).toContain(
      'Poseidon Research (Empirical research): Studies deception in AI systems.'
    )
    expect(prompt).toContain(
      '1. Redwood Research (Empirical research): Nonprofit researching AI control.'
    )
    expect(prompt).toContain(
      '2. Goodfire (Empirical research, Capabilities research)\n'
    )
    expect(prompt).toContain('4. METR (Empirical research): Evaluations.')
  })
})

describe('readAlike', () => {
  it('turns the numbers named into ids, most alike first', () => {
    expect(readAlike('{"like":[3,1]}', among)).toEqual(['recC', 'recA'])
  })

  it('drops numbers outside the list and repeats, and keeps three', () => {
    expect(readAlike('{"like":[0,9,3,3,1,2,4]}', among)).toEqual([
      'recC',
      'recA',
      'recB',
    ])
  })

  it('allows naming none', () => {
    expect(readAlike('{"like":[]}', among)).toEqual([])
  })

  it('fails loudly on an answer without the list', () => {
    expect(() => readAlike('{"ids":[1]}', among)).toThrow(/like/)
    expect(() => readAlike('not json', among)).toThrow()
  })
})

describe('readAlikeRequest', () => {
  const body = { area: 'Empirical Escarpment', listing, among }

  it('reads a well-formed body', () => {
    const read = readAlikeRequest(body)
    expect(read.ok && read.request.among.map(a => a.id)).toEqual([
      'recA',
      'recB',
      'recC',
      'recD',
    ])
  })

  it('cuts long texts', () => {
    const long = 'x'.repeat(ALIKE_LIMITS.text + 50)
    const read = readAlikeRequest({
      ...body,
      listing: { ...listing, description: long },
    })
    expect(read.ok && read.request.listing.description).toHaveLength(
      ALIKE_LIMITS.text
    )
  })

  it('refuses what it cannot use', () => {
    expect(readAlikeRequest(null).ok).toBe(false)
    expect(readAlikeRequest({ ...body, area: '' }).ok).toBe(false)
    expect(readAlikeRequest({ ...body, listing: { name: 'X' } }).ok).toBe(false)
    expect(readAlikeRequest({ ...body, among: 'all' }).ok).toBe(false)
    expect(
      readAlikeRequest({ ...body, among: [{ id: 'recA', name: 'A' }] }).ok
    ).toBe(false)
    const many = Array.from({ length: ALIKE_LIMITS.among + 1 }, (_, i) => ({
      id: `rec${i}`,
      name: 'A',
      category: 'Blog',
    }))
    expect(readAlikeRequest({ ...body, among: many }).ok).toBe(false)
  })
})
