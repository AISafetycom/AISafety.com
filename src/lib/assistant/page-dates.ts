import { fetchLastUpdated, validResources } from '@/lib/data/last-updated'

// Which page's update stamp each last-updated resource feeds. Paths match
// PAGES in ./pages.
const RESOURCE_TO_PATH: Record<string, string> = {
  events: '/events',
  training: '/training',
  map: '/map',
  communities: '/communities',
  'self-study': '/self-study',
  jobs: '/jobs',
  funding: '/funding',
  'media-channels': '/media-channels',
  advisors: '/advisors',
  founders: '/founders',
  'donation-guide': '/donation-guide',
}

let cached: { dates: Record<string, string>; expiresAt: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000

/** The formatted "Last updated" date behind each resource page's stamp, keyed
 *  by page path, for the assistant's ambient context. Fetches are serialized
 *  like fetchAllLastUpdated (Airtable rate limit) and the underlying requests
 *  are data-cached for an hour; a complete result is memoized for the same
 *  hour so chat turns don't refetch. A failed resource is skipped with a
 *  warning – the assistant just won't know that page's date this turn. */
export async function getPageLastUpdatedDates(): Promise<Record<
  string,
  string
> | null> {
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.dates

  const dates: Record<string, string> = {}
  let complete = true
  for (const resource of validResources) {
    const path = RESOURCE_TO_PATH[resource]
    if (!path) {
      console.warn(
        `assistant: no page path mapped for last-updated resource '${resource}'`
      )
      continue
    }
    try {
      const { formattedDate } = await fetchLastUpdated(resource)
      if (formattedDate) dates[path] = formattedDate
      else complete = false
    } catch (err) {
      console.warn(
        `assistant: last-updated fetch failed for '${resource}'`,
        err
      )
      complete = false
    }
  }
  if (Object.keys(dates).length === 0) return null
  // Only memoize a full set – a partial one retries on the next turn.
  if (complete) cached = { dates, expiresAt: now + CACHE_TTL_MS }
  return dates
}
