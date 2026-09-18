import { describe, expect, it } from 'vitest'
import { SEED_GUIDE } from './seed'
import { OLD_EXTRACTOR_TEXT } from './seed-old-extractor.fixture'
import { guideChatText, richTextLines } from './text'
import { validateGuide, validHref } from './validate'
import { LIMITS } from './types'

describe('the seed', () => {
  it('passes the validator unchanged', () => {
    const v = validateGuide(JSON.parse(JSON.stringify(SEED_GUIDE)))
    expect(v.ok, v.ok ? '' : v.error).toBe(true)
    if (v.ok) expect(v.guide).toEqual(SEED_GUIDE)
  })

  it('reads exactly as the React components did', () => {
    // One approved change (15 September 2026): the heading is now the tab
    // name plus "donation", and the second tab's heading used to have
    // spaces around its dash that the tab name never had.
    const expected = OLD_EXTRACTOR_TEXT.replace(
      '$1,000 – 10,000 donation',
      '$1,000–10,000 donation'
    )
    expect(guideChatText(SEED_GUIDE)).toBe(expected)
  })

  it('has the four tabs with four sections each and 78 links', () => {
    expect(SEED_GUIDE.tabs.map(t => t.amount)).toEqual([
      '$1–1,000',
      '$1,000–10,000',
      '$10,000–100,000',
      '$100,000+',
    ])
    expect(SEED_GUIDE.tabs.every(t => t.sections.length === 4)).toBe(true)
    const links = SEED_GUIDE.tabs.flatMap(t =>
      t.sections.flatMap(s =>
        s.body.blocks.flatMap(b =>
          b.type === 'paragraph'
            ? b.inlines.filter(i => i.href)
            : b.items.flat().filter(i => i.href)
        )
      )
    )
    expect(links).toHaveLength(78)
    // Stored addresses are clean: the UTM tags are added at render time.
    expect(links.some(l => l.href!.includes('utm_'))).toBe(false)
  })
})

describe('validateGuide', () => {
  const clone = () => JSON.parse(JSON.stringify(SEED_GUIDE))

  it('refuses unknown keys anywhere', () => {
    const g = clone()
    g.extra = 1
    expect(validateGuide(g)).toMatchObject({ ok: false })
    const h = clone()
    h.tabs[0].sections[0].body.blocks[0].inlines[0].html = '<b>'
    const r = validateGuide(h)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('unknown key "html"')
  })

  it('refuses links that are not web addresses or site paths', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,hi',
      '//evil.example',
      'mailto:x@y.z',
      'ftp://x.y',
      '/path with space',
      'not a url',
    ]) {
      expect(validHref(bad), bad).toBe(false)
    }
    for (const good of ['https://x.y/z?a=1', 'http://x.y', '/communities']) {
      expect(validHref(good), good).toBe(true)
    }
    const g = clone()
    g.tabs[0].sections[0].body.blocks[0].inlines[0].href = 'javascript:x'
    expect(validateGuide(g)).toMatchObject({ ok: false })
  })

  it('caps tabs, sections, blocks and size', () => {
    const g = clone()
    g.tabs = Array.from({ length: LIMITS.tabs + 1 }, (_, i) => ({
      ...clone().tabs[0],
      id: `t${i}`,
      sections: [],
    }))
    expect(validateGuide(g)).toMatchObject({ ok: false })

    const h = clone()
    h.tabs[0].sections = Array.from(
      { length: LIMITS.sections + 1 },
      (_, i) => ({ ...clone().tabs[0].sections[0], id: `s${i}` })
    )
    expect(validateGuide(h)).toMatchObject({ ok: false })

    const big = clone()
    big.tabs[0].lead = 'x'.repeat(LIMITS.lead + 1)
    expect(validateGuide(big)).toMatchObject({ ok: false })

    const huge = clone()
    huge.tabs[0].sections[0].body.blocks = Array.from(
      { length: LIMITS.blocksPerSection },
      () => ({ type: 'paragraph', inlines: [{ text: 'y'.repeat(2000) }] })
    )
    expect(validateGuide(huge)).toMatchObject({ ok: true })
    huge.tabs[0].sections[1].body.blocks = huge.tabs[0].sections[0].body.blocks
    huge.tabs[0].sections[2].body.blocks = huge.tabs[0].sections[0].body.blocks
    expect(validateGuide(huge)).toMatchObject({ ok: false })
  })

  it('refuses duplicate ids, empty tabs, lists in the intro and bad shapes', () => {
    const g = clone()
    g.tabs[1].id = g.tabs[0].id
    expect(validateGuide(g)).toMatchObject({ ok: false })
    const h = clone()
    h.tabs = []
    expect(validateGuide(h)).toMatchObject({ ok: false })
    const i = clone()
    i.intro.blocks = [{ type: 'bullets', items: [[{ text: 'x' }]] }]
    expect(validateGuide(i)).toMatchObject({ ok: false })
    expect(validateGuide(null)).toMatchObject({ ok: false })
    expect(validateGuide('guide')).toMatchObject({ ok: false })
    expect(validateGuide({ intro: { blocks: [] }, tabs: [] })).toMatchObject({
      ok: false,
    })
  })

  it('accepts lists in sections and returns a fresh copy', () => {
    const g = clone()
    g.tabs[0].sections[0].body.blocks.push({
      type: 'numbers',
      items: [[{ text: 'one' }], [{ text: 'two', bold: true }]],
    })
    const r = validateGuide(g)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.guide).not.toBe(g)
      expect(r.guide).toEqual(g)
      const lines = richTextLines(r.guide.tabs[0].sections[0].body)
      expect(lines[lines.length - 1]).toBe('1. one\n2. two')
    }
  })
})
