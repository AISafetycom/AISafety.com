import { describe, expect, it } from 'vitest'
import {
  localPath,
  markdownOf,
  parseInline,
  parseMarkdown,
  plainText,
  webAddress,
  type Block,
  type DomNode,
  type Inline,
} from './queue-markdown'

const text = (t: string): Inline => ({ t: 'text', text: t })
const link = (href: string, ...kids: Inline[]): Inline => ({
  t: 'link',
  href,
  kids,
})
const auto = (href: string, shown: string): Inline => ({
  t: 'link',
  href,
  auto: true,
  kids: [text(shown)],
})
const links = (kids: Inline[]): string[] =>
  kids.flatMap(k =>
    k.t === 'link'
      ? [k.href]
      : k.t === 'strong' || k.t === 'em' || k.t === 'del'
        ? links(k.kids)
        : []
  )

describe('parseInline: links with a label', () => {
  // The two lines in Bryce's screenshot, 18 Nov 2026.
  it('reads a label and a bare address as one link', () => {
    expect(
      parseInline(
        'a [meetup for people building AI products](saopaulo.aitinkerers.org/), with live demos'
      )
    ).toEqual([
      text('a '),
      link(
        'https://saopaulo.aitinkerers.org/',
        text('meetup for people building AI products')
      ),
      text(', with live demos'),
    ])
  })

  it('leaves a link that never closes as it was typed', () => {
    // As the screenshot cut it off, and as a reply reads while it streams.
    const raw =
      'It [talks about "ethical and responsible" AI development](itforum.com.br/?…'
    expect(parseInline(raw)).toEqual([text(raw)])
  })

  it('takes quotes in the label and a query string in the address', () => {
    expect(
      parseInline(
        'It [talks about "ethical and responsible" AI development](itforum.com.br/?p=4411&utm_source=x%20y#topo) there.'
      )
    ).toEqual([
      text('It '),
      link(
        'https://itforum.com.br/?p=4411&utm_source=x%20y#topo',
        text('talks about "ethical and responsible" AI development')
      ),
      text(' there.'),
    ])
  })

  it('keeps an https address as written', () => {
    expect(
      parseInline('[Their site](https://aisafetybrazil.org/) – it says so')
    ).toEqual([
      link('https://aisafetybrazil.org/', text('Their site')),
      text(' – it says so'),
    ])
  })

  it('takes parentheses that pair up inside the address', () => {
    expect(
      parseInline(
        'See [the article](https://en.wikipedia.org/wiki/AI_safety_(field)#History).'
      )
    ).toEqual([
      text('See '),
      link(
        'https://en.wikipedia.org/wiki/AI_safety_(field)#History',
        text('the article')
      ),
      text('.'),
    ])
  })

  it('ends the link before the bracket or the full stop after it', () => {
    expect(
      parseInline('It moved ([the new page](example.org/new)), last week.')
    ).toEqual([
      text('It moved ('),
      link('https://example.org/new', text('the new page')),
      text('), last week.'),
    ])
    expect(parseInline('Read [the post](https://example.org/post).')).toEqual([
      text('Read '),
      link('https://example.org/post', text('the post')),
      text('.'),
    ])
  })

  it('renders bold and code inside a label, and a link inside bold', () => {
    expect(
      parseInline('[**ABRIA** and `code`](https://abria.com.br/)')
    ).toEqual([
      link(
        'https://abria.com.br/',
        { t: 'strong', kids: [text('ABRIA')] },
        text(' and '),
        { t: 'code', text: 'code' }
      ),
    ])
    expect(
      parseInline(
        '**[PR 870](https://github.com/o/r/pull/870), [#4](https://x.org/4)** – merged'
      )
    ).toEqual([
      {
        t: 'strong',
        kids: [
          link('https://github.com/o/r/pull/870', text('PR 870')),
          text(', '),
          link('https://x.org/4', text('#4')),
        ],
      },
      text(' – merged'),
    ])
  })

  it('takes brackets inside a label without breaking the line', () => {
    expect(parseInline('a [list [of] things](example.org/a) b')).toEqual([
      text('a '),
      link('https://example.org/a', text('list [of] things')),
      text(' b'),
    ])
    expect(parseInline('an [aside] and [a link](example.org)')).toEqual([
      text('an [aside] and '),
      link('https://example.org/', text('a link')),
    ])
  })

  it('drops a title after the address', () => {
    expect(parseInline('[x](https://example.org/a "The title")')).toEqual([
      link('https://example.org/a', text('x')),
    ])
  })

  it('never makes a link of anything but a web address', () => {
    for (const raw of [
      '[click](javascript:alert(1))',
      '[click](JavaScript:alert%281%29)',
      '[click](data:text/html,<script>alert(1)</script>)',
      '[mail](mailto:someone@example.org?subject=hi)',
      '[x](vbscript:msgbox)',
      '[login](https://aisafety.com@evil.example/)',
      '[the file](chat.py)',
      '[notes](README.md)',
      '[here](#section)',
      '[a path](src/lib/admin/queue.ts)',
      '[x](ftp://example.org/file)',
      '[x](//example.org/no-scheme)',
    ]) {
      const kids = parseInline(raw)
      expect(links(kids), raw).toEqual([])
      expect(plainText(kids), raw).toBe(raw)
    }
  })

  it('shows a link to a file on the Mac as its path, never as a link', () => {
    expect(
      parseInline(
        'Saved ([~/Pen/events/CLAUDE.md](file:///Users/someone/Pen/events/CLAUDE.md)), done'
      )
    ).toEqual([
      text('Saved ('),
      {
        t: 'file',
        path: '~/Pen/events/CLAUDE.md',
        kids: [text('~/Pen/events/CLAUDE.md')],
      },
      text('), done'),
    ])
    expect(
      parseInline('[the screenshot](/Users/someone/Downloads/a%20b.png)')
    ).toEqual([
      {
        t: 'file',
        path: '~/Downloads/a%20b.png',
        kids: [text('the screenshot')],
      },
    ])
  })
})

describe('parseInline: bare addresses', () => {
  it('links one and shows it without the scheme', () => {
    expect(parseInline('See https://example.org/a?b=c&d=e#f for more')).toEqual(
      [
        text('See '),
        auto('https://example.org/a?b=c&d=e#f', 'example.org/a?b=c&d=e#f'),
        text(' for more'),
      ]
    )
  })

  it('leaves the mark that ends the sentence, the bold or the bracket outside', () => {
    expect(parseInline('It is at https://example.org/page.')).toEqual([
      text('It is at '),
      auto('https://example.org/page', 'example.org/page'),
      text('.'),
    ])
    expect(parseInline('(see https://example.org/page), then')).toEqual([
      text('(see '),
      auto('https://example.org/page', 'example.org/page'),
      text('), then'),
    ])
    expect(parseInline('**https://example.org/page**')).toEqual([
      {
        t: 'strong',
        kids: [auto('https://example.org/page', 'example.org/page')],
      },
    ])
    expect(
      parseInline('https://en.wikipedia.org/wiki/Safety_(AI) says')
    ).toEqual([
      auto(
        'https://en.wikipedia.org/wiki/Safety_(AI)',
        'en.wikipedia.org/wiki/Safety_(AI)'
      ),
      text(' says'),
    ])
  })

  it('links an address in angle brackets', () => {
    expect(parseInline('<https://example.org/a>')).toEqual([
      auto('https://example.org/a', 'example.org/a'),
    ])
  })

  it('does not link a bare domain in running text, or a word that only starts like one', () => {
    expect(
      links(parseInline('It is on example.org and in chat.py, e.g. here'))
    ).toEqual([])
    expect(links(parseInline('xhttps://example.org'))).toEqual([])
  })
})

describe('parseInline: emphasis and code', () => {
  it('reads bold, italics, strike and code', () => {
    expect(
      parseInline('**Bold:** and *italic*, _also_, ~~gone~~, `code`')
    ).toEqual([
      { t: 'strong', kids: [text('Bold:')] },
      text(' and '),
      { t: 'em', kids: [text('italic')] },
      text(', '),
      { t: 'em', kids: [text('also')] },
      text(', '),
      { t: 'del', kids: [text('gone')] },
      text(', '),
      { t: 'code', text: 'code' },
    ])
  })

  it('nests them', () => {
    expect(parseInline('**bold *and italic* too**')).toEqual([
      {
        t: 'strong',
        kids: [
          text('bold '),
          { t: 'em', kids: [text('and italic')] },
          text(' too'),
        ],
      },
    ])
    expect(parseInline('***both***')).toEqual([
      { t: 'strong', kids: [{ t: 'em', kids: [text('both')] }] },
    ])
  })

  it('leaves stray marks as they were typed', () => {
    for (const raw of [
      '5 * 3 * 2',
      'a * b',
      '*not closed',
      '** not bold **',
      'snake_case_name and __init__.py',
      'file_name.py',
      '~ about 5',
      'a ` b',
      '2 ** 8',
    ]) {
      expect(parseInline(raw), raw).toEqual([text(raw)])
    }
  })

  it('reads nothing inside code', () => {
    expect(parseInline('`**x** [a](b.org) https://c.org`')).toEqual([
      { t: 'code', text: '**x** [a](b.org) https://c.org' },
    ])
  })

  it('takes a backslash off an escaped mark', () => {
    expect(parseInline('\\*not italic\\* and \\[not a link\\](x.org)')).toEqual(
      [text('*not italic* and [not a link](x.org)')]
    )
  })

  it('breaks the line at a newline', () => {
    expect(parseInline('one\ntwo')).toEqual([
      text('one'),
      { t: 'br' },
      text('two'),
    ])
  })
})

describe('webAddress', () => {
  it('takes http and https, and puts https:// on a bare domain', () => {
    expect(webAddress('https://aisafety.com/events')).toBe(
      'https://aisafety.com/events'
    )
    expect(webAddress('http://example.org')).toBe('http://example.org/')
    expect(webAddress('saopaulo.aitinkerers.org/')).toBe(
      'https://saopaulo.aitinkerers.org/'
    )
    expect(webAddress('aisafetybrazil.org')).toBe('https://aisafetybrazil.org/')
    expect(
      webAddress('telesintese.com.br/associacao-quer-alterar-pl-de-ia/')
    ).toBe('https://telesintese.com.br/associacao-quer-alterar-pl-de-ia/')
    expect(webAddress('localhost:3400/admin/queue')).toBe(
      'http://localhost:3400/admin/queue'
    )
    expect(webAddress('http://localhost:3000/admin/queue#rec1')).toBe(
      'http://localhost:3000/admin/queue#rec1'
    )
    expect(webAddress('<https://example.org/a>')).toBe('https://example.org/a')
  })

  it('refuses everything else', () => {
    for (const raw of [
      '',
      'javascript:alert(1)',
      'data:text/html,hi',
      'mailto:a@example.org',
      'file:///Users/someone/x',
      'ftp://example.org/',
      '//example.org',
      '/admin/queue',
      '#top',
      'chat.py',
      'README.md',
      'just words',
      'https://user:pw@example.org/',
      'https://example.org/a b',
      'https://',
    ]) {
      expect(webAddress(raw), raw).toBeNull()
    }
  })
})

describe('localPath', () => {
  it('reads file links and home paths, with the home folder short', () => {
    expect(localPath('file:///Users/someone/Downloads/a%20b.png')).toBe(
      '~/Downloads/a b.png'
    )
    expect(localPath('/Users/someone/Queue/chat.py')).toBe('~/Queue/chat.py')
    expect(localPath('~/Queue/chat.py')).toBe('~/Queue/chat.py')
    expect(localPath('/private/tmp/x.log')).toBe('/private/tmp/x.log')
    expect(localPath('/admin/queue')).toBeNull()
    expect(localPath('https://example.org/Users/x/')).toBeNull()
  })
})

const p = (...kids: Inline[]): Block => ({ t: 'p', kids })

describe('parseMarkdown', () => {
  it('keeps paragraphs and the line breaks inside one', () => {
    expect(parseMarkdown('One\ntwo\n\nThree')).toEqual([
      p(text('One'), { t: 'br' }, text('two')),
      p(text('Three')),
    ])
  })

  it('reads a bullet list straight under a line of text', () => {
    expect(
      parseMarkdown(
        'What I checked:\n- **The listing** – fine\n- [Their site](example.org/)'
      )
    ).toEqual([
      p(text('What I checked:')),
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [
          [p({ t: 'strong', kids: [text('The listing')] }, text(' – fine'))],
          [p(link('https://example.org/', text('Their site')))],
        ],
      },
    ])
  })

  it('reads numbered steps, from the number they start at', () => {
    const [list] = parseMarkdown('3. Third\n4. Fourth\n5) Fifth')
    expect(list).toMatchObject({ t: 'list', ordered: true, start: 3 })
    expect(list.t === 'list' && list.items.length).toBe(3)
  })

  it('nests a list under a bullet, with a paragraph of its own after it', () => {
    const blocks = parseMarkdown(
      [
        '- **Other things:**',
        '  - **First** (`~/a.md`): one',
        '  - Second',
        '',
        '  The note under them.',
        '- There are three:',
        '  1. One',
        '  2. Two',
        '- Last, wrapped',
        '  onto a second line.',
      ].join('\n')
    )
    expect(blocks).toEqual([
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [
          [
            p({ t: 'strong', kids: [text('Other things:')] }),
            {
              t: 'list',
              ordered: false,
              start: 1,
              items: [
                [
                  p(
                    { t: 'strong', kids: [text('First')] },
                    text(' ('),
                    { t: 'code', text: '~/a.md' },
                    text('): one')
                  ),
                ],
                [p(text('Second'))],
              ],
            },
            p(text('The note under them.')),
          ],
          [
            p(text('There are three:')),
            {
              t: 'list',
              ordered: true,
              start: 1,
              items: [[p(text('One'))], [p(text('Two'))]],
            },
          ],
          [p(text('Last, wrapped onto a second line.'))],
        ],
      },
    ])
  })

  it('keeps bullets with a gap between them in one list, and ends it at plain text', () => {
    expect(parseMarkdown('- a\n\n- b\nAfter')).toEqual([
      {
        t: 'list',
        ordered: false,
        start: 1,
        items: [[p(text('a'))], [p(text('b'))]],
      },
      p(text('After')),
    ])
  })

  it('reads headings as a line, whatever their level', () => {
    expect(
      parseMarkdown('# Top\n## What I checked ##\nText\n#hashtag')
    ).toEqual([
      { t: 'head', level: 1, kids: [text('Top')] },
      { t: 'head', level: 2, kids: [text('What I checked')] },
      p(text('Text'), { t: 'br' }, text('#hashtag')),
    ])
  })

  it('reads a block quote, with what is inside it', () => {
    expect(
      parseMarkdown(
        'They wrote:\n\n> We meet **monthly**.\n> - in person\n\nSo yes.'
      )
    ).toEqual([
      p(text('They wrote:')),
      {
        t: 'quote',
        blocks: [
          p(
            text('We meet '),
            { t: 'strong', kids: [text('monthly')] },
            text('.')
          ),
          {
            t: 'list',
            ordered: false,
            start: 1,
            items: [[p(text('in person'))]],
          },
        ],
      },
      p(text('So yes.')),
    ])
  })

  it('keeps a fenced block as it was typed', () => {
    expect(
      parseMarkdown('Run:\n```bash\ncd ~/Queue\n**not bold**\n```\nDone')
    ).toEqual([
      p(text('Run:')),
      { t: 'code', lang: 'bash', text: 'cd ~/Queue\n**not bold**' },
      p(text('Done')),
    ])
    // Still being written: everything after the fence is code.
    expect(parseMarkdown('```\nhalf')).toEqual([
      { t: 'code', lang: '', text: 'half' },
    ])
  })

  it('reads a rule, and never a bullet or bold for one', () => {
    expect(parseMarkdown('Above\n\n---\n\nBelow\n***\n- - -')).toEqual([
      p(text('Above')),
      { t: 'rule' },
      p(text('Below')),
      { t: 'rule' },
      { t: 'rule' },
    ])
    expect(parseMarkdown('**bold** line')[0].t).toBe('p')
  })

  it('reads a simple table', () => {
    expect(
      parseMarkdown(
        [
          'As it stands:',
          '',
          '| Field | New value |',
          '|---|:--:|',
          '| Type | Fellowship: **paid** |',
          '| Link | [site](example.org) |',
          '| `a|b` | x \\| y |',
          '',
          'After.',
        ].join('\n')
      )
    ).toEqual([
      p(text('As it stands:')),
      {
        t: 'table',
        head: [[text('Field')], [text('New value')]],
        align: [null, 'center'],
        rows: [
          [
            [text('Type')],
            [text('Fellowship: '), { t: 'strong', kids: [text('paid')] }],
          ],
          [[text('Link')], [link('https://example.org/', text('site'))]],
          [[{ t: 'code', text: 'a|b' }], [text('x | y')]],
        ],
      },
      p(text('After.')),
    ])
  })

  it('does not take a line with a | for a table', () => {
    expect(parseMarkdown('a | b\nc | d').map(b => b.t)).toEqual(['p'])
  })
})

/** A stand-in for a DOM node. */
function el(
  name: string,
  kids: (DomNode | string)[] = [],
  attrs: Record<string, string> = {}
): DomNode {
  const childNodes = kids.map(
    (k): DomNode =>
      typeof k === 'string'
        ? { nodeType: 3, nodeName: '#text', textContent: k, childNodes: [] }
        : k
  )
  return {
    nodeType: name === '#fragment' ? 11 : 1,
    nodeName: name,
    textContent: null,
    childNodes,
    getAttribute: n => attrs[n] ?? null,
  }
}

describe('markdownOf', () => {
  it('gives a link back with its label and whole address', () => {
    expect(
      markdownOf(
        el('#fragment', [
          'ABRIA has ',
          el('A', ['pushed to change more than 30 articles'], {
            href: 'https://telesintese.com.br/associacao-quer-alterar-pl-de-ia/',
          }),
          '.',
        ])
      )
    ).toBe(
      'ABRIA has [pushed to change more than 30 articles](https://telesintese.com.br/associacao-quer-alterar-pl-de-ia/).'
    )
  })

  it('gives a bare address back whole', () => {
    expect(
      markdownOf(
        el('P', [
          'See ',
          el('A', ['example.org/page'], {
            href: 'https://example.org/page',
            'data-auto': '',
          }),
        ])
      )
    ).toBe('See https://example.org/page')
    expect(
      markdownOf(el('A', ['example.org'], { href: 'https://example.org/' }))
    ).toBe('https://example.org/')
  })

  it('keeps bold, italics, code and bullets, and leaves buttons out', () => {
    expect(
      markdownOf(
        el('DIV', [
          el('P', [
            el('STRONG', ['What I checked']),
            ' and ',
            el('EM', ['how']),
          ]),
          el('UL', [
            el('LI', ['The ', el('CODE', ['Focus']), ' field']),
            el('LI', [
              el('A', ['Their site'], { href: 'https://example.org/' }),
            ]),
          ]),
          el('OL', [el('LI', ['One']), el('LI', ['Two'])], { start: '3' }),
          el('BUTTON', ['Undo edit']),
        ])
      )
    ).toBe(
      '**What I checked** and *how*\n\n- The `Focus` field\n\n- [Their site](https://example.org/)\n\n3. One\n\n4. Two'
    )
  })

  it('reads back as the same link', () => {
    const quoted = markdownOf(
      el('P', [
        el('A', ['a "quoted" label'], {
          href: 'https://example.org/a_(b)?c=d',
        }),
      ])
    )
    expect(parseInline(quoted)).toEqual([
      link('https://example.org/a_(b)?c=d', text('a "quoted" label')),
    ])
  })

  it('makes no link of anything that is not a web address', () => {
    expect(
      markdownOf(el('A', ['click'], { href: 'javascript:alert(1)' }))
    ).toBe('click')
  })
})
