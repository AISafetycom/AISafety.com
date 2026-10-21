import { describe, expect, it } from 'vitest'
import {
  orgNewsletterClicks,
  orgSpec,
  rowHash,
  type CatalogEntry,
} from './org-lookup'
import { listIdsIn, sentInRange, withListedLinks } from './org-newsletter'

const entry = (
  page: string,
  name: string,
  id: string,
  url: string,
  extra: Partial<CatalogEntry> = {}
): CatalogEntry => ({
  page,
  name,
  id,
  url,
  logo: null,
  orgText: [],
  live: true,
  ...extra,
})

const CATALOG = [
  entry('Map', 'Lens Academy', 'recMap', 'https://lensacademy.org/', {
    orgText: ['Lens Academy', 'Lens'],
  }),
  entry(
    'Training',
    'Lens Academy courses',
    'recCourses',
    'https://lensacademy.org/'
  ),
  // An event on a shared host: matched by its own address only.
  entry(
    'Events',
    'Lens Academy info session',
    'recEvent',
    'https://luma.com/lens-info'
  ),
  entry(
    'Events',
    'Someone else’s meetup',
    'recOther',
    'https://luma.com/other'
  ),
]

const tag =
  '?utm_source=aisafety.com&utm_medium=email&utm_campaign=training-newsletter'
const ISSUES = [
  {
    name: 'Training · Week 41, 2026',
    links: [
      {
        label: 'Lens Academy: AI Control',
        url: `https://lensacademy.org/courses/ai-control${tag}`,
        clicks: 12,
      },
      {
        label: 'Lens Academy info session',
        url: `https://luma.com/lens-info${tag}`,
        clicks: 4,
      },
      {
        label: 'Someone else’s meetup',
        url: `https://luma.com/other${tag}`,
        clicks: 9,
      },
      {
        label: 'View in browser',
        url: 'https://aisafety.com/newsletter/training/week-41-2026',
        clicks: 3,
      },
    ],
  },
  {
    name: 'Events · Week 41, 2026',
    links: [
      {
        label: 'Theoretical Lenses talk',
        url: 'https://luma.com/lenses',
        clicks: 7,
      },
    ],
  },
]

describe('orgNewsletterClicks', () => {
  it('finds the org’s links by address (tags aside), website, or title', () => {
    const rows = orgNewsletterClicks(
      orgSpec(CATALOG, 'Lens', new Set()),
      ISSUES
    )
    expect(rows.map(r => [r.issue, r.label, r.clicks])).toEqual([
      ['Training · Week 41, 2026', 'Lens Academy: AI Control', 12],
      ['Training · Week 41, 2026', 'Lens Academy info session', 4],
    ])
  })

  it('keeps a left-out listing’s links out', () => {
    const x = new Set([rowHash('Events', 'Lens Academy info session')])
    // Its title still names Lens, but the address belongs only to the
    // left-out listing.
    const rows = orgNewsletterClicks(orgSpec(CATALOG, 'Lens', x), ISSUES)
    expect(rows.map(r => r.label)).toEqual(['Lens Academy: AI Control'])
  })

  it('keeps a left-out card out even when its listing has left the catalog', () => {
    const issues = [
      {
        name: 'Events · Week 41, 2026',
        links: [
          {
            label: 'Lens Day at the Lens Cafe',
            url: 'https://luma.com/lens-day',
            clicks: 5,
          },
        ],
      },
    ]
    expect(
      orgNewsletterClicks(orgSpec(CATALOG, 'Lens', new Set()), issues)
    ).toHaveLength(1)
    const x = new Set([rowHash('Events', 'Lens Day at the Lens Cafe')])
    expect(orgNewsletterClicks(orgSpec(CATALOG, 'Lens', x), issues)).toEqual([])
  })

  it('keeps a link of theirs nobody clicked, as a row with 0', () => {
    const issues = [
      {
        name: 'Events · Week 42, 2026',
        links: [
          {
            label: 'Someone else’s meetup',
            url: `https://luma.com/other${tag}`,
            clicks: 3,
          },
          {
            label: 'Lens Academy: AI Control',
            url: `https://lensacademy.org/courses/ai-control${tag}`,
            clicks: 0,
          },
          {
            label: 'Lens Academy info session',
            url: `https://luma.com/lens-info${tag}`,
            clicks: 0,
          },
        ],
      },
    ]
    const rows = orgNewsletterClicks(
      orgSpec(CATALOG, 'Lens', new Set()),
      issues
    )
    expect(rows.map(r => [r.label, r.clicks])).toEqual([
      ['Lens Academy: AI Control', 0],
      ['Lens Academy info session', 0],
    ])
    // The left-out rules apply to them as to clicked links.
    const x = new Set([rowHash('Events', 'Lens Academy info session')])
    expect(
      orgNewsletterClicks(orgSpec(CATALOG, 'Lens', x), issues).map(r => r.label)
    ).toEqual(['Lens Academy: AI Control'])
  })

  it('finds nothing for a too-broad search', () => {
    const spec = {
      ...orgSpec(CATALOG, 'Lens', new Set()),
      tooBroad: { listings: 99, websites: 9 },
    }
    expect(orgNewsletterClicks(spec, ISSUES)).toEqual([])
  })
})

describe('listIdsIn', () => {
  const link = (id: string, n: number) =>
    `<a href="https://aisafety.com/api/nl/${id}/${n}" style="color:#fff;">Link</a>`

  it('finds none in an email without counted links', () => {
    expect(listIdsIn('')).toEqual([])
    expect(
      listIdsIn(
        // The pipeline's content marker is 16 hex characters too.
        '<!--aisafety-issue:3366354382b40bf9--><a href="https://lensacademy.org/">Lens</a>'
      )
    ).toEqual([])
  })

  it('finds a list once, however many links point into it', () => {
    const html = [0, 1, 2, 1].map(n => link('9501080242933ad2', n)).join('\n')
    expect(listIdsIn(html)).toEqual(['9501080242933ad2'])
  })

  it('finds every list, in the order they first appear', () => {
    const html =
      link('ef5a4892a0dbf9ee', 0) +
      link('9501080242933ad2', 0) +
      link('ef5a4892a0dbf9ee', 1)
    expect(listIdsIn(html)).toEqual(['ef5a4892a0dbf9ee', '9501080242933ad2'])
  })

  it('skips anything that isn’t one of our list ids', () => {
    const html = [
      link('9501080242933AD2', 0), // capitals
      link('9501080242933ad', 0), // too short
      link('9501080242933ad2f', 0), // too long
      link('..%2F..%2Fetc', 0),
      '<a href="https://aisafety.com/api/nl/9501080242933ad2">no link number</a>',
      '<a href="https://example.com/api/nl/0123456789abcdef/1">elsewhere</a>',
    ].join('')
    expect(listIdsIn(html)).toEqual([])
    expect(listIdsIn(html + link('0123456789abcdef', 3))).toEqual([
      '0123456789abcdef',
    ])
  })
})

describe('withListedLinks', () => {
  const listed = [
    { t: 'Lens Academy: AI Control', u: 'https://lensacademy.org/ai' },
    { t: 'Big Tent', u: 'https://bigtent.example/' },
    // The same card linked twice (its Outlook title link): one count.
    { t: 'Big Tent', u: 'https://bigtent.example/' },
    { t: 'View in browser', u: 'https://aisafety.com/newsletter/x' },
  ]

  it('shows every listed link, 0 when nobody clicked it', () => {
    const clicked = [
      { label: 'Big Tent', url: 'https://bigtent.example/', clicks: 4 },
    ]
    expect(withListedLinks(clicked, listed)).toEqual([
      { label: 'Big Tent', url: 'https://bigtent.example/', clicks: 4 },
      {
        label: 'Lens Academy: AI Control',
        url: 'https://lensacademy.org/ai',
        clicks: 0,
      },
      {
        label: 'View in browser',
        url: 'https://aisafety.com/newsletter/x',
        clicks: 0,
      },
    ])
  })

  it('tells links apart by label and address together', () => {
    const rows = withListedLinks(
      [{ label: 'Big Tent', url: 'https://bigtent.example/', clicks: 2 }],
      [
        { t: 'Big Tent', u: 'https://bigtent.example/' },
        { t: 'Big Tent tickets', u: 'https://bigtent.example/' },
      ]
    )
    expect(rows.map(r => [r.label, r.clicks])).toEqual([
      ['Big Tent', 2],
      ['Big Tent tickets', 0],
    ])
  })

  it('keeps a clicked link the list lacks', () => {
    const stray = {
      label: 'Old link',
      url: 'https://old.example/',
      clicks: 1,
    }
    const rows = withListedLinks([stray], listed)
    expect(rows[0]).toEqual(stray)
    expect(rows).toHaveLength(4)
  })

  it('changes nothing with no list entries', () => {
    const clicked = [
      { label: 'Big Tent', url: 'https://bigtent.example/', clicks: 4 },
    ]
    expect(withListedLinks(clicked, [])).toEqual(clicked)
  })
})

describe('sentInRange', () => {
  const sept = {
    startMs: Date.parse('2026-09-01T00:00:00Z'),
    endMs: Date.parse('2026-09-30T23:59:59.999Z'),
  }
  it('keeps issues sent within the range', () => {
    expect(sentInRange('2026-09-15T08:00:00Z', sept)).toBe(true)
    expect(sentInRange('2026-10-08T08:00:00Z', sept)).toBe(false)
  })
  it('counts an issue with no send time toward All time only', () => {
    expect(sentInRange(null, sept)).toBe(false)
    expect(sentInRange(null, { startMs: null, endMs: null })).toBe(true)
  })
})
