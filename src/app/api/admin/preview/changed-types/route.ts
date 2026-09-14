/*
  Which listing types changed recently — for preview mode's search.

  GET /api/admin/preview/changed-types
    → { types: ['funder', 'map'] }

  The search types (src/lib/search.ts TYPE_PATH) whose Airtable table had a
  record modified in the last LOOK_BACK_MS: one tiny LAST_MODIFIED_TIME()
  read per table (twelve in all), the same check the page poll makes for
  the page being looked at. Search asks on its first open and whenever the
  tab is returned to — polling pauses in hidden tabs, and coming back from
  Airtable is exactly when an edit to any page's records may be waiting —
  and then re-reads just those types live. Every table is never polled
  continuously: that would be six reads a second, past Airtable's limit.
*/

import { canUsePreview } from '@/lib/admin/auth'
import { hasChangesSince } from '@/lib/data/changed-since'
import { resourceTables, validResources } from '@/lib/data/last-updated'
import type { SearchType } from '@/lib/data/search-index'
import { TYPE_PATH } from '@/lib/search'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Generous on purpose. The tab may have been away for a while, and beyond a
// couple of minutes the prebuilt index has caught up on its own, so a type
// reported here needlessly costs one redundant table read — while an edit
// missed here shows the old listing in search.
const LOOK_BACK_MS = 10 * 60_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET() {
  if (!(await canUsePreview())) return json({ error: 'unauthorized' }, 401)

  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  // Contributor mode: no credentials, no live data to check.
  if (!token || !baseId) return json({ types: [] })

  const since = new Date(Date.now() - LOOK_BACK_MS)
  const types: SearchType[] = []

  // Sequential on purpose — same rate-limit care as the page poll, and no
  // retries: the caller asks again on the next open or return.
  try {
    for (const [type, path] of Object.entries(TYPE_PATH)) {
      if (!path) continue
      const resource = path.slice(1)
      if (!validResources.includes(resource)) continue
      for (const tableId of resourceTables(resource)) {
        if (
          await hasChangesSince(baseId, token, tableId, since, undefined, {
            attempts: 0,
          })
        ) {
          types.push(type as SearchType)
          break
        }
      }
    }
  } catch (error) {
    // Usually Airtable's 429 during a burst of reads.
    console.warn(`preview changed-types check failed: ${error}`)
    return json({ error: 'airtable' }, 503)
  }

  return json({ types })
}
