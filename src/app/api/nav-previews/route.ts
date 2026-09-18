import { NextResponse } from 'next/server'
import { getNavPreviews } from '@/lib/data/nav-previews'

// The cards shown in the global nav's hover previews: prebuilt with the site
// and refreshed on the same hourly cycle as the pages, like /api/counts. The
// nav fetches it without cookies, so preview-mode admins get this cached copy
// too instead of a dozen live Airtable reads.
export const revalidate = 3600

export async function GET() {
  try {
    return NextResponse.json(await getNavPreviews(), {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
    })
  } catch (err) {
    // Don't leak internal details (Airtable URLs, table IDs) to the client.
    console.error('Failed to build nav previews:', err)
    return NextResponse.json(
      { error: 'Nav previews unavailable' },
      { status: 500 }
    )
  }
}
