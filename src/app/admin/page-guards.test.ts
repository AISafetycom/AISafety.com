import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCESS_AREAS } from '@/lib/admin/access'

// Every admin page checks its own area before it reads anything: the first
// thing its default export awaits is requireAccess('<area>'). The section
// layouts check too, but a client navigation asks for a page without
// rendering the layouts above it again, so a page that relied on its layout
// served its data to anyone replaying that request signed out (found on
// /admin/analytics, 13 October 2026). A new page that forgets fails here.

const ADMIN_DIR = fileURLToPath(new URL('.', import.meta.url))

/** Pages anyone may open: the sign-in page, and the index, which only
 *  redirects to the session's first area. */
const OPEN = new Set(['/admin', '/admin/login'])

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return pageFiles(p)
    return name === 'page.tsx' ? [p] : []
  })
}

/** The URL a page file serves: route groups like (editor) are not part of it. */
function routeOf(file: string): string {
  const parts = relative(ADMIN_DIR, file)
    .split(/[\\/]/)
    .slice(0, -1)
    .filter(p => !/^\(.*\)$/.test(p))
  return ['/admin', ...parts].join('/')
}

/** The area whose tab the page sits under: the longest matching href. */
function areaOf(route: string): string | undefined {
  return ACCESS_AREAS.filter(
    a => route === a.href || route.startsWith(`${a.href}/`)
  ).sort((a, b) => b.href.length - a.href.length)[0]?.key
}

const pages = pageFiles(ADMIN_DIR).map(file => ({
  file,
  route: routeOf(file),
}))

describe('admin pages', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(10)
    for (const route of OPEN) {
      expect(pages.map(p => p.route)).toContain(route)
    }
  })

  for (const { file, route } of pages.filter(p => !OPEN.has(p.route))) {
    it(`${route} checks its own area first`, () => {
      const area = areaOf(route)
      expect(area, `${route} is under no area in ACCESS_AREAS`).toBeDefined()
      const src = readFileSync(file, 'utf8')
      const body = src.slice(src.indexOf('export default'))
      const firstAwait = body.match(/\bawait\s+([^\n;]+)/)?.[1]
      expect(firstAwait).toBe(`requireAccess('${area}')`)
    })
  }
})
