import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { SITE_PAGES } from '../src/lib/site-pages'

// Browser smoke tests: does every public page still render, without runtime
// errors, with its data? Does the Data API still answer? Run against a
// production build (see playwright.config.ts). No credentials required: in
// contributor mode the build reads the live site's public data, so these
// tests only assert things that hold in that mode too (no featured cards, no
// "Updated" line).

const APP_DIR = join(__dirname, '..', 'src', 'app')

/** Every public page, found the way Next.js finds routes: one `page.tsx` per
 *  folder under src/app. Nothing is listed by hand, so a new page is covered
 *  the moment it exists. The admin area is skipped (it needs a login) and so
 *  is the API (covered below). Route groups "(name)" add no URL segment;
 *  dynamic segments "[slug]" and private folders "_name" are skipped because
 *  there is no single URL to open. */
function findPublicPages(dir = APP_DIR, route = ''): string[] {
  const pages: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (entry.name === 'page.tsx') pages.push(route || '/')
      continue
    }
    if (!entry.isDirectory()) continue
    if (['admin', 'api'].includes(entry.name)) continue
    if (entry.name.startsWith('[') || entry.name.startsWith('_')) continue
    const segment = entry.name.startsWith('(') ? '' : `/${entry.name}`
    pages.push(...findPublicPages(join(dir, entry.name), route + segment))
  }
  return pages.sort()
}

// Retired pages whose code is kept for a rebuild. next.config.ts redirects
// them, so they're checked for the redirect instead of rendered.
const RETIRED_PAGES: Record<string, string> = { '/projects': '/about' }

const PUBLIC_PAGES = findPublicPages().filter(p => !(p in RETIRED_PAGES))

// The resource pages (src/lib/site-pages.ts) get extra checks on their data.
const RESOURCE_PAGES: string[] = Object.values(SITE_PAGES)
  .map(p => p.path)
  .filter(p => !(p in RETIRED_PAGES))

// Resource pages whose main content is a list of listings that link out.
// The map draws logos instead, and the donation guide is prose.
const LISTING_PAGES = RESOURCE_PAGES.filter(
  p => !['/map', '/donation-guide'].includes(p)
)

// Every outbound listing link carries the site's UTM tags (src/lib/utm.ts),
// so this selector finds listing cards without depending on class names.
const LISTING_LINK = 'a[href*="utm_source=aisafety.com"]'

// Links to the site's own forms, channels and files, and the credits the
// communities map draws, are not visits sent to another organization, so
// they stay untagged. Everything else that leaves aisafety.com must carry
// the UTM tags.
const OWN_DESTINATIONS = [
  'airtable.com', // suggestion, correction and feedback forms, shared views
  'discord.gg', // invites to the site's own Discord servers
  'every.org', // the site's own donation page (footer)
  'app.notion.com', // the hackathon's own project list
  'creativecommons.org', // the Data API's license, linked by its exact URL
  'public.blob.vercel-storage.com', // the site's own files (press kit)
  'mapbox.com', // the communities map's attribution, drawn by Mapbox
  'openstreetmap.org', // the same attribution
]

/** Outbound links on the page without the site's UTM tags. A link that
 *  slips through (a new page, a new component) fails here instead of
 *  quietly sending visitors to an org as unattributed traffic. */
async function untaggedOutboundLinks(page: Page): Promise<string[]> {
  const hrefs = await page
    .locator('a[href^="http"]')
    .evaluateAll(links => links.map(a => a.getAttribute('href') ?? ''))
  return hrefs.filter(href => {
    const { hostname, searchParams } = new URL(href)
    const host = hostname.replace(/^www\./, '')
    if (host === 'aisafety.com' || host === 'localhost') return false
    if (OWN_DESTINATIONS.some(d => host === d || host.endsWith(`.${d}`))) {
      return false
    }
    return searchParams.get('utm_source') !== 'aisafety.com'
  })
}

/** Collect uncaught exceptions and console errors (hydration mismatches,
 *  failed renders, broken imports all surface here in a production build). */
function watchForErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

test.beforeEach(async ({ context }) => {
  // Keep test runs out of the analytics: opt out the way the privacy page
  // does (honoured by both Matomo and the first-party beacon), and answer
  // any request to Matomo with an empty script so nothing leaves the machine.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('aisafety_no_track', '1')
    } catch {
      // storage unavailable: nothing to opt out of
    }
  })
  await context.route(/matomo\.cloud/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    })
  )
})

test.describe('page discovery', () => {
  test('the scan of src/app finds the homepage and every resource page', () => {
    expect(PUBLIC_PAGES).toContain('/')
    expect(PUBLIC_PAGES).toEqual(expect.arrayContaining(RESOURCE_PAGES))
  })
})

test.describe('public pages', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} renders without errors`, async ({ page }) => {
      const errors = watchForErrors(page)

      const response = await page.goto(path)
      expect(response?.status()).toBe(200)
      await expect(page).toHaveTitle(/AISafety\.com/)
      // Every page has a heading; on the map pages it is visually hidden
      // (the map is the page) but still there for screen readers.
      await expect(page.locator('h1').first()).toBeVisible()

      if (LISTING_PAGES.includes(path)) {
        await expect(page.locator(LISTING_LINK).first()).toBeVisible()
        expect(await page.locator(LISTING_LINK).count()).toBeGreaterThan(3)
        // A card's link is its title alone, in a list item, so screen readers
        // get a short link name and a list they can move through (#812).
        expect(
          await page.locator(`li h3 ${LISTING_LINK}`).count()
        ).toBeGreaterThan(3)
      }
      if (path === '/map') {
        // The D3 map draws one <image> per organization logo.
        await expect
          .poll(() => page.locator('svg image').count())
          .toBeGreaterThan(20)
      }

      // Give hydration a moment to finish so late errors are caught too.
      await page.waitForLoadState('load')
      await page.waitForTimeout(1000)
      expect(errors).toEqual([])
      expect(await untaggedOutboundLinks(page)).toEqual([])
    })
  }
})

test.describe('site search', () => {
  test('results that link to other sites carry the UTM tags', async ({
    page,
  }) => {
    await page.goto('/training')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Search AISafety.com' })
    await dialog.locator('input').fill('fellowship')
    // Results are listings, most of them on other sites.
    const results = dialog.locator('a[data-result-index]')
    await expect(results.first()).toBeVisible()
    expect(
      await dialog.locator('a[data-result-index][href^="http"]').count()
    ).toBeGreaterThan(3)
    expect(await untaggedOutboundLinks(page)).toEqual([])
  })
})

test.describe('retired pages', () => {
  for (const [path, target] of Object.entries(RETIRED_PAGES)) {
    test(`${path} redirects to ${target}`, async ({ page }) => {
      await page.goto(path)
      expect(new URL(page.url()).pathname).toBe(target)
    })
  }
})

test.describe('Data API', () => {
  test('index lists endpoints and every endpoint returns data', async ({
    request,
  }) => {
    const index = await request.get('/api/v1')
    expect(index.status()).toBe(200)
    const body = await index.json()
    expect(body.data.version).toBe('v1')

    const endpoints: Array<{ slug: string }> = body.data.endpoints
    expect(endpoints.length).toBeGreaterThan(5)

    for (const { slug } of endpoints) {
      const response = await request.get(`/api/v1/${slug}`)
      expect(response.status(), slug).toBe(200)
      expect(response.headers()['access-control-allow-origin'], slug).toBe('*')
      const json = await response.json()
      expect(Array.isArray(json.data), slug).toBe(true)
      expect(json.data.length, slug).toBeGreaterThan(0)
      expect(json.meta.count, slug).toBe(json.data.length)
    }
  })

  test('serves an OpenAPI spec', async ({ request }) => {
    const response = await request.get('/api/v1/openapi.json')
    expect(response.status()).toBe(200)
    const spec = await response.json()
    expect(String(spec.openapi)).toMatch(/^3\./)
    expect(Object.keys(spec.paths).length).toBeGreaterThan(5)
  })
})

test.describe('routing', () => {
  test('legacy paths redirect to their new home', async ({ request }) => {
    const response = await request.get('/founder-toolkit', { maxRedirects: 0 })
    expect(response.status()).toBe(308)
    expect(response.headers()['location']).toContain('/founders')
  })

  test('sitemap lists every resource page and only real pages', async ({
    request,
  }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.status()).toBe(200)
    const xml = await response.text()
    const listed = [
      ...xml.matchAll(/<loc>https:\/\/aisafety\.com([^<]*)<\/loc>/g),
    ]
      .map(match => match[1] || '/')
      .sort()
    expect(listed).toEqual(expect.arrayContaining(RESOURCE_PAGES))
    // The sitemap is curated (some pages are unlisted on purpose), but
    // everything in it must be a page that exists. A page of a dynamic route
    // (a newsletter's past issues, listed once it has one) isn't in the scan,
    // so it must answer instead.
    for (const path of listed) {
      if (PUBLIC_PAGES.includes(path)) continue
      expect(path, `${path} is in the sitemap`).toMatch(
        /^\/newsletter\/[a-z]+$/
      )
      const page = await request.get(path)
      expect(page.status(), `${path} is in the sitemap`).toBe(200)
    }
  })

  test('unknown paths return the 404 page', async ({ page }) => {
    const response = await page.goto('/no-such-page')
    expect(response?.status()).toBe(404)
  })
})
