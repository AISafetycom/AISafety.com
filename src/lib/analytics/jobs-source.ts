// The job board's page: how the jobs on /jobs did over a range. Every job
// there comes from the 80,000 Hours Job Board (the Jobs table is an Airtable
// sync of theirs), so this is their feed's own report card, shown at
// /stats/<token> for a link made on the dashboard's Jobs tab (org-shares.ts,
// kind 'jobs'). The counting is pure: the page hands in the range's events
// and the jobs listed now.

import { displayFilterGroup, displayFilterValue } from '@/lib/filter-tracking'
import { clicksSeries, type AnalyticsEvent, type DateRange } from './events'
import type { JobsSeen } from './jobs-seen'
import { hostOf, isSharedHost, onHosts } from './org-lookup'

/** A job listed now, as getJobs() gives it. */
export interface LiveJob {
  id: string
  name: string
  organization: string
  url: string
  /** 'YYYY-MM-DD', the day 80,000 Hours published it, when known. */
  datePublished: string | null
  /** Its employer's logo. */
  logo: string | null
}

export type ClickSource = 'jobsPage' | 'search' | 'chatbot'
export type ClicksBySource = Record<ClickSource, number>

export interface JobRow {
  /** The listing's Airtable record id, or 'url:<address>' for a job only
   *  ever clicked from the site search after it left the page. */
  key: string
  title: string
  employer: string
  url?: string
  /** Its own logo, else its employer's from another job, else the icon of
   *  the employer's site its posting is on. */
  logo?: string
  /** Known for jobs listed now. */
  datePublished: string | null
  clicks: number
  people: number
  bySource: ClicksBySource
  /** The first and last UTC days it was clicked in the range. */
  firstClick: string
  lastClick: string
  /** The first and last UTC days it was on /jobs, when the record of jobs
   *  listed (jobs-seen.ts) saw it. */
  firstListed: string | null
  lastListed: string | null
  listedNow: boolean
}

export interface EmployerRow {
  name: string
  logo?: string
  /** Its jobs that were clicked in the range. */
  jobs: number
  clicks: number
  people: number
}

/** One UTC day with a click or a Jobs page visitor. `people` counts the
 *  day's own clickers, so days don't add up to the range's. */
export interface DayRow {
  date: string
  clicks: number
  people: number
  pageVisitors: number
}

/** One job's clicks from one place on one UTC day. */
export interface JobDayRow {
  date: string
  key: string
  source: ClickSource
  clicks: number
}

export interface FilterRow {
  group: string
  value: string
  uses: number
  people: number
}

/** A job on /jobs in the range that nobody clicked, from the record of
 *  jobs listed. */
export interface UnclickedJob {
  key: string
  title: string
  employer: string
  url: string | null
  datePublished: string | null
  firstListed: string
  lastListed: string
  listedNow: boolean
}

export interface JobsSourceStats {
  /** Jobs on the page at some point in the range: every one the record of
   *  jobs listed saw then, plus every job clicked in it. For days before the
   *  record began, also those listed now that 80,000 Hours published before
   *  the range ended; a job that came and went then without a click isn't
   *  known, so the count is a floor unless `listedExact`. */
  listed: number
  /** The whole range falls within the record of jobs listed. */
  listedExact: boolean
  /** The first whole day the record covers, or null before it began. */
  listedSince: string | null
  /** Listed in the range, never clicked in it; only those the record saw. */
  unclicked: UnclickedJob[]
  /** Of those, the jobs clicked at least once. */
  clickedJobs: number
  /** Clicks through to a job posting, from every place below. */
  clicks: number
  /** Browsers behind those clicks, each counted once. */
  people: number
  bySource: ClicksBySource
  /** Browsers that opened /jobs, and those of them that clicked a job there. */
  pageVisitors: number
  pageClickers: number
  /** Most clicked first. */
  rows: JobRow[]
  employers: EmployerRow[]
  /** The /jobs filters people turned on, most used first. */
  filters: FilterRow[]
  series: { start: string; count: number; days?: number }[]
  seriesUnit: 'day' | 'week'
  /** For the data file, oldest first. */
  daily: DayRow[]
  jobDays: JobDayRow[]
}

/** Pure: which of the board's jobs /jobs shows, in the words the page and
 *  the data file use. It is the Airtable view's filter ("Jobs AI Safety
 *  Only", src/lib/data/jobs.ts), so keep the two in step. */
export function jobsFilterNote(board: string): string {
  return `Every job on aisafety.com/jobs comes from the ${board} Job Board: those in its AI safety & policy problem area, except OpenAI’s jobs and roles typed Fellowship, Funding, Course, Volunteering, or Other. Those types have been left out since 1 September 2026 (Other since 14 September 2026), so earlier dates include some.`
}

/** The page the Jobs tab's events carry, and the path its page views do. */
const JOBS_PAGE = 'Jobs'
const JOBS_PATH = '/jobs'
/** The chatbot's job cards record their listing as 'job:<record id>'. */
const CHATBOT_JOB_PREFIX = 'job:'

/** Pure: a /jobs click's label ('<title> – <employer>', JobsClient's
 *  trackingName) split back into its parts. A title can hold a dash of its
 *  own, so the employer is what follows the last one. */
export function splitJobLabel(label: string): {
  title: string
  employer: string
} {
  const i = label.lastIndexOf(' – ')
  return i > 0
    ? { title: label.slice(0, i), employer: label.slice(i + 3) }
    : { title: label, employer: '' }
}

/** Pure: whether an event is a click through to a job posting, and from
 *  where. */
export function jobClickSource(e: AnalyticsEvent): ClickSource | null {
  if (e.type === 'listing_click' && e.page === JOBS_PAGE) return 'jobsPage'
  if (e.type === 'search_click' && e.source === 'job') return 'search'
  if (e.type === 'chatbot_click' && e.listingId?.startsWith(CHATBOT_JOB_PREFIX))
    return 'chatbot'
  return null
}

/** Job platforms whose icon is their own brand, on top of the hosts many
 *  groups share (org-lookup.ts). A posting there says nothing about how its
 *  employer looks. */
const JOB_PLATFORM_HOSTS = new Set([
  'myworkdayjobs.com',
  'usajobs.gov',
  'jobs.ac.uk',
  'join.com',
  'calcareers.ca.gov',
  'bamboohr.com',
  'recruitee.com',
  'teamtailor.com',
  'smartrecruiters.com',
  'breezy.hr',
  'jobvite.com',
  'icims.com',
  'rippling.com',
  'dover.com',
  'wellfound.com',
  'personio.com',
  'personio.de',
  'pinpointhq.com',
  'applytojob.com',
])

/** Pure: the icon of the site a posting is on, when that site is the
 *  employer's own, as Comb falls back to a favicon for a listing with no
 *  logo; never a job platform's. */
export function postingFavicon(url: string | undefined): string | undefined {
  const host = hostOf(url)
  if (!host || isSharedHost(host) || onHosts(host, JOB_PLATFORM_HOSTS))
    return undefined
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
}

/** Pure: the day of an epoch-ms instant, as 'YYYY-MM-DD' in UTC (the
 *  dashboard's zone). */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Pure: the range's figures. `events` are the range's (newest first, as the
 *  store reads them); `live` the jobs listed now; `now` the time they were
 *  read. */
export function jobsSourceStats(
  events: AnalyticsEvent[],
  live: LiveJob[],
  range: DateRange,
  now: number,
  seen: JobsSeen = { since: null, jobs: new Map() }
): JobsSourceStats {
  const liveById = new Map(live.map(j => [j.id, j]))
  // A search result is recorded by its address only, so it joins its job
  // through the address: a job listed now, or one clicked on /jobs.
  const idByUrl = new Map<string, string>()
  for (const j of live) if (j.url && j.url !== '#') idByUrl.set(j.url, j.id)

  const clicks: { e: AnalyticsEvent; key: string; source: ClickSource }[] = []
  const labelById = new Map<string, string>()
  const urlById = new Map<string, string>()
  const bySource: ClicksBySource = { jobsPage: 0, search: 0, chatbot: 0 }
  // Events come newest first, so the first label or address seen for a job
  // is its latest.
  for (const e of events) {
    if (jobClickSource(e) !== 'jobsPage' || !e.listingId) continue
    if (e.label && !labelById.has(e.listingId))
      labelById.set(e.listingId, e.label)
    if (e.url) {
      if (!urlById.has(e.listingId)) urlById.set(e.listingId, e.url)
      if (!idByUrl.has(e.url)) idByUrl.set(e.url, e.listingId)
    }
  }
  const searchTitleByKey = new Map<string, string>()
  for (const e of events) {
    const source = jobClickSource(e)
    if (!source) continue
    let key: string | undefined
    if (source === 'jobsPage') key = e.listingId
    else if (source === 'chatbot')
      key = e.listingId!.slice(CHATBOT_JOB_PREFIX.length)
    else if (e.url) {
      key = idByUrl.get(e.url) ?? `url:${e.url}`
      if (e.label && !searchTitleByKey.has(key))
        searchTitleByKey.set(key, e.label)
    }
    if (!key) continue
    bySource[source]++
    clicks.push({ e, key, source })
  }

  // Browsers, each once; a click with no browser id (private browsing)
  // can't be told apart from the rest, so it counts as its own person.
  const personOf = (e: AnalyticsEvent, i: number) => e.vid ?? `#${i}`
  const peopleByKey = new Map<string, Set<string>>()
  const clicksByKey = new Map<string, number>()
  const sourcesByKey = new Map<string, ClicksBySource>()
  const daysByKey = new Map<string, { first: string; last: string }>()
  const allPeople = new Set<string>()
  const byDay = new Map<
    string,
    { clicks: number; people: Set<string>; visitors: Set<string> }
  >()
  const dayOf = (date: string) => {
    let d = byDay.get(date)
    if (!d)
      byDay.set(
        date,
        (d = { clicks: 0, people: new Set(), visitors: new Set() })
      )
    return d
  }
  const jobDayClicks = new Map<string, JobDayRow>()
  clicks.forEach(({ e, key, source }, i) => {
    const who = personOf(e, i)
    const date = utcDay(Date.parse(e.ts))
    allPeople.add(who)
    clicksByKey.set(key, (clicksByKey.get(key) ?? 0) + 1)
    let set = peopleByKey.get(key)
    if (!set) peopleByKey.set(key, (set = new Set()))
    set.add(who)
    let sources = sourcesByKey.get(key)
    if (!sources)
      sourcesByKey.set(key, (sources = { jobsPage: 0, search: 0, chatbot: 0 }))
    sources[source]++
    const days = daysByKey.get(key)
    if (!days) daysByKey.set(key, { first: date, last: date })
    else {
      if (date < days.first) days.first = date
      if (date > days.last) days.last = date
    }
    const day = dayOf(date)
    day.clicks++
    day.people.add(who)
    const k = `${date}\x00${key}\x00${source}`
    const row = jobDayClicks.get(k)
    if (row) row.clicks++
    else jobDayClicks.set(k, { date, key, source, clicks: 1 })
  })

  // An employer's logo, from any of its jobs listed now or noted in the
  // record of jobs listed, so a job that has gone keeps its employer's face.
  const logoByEmployer = new Map<string, string>()
  for (const j of live)
    if (j.logo && !logoByEmployer.has(j.organization))
      logoByEmployer.set(j.organization, j.logo)
  for (const j of seen.jobs.values())
    if (j.logo && !logoByEmployer.has(j.employer))
      logoByEmployer.set(j.employer, j.logo)

  const rows: JobRow[] = [...clicksByKey.entries()].map(([key, n]) => {
    const job = liveById.get(key)
    const label = labelById.get(key)
    const parts = label
      ? splitJobLabel(label)
      : {
          title: searchTitleByKey.get(key) ?? key.replace(/^url:/, ''),
          employer: '',
        }
    const url =
      job?.url && job.url !== '#'
        ? job.url
        : (urlById.get(key) ??
          (key.startsWith('url:') ? key.slice(4) : undefined))
    const employer = job?.organization ?? parts.employer
    const days = daysByKey.get(key)!
    return {
      key,
      title: job?.name ?? parts.title,
      employer,
      url,
      logo:
        job?.logo ??
        seen.jobs.get(key)?.logo ??
        logoByEmployer.get(employer) ??
        postingFavicon(url),
      datePublished: job?.datePublished ?? null,
      clicks: n,
      people: peopleByKey.get(key)!.size,
      bySource: sourcesByKey.get(key)!,
      firstClick: days.first,
      lastClick: days.last,
      firstListed: seen.jobs.get(key)?.first ?? null,
      lastListed: seen.jobs.get(key)?.last ?? null,
      listedNow: !!job,
    }
  })
  rows.sort(
    (a, b) =>
      b.clicks - a.clicks ||
      b.people - a.people ||
      a.title.localeCompare(b.title)
  )

  // Employers, by the name their jobs carry.
  const byEmployer = new Map<
    string,
    { logo?: string; jobs: number; clicks: number; people: Set<string> }
  >()
  for (const r of rows) {
    const name = r.employer || 'Unknown'
    let em = byEmployer.get(name)
    if (!em)
      byEmployer.set(name, (em = { jobs: 0, clicks: 0, people: new Set() }))
    em.logo ??= r.logo
    em.jobs++
    em.clicks += r.clicks
    for (const p of peopleByKey.get(r.key)!) em.people.add(p)
  }
  const employers: EmployerRow[] = [...byEmployer.entries()]
    .map(([name, em]) => ({
      name,
      logo: logoByEmployer.get(name) ?? em.logo,
      jobs: em.jobs,
      clicks: em.clicks,
      people: em.people.size,
    }))
    .sort(
      (a, b) =>
        b.clicks - a.clicks ||
        b.people - a.people ||
        a.name.localeCompare(b.name)
    )

  // Jobs on the page in the range: every one the record saw then, and every
  // job someone clicked in it. Days before the record began add the jobs
  // listed now that were published before the range ended.
  const startDay = range.startMs != null ? utcDay(range.startMs) : null
  const endDay = range.endMs != null ? utcDay(range.endMs) : null
  const listedExact =
    seen.since != null && startDay != null && startDay >= seen.since
  const listedKeys = new Set<string>()
  const unclicked: UnclickedJob[] = []
  for (const [key, j] of seen.jobs) {
    if ((endDay && j.first > endDay) || (startDay && j.last < startDay))
      continue
    listedKeys.add(key)
    if (!clicksByKey.has(key))
      unclicked.push({
        key,
        title: j.title,
        employer: j.employer,
        url: j.url,
        datePublished: j.datePublished,
        firstListed: j.first,
        lastListed: j.last,
        listedNow: liveById.has(key),
      })
  }
  unclicked.sort(
    (a, b) =>
      a.firstListed.localeCompare(b.firstListed) ||
      a.title.localeCompare(b.title)
  )
  if (!listedExact)
    for (const j of live)
      if (!endDay || !j.datePublished || j.datePublished <= endDay)
        listedKeys.add(j.id)
  for (const key of clicksByKey.keys()) listedKeys.add(key)

  // /jobs visitors, and those of them who clicked a job on it.
  const visitors = new Set<string>()
  const pageClickers = new Set<string>()
  for (const e of events)
    if (e.type === 'page_view' && e.page === JOBS_PATH && e.vid) {
      visitors.add(e.vid)
      dayOf(utcDay(Date.parse(e.ts))).visitors.add(e.vid)
    }
  for (const { e } of clicks)
    if (jobClickSource(e) === 'jobsPage' && e.vid && visitors.has(e.vid))
      pageClickers.add(e.vid)

  // Filters turned on, under the labels they show today.
  const filterRows = new Map<
    string,
    { group: string; value: string; uses: number; people: Set<string> }
  >()
  events.forEach((e, i) => {
    if (e.type !== 'filter_apply' || e.page !== JOBS_PAGE) return
    if (!e.source || !e.label) return
    const group = displayFilterGroup(JOBS_PAGE, e.source)
    const value = displayFilterValue(JOBS_PAGE, e.source, e.label)
    const k = `${group}\x00${value}`
    let row = filterRows.get(k)
    if (!row)
      filterRows.set(k, (row = { group, value, uses: 0, people: new Set() }))
    row.uses++
    row.people.add(personOf(e, i))
  })
  const filters: FilterRow[] = [...filterRows.values()]
    .map(r => ({
      group: r.group,
      value: r.value,
      uses: r.uses,
      people: r.people.size,
    }))
    .sort((a, b) => b.people - a.people || b.uses - a.uses)

  // Events are newest first, so the last is the oldest data there is.
  const oldest = events.length ? Date.parse(events[events.length - 1].ts) : NaN
  const { series, unit } = clicksSeries(
    clicks.map(c => c.e),
    range,
    now,
    oldest
  )

  return {
    listed: listedKeys.size,
    listedExact,
    listedSince: seen.since,
    unclicked,
    clickedJobs: clicksByKey.size,
    clicks: clicks.length,
    people: allPeople.size,
    bySource,
    pageVisitors: visitors.size,
    pageClickers: pageClickers.size,
    rows,
    employers,
    filters,
    series,
    seriesUnit: unit,
    daily: [...byDay.entries()]
      .map(([date, d]) => ({
        date,
        clicks: d.clicks,
        people: d.people.size,
        pageVisitors: d.visitors.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    jobDays: [...jobDayClicks.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.key.localeCompare(b.key) ||
        a.source.localeCompare(b.source)
    ),
  }
}

/** Pure: everything on the job board's page, plus each job's clicks by day,
 *  as one JSON document that explains itself, for a spreadsheet or an AI
 *  assistant. No row is about one visitor. `from` and `to` are the UTC days
 *  the figures cover. */
export function jobsDataFile(
  s: JobsSourceStats,
  meta: { board: string; from: string | null; to: string; generatedAt: string }
) {
  const { board, from, to, generatedAt } = meta
  return {
    about: `How the ${board} jobs listed on aisafety.com/jobs did ${from ? `from ${from}` : 'up'} to ${to} (UTC days, inclusive): how many were listed, the clicks through to their postings, where those clicks came from, and what job seekers filtered for.`,
    notes: [
      jobsFilterNote(board),
      'A click is a visitor on AISafety.com opening a job’s posting, from the Jobs page (jobsPage), the site search (search), or the chatbot (chatbot).',
      'people counts browsers, each once, so one person on two devices counts twice. A click from a browser with no id (private browsing) counts as its own person.',
      s.listedExact
        ? `summary.jobsListed counts every job on the page at some point in these dates: the site has noted every job listed, hourly, since ${s.listedSince}.`
        : `summary.jobsListed is a floor (jobsListedExact is false): the site has only noted every job listed since ${s.listedSince ?? 'late October 2026'}, so a job that came and went before then without a click isn’t known.`,
      'jobs has every job clicked in these dates, most clicked first, then every job listed in them that nobody clicked (clicks 0), as far as the site noted them. firstListed and lastListed are the first and last days a job was on the page, when noted; firstClick and lastClick fall within these dates. datePublished is the day the board published it, when known. An id starting with "url:" is a job only ever clicked from the site search after it left the Jobs page.',
      'daily has a row for each day with any click or Jobs page visitor; a missing day had neither. Its people count each day on its own, so they don’t add up to summary.people.',
      'Clicks are counted from 1 July 2026, Jobs page visitors from 15 July 2026, and filters from 29 July 2026.',
      'Since 24 August 2026, links from the Jobs page reach the posting tagged utm_source=aisafety.com.',
      'For other dates, fetch the same address with ?from=YYYY-MM-DD&to=YYYY-MM-DD (UTC days, inclusive).',
    ],
    dates: { from, to, timezone: 'UTC' },
    generatedAt,
    summary: {
      jobsListed: s.listed,
      jobsListedExact: s.listedExact,
      jobsClicked: s.clickedJobs,
      clicks: s.clicks,
      people: s.people,
      clicksBySource: s.bySource,
      jobsPageVisitors: s.pageVisitors,
      jobsPageVisitorsWhoClickedAJob: s.pageClickers,
    },
    jobs: [
      ...s.rows.map(r => ({
        id: r.key,
        title: r.title,
        employer: r.employer,
        url: r.url ?? null,
        datePublished: r.datePublished,
        listedNow: r.listedNow,
        firstListed: r.firstListed,
        lastListed: r.lastListed,
        clicks: r.clicks,
        people: r.people,
        clicksBySource: r.bySource,
        firstClick: r.firstClick as string | null,
        lastClick: r.lastClick as string | null,
      })),
      ...s.unclicked.map(u => ({
        id: u.key,
        title: u.title,
        employer: u.employer,
        url: u.url,
        datePublished: u.datePublished,
        listedNow: u.listedNow,
        firstListed: u.firstListed as string | null,
        lastListed: u.lastListed as string | null,
        clicks: 0,
        people: 0,
        clicksBySource: { jobsPage: 0, search: 0, chatbot: 0 },
        firstClick: null,
        lastClick: null,
      })),
    ],
    employers: s.employers.map(e => ({
      name: e.name,
      jobsClicked: e.jobs,
      clicks: e.clicks,
      people: e.people,
    })),
    filters: s.filters.map(f => ({
      filter: f.group,
      option: f.value,
      people: f.people,
      uses: f.uses,
    })),
    daily: s.daily.map(d => ({
      date: d.date,
      clicks: d.clicks,
      people: d.people,
      jobsPageVisitors: d.pageVisitors,
    })),
    clicksByJobAndDay: s.jobDays.map(d => ({
      date: d.date,
      jobId: d.key,
      source: d.source,
      clicks: d.clicks,
    })),
  }
}

/** Pure: the jobs table as a CSV file's text, every row. */
export function jobRowsCsv(rows: JobRow[]): string {
  const cell = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    ['Job', 'Employer', 'Posting', 'Clicks', 'People', 'Listed now'],
    ...rows.map(r => [
      r.title,
      r.employer,
      r.url ?? '',
      r.clicks,
      r.people,
      r.listedNow ? 'Yes' : 'No',
    ]),
  ]
  return lines.map(l => l.map(cell).join(',')).join('\n') + '\n'
}

/** The first quarter with job clicks recorded: counting began on 1 July
 *  2026 (the June days before it were lost, see events.ts). */
const FIRST_QUARTER = { year: 2026, q: 3 }

export interface Quarter {
  /** 'Q3 2026'. */
  label: string
  /** Inclusive UTC days, 'YYYY-MM-DD', as the date boxes take them. */
  from: string
  to: string
  /** Still under way at `now`. */
  current: boolean
}

/** Pure: every quarter from the first with data to the one under way at
 *  `now`, oldest first. */
export function quartersSoFar(now: number): Quarter[] {
  const d = new Date(now)
  const nowYear = d.getUTCFullYear()
  const nowQ = Math.floor(d.getUTCMonth() / 3) + 1
  const out: Quarter[] = []
  let { year, q } = FIRST_QUARTER
  while (year < nowYear || (year === nowYear && q <= nowQ)) {
    const startMonth = (q - 1) * 3
    const from = new Date(Date.UTC(year, startMonth, 1))
    const to = new Date(Date.UTC(year, startMonth + 3, 0)) // last day
    out.push({
      label: `Q${q} ${year}`,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      current: year === nowYear && q === nowQ,
    })
    if (++q > 4) {
      q = 1
      year++
    }
  }
  return out
}
