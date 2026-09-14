import { headers } from 'next/headers'
import { fetchAirtableRecords } from './airtable'
import { isPreviewRequest } from '@/lib/preview'
import { getAdvisors } from './advisors'
import { getCommunities } from './communities'
import { getEvents } from './events'
import { getFounderResources } from './founders'
import { getFunders } from './funding'
import { getJobs } from './jobs'
import { getMapData } from './map'
import { getMediaChannels } from './media-channels'
import { getProjects } from './projects'
import { getCourses } from './self-study'
import { getTrainingPrograms, getRecurringPrograms } from './training'
import { hasAirtableCredentials } from './public-api'

// Each resource's table ID, view to count from, and a minimal field (by
// permanent field ID — rename-proof) to fetch.
// adjust: manual correction for counts that don't match the live site exactly.
//
// Note: redesigned pages derive their nav count from the page's own data
// function instead (see below), so the badge always matches the on-page total
// and needs no `adjust` hack. As more pages migrate, move them out of here.
const resources = [
  {
    path: '/map',
    tableId: 'tblvzbGL9q9dOO9Nc',
    viewId: 'viwJgtDFDmaP8PyoI',
    field: 'fldqYJa5li27kVOUW', // Long name
    adjust: -4, // Grid view includes 4 category header rows that aren't displayed on the site
  },
]

type Counts = Partial<Record<string, number>>

// Preview-mode requests can't be served from any Next.js data cache (Draft
// Mode disables caching for the whole request), and the two dozen Airtable
// reads below — paced to Airtable's rate limit — took the first preview page
// on a fresh server instance ten seconds, for nav badges the admin isn't
// checking. So in preview the badges come from the public site's own numbers
// instead: this deployment's prebuilt /api/counts, fetched without cookies
// (no Draft Mode, so it is served from cache) and costing no Airtable reads.
// They are exactly what visitors see, and a rebuild refreshes them a couple
// of minutes after any edit. Remembered briefly in process memory so the
// requests one page view fans out into (its segments, the nav prefetches
// after every refresh, a second tab) share one fetch; the memo holds the
// fetch itself, so concurrent callers never each start their own.
let previewCountsMemo: { at: number; counts: Promise<Counts> } | null = null
const PREVIEW_COUNTS_MEMO_MS = 60_000

// Called at build time (static generation) so latency doesn't matter.
export async function fetchAllCounts(): Promise<Counts> {
  // Contributor mode: derive every count from the same public data the pages
  // render, so each badge matches its page. The Airtable view counts below
  // aren't available without credentials.
  if (!hasAirtableCredentials()) {
    const mapData = await getMapData()
    return {
      '/map': mapData.records.filter(r => !r.isMagic).length,
      '/communities': (await getCommunities()).length,
      '/jobs': (await getJobs()).length,
      '/funding': (await getFunders()).length,
      '/media-channels': (await getMediaChannels()).length,
      '/advisors': (await getAdvisors()).length,
      '/projects': (await getProjects()).length,
      '/founders': (await getFounderResources()).length,
      '/self-study': (await getCourses()).length,
      '/events': (await getEvents()).length,
      '/training':
        (await getTrainingPrograms()).length +
        (await getRecurringPrograms()).length,
    }
  }

  if (!(await isPreviewRequest())) return readAllCounts()

  const now = Date.now()
  if (
    previewCountsMemo &&
    now - previewCountsMemo.at < PREVIEW_COUNTS_MEMO_MS
  ) {
    return previewCountsMemo.counts
  }
  const counts = readPublicCounts().catch(error => {
    // A deployment whose public URL isn't reachable from here (a protected
    // branch preview answering 401, say) falls back to reading Airtable live.
    console.warn(`Public counts unavailable (${error}); reading Airtable live`)
    return readAllCounts()
  })
  previewCountsMemo = { at: now, counts }
  counts.catch(() => {
    if (previewCountsMemo?.counts === counts) previewCountsMemo = null
  })
  return counts
}

// The public site's counts, from this deployment's own /api/counts. Built
// from the request's host so it works on any deployment and on `next start`.
async function readPublicCounts(): Promise<Counts> {
  const requestHeaders = await headers()
  const host =
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  if (!host) throw new Error('request has no host header')
  const proto =
    requestHeaders.get('x-forwarded-proto') ??
    (host.startsWith('localhost') ? 'http' : 'https')
  const response = await fetch(`${proto}://${host}/api/counts`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = (await response.json()) as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('unexpected /api/counts response')
  }
  return body as Counts
}

// Serialized to avoid hitting Airtable's 5 req/sec rate limit.
async function readAllCounts(): Promise<Counts> {
  const counts: Counts = {}
  for (const r of resources) {
    const raw = await fetchAirtableRecords({
      tableId: r.tableId,
      viewId: r.viewId,
      fields: [r.field],
    })
    counts[r.path] = raw.length + (r.adjust ?? 0)
  }

  // Derive redesigned pages' counts from the same data the page renders, so the
  // nav badge always matches the on-page total exactly.
  counts['/communities'] = (await getCommunities()).length
  counts['/jobs'] = (await getJobs()).length
  counts['/media-channels'] = (await getMediaChannels()).length
  counts['/advisors'] = (await getAdvisors()).length
  counts['/projects'] = (await getProjects()).length
  counts['/founders'] = (await getFounderResources()).length
  counts['/self-study'] = (await getCourses()).length
  counts['/events'] = (await getEvents()).length
  // Both program sets the page lists: upcoming + recurring.
  counts['/training'] =
    (await getTrainingPrograms()).length + (await getRecurringPrograms()).length
  counts['/funding'] = (await getFunders()).length
  return counts
}
