import { describe, expect, it } from 'vitest'
import {
  orgNewsletterClicks,
  orgSpec,
  rowHash,
  type CatalogEntry,
} from './org-lookup'
import { sentInRange } from './org-newsletter'

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

  it('finds nothing for a too-broad search', () => {
    const spec = {
      ...orgSpec(CATALOG, 'Lens', new Set()),
      tooBroad: { listings: 99, websites: 9 },
    }
    expect(orgNewsletterClicks(spec, ISSUES)).toEqual([])
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
