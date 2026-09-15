import { describe, expect, it } from 'vitest'
import { describeChanges, summarizeChanges } from './diff'
import { SEED_GUIDE } from './seed'
import type { Guide, ParagraphBlock } from './types'

// Loosely typed on purpose: the tests poke at paragraphs by index.
const clone = (): Guide & {
  intro: { blocks: ParagraphBlock[] }
  tabs: { sections: { body: { blocks: ParagraphBlock[] } }[] }[]
} => JSON.parse(JSON.stringify(SEED_GUIDE))

describe('describeChanges', () => {
  it('sees nothing when nothing changed', () => {
    expect(describeChanges(SEED_GUIDE, clone())).toEqual([])
  })

  it('names a changed section by tab and time, with before and after', () => {
    const g = clone()
    g.tabs[0].sections[1].body.blocks[0].inlines[0].text = 'New words. '
    const c = describeChanges(SEED_GUIDE, g)
    expect(c).toHaveLength(1)
    expect(c[0].where).toBe('$1–1,000 › 1–50 hours')
    expect(c[0].kind).toBe('changed')
    expect(c[0].after).toContain('New words.')
    expect(summarizeChanges(c)).toEqual(['Changed: $1–1,000 › 1–50 hours'])
  })

  it('counts a changed link address as a change', () => {
    const g = clone()
    const link = g.tabs[0].sections[0].body.blocks[1].inlines.find(i => i.href)!
    link.href = 'https://example.com/'
    expect(describeChanges(SEED_GUIDE, g)).toHaveLength(1)
  })

  it('reports renames, added and removed tabs and sections, and reorders', () => {
    const g = clone()
    g.tabs[0].amount = '$1–500'
    g.tabs[1].sections.push({
      id: 'tab2-extra',
      time: 'A weekend',
      body: { blocks: [{ type: 'paragraph', inlines: [{ text: 'Go.' }] }] },
    })
    g.tabs[2].sections.splice(0, 1)
    g.tabs.push({ id: 'tab5', amount: '$1M+', lead: '', sections: [] })
    const [a, b] = [g.tabs[0], g.tabs[1]]
    g.tabs[0] = b
    g.tabs[1] = a
    const lines = summarizeChanges(describeChanges(SEED_GUIDE, g))
    // In the new tab order: the second tab now comes first.
    expect(lines).toEqual([
      'Added: $1,000–10,000 › A weekend',
      'Changed: $1–1,000 › name',
      'Removed: $10,000–100,000 › 5 minutes–1 hour',
      'Added: $1M+',
      'Reordered: Tabs',
    ])
  })

  it('reports the intro', () => {
    const g = clone()
    g.intro.blocks[0].inlines[1].bold = undefined
    delete g.intro.blocks[0].inlines[1].bold
    expect(summarizeChanges(describeChanges(SEED_GUIDE, g))).toEqual([
      'Changed: Intro',
    ])
  })
})
