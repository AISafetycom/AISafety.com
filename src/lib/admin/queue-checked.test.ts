import { describe, expect, it } from 'vitest'
import {
  MAX_CLAIMS,
  MAX_SOURCES,
  checkedOf,
  sourceHost,
  sourceLabels,
  sourceLink,
  supportsWord,
} from './queue-checked'

const brazil = {
  at: '2026-11-18T06:20:00Z',
  claims: [
    {
      claim: 'The group is not focused on AI safety',
      found:
        'Its site says it covers the full spectrum of AI safety, and its meetup rooms are technical alignment, AI governance, and field growth.',
      supports: 'no',
      sources: [
        'https://aisafetybrazil.org/',
        'https://aisafetybrazil.org/about',
      ],
    },
    {
      claim: 'It is run and supported by members of an AI acceleration lobby',
      found:
        'ABRIA, the Brazilian AI industry association, is an institutional supporter of the meetups.',
      supports: 'partly',
      sources: ['https://www.abria.com.br/apoio'],
    },
  ],
}

describe('checkedOf', () => {
  it('reads the block the Mac writes', () => {
    expect(checkedOf(brazil)).toEqual([
      {
        claim: 'The group is not focused on AI safety',
        found: brazil.claims[0].found,
        supports: 'no',
        sources: [
          'https://aisafetybrazil.org/',
          'https://aisafetybrazil.org/about',
        ],
      },
      {
        claim: 'It is run and supported by members of an AI acceleration lobby',
        found: brazil.claims[1].found,
        supports: 'partly',
        sources: ['https://www.abria.com.br/apoio'],
      },
    ])
  })

  it('is empty for a row without the block, or a malformed one', () => {
    for (const v of [
      undefined,
      null,
      '',
      'checked',
      7,
      [],
      {},
      { claims: 'none' },
      { claims: {} },
      { at: '2026-11-18T06:20:00Z' },
    ]) {
      expect(checkedOf(v)).toEqual([])
    }
  })

  it('leaves out a claim with nothing found, and keeps the rest', () => {
    expect(
      checkedOf({
        claims: [
          null,
          'a string',
          ['a list'],
          { claim: 'No finding' },
          { claim: 'Blank finding', found: '   ' },
          { claim: 'Finding is not text', found: { text: 'x' } },
          { found: 'The page lists a 5 December deadline.' },
        ],
      })
    ).toEqual([
      {
        claim: null,
        found: 'The page lists a 5 December deadline.',
        supports: null,
        sources: [],
      },
    ])
  })

  it('takes only text for the words, on one line', () => {
    const [c] = checkedOf({
      claims: [
        {
          claim: ['not', 'text'],
          found: '  It says\n\n so   on its\tAbout page. ',
          supports: 'certainly',
          sources: 'https://example.org/',
        },
      ],
    })
    expect(c).toEqual({
      claim: null,
      found: 'It says so on its About page.',
      supports: null,
      sources: [],
    })
  })

  it('keeps markup as plain words, never as markup', () => {
    const [c] = checkedOf({
      claims: [
        { found: '<img src=x onerror=alert(1)> [x](javascript:alert(1))' },
      ],
    })
    expect(c.found).toBe(
      '<img src=x onerror=alert(1)> [x](javascript:alert(1))'
    )
  })

  it('drops every source that is not a plain http(s) link', () => {
    const [c] = checkedOf({
      claims: [
        {
          found: 'Found.',
          sources: [
            'javascript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'file:///etc/passwd',
            'mailto:someone@example.org',
            '//example.org/no-scheme',
            'example.org',
            'https://user:secret@example.org/',
            'https://localhost/',
            'http://',
            7,
            null,
            { href: 'https://example.org/' },
            ' https://example.org/page ',
            'HTTP://Example.org/Other',
          ],
        },
      ],
    })
    expect(c.sources).toEqual([
      'https://example.org/page',
      'http://example.org/Other',
    ])
  })

  it('shows a link once, and at most four a claim', () => {
    const [c] = checkedOf({
      claims: [
        {
          found: 'Found.',
          sources: [
            'https://example.org/a',
            'https://example.org/a',
            'https://example.org/b',
            'https://example.org/c',
            'https://example.org/d',
            'https://example.org/e',
          ],
        },
      ],
    })
    expect(c.sources).toHaveLength(MAX_SOURCES)
    expect(c.sources).toEqual([
      'https://example.org/a',
      'https://example.org/b',
      'https://example.org/c',
      'https://example.org/d',
    ])
  })

  it('shows at most five claims', () => {
    const claims = Array.from({ length: 9 }, (_, i) => ({
      found: `Finding ${i + 1}.`,
    }))
    const out = checkedOf({ claims })
    expect(out).toHaveLength(MAX_CLAIMS)
    expect(out.at(-1)?.found).toBe('Finding 5.')
  })

  it('caps words of absurd length', () => {
    const [c] = checkedOf({
      claims: [{ claim: 'c'.repeat(5000), found: 'f'.repeat(5000) }],
    })
    expect(c.claim).toHaveLength(300)
    expect(c.found).toHaveLength(1000)
  })
})

describe('sourceLink', () => {
  it('takes http and https links only', () => {
    expect(sourceLink('https://aisafetybrazil.org/')).toBe(
      'https://aisafetybrazil.org/'
    )
    expect(sourceLink('http://example.org/a?b=c#d')).toBe(
      'http://example.org/a?b=c#d'
    )
    expect(sourceLink('ftp://example.org/')).toBeNull()
    expect(sourceLink('javascript:alert(1)')).toBeNull()
    expect(sourceLink('https://')).toBeNull()
    expect(sourceLink(undefined)).toBeNull()
  })
})

describe('sourceLabels', () => {
  it('names a source by its host', () => {
    expect(
      sourceLabels(['https://www.abria.com.br/apoio', 'https://luma.com/x1'])
    ).toEqual(['abria.com.br', 'luma.com'])
  })

  it('adds the path when two sources share a host', () => {
    expect(
      sourceLabels([
        'https://aisafetybrazil.org/',
        'https://aisafetybrazil.org/nosso-time/',
        'https://aisafetybrazil.org/wp-json/api/artigos?per_page=100',
        'https://abria.org.br/a-abria/',
      ])
    ).toEqual([
      'aisafetybrazil.org',
      'aisafetybrazil.org/nosso-time',
      'aisafetybrazil.org/wp-json/api/artigos',
      'abria.org.br',
    ])
  })
})

describe('sourceHost', () => {
  it('names a link by its host, without www', () => {
    expect(sourceHost('https://www.abria.com.br/apoio')).toBe('abria.com.br')
    expect(sourceHost('https://telesintese.com.br/a/long/path/')).toBe(
      'telesintese.com.br'
    )
    expect(sourceHost('not a link')).toBe('not a link')
  })
})

describe('supportsWord', () => {
  it('says how a claim fared', () => {
    expect(supportsWord('yes')).toBe('holds up')
    expect(supportsWord('no')).toBe('does not hold up')
    expect(supportsWord('partly')).toBe('partly holds up')
    expect(supportsWord('unclear')).toBe('could not be settled')
    expect(supportsWord(null)).toBeNull()
  })
})
