import { NextResponse } from 'next/server'
import { fetchAllCounts } from '@/lib/data/counts'

// The nav badge counts as the public site shows them: prebuilt with the site
// and refreshed on the same hourly cycle as the pages. Preview mode reads
// its badges from here rather than from Airtable live (see fetchAllCounts).
export const revalidate = 3600

export async function GET() {
  try {
    return NextResponse.json(await fetchAllCounts(), {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=3600' },
    })
  } catch (err) {
    console.error('Failed to read counts:', err)
    return NextResponse.json({ error: 'Counts unavailable' }, { status: 500 })
  }
}
