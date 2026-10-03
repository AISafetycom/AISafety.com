import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cardGroups,
  contentDigest,
  DraftProblemError,
  FieldError,
  FitError,
  formatLocal,
  isLiveCampaign,
  liveCampaignsNamed,
  previewText,
  ReorderError,
  reorderHtml,
  sendTestCopy,
  setFieldsHtml,
  setFitHtml,
  TestSendError,
  baseIssueName,
  editLockFor,
  groupSends,
  holdsAt,
  parseWaveSegments,
  sdateInstant,
  sendDelayMinutes,
  stopActionsFor,
  sumIssues,
  waveCampaignName,
  waveOf,
  waveProgress,
  waveTags,
} from './newsletter'
import { createHash } from 'node:crypto'
import cardEdit from './__fixtures__/newsletter-card-edit.json'
import siteCardEdit from './__fixtures__/newsletter-site-card-edit.json'

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
            fields: [],
          },
          {
            key: 'b',
            title: 'Title b',
            logo: null,
            fit: null,
            pipelineFit: null,
            fields: [],
          },
          {
            key: 'c',
            title: 'Title c',
            logo: null,
            fit: null,
            pipelineFit: null,
            fields: [],
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

describe('liveCampaignsNamed', () => {
  const name = 'Events · Week 40, 2026'
  const c = (id: string, status: string, n = name, send_amt?: string) => ({
    id,
    name: n,
    status,
    send_amt,
  })

  it('finds live campaigns of the same issue: scheduled, sending, paused, sent, held', () => {
    const found = liveCampaignsNamed(
      [c('1', '1'), c('2', '2'), c('3', '3'), c('5', '5'), c('7', '7')],
      '99',
      name
    )
    expect(found.map(x => x.id)).toEqual(['1', '2', '3', '5', '7'])
  })

  it('ignores the draft itself, other drafts, sends stopped before anyone got them, and other issues', () => {
    const found = liveCampaignsNamed(
      [
        c('99', '1'),
        c('10', '0'),
        c('11', '4', name, '0'),
        c('12', '6', name, '0'),
        c('13', '5', 'Events · Week 39, 2026'),
      ],
      '99',
      name
    )
    expect(found).toEqual([])
  })

  it('counts a stop that already reached people, an unknown send count and unknown statuses', () => {
    const found = liveCampaignsNamed(
      [
        c('20', '4', name, '1200'),
        c('21', '6'),
        c('22', '9'),
        c('23', '4', name, ''),
      ],
      '99',
      name
    )
    expect(found.map(x => x.id)).toEqual(['20', '21', '22', '23'])
  })

  it('matches every wave of the issue by its base name', () => {
    const campaigns = [
      c('30', '5', `${name} · wave 1/4`),
      c('31', '1', `${name} · wave 2/4`),
      c('32', '5', 'Events · Week 41, 2026 · wave 1/4'),
    ]
    expect(liveCampaignsNamed(campaigns, '99', name).map(x => x.id)).toEqual([
      '30',
      '31',
    ])
    // A wave send only clashes with the same wave or a whole-list send.
    expect(liveCampaignsNamed(campaigns, '99', name, 2).map(x => x.id)).toEqual(
      ['31']
    )
    expect(
      liveCampaignsNamed([...campaigns, c('33', '5')], '99', name, 3).map(
        x => x.id
      )
    ).toEqual(['33'])
  })
})

describe('isLiveCampaign', () => {
  it('only a draft, or a stop/disable that provably reached nobody, is not live', () => {
    expect(isLiveCampaign({ status: '0' })).toBe(false)
    expect(isLiveCampaign({ status: '4', send_amt: '0' })).toBe(false)
    expect(isLiveCampaign({ status: '6', send_amt: '0' })).toBe(false)
    expect(isLiveCampaign({ status: '4', send_amt: '3' })).toBe(true)
    expect(isLiveCampaign({ status: '4', send_amt: null })).toBe(true)
    for (const s of ['1', '2', '3', '5', '7', '8', '42'])
      expect(isLiveCampaign({ status: s, send_amt: '0' })).toBe(true)
  })
})

describe('wave names', () => {
  it('builds and strips the wave suffix', () => {
    const issue = 'Events · Week 41, 2026'
    expect(waveCampaignName(issue, 2, 4)).toBe(
      'Events · Week 41, 2026 · wave 2/4'
    )
    expect(baseIssueName('Events · Week 41, 2026 · wave 2/4')).toBe(issue)
    expect(baseIssueName(issue)).toBe(issue)
    expect(waveOf('Events · Week 41, 2026 · wave 2/4')).toEqual({
      wave: 2,
      waves: 4,
    })
    expect(waveOf(issue)).toBeNull()
    // Only the exact suffix counts.
    expect(baseIssueName('Events · Week 41, 2026 · wave 2')).toBe(
      'Events · Week 41, 2026 · wave 2'
    )
  })
})

/* ─── Card text edits (mirrors ~/Newsletter/render.py set_fields) ─────── */

describe('card text fields', () => {
  const { input, group, key, values } = cardEdit

  it('lists every piece of text on a card, labelled by what it is', () => {
    const card = cardGroups(input)![0].cards.find(c => c.key === key)!
    expect(card.fields.map(f => [f.name, f.label])).toEqual([
      ['title', 'Title'],
      ['m0', 'Location'],
      ['m1', 'Dates'],
      ['desc', 'Description'],
      ['b0', 'Stipend'],
      ['b1', 'Time commitment'],
      ['b2', 'Entry bar'],
      ['b3', 'Applications'],
    ])
    expect(card.fields[2].value).toBe('1 week · Starts 5–11 October')
    expect(card.fields.every(f => f.original === null)).toBe(true)
  })

  it('gives byte-identical output to the pipeline (render.py set_fields)', () => {
    const out = setFieldsHtml(input, group, key, values)
    expect(createHash('sha256').update(out.html, 'utf8').digest('hex')).toBe(
      cardEdit.expectedHtmlSha256
    )
    expect(out.text).toBe(cardEdit.expectedText)
  })

  it('remembers the text as built, so the edit shows and can be undone', () => {
    const out = setFieldsHtml(input, group, key, values)
    const card = cardGroups(out.html)![0].cards.find(c => c.key === key)!
    expect(card.title).toBe('Lens Academy: Deep Learning Theory')
    const desc = card.fields.find(f => f.name === 'desc')!
    expect(desc.value).toBe('A new description & more <b>.')
    expect(desc.original).toMatch(/^Studies the mathematics/)
    // Putting Pen's text back clears the "edited" state.
    const back = setFieldsHtml(out.html, group, key, {
      desc: desc.original!,
    })
    const again = cardGroups(back.html)![0].cards.find(c => c.key === key)!
    expect(again.fields.find(f => f.name === 'desc')!.original).toBeNull()
  })

  it('leaves the other cards alone', () => {
    const before = cardGroups(input)![0].cards.filter(c => c.key !== key)
    const out = setFieldsHtml(input, group, key, values)
    const after = cardGroups(out.html)![0].cards.filter(c => c.key !== key)
    expect(after).toEqual(before)
  })

  it('refuses empty text, unknown fields and unknown cards', () => {
    expect(() => setFieldsHtml(input, group, key, { title: '  ' })).toThrow(
      FieldError
    )
    expect(() => setFieldsHtml(input, group, key, { b9: 'x' })).toThrow(
      FieldError
    )
    expect(() =>
      setFieldsHtml(input, group, 'recNope', { title: 'x' })
    ).toThrow(FieldError)
  })
})

/* ─── Card text edits on site cards (sitecards.py layout, 3 Oct 2026) ─── */

describe('card text fields on site cards', () => {
  const { group, training, events } = siteCardEdit

  it('gives byte-identical output to the pipeline for both issues', () => {
    for (const c of [training, events]) {
      const out = setFieldsHtml(c.input, group, c.key, c.values)
      expect(createHash('sha256').update(out.html, 'utf8').digest('hex')).toBe(
        c.expectedHtmlSha256
      )
      expect(out.text).toBe(c.expectedText)
    }
  })

  it('never rewrites the title line for an edit to another field', () => {
    // "Hong Kong" is both the location and part of the program's name.
    const out = setFieldsHtml(
      training.input,
      group,
      training.key,
      training.values
    )
    expect(out.text).toContain('* ML4Good Governance: Hong Kong October 2026\n')
    expect(out.text).toContain(
      '  Bootcamp · Hong Kong & Shenzhen · 9 days · Starts 12 Oct 2026\n'
    )
  })

  it('swaps a whole part of a detail line before a match inside another part', () => {
    const out = setFieldsHtml(events.input, group, events.key, events.values)
    expect(out.text).toContain(
      '  By Free Software Foundation · Free (donations welcome) · Register by 7 Oct 2026\n'
    )
  })

  it("labels an event's time of day as Time, not Time commitment", () => {
    const card = cardGroups(events.input)![0].cards.find(
      c => c.key === events.key
    )!
    expect(card.fields.map(f => [f.name, f.label])).toEqual([
      ['title', 'Title'],
      ['m0', 'Location'],
      ['m1', 'Dates'],
      ['m2', 'Time'],
      ['desc', 'Description'],
      ['b0', 'Host'],
      ['b1', 'Cost'],
      ['b2', 'Applications'],
    ])
    const program = cardGroups(training.input)![0].cards[0]
    expect(program.fields.find(f => f.name === 'b1')!.label).toBe(
      'Time commitment'
    )
  })
})

/* ─── Test copies ───────────────────────────────────────────────────── */

describe('sendTestCopy', () => {
  // A pretend ActiveCampaign: one draft (campaign 42, message 77, list 6)
  // and the v1 endpoint, which records what it was asked to do.
  const body = '<p>Week 40</p>'
  let html = ''
  let v1calls: URLSearchParams[] = []
  let v1answer: Record<string, unknown> = {}
  const env = { ...process.env }

  beforeEach(() => {
    process.env.ACTIVECAMPAIGN_URL = 'https://ac.example'
    process.env.ACTIVECAMPAIGN_KEY = 'key'
    html = `<!--aisafety-issue:${contentDigest(body)}-->${body}`
    v1calls = []
    v1answer = { result_code: 1, result_message: 'Message sent' }
    const reads: Record<string, unknown> = {
      'campaigns/42': {
        campaign: { id: '42', name: 'Events · Week 40, 2026', status: '0' },
      },
      'campaigns/42/campaignLists': { campaignLists: [{ list: '6' }] },
      'campaigns/42/campaignMessages': {
        campaignMessages: [{ messageid: '77' }],
      },
    }
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/admin/api.php') {
        const call = new URLSearchParams(String(init?.body ?? ''))
        call.set('api_action', url.searchParams.get('api_action') ?? '')
        v1calls.push(call)
        return Response.json(v1answer)
      }
      const path = url.pathname.replace('/api/3/', '')
      if (path === 'messages/77')
        return Response.json({
          message: { id: '77', subject: 'Week 40, 2026', html },
        })
      return path in reads
        ? Response.json(reads[path])
        : new Response('not found', { status: 404 })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...env }
  })

  it('mails ActiveCampaign’s test copy to the one address, and does nothing else', async () => {
    await expect(sendTestCopy('42', 'owner@example.com')).resolves.toEqual({
      to: 'owner@example.com',
    })
    expect(v1calls).toHaveLength(1)
    const [call] = v1calls
    expect(call.get('api_action')).toBe('campaign_send')
    expect(call.get('action')).toBe('test')
    expect(call.get('email')).toBe('owner@example.com')
    expect(call.get('campaignid')).toBe('42')
    expect(call.get('messageid')).toBe('77')
  })

  it('refuses a draft that fails the approval checks, before asking ActiveCampaign', async () => {
    html = body // the marker is gone: someone saved it in AC's designer
    await expect(sendTestCopy('42', 'owner@example.com')).rejects.toThrow(
      DraftProblemError
    )
    expect(v1calls).toHaveLength(0)
  })

  it('passes on ActiveCampaign’s reason when it won’t send', async () => {
    v1answer = { result_code: 0, result_message: 'Daily test limit reached' }
    const err = await sendTestCopy('42', 'owner@example.com').catch(e => e)
    expect(err).toBeInstanceOf(TestSendError)
    expect((err as TestSendError).detail).toContain('Daily test limit reached')
  })
})

/* ─── Waves and stopping (pure parts) ─────────────────────────────────── */

const U = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`

describe('parseWaveSegments', () => {
  const P = 'Newsletter wave '
  it('finds the waves by name, in order, and ignores other segments', () => {
    expect(
      parseWaveSegments(P, [
        { name: 'Newsletter wave 2', segmentId: U(2) },
        { name: 'Engaged readers', segmentId: U(9) },
        { name: 'Newsletter wave 3 (everyone else)', segmentId: U(3) },
        { name: 'Newsletter wave 1', segmentId: U(1) },
        { name: 'Newsletter waves old', segmentId: U(8) },
      ])
    ).toEqual([
      { wave: 1, name: 'Newsletter wave 1', segmentId: U(1), last: false },
      { wave: 2, name: 'Newsletter wave 2', segmentId: U(2), last: false },
      {
        wave: 3,
        name: 'Newsletter wave 3 (everyone else)',
        segmentId: U(3),
        last: true,
      },
    ])
    expect(parseWaveSegments(P, [])).toEqual([])
  })

  it('refuses a set that isn’t 1…N with only the last one “(everyone else)”', () => {
    const bad = [
      // a gap
      [
        { name: 'Newsletter wave 1', segmentId: U(1) },
        { name: 'Newsletter wave 3 (everyone else)', segmentId: U(3) },
      ],
      // no catch-all
      [
        { name: 'Newsletter wave 1', segmentId: U(1) },
        { name: 'Newsletter wave 2', segmentId: U(2) },
      ],
      // the catch-all not last
      [
        { name: 'Newsletter wave 1 (everyone else)', segmentId: U(1) },
        { name: 'Newsletter wave 2', segmentId: U(2) },
      ],
      // one wave twice
      [
        { name: 'Newsletter wave 1', segmentId: U(1) },
        { name: 'Newsletter wave 1', segmentId: U(4) },
        { name: 'Newsletter wave 2 (everyone else)', segmentId: U(2) },
      ],
      // only one
      [{ name: 'Newsletter wave 1 (everyone else)', segmentId: U(1) }],
    ]
    for (const saved of bad)
      expect(parseWaveSegments(P, saved)).toEqual({
        error: expect.stringMatching(/aren’t numbered 1 to N/),
      })
    expect(
      parseWaveSegments(P, [
        { name: 'Newsletter wave 1', segmentId: '12' },
        { name: 'Newsletter wave 2 (everyone else)', segmentId: U(2) },
      ])
    ).toEqual({ error: expect.stringMatching(/unexpected id/) })
  })
})

describe('waveTags', () => {
  const def = (
    wave: number,
    last: boolean,
    conditions: Array<[string, string, string]>,
    groupOps = ['and', 'AND']
  ) => ({
    wave,
    name: `Newsletter wave ${wave}`,
    last,
    conditions: conditions.map(([field, op, value]) => ({ field, op, value })),
    groupOps,
  })

  it('reads each wave’s tag; the last wave has none', () => {
    expect(
      waveTags([
        def(1, false, [['tagid', '=', '101']]),
        def(2, false, [['tagid', '=', '102']]),
        def(3, true, [
          ['tagid', '!=', '102'],
          ['tagid', '!=', '101'],
        ]),
      ])
    ).toEqual({ tags: ['101', '102', null] })
  })

  it('refuses conditions that could send an issue twice or never', () => {
    const cases = [
      // wave 1 isn't "has tag X"
      [
        def(1, false, [['tagid', '!=', '101']]),
        def(2, true, [['tagid', '!=', '101']]),
      ],
      // two conditions on a tagged wave
      [
        def(1, false, [
          ['tagid', '=', '101'],
          ['tagid', '=', '102'],
        ]),
        def(2, true, [['tagid', '!=', '101']]),
      ],
      // the last wave misses a tag
      [
        def(1, false, [['tagid', '=', '101']]),
        def(2, false, [['tagid', '=', '102']]),
        def(3, true, [['tagid', '!=', '101']]),
      ],
      // the last wave's conditions joined with OR
      [
        def(1, false, [['tagid', '=', '101']]),
        def(2, false, [['tagid', '=', '102']]),
        def(
          3,
          true,
          [
            ['tagid', '!=', '101'],
            ['tagid', '!=', '102'],
          ],
          ['or', 'AND']
        ),
      ],
      // something other than a tag (fields read back as "list.listid")
      [
        def(1, false, [['list.listid', '=', '6']]),
        def(2, true, [['tagid', '!=', '101']]),
      ],
      // two waves on one tag
      [
        def(1, false, [['tagid', '=', '101']]),
        def(2, false, [['tagid', '=', '101']]),
        def(3, true, [['tagid', '!=', '101']]),
      ],
    ]
    for (const c of cases) expect(waveTags(c)).toHaveProperty('error')
  })
})

describe('waveProgress', () => {
  const ISSUE = 'Events · Week 41, 2026'
  const w = (
    id: string,
    k: number,
    status: string,
    more: { send_amt?: string; ldate?: string | null; n?: number } = {}
  ) => ({
    id,
    name: `${ISSUE} · wave ${k}/${more.n ?? 4}`,
    status,
    send_amt: more.send_amt ?? '500',
    ldate: more.ldate === undefined ? '2026-10-08T09:30:00-05:00' : more.ldate,
  })

  it('starts at wave 1, then the wave after the last one sent', () => {
    expect(waveProgress(4, [])).toMatchObject({
      next: 1,
      notBefore: null,
      holds: [],
      wait: null,
      blocked: null,
      done: false,
    })
    const p = waveProgress(4, [w('2', 2, '5'), w('1', 1, '5')])
    expect(p).toMatchObject({ next: 3, done: false })
    expect(p.notBefore).toBe(Date.parse('2026-10-09T08:30:00Z'))
    expect(p.byWave.map(c => c?.id ?? null)).toEqual(['1', '2', null, null])
  })

  it('waits while the previous wave is scheduled, sending, paused or held', () => {
    for (const s of ['1', '2', '3', '7'])
      expect(waveProgress(4, [w('1', 1, s, { ldate: null })]).wait).toMatch(
        /^wave 2 can go once wave 1 has finished sending/
      )
  })

  it('a wave stopped after reaching people ends the run', () => {
    const p = waveProgress(4, [w('1', 1, '4', { send_amt: '300' })])
    expect(p.next).toBeNull()
    expect(p.blocked).toMatch(/wave 1 was stopped after reaching 300 people/)
  })

  it('is done after the last wave, or after a whole-list send', () => {
    const all = [1, 2, 3, 4].map(k => w(String(k), k, '5'))
    expect(waveProgress(4, all)).toMatchObject({ done: true, next: null })
    const whole = waveProgress(4, [
      { id: '9', name: ISSUE, status: '5', send_amt: '3' },
    ])
    expect(whole).toMatchObject({ done: true, next: null })
    expect(whole.blocked).toMatch(
      /already went to the whole list as campaign 9/
    )
  })

  it('refuses mixed-up sends: another number of waves, a wave twice, a gap', () => {
    expect(waveProgress(3, [w('1', 1, '5', { n: 4 })]).blocked).toMatch(
      /the waves changed/
    )
    expect(waveProgress(4, [w('1', 1, '5'), w('5', 1, '1')]).blocked).toMatch(
      /wave 1 of this issue went out twice \(campaigns 1 and 5\)/
    )
    expect(waveProgress(4, [w('2', 2, '5')]).blocked).toMatch(
      /wave 1 of this issue never went out, but wave 2 did/
    )
    expect(waveProgress(4, [w('7', 7, '5')]).blocked).toMatch(/can’t be/)
  })

  it('holds the next wave on a red verdict (not a small sample), or when the finish time is unknown', () => {
    const red = new Map([
      ['1', { verdict: 'red', reasons: ['spam complaints 0.3%'] }],
    ])
    expect(waveProgress(4, [w('1', 1, '5')], red).holds).toEqual([
      'the send watcher flagged wave 1 red: spam complaints 0.3%',
    ])
    const small = new Map([['1', { verdict: 'red', smallSample: true }]])
    expect(waveProgress(4, [w('1', 1, '5')], small).holds).toEqual([])
    const amber = new Map([['1', { verdict: 'amber', reasons: ['x'] }]])
    expect(waveProgress(4, [w('1', 1, '5')], amber).holds).toEqual([])
    expect(waveProgress(4, [w('1', 1, '5', { ldate: null })]).holds[0]).toMatch(
      /doesn’t say when wave 1 finished/
    )
  })

  it('holdsAt adds the 18-hour gap until it has passed', () => {
    const p = waveProgress(4, [w('1', 1, '5')])
    expect(holdsAt(p, new Date('2026-10-09T08:29:00Z'))).toEqual([
      'wave 1 finished less than 18 hours ago; wave 2 is due from 9 October 2026, 08:30 UTC',
    ])
    expect(holdsAt(p, new Date('2026-10-09T08:30:00Z'))).toEqual([])
  })
})

describe('stopActionsFor', () => {
  it('cancel before it starts, pause while sending, stop or resume once paused', () => {
    expect(stopActionsFor('1', ['6'])).toEqual(['cancel'])
    expect(stopActionsFor('7', ['7'])).toEqual(['cancel'])
    expect(stopActionsFor('2', ['8'])).toEqual(['pause'])
    expect(stopActionsFor('3', ['5'])).toEqual(['stop', 'resume'])
    for (const s of ['0', '4', '5', '6', '9'])
      expect(stopActionsFor(s, ['6'])).toEqual([])
  })

  it('only for single-list sends on lists 5–8', () => {
    expect(stopActionsFor('1', ['4'])).toEqual([])
    expect(stopActionsFor('1', ['9'])).toEqual([])
    expect(stopActionsFor('1', ['6', '7'])).toEqual([])
    expect(stopActionsFor('1', [])).toEqual([])
  })
})

describe('editLockFor', () => {
  it('locks card edits while a send of the issue is still going out', () => {
    const c = (status: string, name = 'Events · Week 41, 2026 · wave 1/4') => ({
      id: '5',
      name,
      status,
      send_amt: '10',
    })
    for (const s of ['1', '2', '3', '7', '9'])
      expect(editLockFor([c(s)])).toMatch(
        /^Wave 1 of this issue \(campaign 5\) is /
      )
    for (const s of ['4', '5', '6']) expect(editLockFor([c(s)])).toBeNull()
    expect(editLockFor([c('1', 'Events · Week 41, 2026')])).toMatch(
      /^This issue \(campaign 5\) is scheduled/
    )
    expect(editLockFor([])).toBeNull()
  })
})

describe('send delay', () => {
  it('ten minutes on the real lists, two on the test lists', () => {
    for (const l of ['6', '7', '8']) expect(sendDelayMinutes(l)).toBe(10)
    for (const l of ['4', '5']) expect(sendDelayMinutes(l)).toBe(2)
  })
})

describe('sdateInstant', () => {
  it('reads AC’s send date as an instant, in the account’s offset when it has none', () => {
    expect(sdateInstant('2026-10-09 09:00:00', '-05:00')).toBe(
      '2026-10-09T14:00:00.000Z'
    )
    expect(sdateInstant('2026-10-09T09:00:00-05:00', '+02:00')).toBe(
      '2026-10-09T14:00:00.000Z'
    )
    expect(sdateInstant(null, '-05:00')).toBeNull()
    expect(sdateInstant('soon', '-05:00')).toBeNull()
  })
})

describe('grouping by issue', () => {
  it('groupSends puts an issue’s rows together where its newest stands, highest wave first', () => {
    const r = (id: string, group: string, wave: number | null) => ({
      id,
      group,
      wave: wave == null ? null : { wave },
    })
    expect(
      groupSends([
        r('9', 'a', 2),
        r('8', 'b', null),
        r('7', 'a', 1),
        r('6', 'c', null),
        r('5', 'a', 3),
      ]).map(x => x.id)
    ).toEqual(['5', '9', '7', '8', '6'])
  })

  it('sumIssues groups per list and base name, newest first', () => {
    const s = (name: string, listId: string, ldate: string) => ({
      c: { name, ldate },
      listId,
      list: `list ${listId}`,
    })
    const out = sumIssues([
      s('Events · Week 41, 2026 · wave 1/2', '6', '2026-10-08T10:00:00Z'),
      s('Training · Week 41, 2026', '7', '2026-10-08T12:00:00Z'),
      s('Events · Week 41, 2026 · wave 2/2', '6', '2026-10-09T10:00:00Z'),
      s('Events · Week 41, 2026 · wave 1/2', '5', '2026-10-07T10:00:00Z'),
    ])
    expect(out.map(g => g.rows.map(r => `${r.listId}:${r.c.name}`))).toEqual([
      [
        '6:Events · Week 41, 2026 · wave 2/2',
        '6:Events · Week 41, 2026 · wave 1/2',
      ],
      ['7:Training · Week 41, 2026'],
      ['5:Events · Week 41, 2026 · wave 1/2'],
    ])
  })
})
