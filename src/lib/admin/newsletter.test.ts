import { describe, expect, it } from 'vitest'
import {
  cardGroups,
  contentDigest,
  FitError,
  formatLocal,
  previewText,
  ReorderError,
  reorderHtml,
  setFitHtml,
} from './newsletter'

// Fixtures generated with the pipeline's own function
// (~/Newsletter/ac.py content_digest) on 3 September 2026. The two sides
// MUST agree, or every draft would fail verification on the admin page.
describe('contentDigest (mirrors ac.py)', () => {
  it('matches the pipeline for plain content', () => {
    expect(contentDigest('plain')).toBe('a116c9ed46d62077')
  })
  it('ignores the marker itself and the trailing newline AC adds', () => {
    expect(
      contentDigest('<!--aisafety-issue:0000000000000000--><p>x &amp; y</p>\n')
    ).toBe('941b23541f13318e')
  })
  it('treats &amp; at any escaping depth as & (AC decodes one level per save)', () => {
    expect(contentDigest('<p>a &amp; b</p>')).toBe('a47ca84b5587983a')
    expect(contentDigest('<p>a &amp;amp; b</p>\n\n')).toBe('a47ca84b5587983a')
  })
  it('changes when the content changes', () => {
    expect(contentDigest('<p>a &amp; c</p>')).not.toBe('a47ca84b5587983a')
  })
})

describe('formatLocal', () => {
  it('renders the instant in the account offset, AC v1 sdate format', () => {
    const at = new Date('2026-09-03T11:44:54Z')
    expect(formatLocal(at, '-05:00')).toBe('2026-09-03 06:44:54')
    expect(formatLocal(at, '+00:00')).toBe('2026-09-03 11:44:54')
    expect(formatLocal(at, '+05:30')).toBe('2026-09-03 17:14:54')
  })
  it('crosses the date line correctly', () => {
    expect(formatLocal(new Date('2026-09-03T02:10:00Z'), '-05:00')).toBe(
      '2026-09-02 21:10:00'
    )
  })
})

/* ─── Reorderable cards (mirrors ~/Newsletter/render.py reorder_cards) ── */

function issue(groups: Array<{ id: string; label: string; keys: string[] }>) {
  // The shape render.py writes: markers around each card, one base64 JSON
  // manifest (groups + titles + the plain text as keyed segments) at the end.
  const cards = groups.flatMap(g =>
    g.keys.map(k => `<!--card:${g.id}:${k}--><div>${k}</div><!--/card-->`)
  )
  const manifest = {
    v: 1,
    groups: groups.map(g => ({
      id: g.id,
      label: g.label,
      cards: g.keys.map(k => ({ key: k, title: `Title ${k}` })),
    })),
    text: [
      { t: 'HEAD\n' },
      ...groups.flatMap(g => [
        { t: `== ${g.label} ==\n` },
        ...g.keys.map(k => ({ c: `${g.id}:${k}`, t: `* ${k}\n` })),
      ]),
      { t: 'TAIL\n' },
    ],
  }
  const b64 = Buffer.from(JSON.stringify(manifest)).toString('base64')
  const body = groups
    .map(
      g =>
        `<h2>${g.label}</h2>` +
        cards.filter(c => c.includes(`<!--card:${g.id}:`)).join('')
    )
    .join('')
  return `<html><body><p>intro</p>${body}<p>footer</p><!--aisafety-cards:${b64}-->\n</body></html>`
}

describe('cardGroups', () => {
  it('lists the cards per section in document order, with titles', () => {
    const html = issue([
      { id: 'g0', label: 'New events', keys: ['a', 'b', 'c'] },
    ])
    expect(cardGroups(html)).toEqual([
      {
        id: 'g0',
        label: 'New events',
        cards: [
          {
            key: 'a',
            title: 'Title a',
            logo: null,
            fit: null,
            pipelineFit: null,
          },
          {
            key: 'b',
            title: 'Title b',
            logo: null,
            fit: null,
            pipelineFit: null,
          },
          {
            key: 'c',
            title: 'Title c',
            logo: null,
            fit: null,
            pipelineFit: null,
          },
        ],
      },
    ])
  })
  it('is null for emails without markers (built before 10 Sept 2026)', () => {
    expect(cardGroups('<html><body><p>old</p></body></html>')).toBeNull()
  })
})

describe('reorderHtml', () => {
  const html = issue([
    { id: 'g0', label: 'Closing soon', keys: ['a', 'b', 'c'] },
    { id: 'g1', label: 'New', keys: ['x', 'y'] },
  ])
  it('moves the cards and rebuilds the text to match', () => {
    const out = reorderHtml(html, { g0: ['c', 'a', 'b'] })
    expect(cardGroups(out.html)?.map(g => g.cards.map(c => c.key))).toEqual([
      ['c', 'a', 'b'],
      ['x', 'y'],
    ])
    expect(out.text).toBe(
      'HEAD\n== Closing soon ==\n* c\n* a\n* b\n== New ==\n* x\n* y\nTAIL\n'
    )
    // Everything around the cards is untouched.
    expect(
      out.html.startsWith('<html><body><p>intro</p><h2>Closing soon</h2>')
    ).toBe(true)
    expect(out.html).toContain('<h2>New</h2><!--card:g1:x-->')
    expect(out.html.length).toBe(html.length)
  })
  it('round-trips back to the original', () => {
    const once = reorderHtml(html, { g0: ['c', 'a', 'b'], g1: ['y', 'x'] })
    const back = reorderHtml(once.html, { g0: ['a', 'b', 'c'], g1: ['x', 'y'] })
    expect(back.html).toBe(html)
    expect(back.text).toBe(
      'HEAD\n== Closing soon ==\n* a\n* b\n* c\n== New ==\n* x\n* y\nTAIL\n'
    )
  })
  it('refuses anything that is not a permutation of the section', () => {
    expect(() => reorderHtml(html, { g0: ['a', 'b'] })).toThrow(ReorderError)
    expect(() => reorderHtml(html, { g0: ['a', 'b', 'b'] })).toThrow(
      ReorderError
    )
    expect(() => reorderHtml(html, { g0: ['a', 'b', 'x'] })).toThrow(
      ReorderError
    )
    expect(() => reorderHtml(html, { g7: ['a'] })).toThrow(ReorderError)
  })
  it('refuses an email without a manifest', () => {
    expect(() => reorderHtml('<p>x</p>', { g0: ['a'] })).toThrow(ReorderError)
  })
})

describe('previewText', () => {
  it('reads the hidden preheader and drops the invisible padding (entity form)', () => {
    const html =
      '<body><div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#00191b;">This is a weekly newsletter that lists newly announced events.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div><p>x</p></body>'
    expect(previewText(html)).toBe(
      'This is a weekly newsletter that lists newly announced events.'
    )
  })
  it('handles the armoured form: colour wrapper inside, padding as characters, entities resolved', () => {
    const html =
      '<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;"><span style="color:#00191b;color:rgb(0 25 27 / 0.99);">Funding &amp; more &ndash; it’s open. ‌ ‌</span></div>'
    expect(previewText(html)).toBe('Funding & more – it’s open.')
  })
  it('is null without a preheader', () => {
    expect(previewText('<p>no preheader</p>')).toBeNull()
  })
})

/* ─── "Consider applying if" (mirrors ~/Newsletter/render.py set_fit) ── */

const FIT = (html: string) =>
  `<div style="margin-top:12px;"><span style="font-weight:600;">Consider applying if</span>: ${html}</div>`
const SUB =
  '<div style="margin-top:8px;"><a href="https://x.test/t">Track</a>: a track</div>'

/** A funding issue the way render.py writes it: description block with the
 *  fit line (and maybe sub-links), a manifest whose cards carry Pen's fit. */
function fundingIssue(
  cards: Array<{ key: string; fit: string | null; sub?: boolean }>
) {
  const card = (c: (typeof cards)[number]) =>
    `<!--card:g0:${c.key}--><table><tr><td><div class="pb" style="margin-bottom:24px;">Desc of ${c.key}.${
      c.fit ? FIT(c.fit) : ''
    }${c.sub ? SUB : ''}</div><div class="meta">rows</div></td></tr></table><!--/card-->`
  const seg = (c: (typeof cards)[number]) => ({
    c: `g0:${c.key}`,
    t:
      `* Title ${c.key}\n  Desc of ${c.key}.\n` +
      (c.fit
        ? `  Consider applying if: ${c.fit.replace(/<[^>]+>/g, '')}\n`
        : '') +
      (c.sub ? '  - Track: a track  https://x.test/t\n' : '') +
      `  https://x.test/${c.key}\n\n`,
  })
  const manifest = {
    v: 1,
    groups: [
      {
        id: 'g0',
        label: 'Newly announced',
        cards: cards.map(c => ({
          key: c.key,
          title: `Title ${c.key}`,
          fit: c.fit ?? '',
        })),
      },
    ],
    text: [{ t: 'HEAD\n' }, ...cards.map(seg), { t: 'TAIL\n' }],
  }
  const b64 = Buffer.from(JSON.stringify(manifest)).toString('base64')
  return `<html><body><p>intro</p>${cards.map(card).join('')}<p>footer</p><!--aisafety-cards:${b64}-->\n</body></html>`
}

describe('cardGroups: fit fields', () => {
  it('reads the current line and Pen’s original as plain text', () => {
    const html = fundingIssue([
      { key: 'a', fit: 'you run a <em>lab</em> &amp; need compute' },
      { key: 'b', fit: null },
    ])
    const cards = cardGroups(html)![0].cards
    expect(cards[0].fit).toBe('you run a lab & need compute')
    expect(cards[0].pipelineFit).toBe('you run a lab & need compute')
    // A funding card Pen gave no line: editable (''), original ''.
    expect(cards[1].fit).toBe('')
    expect(cards[1].pipelineFit).toBe('')
  })
  it('older funding drafts (no fit in the manifest) still expose the line', () => {
    const html = fundingIssue([{ key: 'a', fit: 'old' }]).replace(
      /<!--aisafety-cards:[^>]+-->/,
      () => {
        const m = {
          v: 1,
          groups: [{ id: 'g0', label: 'x', cards: [{ key: 'a', title: 'A' }] }],
          text: [{ c: 'g0:a', t: '* A\n' }],
        }
        return `<!--aisafety-cards:${Buffer.from(JSON.stringify(m)).toString('base64')}-->`
      }
    )
    expect(cardGroups(html)![0].cards[0]).toMatchObject({
      fit: 'old',
      pipelineFit: null,
    })
  })
})

describe('setFitHtml', () => {
  const html = fundingIssue([
    { key: 'a', fit: 'you run a lab' },
    { key: 'b', fit: null },
    { key: 'c', fit: null, sub: true },
  ])
  it('replaces the line in the card, the manifest and the text', () => {
    const out = setFitHtml(html, 'g0', 'a', '  you  have <5 people & a plan ')
    expect(out.html).toContain(FIT('you have &lt;5 people &amp; a plan'))
    expect(out.html).not.toContain('you run a lab')
    const cards = cardGroups(out.html)![0].cards
    expect(cards[0].fit).toBe('you have <5 people & a plan')
    expect(cards[0].pipelineFit).toBe('you run a lab')
    expect(out.text).toBe(
      'HEAD\n* Title a\n  Desc of a.\n  Consider applying if: you have <5 people & a plan\n  https://x.test/a\n\n' +
        '* Title b\n  Desc of b.\n  https://x.test/b\n\n' +
        '* Title c\n  Desc of c.\n  - Track: a track  https://x.test/t\n  https://x.test/c\n\nTAIL\n'
    )
    // Only that card and the manifest changed.
    expect(out.html.replace(/<!--aisafety-cards:[^>]+-->/, '')).toBe(
      html
        .replace(/<!--aisafety-cards:[^>]+-->/, '')
        .replace(
          FIT('you run a lab'),
          FIT('you have &lt;5 people &amp; a plan')
        )
    )
  })
  it('adds the line to a card without one, before any sub-links', () => {
    const plain = setFitHtml(html, 'g0', 'b', 'new line')
    expect(plain.html).toContain(`Desc of b.${FIT('new line')}</div>`)
    expect(plain.text).toContain(
      '* Title b\n  Desc of b.\n  Consider applying if: new line\n  https://x.test/b\n'
    )
    const sub = setFitHtml(html, 'g0', 'c', 'with tracks')
    expect(sub.html).toContain(`Desc of c.${FIT('with tracks')}${SUB}</div>`)
    expect(sub.text).toContain(
      '* Title c\n  Desc of c.\n  Consider applying if: with tracks\n  - Track: a track'
    )
  })
  it('removes the line when the text is empty', () => {
    const out = setFitHtml(html, 'g0', 'a', '  ')
    expect(out.html).not.toContain('Consider applying if')
    expect(out.text).not.toContain('Consider applying if')
    expect(cardGroups(out.html)![0].cards[0]).toMatchObject({
      fit: '',
      pipelineFit: 'you run a lab',
    })
  })
  it('keeps a manual card order in the rebuilt text', () => {
    const moved = reorderHtml(html, { g0: ['c', 'a', 'b'] })
    const out = setFitHtml(moved.html, 'g0', 'a', 'later')
    expect(cardGroups(out.html)![0].cards.map(c => c.key)).toEqual([
      'c',
      'a',
      'b',
    ])
    expect(out.text.indexOf('* Title c')).toBeLessThan(
      out.text.indexOf('* Title a')
    )
    expect(out.text).toContain('  Consider applying if: later\n')
    // A later reorder still sees the edited text (the manifest was updated).
    const back = reorderHtml(out.html, { g0: ['a', 'b', 'c'] })
    expect(back.text).toContain('  Consider applying if: later\n')
    expect(back.text).not.toContain('you run a lab')
  })
  it('refuses unknown cards and emails without a manifest', () => {
    expect(() => setFitHtml(html, 'g0', 'zz', 'x')).toThrow(FitError)
    expect(() => setFitHtml(html, 'g9', 'a', 'x')).toThrow(FitError)
    expect(() => setFitHtml('<p>x</p>', 'g0', 'a', 'x')).toThrow(FitError)
  })
})
