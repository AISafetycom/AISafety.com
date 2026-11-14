/*
  The Field map as the Queue's map strip draws it (the strip under a /map
  addition, src/app/admin/queue/MapSpot.tsx).

  Where each listing sits comes from the map editor's live read, so the
  strip shows what Airtable holds this minute, unpublished suggestions
  included. A published listing's logo comes from the site's own data
  instead: that is the copy /map serves, at an address that does not change,
  so the browser already has it. Airtable's own attachment links are new on
  every read, and a strip that fetched four hundred logos afresh on each
  /map addition drew blank pins for many seconds.

  Read-only. Nothing here writes to Airtable or touches a cache.
*/

import { getMapData } from '@/lib/data/map'
import { isExpiredAttachment } from './attachment-url'
import { listMapRecordsLive } from './map-editor'
import type { EditorRecord } from './map-editor-core'

/** The site's logo for each published map listing, by record. A failed
 *  read costs only speed (the pins fall back to Airtable's links), so it is
 *  logged and the strip carries on. */
async function siteLogos(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    for (const org of (await getMapData()).records) {
      if (org.mapLogo && !isExpiredAttachment(org.mapLogo)) {
        out.set(org.id, org.mapLogo)
      }
    }
  } catch (e) {
    console.warn(
      `[admin-queue] The site's map logos could not be read (${e instanceof Error ? e.message : String(e)}); the map strip uses Airtable's links.`
    )
  }
  return out
}

export async function mapForStrip(): Promise<EditorRecord[]> {
  const [records, logos] = await Promise.all([
    listMapRecordsLive(),
    siteLogos(),
  ])
  return records.map(r => {
    const logo = r.published ? logos.get(r.id) : undefined
    return logo ? { ...r, mapLogo: logo } : r
  })
}
