import { describe, expect, it } from 'vitest'
import {
  abHalves,
  abLine,
  abListProblems,
  abTestOf,
  abVariants,
  joinLine,
  type AbTest,
} from './newsletter-ab'

const P = '0123456789abcdef'
const S = 'fedcba9876543210'

function marker(d: unknown): string {
  return `<!--aisafety-ab:${Buffer.from(JSON.stringify(d)).toString('base64')}-->`
}

const TEST: AbTest = {
  picks: [
    { k: 'recC', t: 'PauseAI in Parliament' },
    { k: 'recA', t: 'AI Safety Career Fair in SF' },
  ],
  p: P,
  s: S,
}

function card(key: string): string {
  return `<!--card:g0:${key}--><table><tr><td>${key}</td></tr></table><!--/card-->`
}

const HTML =
  '<html><body><div style="display:none;max-height:0;">Newly announced events.&nbsp;&zwnj;&nbsp;&zwnj;</div>' +
  ['recA', 'recB', 'recC', 'recD'].map(card).join('') +
  `<a href="https://aisafety.com/api/nl/${P}/0">One</a>` +
  `<a href="https://aisafety.com/api/nl/${P}/1">Two</a>` +
  `${marker({ v: 1, picks: TEST.picks, p: P, s: S })}</body></html>`

describe('abTestOf', () => {
  it('reads the marker', () => {
    expect(abTestOf(HTML)).toEqual(TEST)
  })

  it('is null for a usual issue', () => {
    expect(abTestOf('<html><body>no test</body></html>')).toBeNull()
  })

  it('calls a marker it can’t use malformed', () => {
    expect(abTestOf('<!--aisafety-ab:bm90IGpzb24=-->')).toBe('malformed')
    expect(abTestOf(marker({ v: 1, picks: [], p: P, s: S }))).toBe('malformed')
    expect(abTestOf(marker({ v: 1, picks: TEST.picks, p: P, s: P }))).toBe(
      'malformed'
    )
    expect(
      abTestOf(marker({ v: 1, picks: [{ k: 'recA', t: ' ' }], p: P, s: S }))
    ).toBe('malformed')
    expect(abTestOf(marker({ v: 1, picks: TEST.picks, p: 'nope', s: S }))).toBe(
      'malformed'
    )
  })
})

describe('joinLine', () => {
  it('writes the line with the Oxford comma', () => {
    expect(joinLine(['A', 'B'], 8)).toBe('A, B, and 8 more')
    expect(joinLine(['A', 'B', 'C'], 0)).toBe('A, B, and C')
    expect(joinLine(['A', 'B'], 0)).toBe('A and B')
    expect(joinLine(['A'], 3)).toBe('A and 3 more')
    expect(joinLine(['A'], 0)).toBe('A')
  })
})

describe('abLine', () => {
  it('names the picks in the email’s order, then the others', () => {
    expect(abLine(HTML, TEST)).toBe(
      'AI Safety Career Fair in SF, PauseAI in Parliament, and 2 more'
    )
  })

  it('follows a card removed on the page', () => {
    const removed = HTML.replace(card('recC'), '').replace(card('recD'), '')
    expect(abLine(removed, TEST)).toBe('AI Safety Career Fair in SF and 1 more')
  })

  it('follows a reorder', () => {
    const moved = HTML.replace(card('recA'), '').replace(
      card('recD'),
      card('recD') + card('recA')
    )
    expect(abLine(moved, TEST)).toBe(
      'PauseAI in Parliament, AI Safety Career Fair in SF, and 2 more'
    )
  })

  it('is null once every pick is gone', () => {
    const gone = HTML.replace(card('recA'), '').replace(card('recC'), '')
    expect(abLine(gone, TEST)).toBeNull()
  })
})

describe('abVariants', () => {
  const msg = {
    subject: 'Week 48, 2026',
    html: HTML,
    text: `WEEK 48, 2026\nhttps://aisafety.com/api/nl/${P}/0\n`,
  }

  it('makes the subject half and the preview half', () => {
    const made = abVariants(msg, TEST)
    if (typeof made === 'string') throw new Error(made)
    const line =
      'AI Safety Career Fair in SF, PauseAI in Parliament, and 2 more'
    expect(made.line).toBe(line)
    // Subject half: the line as the subject, the usual preview, its own
    // link list.
    expect(made.subject.subject).toBe(line)
    expect(made.subject.html).toContain('Newly announced events.&nbsp;')
    expect(made.subject.html).not.toContain(`/api/nl/${P}/`)
    expect(made.subject.html).toContain(`/api/nl/${S}/0`)
    expect(made.subject.html).toContain(`/api/nl/${S}/1`)
    expect(made.subject.text).toContain(`/api/nl/${S}/0`)
    // Preview half: the usual subject, the line as the preview (padding
    // kept), the email's own link list.
    expect(made.preview.subject).toBe('Week 48, 2026')
    expect(made.preview.html).toContain(
      `display:none;max-height:0;">${line}&nbsp;&zwnj;&nbsp;&zwnj;</div>`
    )
    expect(made.preview.html).not.toContain('Newly announced events.')
    expect(made.preview.html).toContain(`/api/nl/${P}/0`)
    expect(made.preview.text).toBe(msg.text)
  })

  it('escapes the line in the preview', () => {
    const t: AbTest = { ...TEST, picks: [{ k: 'recA', t: 'R&D <Fair>' }] }
    const made = abVariants(msg, t)
    if (typeof made === 'string') throw new Error(made)
    expect(made.preview.html).toContain('R&amp;D &lt;Fair&gt; and 3 more')
    expect(made.subject.subject).toBe('R&D <Fair> and 3 more')
  })

  it('refuses when no pick is left, the line is too long, or the links aren’t the test’s', () => {
    const gone = HTML.replace(card('recA'), '').replace(card('recC'), '')
    expect(abVariants({ ...msg, html: gone }, TEST)).toMatch(
      /none of the listings picked/
    )
    const long: AbTest = { ...TEST, picks: [{ k: 'recA', t: 'x'.repeat(200) }] }
    expect(abVariants(msg, long)).toMatch(/more than 150/)
    const other = HTML.split(`/api/nl/${P}/`).join(`/api/nl/${'1'.repeat(16)}/`)
    expect(abVariants({ ...msg, html: other }, TEST)).toMatch(
      /don’t use the A\/B test’s link list/
    )
    expect(
      abVariants(
        { ...msg, html: HTML.replace(/<div style[^>]*>.*?<\/div>/, '') },
        TEST
      )
    ).toMatch(/no preview line/)
  })
})

describe('abHalves', () => {
  it('says what each half sees', () => {
    expect(
      abHalves('Week 48, 2026', 'Newly announced events.', 'A and B')
    ).toEqual({
      a: { subject: 'A and B', preview: 'Newly announced events.' },
      b: { subject: 'Week 48, 2026', preview: 'A and B' },
    })
  })
})

describe('abListProblems', () => {
  const links = [{ u: 'https://example.org/', k: 'recA', t: 'One' }]
  const p = { v: 1, c: 'Events · Week 48, 2026', ab: 'preview', links }
  const s = { ...p, ab: 'subject' }

  it('passes the pair', () => {
    expect(abListProblems(TEST, p, s)).toEqual([])
  })

  it('blocks a missing, unreadable or different second list', () => {
    expect(abListProblems(TEST, p, 'missing')[0]).toMatch(/isn’t on the Blob/)
    expect(abListProblems(TEST, p, 'unreadable')[0]).toMatch(/try again/)
    expect(abListProblems(TEST, p, { ...s, links: [] })[0]).toMatch(
      /don’t match/
    )
    expect(abListProblems(TEST, p, { ...s, ab: 'preview' })[0]).toMatch(
      /don’t match/
    )
    expect(abListProblems(TEST, { ...p, ab: undefined }, s)[0]).toMatch(
      /don’t match/
    )
  })
})
