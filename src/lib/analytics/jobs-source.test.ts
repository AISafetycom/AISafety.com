import { describe, expect, it } from 'vitest'
import type { AnalyticsEvent } from './events'
import {
  jobClickSource,
  jobRowsCsv,
  jobsSourceStats,
  quartersSoFar,
  splitJobLabel,
  type LiveJob,
} from './jobs-source'

const day = (d: string, h = 12) =>
  `${d}T${String(h).padStart(2, '0')}:00:00.000Z`

function click(
  listingId: string,
  label: string,
  vid: string | undefined,
  ts: string,
  url = `https://example.org/${listingId}`
): AnalyticsEvent {
  return { type: 'listing_click', page: 'Jobs', listingId, label, url, vid, ts }
}

const live: LiveJob[] = [
  {
    id: 'recA',
    name: 'Research Engineer',
    organization: 'Org A',
    url: 'https://example.org/recA',
    datePublished: '2026-07-10',
  },
  {
    id: 'recNew',
    name: 'Policy Lead',
    organization: 'Org B',
    url: 'https://example.org/recNew',
    datePublished: '2026-10-05',
  },
]

const q3 = {
  startMs: Date.parse('2026-07-01T00:00:00Z'),
  endMs: Date.parse('2026-09-30T23:59:59.999Z'),
}

describe('splitJobLabel', () => {
  it('takes the employer after the last dash', () => {
    expect(splitJobLabel('Head of Ops – Finance – Org C')).toEqual({
      title: 'Head of Ops – Finance',
      employer: 'Org C',
    })
    expect(splitJobLabel('No employer')).toEqual({
      title: 'No employer',
      employer: '',
    })
  })
})

describe('jobClickSource', () => {
  it('tells the three places apart and ignores the rest', () => {
    expect(jobClickSource(click('recA', 'x', 'v', day('2026-08-01')))).toBe(
      'jobsPage'
    )
    expect(
      jobClickSource({ type: 'search_click', source: 'job', ts: '' })
    ).toBe('search')
    expect(
      jobClickSource({ type: 'search_click', source: 'funder', ts: '' })
    ).toBeNull()
    expect(
      jobClickSource({ type: 'chatbot_click', listingId: 'job:recA', ts: '' })
    ).toBe('chatbot')
    expect(
      jobClickSource({ type: 'chatbot_click', listingId: 'event:recA', ts: '' })
    ).toBeNull()
    expect(
      jobClickSource({ type: 'listing_click', page: 'Funding', ts: '' })
    ).toBeNull()
  })
})

describe('jobsSourceStats', () => {
  // Newest first, as the store reads them.
  const events: AnalyticsEvent[] = [
    {
      type: 'chatbot_click',
      listingId: 'job:recA',
      url: 'https://example.org/recA',
      vid: 'v3',
      ts: day('2026-09-20'),
    },
    {
      type: 'search_click',
      source: 'job',
      label: 'Gone Job',
      url: 'https://example.org/recGone',
      vid: 'v3',
      ts: day('2026-09-10'),
    },
    {
      type: 'filter_apply',
      page: 'Jobs',
      source: 'Country',
      label: 'USA',
      vid: 'v1',
      ts: day('2026-08-02'),
    },
    click('recA', 'Research Engineer – Org A', 'v2', day('2026-08-02')),
    click('recGone', 'Gone Job – Org B', 'v1', day('2026-08-01', 13)),
    { type: 'page_view', page: '/jobs', vid: 'v1', ts: day('2026-08-01', 11) },
    { type: 'page_view', page: '/jobs', vid: 'v9', ts: day('2026-08-01', 10) },
    click('recA', 'Research Engineer – Org A', 'v1', day('2026-08-01')),
    click('recA', 'Research Engineer – Org A', undefined, day('2026-07-02')),
  ]
  const s = jobsSourceStats(
    events,
    live,
    q3,
    Date.parse('2026-10-28T00:00:00Z')
  )

  it('counts clicks from every place, and the people behind them', () => {
    expect(s.clicks).toBe(6)
    expect(s.bySource).toEqual({ jobsPage: 4, search: 1, chatbot: 1 })
    // v1, v2, v3, and one click with no browser id.
    expect(s.people).toBe(4)
  })

  it('joins a search click to its job through the address', () => {
    const gone = s.rows.find(r => r.key === 'recGone')!
    expect(gone).toMatchObject({
      title: 'Gone Job',
      employer: 'Org B',
      clicks: 2,
      people: 2,
      listedNow: false,
    })
    const a = s.rows[0]
    expect(a).toMatchObject({
      key: 'recA',
      clicks: 4,
      people: 4,
      listedNow: true,
    })
  })

  it('counts jobs listed in the range, leaving out ones published after it', () => {
    // recA (listed now, published in range) + recGone (clicked); not recNew.
    expect(s.listed).toBe(2)
    expect(s.clickedJobs).toBe(2)
  })

  it('counts Jobs page visitors and the ones who clicked there', () => {
    expect(s.pageVisitors).toBe(2)
    expect(s.pageClickers).toBe(1)
  })

  it('sums employers across their jobs', () => {
    expect(s.employers.map(e => [e.name, e.jobs, e.clicks])).toEqual([
      ['Org A', 1, 4],
      ['Org B', 1, 2],
    ])
  })

  it('lists the filters people turned on', () => {
    expect(s.filters).toEqual([
      { group: 'Country', value: 'USA', uses: 1, people: 1 },
    ])
  })

  it('draws weeks for a quarter', () => {
    expect(s.seriesUnit).toBe('week')
    expect(s.series.reduce((n, p) => n + p.count, 0)).toBe(6)
  })
})

describe('jobRowsCsv', () => {
  it('quotes cells that need it', () => {
    expect(
      jobRowsCsv([
        {
          key: 'r',
          title: 'Engineer, "Safety"',
          employer: 'Org',
          url: 'https://x',
          clicks: 3,
          people: 2,
          listedNow: false,
        },
      ])
    ).toBe(
      'Job,Employer,Posting,Clicks,People,Listed now\n"Engineer, ""Safety""",Org,https://x,3,2,No\n'
    )
  })
})

describe('quartersSoFar', () => {
  it('runs from Q3 2026 to the quarter under way', () => {
    expect(quartersSoFar(Date.parse('2027-01-15T00:00:00Z'))).toEqual([
      {
        label: 'Q3 2026',
        from: '2026-07-01',
        to: '2026-09-30',
        current: false,
      },
      {
        label: 'Q4 2026',
        from: '2026-10-01',
        to: '2026-12-31',
        current: false,
      },
      { label: 'Q1 2027', from: '2027-01-01', to: '2027-03-31', current: true },
    ])
  })
})
