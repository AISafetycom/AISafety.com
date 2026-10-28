// The job board's page: how the jobs on /jobs did over a range. Every job
// there comes from the 80,000 Hours Job Board (the Jobs table is an Airtable
// sync of theirs), so this is their feed's own report card, shown at
// /stats/<token> for a link made on the dashboard's Jobs tab (org-shares.ts,
// kind 'jobs'). The counting is pure: the page hands in the range's events
// and the jobs listed now.

import { displayFilterGroup, displayFilterValue } from '@/lib/filter-tracking'
import { clicksSeries, type AnalyticsEvent, type DateRange } from './events'

/** A job listed now, as getJobs() gives it. */
export interface LiveJob {
  id: string
  name: string
  organization: string
  url: string
  /** 'YYYY-MM-DD', the day 80,000 Hours published it, when known. */
  datePublished: string | null
}

export interface JobRow {
  /** The listing's Airtable record id, or 'url:<address>' for a job only
   *  ever clicked from the site search after it left the page. */
  key: string
  title: string
  employer: string
  url?: string
  clicks: number
  people: number
  listedNow: boolean
}

export interface EmployerRow {
  name: string
  /** Its jobs that were clicked in the range. */
  jobs: number
  clicks: number
  people: number
}

export interface FilterRow {
  group: string
  value: string
  uses: number
  people: number
}

export interface JobsSourceStats {
  /** Jobs on the page at some point in the range: those listed now that
   *  80,000 Hours published before it ended, plus every other job clicked in
   *  it. A job that came and went without a click isn't known, so this is a
   *  floor. */
  listed: number
  /** Of those, the jobs clicked at least once. */
  clickedJobs: number
  /** Clicks through to a job posting, from every place below. */
  clicks: number
  /** Browsers behind those clicks, each counted once. */
  people: number
  bySource: { jobsPage: number; search: number; chatbot: number }
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
export function jobClickSource(
  e: AnalyticsEvent
): 'jobsPage' | 'search' | 'chatbot' | null {
  if (e.type === 'listing_click' && e.page === JOBS_PAGE) return 'jobsPage'
  if (e.type === 'search_click' && e.source === 'job') return 'search'
  if (e.type === 'chatbot_click' && e.listingId?.startsWith(CHATBOT_JOB_PREFIX))
    return 'chatbot'
  return null
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
  now: number
): JobsSourceStats {
  const liveById = new Map(live.map(j => [j.id, j]))
  // A search result is recorded by its address only, so it joins its job
  // through the address: a job listed now, or one clicked on /jobs.
  const idByUrl = new Map<string, string>()
  for (const j of live) if (j.url && j.url !== '#') idByUrl.set(j.url, j.id)

  const clicks: { e: AnalyticsEvent; key: string }[] = []
  const labelById = new Map<string, string>()
  const urlById = new Map<string, string>()
  const bySource = { jobsPage: 0, search: 0, chatbot: 0 }
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
    clicks.push({ e, key })
  }

  // Browsers, each once; a click with no browser id (private browsing)
  // can't be told apart from the rest, so it counts as its own person.
  const personOf = (e: AnalyticsEvent, i: number) => e.vid ?? `#${i}`
  const peopleByKey = new Map<string, Set<string>>()
  const clicksByKey = new Map<string, number>()
  const allPeople = new Set<string>()
  clicks.forEach(({ e, key }, i) => {
    const who = personOf(e, i)
    allPeople.add(who)
    clicksByKey.set(key, (clicksByKey.get(key) ?? 0) + 1)
    let set = peopleByKey.get(key)
    if (!set) peopleByKey.set(key, (set = new Set()))
    set.add(who)
  })

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
    return {
      key,
      title: job?.name ?? parts.title,
      employer: job?.organization ?? parts.employer,
      url,
      clicks: n,
      people: peopleByKey.get(key)!.size,
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
    { jobs: number; clicks: number; people: Set<string> }
  >()
  for (const r of rows) {
    const name = r.employer || 'Unknown'
    let em = byEmployer.get(name)
    if (!em)
      byEmployer.set(name, (em = { jobs: 0, clicks: 0, people: new Set() }))
    em.jobs++
    em.clicks += r.clicks
    for (const p of peopleByKey.get(r.key)!) em.people.add(p)
  }
  const employers: EmployerRow[] = [...byEmployer.entries()]
    .map(([name, em]) => ({
      name,
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

  // Jobs on the page in the range: those listed now that were published
  // before it ended, and every other job someone clicked in it.
  const endDay = range.endMs != null ? utcDay(range.endMs) : null
  const listedKeys = new Set(
    live
      .filter(j => !endDay || !j.datePublished || j.datePublished <= endDay)
      .map(j => j.id)
  )
  for (const key of clicksByKey.keys()) listedKeys.add(key)

  // /jobs visitors, and those of them who clicked a job on it.
  const visitors = new Set<string>()
  const pageClickers = new Set<string>()
  for (const e of events)
    if (e.type === 'page_view' && e.page === JOBS_PATH && e.vid)
      visitors.add(e.vid)
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
