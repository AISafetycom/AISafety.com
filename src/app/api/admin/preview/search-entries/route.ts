/*
  Live search entries for preview mode.

  GET /api/admin/preview/search-entries?type=map
    → { type: 'map', entries: SearchEntry[] }

  Search in preview mode shows the public site's prebuilt index — reading
  every table live tripped Airtable's rate limit and hung search (see
  SearchTrigger.tsx) — and lays this route's entries for the page being
  looked at over it. With the Draft Mode cookie the data layer reads Airtable
  live (src/lib/preview.ts), so the entries carry an edit within seconds. One
  table (two for /training), through the same getX() the page renders from,
  so when the page and search refresh in the same moment the read is shared
  (shareLiveRead) rather than repeated.
*/

import { NextRequest } from 'next/server'
import { canUsePreview } from '@/lib/admin/auth'
import {
  buildSearchEntries,
  isListingSearchType,
} from '@/lib/data/search-index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  const type = request.nextUrl.searchParams.get('type') ?? ''
  if (!isListingSearchType(type)) return json({ error: 'unknown type' }, 400)

  try {
    const entries = await buildSearchEntries(type)
    return json({ type, entries })
  } catch (error) {
    // Usually Airtable's 429 during a burst of reads; the next change or
    // search open asks again.
    console.warn(`preview search entries failed for ${type}: ${error}`)
    return json({ error: 'airtable' }, 503)
  }
}
