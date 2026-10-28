import { describe, expect, it, vi } from 'vitest'
import type { AirtableRawRecord } from '@/lib/data/airtable'

// The chatbot filters listings on their meta fields, and both its tool
// description and its prompt name the keys it may filter on. A key that no
// listing carries matches nothing, every time: recipientType did exactly that
// for three months after its Airtable field was retired (July 2026), with no
// error anywhere. These tests build the catalog from Airtable-shaped records
// through the real funderFromRecord / advisorFromRecord and check that every
// funder and advisor key the bot is offered is really there.

const records = vi.hoisted(() => {
  // Funding field ids (src/lib/data/funding.ts).
  const funder = (id: string, fields: Record<string, unknown>) => ({
    id,
    createdTime: '2026-10-01T00:00:00.000Z',
    fields: {
      fldsFpgVduYnNuYkN: `Funder ${id}`, // Name
      fldBm7ZehvD2anFg8: 'Grants for AI safety work.', // Description
      fldpc3AO5j2k3PU3b: 'https://example.org', // Website
      fldu44vSLT2tH4fqh: ['Fund'], // Type
      ...fields,
    },
  })
  // Advisors field ids (src/lib/data/advisors.ts).
  const advisor = (id: string, fields: Record<string, unknown>) => ({
    id,
    createdTime: '2026-10-01T00:00:00.000Z',
    fields: {
      fldDCHQmcF8HLOz5S: `Advisor ${id}`, // Name
      fldKAGrIoU5VBZJ85: 'Calls about AI safety careers.', // Description
      fldAOckkk19f4aNTm: 'https://example.org', // Link
      flduXnbMW0gaLpSgE: 'Active', // Status
      ...fields,
    },
  })
  return {
    funders: [
      funder('recOpenDated', {
        fldD8GVcdVy4Vonaa: 'Applications open', // Application status
        fldv6IKA9WMDJNTbT: '2999-12-31', // Deadline
        fldubjbVV9Df9MXbk: ['Nonprofits', 'Individuals'], // Who can apply
        flddVCzyFr56x9NLs: '$10k – $50k', // Grant size (display)
      }),
      funder('recPassed', {
        fldD8GVcdVy4Vonaa: 'Applications open',
        fldv6IKA9WMDJNTbT: '2020-01-31',
        fldubjbVV9Df9MXbk: ['Universities'],
      }),
      funder('recInvite', {
        fldD8GVcdVy4Vonaa: 'Invite only, no applications',
        fldubjbVV9Df9MXbk: ['For-profits'],
      }),
    ] as AirtableRawRecord[],
    advisors: [
      advisor('recAdvisor', {
        fldV0iU04GFzGMypK: ['Existing field members', 'Newcomers'], // Who it's for
        fldKAVyL9lBOFy8Ht: ['Well-being', 'Career'], // Focus areas
        fldb32mL5jiHvtN9J: 'Accepts everyone', // Applications
      }),
    ] as AirtableRawRecord[],
  }
})

vi.mock('@/lib/data/funding', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/data/funding')>()
  return {
    ...actual,
    getFunders: async () =>
      records.funders.map(actual.funderFromRecord).filter(f => f !== null),
  }
})
vi.mock('@/lib/data/advisors', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/data/advisors')>()
  return {
    ...actual,
    getAdvisors: async () =>
      records.advisors.map(actual.advisorFromRecord).filter(a => a !== null),
  }
})
vi.mock('@/lib/data/jobs', () => ({ getJobs: async () => [] }))
vi.mock('@/lib/data/communities', () => ({ getCommunities: async () => [] }))
vi.mock('@/lib/data/self-study', () => ({ getCourses: async () => [] }))
vi.mock('@/lib/data/founders', () => ({ getFounderResources: async () => [] }))
vi.mock('@/lib/data/media-channels', () => ({
  getMediaChannels: async () => [],
}))
vi.mock('@/lib/data/map', () => ({ getMapData: async () => ({ records: [] }) }))
vi.mock('@/lib/data/events', () => ({ getEvents: async () => [] }))
vi.mock('@/lib/data/training', () => ({
  getTrainingPrograms: async () => [],
  getRecurringPrograms: async () => [],
}))

import { buildCatalog } from './catalog'
import { PRODUCTION_PROMPT } from './prompt'
import { TOOL_DEFINITIONS } from './tools'

/** The filter keys search_listings' description offers for a type: the
 *  "funder: type (…), applicationStatus (…)" line, value lists dropped. */
function toolKeys(type: string): string[] {
  const description =
    TOOL_DEFINITIONS.find(t => t.name === 'search_listings')?.description ?? ''
  const line = description
    .split('\n')
    .find(l => l.trim().startsWith(`${type}:`))
  if (!line) throw new Error(`No "${type}:" line in the tool description`)
  let depth = 0
  let keys = ''
  for (const ch of line.slice(line.indexOf(':') + 1)) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0) keys += ch
  }
  return keys
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
}

/** The keys the prompt's per-type list names: its "  - `key`" lines. */
function promptKeys(type: string): string[] {
  const start = PRODUCTION_PROMPT.indexOf(`\n- **${type}**`)
  if (start < 0) throw new Error(`No "${type}" list in the prompt`)
  const section = PRODUCTION_PROMPT.slice(start + 1).split('\n\n')[0]
  return [...section.matchAll(/^ {2}- `(\w+)`/gm)].map(m => m[1])
}

describe('chatbot catalog filter keys', () => {
  for (const type of ['funder', 'advisor'] as const) {
    it(`every ${type} key the tool and the prompt offer is in some listing's meta`, async () => {
      const { listings } = await buildCatalog()
      const ofType = listings.filter(l => l.type === type)
      expect(ofType.length).toBeGreaterThan(0)
      const offered = [...new Set([...toolKeys(type), ...promptKeys(type)])]
      expect(offered.length).toBeGreaterThan(2)
      const missing = offered.filter(key => !ofType.some(l => l.meta[key]))
      expect(missing).toEqual([])
    })
  }

  it('no longer offers the retired fields', () => {
    expect(toolKeys('funder')).not.toContain('recipientType')
    expect(promptKeys('funder')).not.toContain('recipientType')
    expect(toolKeys('advisor')).not.toContain('focus')
    expect(promptKeys('advisor')).not.toContain('focus')
  })
})

describe('chatbot funder meta', () => {
  async function funderMeta(id: string) {
    const { listings } = await buildCatalog()
    const listing = listings.find(l => l.id === `funder:${id}`)
    if (!listing) throw new Error(`No funder ${id}`)
    return listing.meta
  }

  it('reads an open funder from the new fields, deadline and all', async () => {
    expect(await funderMeta('recOpenDated')).toEqual({
      type: 'Fund',
      applications: 'Applications close 31 Dec 2999',
      applicationStatus: 'Open',
      deadline: '2999-12-31',
      whoCanApply: 'Individuals, Nonprofits',
      grantSize: '$10k – $50k',
    })
  })

  it('counts a funder whose deadline has passed as closed', async () => {
    const meta = await funderMeta('recPassed')
    expect(meta.applicationStatus).toBe('Closed')
    expect(meta.applications).toBe('Not currently accepting applications')
    expect(meta.deadline).toBeUndefined()
  })

  it('says which kind of closed an invite-only funder is', async () => {
    const meta = await funderMeta('recInvite')
    expect(meta.applicationStatus).toBe('Closed')
    expect(meta.applications).toBe('Invite only, no applications')
    expect(meta.whoCanApply).toBe('For-profits')
    expect(meta.grantSize).toBeUndefined()
  })
})

describe('chatbot advisor meta', () => {
  it('reads who it is for, focus areas and applications in option order', async () => {
    const { listings } = await buildCatalog()
    const advisor = listings.find(l => l.id === 'advisor:recAdvisor')
    expect(advisor?.meta).toEqual({
      whoItsFor: 'Newcomers, Existing field members',
      focusAreas: 'Career, Well-being',
      applications: 'Accepts everyone',
      status: 'Active',
    })
  })
})
