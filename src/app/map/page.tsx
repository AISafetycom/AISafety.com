import MapClient from './MapClient'
import { getMapData } from '@/lib/data/map'
import { fetchLastUpdated } from '@/lib/data/last-updated'
import { pageMetadata } from '@/lib/page-metadata'
import { SITE_PAGES } from '@/lib/site-pages'

export const metadata = pageMetadata(SITE_PAGES.map)

export default async function MapPage() {
  const [{ records, suggestEntryLink, suggestCorrectionLink }, lastUpdated] =
    await Promise.all([getMapData(), fetchLastUpdated('map')])

  return (
    <MapClient
      orgs={records}
      lastUpdatedIso={lastUpdated.lastUpdated}
      suggestEntryLink={suggestEntryLink}
      suggestCorrectionLink={suggestCorrectionLink}
    />
  )
}
