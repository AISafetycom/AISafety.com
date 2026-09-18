import { getAdvisors } from './advisors'
import { getCommunities } from './communities'
import { getCourses } from './self-study'
import { getEvents } from './events'
import { getFounderResources } from './founders'
import { getFunders } from './funding'
import { getJobs } from './jobs'
import { getMapData } from './map'
import { getMediaChannels } from './media-channels'
import { getProjects } from './projects'
import { getTrainingPrograms, getRecurringPrograms } from './training'

export type SearchType =
  | 'advisor'
  | 'community'
  | 'course'
  | 'event'
  | 'founder'
  | 'funder'
  | 'job'
  | 'map'
  | 'media'
  | 'project'
  | 'training'
  | 'page'

export interface SearchEntry {
  type: SearchType
  title: string
  subtitle: string
  description: string
  category: string
  url: string
  logo: string | null
}

function page(
  title: string,
  url: string,
  icon: string | null,
  description = ''
): SearchEntry {
  return {
    type: 'page',
    title,
    subtitle: '',
    description,
    category: '',
    url,
    logo: icon,
  }
}

const STATIC_PAGES: SearchEntry[] = [
  page('Home', '/', null, 'AISafety.com — the hub for AI existential safety.'),
  page(
    'Training programs',
    '/training',
    '/images/icons/grad-cap.svg',
    'Fellowships, bootcamps, and courses in AI safety.'
  ),
  page(
    'Events',
    '/events',
    '/images/icons/calendar.svg',
    'Conferences, competitions, meetups, talks, and workshops in AI safety.'
  ),
  page(
    'Field map',
    '/map',
    '/images/icons/map.svg',
    'A visual overview of the key organizations, programs, and other resources in AI safety.'
  ),
  page(
    'Communities',
    '/communities',
    '/images/icons/globe.svg',
    'Discussion groups and communities, online and in person.'
  ),
  page(
    'Self-study',
    '/self-study',
    '/images/icons/book.svg',
    'Curated courses and study guides.'
  ),
  page(
    'Jobs',
    '/jobs',
    '/images/icons/briefcase.svg',
    'Open roles across AI safety.'
  ),
  page(
    'Funding',
    '/funding',
    '/images/icons/coins.svg',
    'Grants and funders supporting AI safety work.'
  ),
  page(
    'Media channels',
    '/media-channels',
    '/images/icons/megaphone.svg',
    'Podcasts, newsletters, and feeds.'
  ),
  page(
    'Advisors',
    '/advisors',
    '/images/icons/person.svg',
    'Talk to a 1-1 advisor.'
  ),
  page(
    'Volunteer projects',
    '/projects',
    '/images/icons/clipboard.svg',
    'Volunteer projects you can join.'
  ),
  page(
    'Hackathon 2026',
    '/hackathon',
    '/images/icons/calendar.svg',
    'The annual AISafety.com hackathon – 17–20 September 2026 at CEEALAR, Blackpool, UK.'
  ),
  page(
    'Founder toolkit',
    '/founders',
    '/images/icons/rocket.svg',
    'Resources for founders building AI safety orgs.'
  ),
  page(
    'Donation guide',
    '/donation-guide',
    '/images/icons/heart.svg',
    'How to donate effectively.'
  ),
  page(
    'About',
    '/about',
    '/images/icons/people.svg',
    'Mission, team, and how to contribute.'
  ),
]

// The data layer normalizes a missing URL to '#'; treat that as no URL.
function realUrl(url: string): string {
  return url === '#' ? '' : url
}

function faviconFor(url: string): string | null {
  if (!url) return null
  return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`
}

function parseISO(iso: string): Date {
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Unexpected date format in search index: "${iso}"`)
  }
  return d
}

function shortMonth(d: Date): string {
  // en-US, not en-GB: en-GB abbreviates September as "Sept".
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(d)
}

// "2026-09-28" -> "28 Sep 2026", matching the /events and /training cards.
function shortDate(iso: string): string {
  const d = parseISO(iso)
  return `${d.getUTCDate()} ${shortMonth(d)} ${d.getUTCFullYear()}`
}

// Same collapsing rules as the /events cards: "27 – 30 Jul 2026",
// "27 Jul – 2 Aug 2026", "27 Dec 2026 – 2 Jan 2027".
function dateRange(start: string | null, end: string | null): string {
  if (!start) return ''
  if (!end || end === start) return shortDate(start)
  const s = parseISO(start)
  const e = parseISO(end)
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear()
  const sameMonth = sameYear && s.getUTCMonth() === e.getUTCMonth()
  if (sameMonth) {
    return `${s.getUTCDate()} – ${e.getUTCDate()} ${shortMonth(e)} ${e.getUTCFullYear()}`
  }
  if (sameYear) {
    return `${s.getUTCDate()} ${shortMonth(s)} – ${e.getUTCDate()} ${shortMonth(e)} ${e.getUTCFullYear()}`
  }
  return `${shortDate(start)} – ${shortDate(end)}`
}

async function getEventEntries(): Promise<SearchEntry[]> {
  const events = await getEvents()
  return events.map(e => {
    const url = realUrl(e.url)
    const deadline =
      e.applicationStatus === 'Open' && e.deadlineType && e.applicationsClose
        ? `${e.deadlineType} by ${shortDate(e.applicationsClose)}`
        : ''
    return {
      type: 'event' as const,
      title: e.name,
      subtitle: e.host,
      description: e.description,
      category: [
        dateRange(e.startDate, e.endDate),
        e.type.join(', '),
        e.location || e.mode,
        deadline,
      ]
        .filter(Boolean)
        .join(' · '),
      url: url || '/events',
      logo: e.logo ?? faviconFor(url),
    }
  })
}

async function getTrainingEntries(): Promise<SearchEntry[]> {
  const [upcoming, recurring] = await Promise.all([
    getTrainingPrograms(),
    getRecurringPrograms(),
  ])
  const entries: SearchEntry[] = []

  for (const p of upcoming) {
    const url = realUrl(p.url)
    const applications = p.notYetOpen
      ? 'Applications not yet open'
      : p.applicationStatus === 'Open' && p.applicationsClose
        ? `Apply by ${shortDate(p.applicationsClose)}`
        : ''
    entries.push({
      type: 'training',
      title: p.name,
      // Host isn't shown on /training and isn't maintained, so don't
      // display or match on it.
      subtitle: '',
      description: p.description,
      category: [
        p.startDateApprox || dateRange(p.startDate, p.endDate),
        p.type.join(', '),
        p.location || p.mode,
        applications,
      ]
        .filter(Boolean)
        .join(' · '),
      url: url || '/training',
      logo: p.logo ?? faviconFor(url),
    })
  }

  for (const p of recurring) {
    const url = realUrl(p.url)
    entries.push({
      type: 'training',
      title: p.name,
      subtitle: '',
      description: p.description,
      category: ['Recurring', p.type.join(', '), p.location || p.mode]
        .filter(Boolean)
        .join(' · '),
      url: url || '/training',
      logo: p.logo ?? faviconFor(url),
    })
  }

  return entries
}

async function getAdvisorEntries(): Promise<SearchEntry[]> {
  const advisors = await getAdvisors()
  return advisors.map(a => ({
    type: 'advisor' as const,
    title: a.name,
    subtitle: '',
    description: a.description,
    category: a.focus,
    url: a.url || '/advisors',
    logo: a.logo,
  }))
}

async function getCommunityEntries(): Promise<SearchEntry[]> {
  const communities = await getCommunities()
  return communities.map(c => ({
    type: 'community' as const,
    title: c.name,
    subtitle: '',
    description: c.description,
    category: [c.platformText, c.focus, c.location ?? '']
      .filter(Boolean)
      .join(' · '),
    url: c.joinLink !== '#' ? c.joinLink : '/communities',
    logo: c.logo,
  }))
}

async function getCourseEntries(): Promise<SearchEntry[]> {
  const courses = await getCourses()
  return courses.map(c => ({
    type: 'course' as const,
    title: c.name,
    subtitle: '',
    description: c.description,
    category: [c.category, c.courseType].filter(Boolean).join(' · '),
    url: c.url || '/self-study',
    logo: c.image,
  }))
}

async function getFounderEntries(): Promise<SearchEntry[]> {
  const founders = await getFounderResources()
  return founders.map(f => ({
    type: 'founder' as const,
    title: f.name,
    subtitle: '',
    description: f.description,
    category: f.type,
    url: f.website || '/founders',
    logo: f.image,
  }))
}

async function getFunderEntries(): Promise<SearchEntry[]> {
  const funders = await getFunders()
  return funders.map(f => ({
    type: 'funder' as const,
    title: f.name,
    subtitle: '',
    description: f.description,
    category: [f.type, f.acceptingApplications].filter(Boolean).join(' · '),
    url: f.url || '/funding',
    logo: f.logo,
  }))
}

async function getJobEntries(): Promise<SearchEntry[]> {
  const jobs = await getJobs()
  return jobs.map(j => ({
    type: 'job' as const,
    title: j.name,
    subtitle: j.organization,
    description: j.description,
    category: [j.location, j.roleType, j.skillSet].filter(Boolean).join(' · '),
    url: j.url || '/jobs',
    logo: j.logo,
  }))
}

async function getMapEntries(): Promise<SearchEntry[]> {
  const mapData = await getMapData()
  const entries: SearchEntry[] = []
  for (const o of mapData.records) {
    if (o.isMagic) continue
    // Already covered by STATIC_PAGES.
    if (/^https?:\/\/(www\.)?aisafety\.com/i.test(o.link)) continue
    entries.push({
      type: 'map',
      title: o.title,
      subtitle: '',
      description: o.description,
      category: [o.category, o.status].filter(Boolean).join(' · '),
      url: o.link || '/map',
      logo: o.logo,
    })
  }
  return entries
}

async function getMediaEntries(): Promise<SearchEntry[]> {
  const media = await getMediaChannels()
  return media.map(m => ({
    type: 'media' as const,
    title: m.name,
    subtitle: '',
    description: m.description,
    category: m.type,
    url: m.url || '/media-channels',
    logo: m.logo,
  }))
}

async function getProjectEntries(): Promise<SearchEntry[]> {
  const projects = await getProjects()
  return projects.map(p => ({
    type: 'project' as const,
    title: p.name,
    subtitle: '',
    description: p.description,
    category: p.status,
    url: p.email ? `mailto:${p.email}` : '/projects',
    logo: p.logo,
  }))
}

/** Every search type with listings behind it — all but the static pages. */
export type ListingSearchType = Exclude<SearchType, 'page'>

// One builder per resource page, in the order the index lists them.
const ENTRY_BUILDERS: Record<ListingSearchType, () => Promise<SearchEntry[]>> =
  {
    advisor: getAdvisorEntries,
    community: getCommunityEntries,
    course: getCourseEntries,
    event: getEventEntries,
    training: getTrainingEntries,
    founder: getFounderEntries,
    funder: getFunderEntries,
    job: getJobEntries,
    map: getMapEntries,
    media: getMediaEntries,
    project: getProjectEntries,
  }

export function isListingSearchType(type: string): type is ListingSearchType {
  return (Object.keys(ENTRY_BUILDERS) as string[]).includes(type)
}

/** The index entries for one resource page's listings, built from whatever
 *  the data layer returns for this request: live Airtable in preview mode
 *  (src/lib/preview.ts), the hourly cache otherwise. Preview mode's search
 *  uses this to re-read just the page being looked at
 *  (/api/admin/preview/search-entries). */
export async function buildSearchEntries(
  type: ListingSearchType
): Promise<SearchEntry[]> {
  return ENTRY_BUILDERS[type]()
}

export async function buildSearchIndex(): Promise<SearchEntry[]> {
  const sections = await Promise.all(
    (Object.keys(ENTRY_BUILDERS) as ListingSearchType[]).map(buildSearchEntries)
  )
  return [...sections.flat(), ...STATIC_PAGES]
}
