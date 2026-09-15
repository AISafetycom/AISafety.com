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

const PUBLIC_PAGES = findPublicPages()

// The resource pages (src/lib/site-pages.ts) get extra checks on their data.
const RESOURCE_PAGES: string[] = Object.values(SITE_PAGES).map(p => p.path)

// Resource pages whose main content is a list of listings that link out.
// The map draws logos instead, volunteer projects name a contact person
// rather than linking anywhere, and the donation guide is prose.
const LISTING_PAGES = RESOURCE_PAGES.filter(
  p => !['/map', '/projects', '/donation-guide'].includes(p)
)

// Every outbound listing link carries the site's UTM tags (src/lib/utm.ts),
// so this selector finds listing cards without depending on class names.
const LISTING_LINK = 'a[href*="utm_source=aisafety.com"]'

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
      }
      if (path === '/projects') {
        // One <h3> per project card.
        expect(await page.locator('h3').count()).toBeGreaterThan(3)
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
    // everything in it must be a page that exists.
    for (const path of listed) {
      expect(PUBLIC_PAGES, `${path} is in the sitemap`).toContain(path)
    }
  })

  test('unknown paths return the 404 page', async ({ page }) => {
    const response = await page.goto('/no-such-page')
    expect(response?.status()).toBe(404)
  })
})
