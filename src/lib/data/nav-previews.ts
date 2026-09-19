import { titleMetaFor as eventTitleMeta } from '@/app/events/card'
import { titleMetaFor as programTitleMeta } from '@/app/training/card'
import { featuredEventsFor, featuredProgramsFor } from '@/lib/featured'
import { compareByDeadline } from '@/lib/training-order'
import { getAdvisors } from './advisors'
import { getCommunities } from './communities'
import { getEvents } from './events'
import { getFounderResources } from './founders'
import { getFunders } from './funding'
import { getJobs } from './jobs'
import { getMediaChannels } from './media-channels'
import { getProjects } from './projects'
import { getCourses } from './self-study'
import { getTrainingPrograms } from './training'

// What the global nav's hover previews show under each page's description:
// the two cards at the top of that page, in miniature. Served prebuilt from
// /api/nav-previews and fetched by the nav on desktop only, so none of this
// rides along in every page's HTML.

/** One miniature card. */
export interface NavPreviewItem {
  id: string
  name: string
  logo: string | null
  /** The line under the name, one entry per fact: where and when for events
   *  and programs, the curated featured tagline on the other pages. */
  facts: string[]
}

/** Page path → its cards. A page with nothing to show has no entry. */
export type NavPreviews = Partial<Record<string, NavPreviewItem[]>>

interface Curated {
  id: string
  name: string
  featured: '1' | '2' | null
  featuredTagline: string | null
}

// Most pages: the listings ranked 1 and 2 in Airtable's Featured field, the
// same pick as the page's own featured row.
function curated<T extends Curated>(
  listings: T[],
  logo: (listing: T) => string | null
): NavPreviewItem[] {
  return [
    listings.find(l => l.featured === '1'),
    listings.find(l => l.featured === '2'),
  ]
    .filter((l): l is T => l != null)
    .map(l => ({
      id: l.id,
      name: l.name,
      logo: logo(l),
      facts: l.featuredTagline ? [l.featuredTagline] : [],
    }))
}

// The facts a featured card shows under its title: where, then when.
function titleFacts(rows: { value: string }[]): string[] {
  return rows.flatMap(row => row.value.split(' · '))
}

export async function getNavPreviews(): Promise<NavPreviews> {
  const [
    programs,
    events,
    communities,
    courses,
    jobs,
    funders,
    channels,
    advisors,
    projects,
    resources,
  ] = await Promise.all([
    getTrainingPrograms(),
    getEvents(),
    getCommunities(),
    getCourses(),
    getJobs(),
    getFunders(),
    getMediaChannels(),
    getAdvisors(),
    getProjects(),
    getFounderResources(),
  ])

  const previews: NavPreviews = {
    // Each page's default view: the Upcoming tab in its deadline order, and
    // In person events.
    '/training': featuredProgramsFor([...programs].sort(compareByDeadline)).map(
      p => ({
        id: p.id,
        name: p.name,
        logo: p.logo,
        facts: titleFacts(programTitleMeta(p, p)),
      })
    ),
    '/events': featuredEventsFor(events, 'in-person').map(e => ({
      id: e.id,
      name: e.name,
      logo: e.logo,
      facts: titleFacts(eventTitleMeta(e)),
    })),
    '/communities': curated(communities, c => c.logo),
    '/self-study': curated(courses, c => c.image),
    // /jobs has no featured row, so its preview is the two newest vacancies —
    // the first two cards on the page.
    '/jobs': jobs.slice(0, 2).map(j => ({
      id: j.id,
      name: j.name,
      logo: j.logo,
      facts: j.organization ? [j.organization] : [],
    })),
    '/funding': curated(funders, f => f.logo),
    '/media-channels': curated(channels, c => c.logo),
    '/advisors': curated(advisors, a => a.logo),
    // Volunteer projects have no logos.
    '/projects': curated(projects, () => null),
    '/founders': curated(resources, r => r.image),
  }

  for (const path of Object.keys(previews)) {
    if (previews[path]!.length === 0) delete previews[path]
  }
  return previews
}
