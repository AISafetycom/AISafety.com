import { describe, expect, it } from 'vitest'
import type { AnalyticsEvent } from './events'
import {
  jobClickSource,
  jobsDataFile,
  jobsSourceStats,
  postingFavicon,
  quartersSoFar,
  splitJobLabel,
  type LiveJob,
} from './jobs-source'
import { seenUpdates } from './jobs-seen'

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
    logo: 'https://blob.example/a.png',
  },
  {
    id: 'recNew',
    name: 'Policy Lead',
    organization: 'Org B',
    url: 'https://example.org/recNew',
    datePublished: '2026-10-05',
    logo: 'https://blob.example/b.png',
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
    {
      type: 'page_view',
      page: '/funding',
      vid: 'v5',
      ts: day('2026-08-02', 9),
    },
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

  it('says the count of jobs listed is a floor without a record', () => {
    expect(s.listedExact).toBe(false)
    expect(s.unclicked).toEqual([])
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

  it('gives each job its places, its days, and its employer’s logo', () => {
    expect(s.rows.find(r => r.key === 'recA')).toMatchObject({
      logo: 'https://blob.example/a.png',
      datePublished: '2026-07-10',
      bySource: { jobsPage: 3, search: 0, chatbot: 1 },
      firstClick: '2026-07-02',
      lastClick: '2026-09-20',
    })
    // Gone, so its logo comes from Org B's job listed now.
    expect(s.rows.find(r => r.key === 'recGone')).toMatchObject({
      logo: 'https://blob.example/b.png',
      datePublished: null,
      bySource: { jobsPage: 1, search: 1, chatbot: 0 },
      firstClick: '2026-08-01',
      lastClick: '2026-09-10',
    })
    expect(s.employers.map(e => e.logo)).toEqual([
      'https://blob.example/a.png',
      'https://blob.example/b.png',
    ])
  })

  it('counts site visitors on every page, from the first day recorded', () => {
    expect(s.siteVisitors).toBe(3)
    // Page views start on Saturday 1 August here, so the first column is
    // that week, with 2 of its days counted; earlier weeks aren't drawn.
    expect(s.visitorSeries[0]).toEqual({
      start: '2026-07-27',
      count: 3,
      days: 2,
    })
    expect(s.visitorSeries.at(-1)).toEqual({
      start: '2026-09-28',
      count: 0,
      days: 3,
    })
    expect(s.visitorSeries).toHaveLength(10)
  })

  it('counts each day, oldest first', () => {
    expect(s.daily).toEqual([
      {
        date: '2026-07-02',
        clicks: 1,
        people: 1,
        pageVisitors: 0,
        siteVisitors: 0,
      },
      {
        date: '2026-08-01',
        clicks: 2,
        people: 1,
        pageVisitors: 2,
        siteVisitors: 2,
      },
      {
        date: '2026-08-02',
        clicks: 1,
        people: 1,
        pageVisitors: 0,
        siteVisitors: 1,
      },
      {
        date: '2026-09-10',
        clicks: 1,
        people: 1,
        pageVisitors: 0,
        siteVisitors: 0,
      },
      {
        date: '2026-09-20',
        clicks: 1,
        people: 1,
        pageVisitors: 0,
        siteVisitors: 0,
      },
    ])
    expect(s.jobDays).toEqual([
      { date: '2026-07-02', key: 'recA', source: 'jobsPage', clicks: 1 },
      { date: '2026-08-01', key: 'recA', source: 'jobsPage', clicks: 1 },
      { date: '2026-08-01', key: 'recGone', source: 'jobsPage', clicks: 1 },
      { date: '2026-08-02', key: 'recA', source: 'jobsPage', clicks: 1 },
      { date: '2026-09-10', key: 'recGone', source: 'search', clicks: 1 },
      { date: '2026-09-20', key: 'recA', source: 'chatbot', clicks: 1 },
    ])
  })

  describe('jobsDataFile', () => {
    const file = jobsDataFile(s, {
      board: '80,000 Hours',
      from: '2026-07-01',
      to: '2026-09-30',
      generatedAt: '2026-10-28T00:00:00.000Z',
    })

    it('carries the page’s figures under plain names', () => {
      expect(file.dates).toEqual({
        from: '2026-07-01',
        to: '2026-09-30',
        timezone: 'UTC',
      })
      expect(file.summary).toMatchObject({
        jobsListed: 2,
        jobsClicked: 2,
        clicks: 6,
        people: 4,
        jobsPageVisitors: 2,
        jobsPageVisitorsWhoClickedAJob: 1,
      })
      expect(file.jobs[0]).toEqual({
        id: 'recA',
        title: 'Research Engineer',
        employer: 'Org A',
        url: 'https://example.org/recA',
        datePublished: '2026-07-10',
        listedNow: true,
        firstListed: null,
        lastListed: null,
        clicks: 4,
        people: 4,
        clicksBySource: { jobsPage: 3, search: 0, chatbot: 1 },
        firstClick: '2026-07-02',
        lastClick: '2026-09-20',
      })
      expect(file.clicksByJobAndDay).toHaveLength(6)
      expect(file.notes[0]).toContain('80,000 Hours Job Board')
    })

    it('has no row about one visitor', () => {
      expect(JSON.stringify(file)).not.toMatch(/"v\d"/)
    })
  })
})

describe('jobsSourceStats with the record of jobs listed', () => {
  const seenJob = (first: string, last: string, title = 'Seen Job') => ({
    title,
    employer: 'Org C',
    url: 'https://example.org/seen',
    logo: null,
    datePublished: null,
    first,
    last,
  })
  const seen = {
    since: '2026-09-25',
    jobs: new Map([
      ['recA', seenJob('2026-09-20', '2026-10-28', 'Research Engineer')],
      ['recQuiet', seenJob('2026-10-02', '2026-10-09', 'Quiet Job')],
      ['recBefore', seenJob('2026-09-25', '2026-09-30', 'Before Job')],
    ]),
  }
  const q4 = {
    startMs: Date.parse('2026-10-01T00:00:00Z'),
    endMs: Date.parse('2026-12-31T23:59:59.999Z'),
  }
  const events: AnalyticsEvent[] = [
    click('recA', 'Research Engineer – Org A', 'v1', day('2026-10-05')),
  ]
  const now = Date.parse('2026-10-28T12:00:00Z')

  it('counts every job the record saw, clicked or not, exactly', () => {
    const s = jobsSourceStats(events, live, q4, now, seen)
    // recA (clicked) and recQuiet (never clicked); not recBefore, gone by
    // 1 October, nor recNew, which the record never saw.
    expect(s.listed).toBe(2)
    expect(s.listedExact).toBe(true)
    expect(s.unclicked.map(u => [u.key, u.firstListed, u.lastListed])).toEqual([
      ['recQuiet', '2026-10-02', '2026-10-09'],
    ])
    expect(s.rows[0]).toMatchObject({
      key: 'recA',
      firstListed: '2026-09-20',
      lastListed: '2026-10-28',
    })
  })

  it('falls back to a floor for dates before the record began', () => {
    const s = jobsSourceStats(events, live, q3, now, seen)
    expect(s.listedExact).toBe(false)
    // recA and recBefore from the record; recNew was published after Q3.
    expect(s.listed).toBe(2)
  })

  it('lists the jobs nobody clicked in the data file, with no clicks', () => {
    const s = jobsSourceStats(events, live, q4, now, seen)
    const file = jobsDataFile(s, {
      board: '80,000 Hours',
      from: '2026-10-01',
      to: '2026-10-28',
      generatedAt: '2026-10-28T12:00:00.000Z',
    })
    expect(file.summary.jobsListedExact).toBe(true)
    expect(file.jobs.map(j => [j.id, j.clicks])).toEqual([
      ['recA', 1],
      ['recQuiet', 0],
    ])
  })
})

describe('seenUpdates', () => {
  const was = new Map([
    [
      'recA',
      {
        title: 'Research Engineer',
        employer: 'Org A',
        url: 'https://example.org/recA',
        logo: 'https://blob.example/a.png',
        datePublished: '2026-07-10',
        first: '2026-09-25',
        last: '2026-10-27',
      },
    ],
  ])

  it('keeps the first day, moves the last, and adds new jobs', () => {
    expect(seenUpdates(was, live, '2026-10-28')).toEqual({
      recA: { ...was.get('recA'), last: '2026-10-28' },
      recNew: {
        title: 'Policy Lead',
        employer: 'Org B',
        url: 'https://example.org/recNew',
        logo: 'https://blob.example/b.png',
        datePublished: '2026-10-05',
        first: '2026-10-28',
        last: '2026-10-28',
      },
    })
  })

  it('writes nothing for a job already noted that day', () => {
    expect(seenUpdates(was, live.slice(0, 1), '2026-10-27')).toEqual({})
  })
})

describe('postingFavicon', () => {
  it('uses the employer’s own site, never a job platform’s', () => {
    expect(postingFavicon('https://www.electricsheep.is/futurekind')).toBe(
      'https://www.google.com/s2/favicons?domain=electricsheep.is&sz=64'
    )
    for (const url of [
      'https://job-boards.greenhouse.io/org/jobs/1',
      'https://jobs.ashbyhq.com/org/1',
      'https://docs.google.com/forms/d/1',
      'https://rand.wd5.myworkdayjobs.com/x',
      'https://www.usajobs.gov/job/1',
    ])
      expect(postingFavicon(url)).toBeUndefined()
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
