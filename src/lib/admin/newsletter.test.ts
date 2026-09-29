import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cardGroups,
  contentDigest,
  DraftProblemError,
  FieldError,
  FitError,
  formatLocal,
  liveCampaignsNamed,
  previewText,
  ReorderError,
  reorderHtml,
  sendTestCopy,
  setFieldsHtml,
  setFitHtml,
  TestSendError,
} from './newsletter'
import { createHash } from 'node:crypto'
import cardEdit from './__fixtures__/newsletter-card-edit.json'

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
  const c = (id: string, status: string, n = name) => ({ id, name: n, status })

  it('finds live campaigns of the same issue: scheduled, sending, paused, sent, held', () => {
    const found = liveCampaignsNamed(
      [c('1', '1'), c('2', '2'), c('3', '3'), c('5', '5'), c('7', '7')],
      '99',
      name
    )
    expect(found.map(x => x.id)).toEqual(['1', '2', '3', '5', '7'])
  })

  it('ignores the draft itself, other drafts, stopped/disabled sends and other issues', () => {
    const found = liveCampaignsNamed(
      [
        c('99', '1'),
        c('10', '0'),
        c('11', '4'),
        c('12', '6'),
        c('13', '5', 'Events · Week 39, 2026'),
      ],
      '99',
      name
    )
    expect(found).toEqual([])
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
