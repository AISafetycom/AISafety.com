import { NextResponse } from 'next/server'
import { getMapData } from '@/lib/data/map'
import { mapImageUrls } from '@/lib/map-images'

// The URL of every image the field map draws (its background and one logo per
// placed listing), read by MapPreload to warm the browser cache from
// other pages. Prebuilt with the site and refreshed on the same hourly cycle
// as /map itself, so the list matches what the map will draw. About 5 KB
// compressed.
export const revalidate = 3600

export async function GET() {
  try {
    const { records } = await getMapData()
    return NextResponse.json(
      { urls: mapImageUrls(records) },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
    )
  } catch (err) {
    console.error('Failed to list map images:', err)
    return NextResponse.json(
      { error: 'Map images unavailable' },
      { status: 500 }
    )
  }
}
