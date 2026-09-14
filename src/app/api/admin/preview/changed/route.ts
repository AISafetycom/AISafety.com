/*
  Change check for preview mode's auto-refresh.

  GET /api/admin/preview/changed?path=/funding
    → { changed: boolean, buildTime: <ISO | null> }

  Asks Airtable whether any record feeding that page was modified within the
  last CHANGE_WINDOW_MS, via LAST_MODIFIED_TIME() — the same mechanism
  /api/check-rebuild uses to trigger deploys. The preview banner polls this
  every few seconds and calls router.refresh() on changed:true.

  A fixed look-back window rather than a "since my last poll" cursor, on
  purpose. An edit made in the Airtable UI takes a moment to be saved and
  become visible to the API; a poll that ran in that moment saw nothing, and
  with a cursor it then moved past the edit for good (a title change on
  3 Sept 2026 was lost that way — the poll and the save shared the same
  second). With the window, every poll until the edit ages out reports it,
  so the page re-renders a couple of times, each from the newest data. A few
  redundant in-place refreshes beat a missed edit.

  `buildTime` is the BUILD_TIME of the deployment answering the poll — when
  it moves past the one the page rendered with, a rebuild has gone live and
  the banner refreshes so "public built X ago" starts over. For a page with
  no Airtable content, it reports no change.
*/

import { NextRequest } from 'next/server'
import { canUsePreview } from '@/lib/admin/auth'
import { hasChangesSince } from '@/lib/data/changed-since'
import { resourceTables, validResources } from '@/lib/data/last-updated'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Five polls' worth: the edit is reported until it is this old. Generous
// against Airtable's save-to-API lag (normally a second or two); the poller
// spaces its refreshes out, so this costs two or three per edit.
const CHANGE_WINDOW_MS = 10_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(request: NextRequest) {
  if (!(await canUsePreview())) return json({ error: 'unauthorized' }, 401)

  const buildTime = process.env.BUILD_TIME ?? null

  const path = request.nextUrl.searchParams.get('path') ?? ''
  const resource = path.replace(/^\//, '')
  if (!validResources.includes(resource))
    return json({ changed: false, buildTime })

  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  // Contributor mode: no credentials, no live data to poll.
  if (!token || !baseId) return json({ changed: false, buildTime })

  const since = new Date(Date.now() - CHANGE_WINDOW_MS)

  // Sequential on purpose — same rate-limit care as everywhere else. No
  // retries either: the browser asks again in two seconds anyway, and a poll
  // waiting out a rate limit would only pile onto the reads that tripped it.
  let changed = false
  try {
    for (const tableId of resourceTables(resource)) {
      if (
        await hasChangesSince(baseId, token, tableId, since, undefined, {
          attempts: 0,
        })
      ) {
        changed = true
        break
      }
    }
  } catch (error) {
    // Usually Airtable's 429 during a burst of reads; the next poll retries.
    console.warn(`preview change check failed: ${error}`)
    return json({ changed: false, buildTime, error: 'airtable' }, 503)
  }
  return json({ changed, buildTime })
}
