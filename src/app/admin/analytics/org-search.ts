// The Org lookup's search, matched against every listing the site knows.
// Shared by the dashboard and the org pages it shares (src/app/stats).

import { getFunders } from '@/lib/data/funding'
import { getEvents, getEventRounds } from '@/lib/data/events'
import {
  getTrainingPrograms,
  getRecurringPrograms,
  getTrainingRounds,
} from '@/lib/data/training'
import { getCourses } from '@/lib/data/self-study'
import { getAdvisors } from '@/lib/data/advisors'
import { getCommunities } from '@/lib/data/communities'
import { getMediaChannels } from '@/lib/data/media-channels'
import { getFounderResources } from '@/lib/data/founders'
import { getJobs } from '@/lib/data/jobs'
import { getMapData } from '@/lib/data/map'
import {
  catalogFrom,
  orgSpec,
  type CatalogSources,
  type OrgSpec,
} from '@/lib/analytics/org-lookup'

/** Which page each catalog source fills, for the "couldn't read" note. */
const CATALOG_SOURCE_PAGE: Record<keyof CatalogSources, string> = {
  training: 'Training programs',
  recurring: 'Training programs',
  trainingRounds: 'Training programs',
  events: 'Events',
  eventRounds: 'Events',
  map: 'Field map',
  communities: 'Communities',
  courses: 'Self-study',
  jobs: 'Jobs',
  funders: 'Funding',
  media: 'Media channels',
  advisors: 'Advisors',
  founders: 'Founder toolkit',
}

/** The Org lookup tab's search matched against every listing the site knows
 *  (the cached page getters, plus past training and event rounds). Never
 *  rejects, so it can load alongside the events: a page that can't be read
 *  is logged and named in failedPages, and the rest still match. */
export async function orgSearchSpec(
  query: string,
  leftOut: Set<string>
): Promise<OrgSpec> {
  const loads: { [K in keyof CatalogSources]-?: Promise<CatalogSources[K]> } = {
    training: getTrainingPrograms(),
    recurring: getRecurringPrograms(),
    trainingRounds: getTrainingRounds(),
    events: getEvents(),
    eventRounds: getEventRounds(),
    map: getMapData().then(d => d.records),
    communities: getCommunities(),
    courses: getCourses(),
    jobs: getJobs(),
    funders: getFunders(),
    media: getMediaChannels(),
    advisors: getAdvisors(),
    founders: getFounderResources(),
  }
  const keys = Object.keys(loads) as (keyof CatalogSources)[]
  const settled = await Promise.allSettled(keys.map(k => loads[k]))
  const sources: Record<string, unknown> = {}
  const failed = new Set<string>()
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') sources[keys[i]] = r.value
    else {
      failed.add(CATALOG_SOURCE_PAGE[keys[i]])
      console.warn(
        `[analytics] org lookup couldn't read ${keys[i]}: ${
          r.reason instanceof Error ? r.reason.message : String(r.reason)
        }`
      )
    }
  })
  return orgSpec(catalogFrom(sources as CatalogSources), query, leftOut, [
    ...failed,
  ])
}
