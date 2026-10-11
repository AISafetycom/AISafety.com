import type { MetadataRoute } from 'next'

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
  // Each newsletter's past issues; Funding's joins once it has one.
  '/newsletter/events',
  '/newsletter/training',
  '/privacy',
  '/projects',
  '/self-study',
  '/training',
] as const

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return ROUTES.map(path => ({
    url: `${BASE_URL}${path}`,
    lastModified,
    changeFrequency: path === '/' ? 'weekly' : 'daily',
    priority: path === '/' ? 1.0 : 0.8,
  }))
}
