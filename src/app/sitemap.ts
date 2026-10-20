import type { MetadataRoute } from 'next'
import { WEB_NEWSLETTERS, type WebKey } from '@/lib/newsletter-web'
import { archivePath } from '@/lib/newsletter-archive'
import { archiveIssues } from '@/lib/newsletter-archive-store'

// Built with the site and rebuilt hourly, so a newsletter's past issues page
// joins once it exists (Funding's after its move). force-static: the reads
// behind that list are uncached fetches.
export const dynamic = 'force-static'
export const revalidate = 3600

const BASE_URL = 'https://aisafety.com'

const ROUTES = [
  '/',
  '/about',
  '/advisors',
  '/communities',
  '/donation-guide',
  '/events',
  '/founders',
  '/funding',
  '/hackathon',
  '/jobs',
  '/listing-policy',
  '/map',
  '/media',
  '/media-channels',
  '/privacy',
  '/self-study',
  '/training',
] as const

/** The newsletters' past issues pages (/newsletter/<key>) that exist: a
 *  newsletter has one once an issue of it has gone out through
 *  ActiveCampaign (none in contributor mode or CI, which can't read it). */
async function pastIssuesPages(): Promise<string[]> {
  const keys = Object.keys(WEB_NEWSLETTERS) as WebKey[]
  const found = await Promise.all(
    keys.map(async key => {
      try {
        return (await archiveIssues(key)).length > 0 ? archivePath(key) : null
      } catch (err) {
        // Left out until the next rebuild, an hour on.
        console.warn(
          `[sitemap] ${archivePath(key)} left out: ${err instanceof Error ? err.message : String(err)}`
        )
        return null
      }
    })
  )
  return found.filter((p): p is string => p !== null)
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date()
  const paths = [...ROUTES, ...(await pastIssuesPages())].sort()
  return paths.map(path => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency: path === '/' ? 'weekly' : 'daily',
    priority: path === '/' ? 1.0 : 0.8,
  }))
}
