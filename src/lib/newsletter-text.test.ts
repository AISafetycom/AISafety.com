import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TEXT_SCRIPT,
  TEXT_SCRIPT_HASH,
  safeInline,
  textHtml,
  textPage,
  textPlain,
  textVersion,
} from './newsletter-text'

// Training · Week 41, 2026 exactly as it went out (the kept copy).
const WEEK_41 = readFileSync(
  path.join(__dirname, 'admin/__fixtures__/newsletter-training-week-41.html'),
  'utf8'
)

type Seg = { c?: string; t: string }

/** A small email the way ~/Newsletter/render.py lays one out: the note in
 *  the header, the intro opening the body cell, cards in markers, the
 *  manifest last. */
function email(opts: {
  intro?: string
  cards?: { key: string; href?: string }[]
  groups?: { id: string; label: string; cards: { key: string }[] }[]
  text?: Seg[]
}) {
  const cards = opts.cards ?? [
    { key: 'recA', href: 'https://aisafety.com/api/nl/0123456789abcdef/2' },
  ]
  const groups = opts.groups ?? [
    { id: 'g0', label: 'New events', cards: cards.map(c => ({ key: c.key })) },
  ]
  const text = opts.text ?? [
    {
      t: 'WEEK 41, 2026\n8 October 2026\n\nThe note.\n\nThe intro.\n\n== NEW EVENTS ==\n\n',
    },
    {
      c: 'g0:recA',
      t: '* The Big Tent\n  Conference · San Francisco, USA · 20 – 21 Nov 2026\n  By Mox · Pay to attend\n  AI safety convention for the whole community.\n  https://thebigtent.example/?utm_source=aisafety.com\n\n',
    },
    {
      t: 'Full directory: https://aisafety.com/events\n\nUnsubscribe: %UNSUBSCRIBELINK%\n',
    },
  ]
  const b64 = Buffer.from(JSON.stringify({ v: 1, groups, text })).toString(
    'base64'
  )
  return (
    '<!DOCTYPE html><html><head><title>Week 41, 2026</title></head><body><table>' +
    '<tr><td class="hero"><p>This newsletter has moved. <a href="%UNSUBSCRIBELINK%">Unsubscribe</a></p></td></tr>' +
    `<tr><td class="inner" style="padding:0;">\n  ${opts.intro ?? '<p style="color:#fff;">The intro, with <a style="color:#a6dad9;" href="https://aisafety.com/api/nl/0123456789abcdef/1">AISafety.com/events</a>.</p>'}\n` +
    '  <div style="height:40px;">&nbsp;</div>' +
    cards
      .map(
        c =>
          `<!--card:g0:${c.key}--><table><tr><td>${c.href ? `<a href="${c.href}">Title</a>` : 'Title'}</td></tr></table><!--/card-->`
      )
      .join('') +
    '<!--web:hide--><a href="%UNSUBSCRIBELINK%">Unsubscribe</a><!--/web:hide-->' +
    `</td></tr></table><!--aisafety-cards:${b64}-->\n</body></html>`
  )
}

describe('textVersion', () => {
  it('reads a real issue: its intro, its section and every card with the email’s own link', () => {
    const tv = textVersion(WEEK_41)!
    expect(tv.intro).toEqual([
      'This is a weekly newsletter that lists newly announced training programs addressing existential risk from AI. ' +
        'Visit <a href="https://aisafety.com/api/nl/ef5a4892a0dbf9ee/1">AISafety.com/training</a> for the full directory of upcoming programs.',
    ])
    expect(tv.groups).toHaveLength(1)
    const [g] = tv.groups
    expect(g.label).toBe('New training programs')
    expect(g.notes).toEqual([])
    expect(g.cards.map(c => c.href)).toEqual(
      [2, 3, 4, 5, 6, 7, 8].map(
        n => `https://aisafety.com/api/nl/ef5a4892a0dbf9ee/${n}`
      )
    )
    expect(g.cards[0]).toEqual({
      title: 'Iliad Intensive: January 2027',
      href: 'https://aisafety.com/api/nl/ef5a4892a0dbf9ee/2',
      lines: [
        'Bootcamp · Berkeley, USA & London, UK · 4 weeks · Starts 4 Jan 2027',
        'Expenses covered · Full-time · Entry bar: mid · Focus: technical · Apply by 16 Nov 2026',
        'Course on foundational alignment research for researchers with math, physics, or computer science backgrounds. ' +
          'Covers deep learning theory, agent foundations, interpretability, and safety guarantees and their limits.',
      ],
    })
  })

  it('leaves out the migration note, the title and the footer', () => {
    const all = textPlain(textVersion(WEEK_41)!)
    expect(all).not.toContain('moved from Substack')
    expect(all).not.toContain('WEEK 41')
    expect(all).not.toContain('Unsubscribe')
    expect(all).not.toContain('Full directory')
    expect(all).not.toMatch(/%[A-Z]/)
    const small = textPlain(textVersion(email({}))!)
    expect(small).not.toContain('The note')
    expect(small).not.toContain('Full directory')
  })

  it('follows the manifest: its order, and no removed card', () => {
    const tv = textVersion(
      email({
        cards: [
          {
            key: 'recA',
            href: 'https://aisafety.com/api/nl/0123456789abcdef/2',
          },
          {
            key: 'recB',
            href: 'https://aisafety.com/api/nl/0123456789abcdef/3',
          },
        ],
        groups: [
          {
            id: 'g0',
            label: 'New events',
            cards: [{ key: 'recB' }, { key: 'recA' }],
          },
        ],
        text: [
          { t: '== NEW EVENTS ==\n\n' },
          { c: 'g0:recB', t: '* Second\n  https://b.example/\n\n' },
          { c: 'g0:recA', t: '* First\n  https://a.example/\n\n' },
          { c: 'g0:recGone', t: '* Removed\n\n' },
        ],
      })
    )!
    expect(tv.groups[0].cards.map(c => [c.title, c.href])).toEqual([
      ['Second', 'https://aisafety.com/api/nl/0123456789abcdef/3'],
      ['First', 'https://aisafety.com/api/nl/0123456789abcdef/2'],
    ])
  })

  it('uses the plain text’s own link for a card the email doesn’t link', () => {
    const tv = textVersion(email({ cards: [{ key: 'recA' }] }))!
    expect(tv.groups[0].cards[0].href).toBe(
      'https://thebigtent.example/?utm_source=aisafety.com'
    )
    expect(tv.groups[0].cards[0].lines).not.toContain(
      'https://thebigtent.example/?utm_source=aisafety.com'
    )
  })

  it('keeps each section’s own notes, and every section’s label', () => {
    const tv = textVersion(
      email({
        cards: [{ key: 'recA' }, { key: 'recB' }],
        groups: [
          {
            id: 'g0',
            label: 'Closing in the next two weeks',
            cards: [{ key: 'recA' }],
          },
          { id: 'g1', label: 'Always open', cards: [{ key: 'recB' }] },
        ],
        text: [
          {
            t: 'ISSUE #22, 2026\n\nIntro.\n\n== CLOSING IN THE NEXT TWO WEEKS ==\n\n',
          },
          {
            c: 'g0:recA',
            t: '* Fund A\n  Deadline: 20 Oct 2026\n  https://a.example/\n\n',
          },
          { t: '== ALWAYS OPEN ==\n\nThe main go-to funders.\n\n' },
          {
            c: 'g1:recB',
            t: '* Fund B\n  - Grants: small ones  https://b.example/grants\n  https://b.example/\n\n',
          },
          { t: 'Full directory: https://aisafety.com/funding\n' },
        ],
      })
    )!
    expect(tv.groups.map(g => [g.label, g.notes])).toEqual([
      ['Closing in the next two weeks', []],
      ['Always open', ['The main go-to funders.']],
    ])
    expect(textHtml(tv)).toContain(
      '- Grants: small ones  <a href="https://b.example/grants">https://b.example/grants</a>'
    )
  })

  it('is null without a manifest, a readable one, or any card', () => {
    expect(textVersion('<html><body>Hi</body></html>')).toBeNull()
    expect(textVersion('<!--aisafety-cards:bm9wZQ==-->')).toBeNull()
    expect(
      textVersion(email({ groups: [{ id: 'g0', label: 'X', cards: [] }] }))
    ).toBeNull()
  })
})

describe('safeInline', () => {
  it('keeps text, http links, bold and italics, and nothing else', () => {
    expect(
      safeInline(
        '<span style="x">Hi <b>bold</b> <i>it</i> <a style="c" href="https://x.example/?a=1&amp;b=2">x</a>' +
          '<img src="y"><script>alert(1)</script></span>'
      )
    ).toBe(
      'Hi <strong>bold</strong> <em>it</em> <a href="https://x.example/?a=1&amp;b=2">x</a>alert(1)'
    )
  })

  it('keeps only the words of a link that isn’t a web address', () => {
    expect(
      safeInline(
        '<a href="%UNSUBSCRIBELINK%">unsubscribe</a> <a href="javascript:x">go</a>'
      )
    ).toBe('unsubscribe go')
    expect(safeInline('<a href="mailto:x@example.com">x</a>')).toBe('x')
  })

  it('closes a link left open', () => {
    expect(safeInline('<a href="https://x.example/">x')).toBe(
      '<a href="https://x.example/">x</a>'
    )
  })
})

describe('textHtml and textPlain', () => {
  const tv = textVersion(email({}))!

  it('write each card as one paragraph: linked title, detail rows in italics, then the description', () => {
    expect(textHtml(tv)).toBe(
      '<p><em>The intro, with <a href="https://aisafety.com/api/nl/0123456789abcdef/1">AISafety.com/events</a>.</em></p>\n' +
        '<p><strong>New events</strong></p>\n' +
        '<p>• <a href="https://aisafety.com/api/nl/0123456789abcdef/2">The Big Tent</a><br>' +
        '<em>Conference · San Francisco, USA · 20 – 21 Nov 2026</em><br><em>By Mox · Pay to attend</em><br>' +
        'AI safety convention for the whole community.</p>'
    )
  })

  it('write the plain version with every link spelled out', () => {
    expect(textPlain(tv)).toBe(
      'The intro, with AISafety.com/events.\n\n' +
        'New events\n\n' +
        '• The Big Tent\nConference · San Francisco, USA · 20 – 21 Nov 2026\nBy Mox · Pay to attend\n' +
        'AI safety convention for the whole community.\nhttps://aisafety.com/api/nl/0123456789abcdef/2\n'
    )
    const other = textVersion(
      email({
        intro:
          '<p>See <a href="https://aisafety.com/api/nl/0123456789abcdef/1">the map</a> &amp; more.</p>',
      })
    )!
    expect(textPlain(other)).toMatch(
      /^See the map \(https:\/\/aisafety\.com\/api\/nl\/0123456789abcdef\/1\) & more\.\n/
    )
  })

  it('escape what the plain text carries', () => {
    const odd = textVersion(
      email({
        text: [{ c: 'g0:recA', t: '* <b>Tom & Jerry</b>\n  "x" · <y>\n\n' }],
      })
    )!
    const html = textHtml(odd)
    expect(html).toContain('&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;</a>')
    expect(html).toContain('<em>&quot;x&quot; · &lt;y&gt;</em>')
  })
})

describe('textPage', () => {
  it('shows the text, the button and the way back to the email, with its one script allowed by hash', () => {
    const page = textPage(
      textVersion(WEEK_41)!,
      'training',
      'Week 41, 2026',
      '/newsletter/training/week-41-2026'
    )
    expect(page).toContain(
      '<title>Week 41, 2026 – text version – AI Safety Training</title>'
    )
    expect(page).toContain(
      '<button type="button" id="copy">Copy text version</button>'
    )
    expect(page).toContain(
      '<a href="/newsletter/training/week-41-2026">View the email</a>'
    )
    expect(page).toContain('noindex')
    expect(page).toContain(`<script>${TEXT_SCRIPT}</script>`)
    expect(TEXT_SCRIPT_HASH).toBe(
      'sha256-' + createHash('sha256').update(TEXT_SCRIPT).digest('base64')
    )
    // The plain version rides along, escaped, for the button.
    expect(page).toContain('<textarea id="plain"')
    expect(page).toContain('Berkeley, USA &amp; London, UK')
    expect(page).not.toContain('Slack')
  })
})
