import {
  fetchAirtableRecords,
  fieldDateOnly,
  fieldAttachmentUrl,
  fieldFeatured,
  fieldString,
  fieldText,
  publishedFormula,
  type AirtableRawRecord,
} from './airtable'
import { fetchPublicData, hasAirtableCredentials } from './public-api'

export const TABLE_ID = 'tblCTOMzyH3vILL5I'
const VIEW_ID = 'viwT8KTwupcVyGKLZ'

// Permanent Airtable field IDs for the Media channels table. Fetching,
// filtering and sorting by ID keeps the page working when fields are
// renamed.
const FIELD = {
  name: 'fldsju0ew5KYrY3Qa', // Name
  description: 'fld4grLOZyX7Msjxg', // Description
  image: 'fldhHGt6N9SSWjUXG', // Image
  type: 'fldEnZ1ZYO1849kV1', // Type
  link: 'fldvCayjHmj5GuBoE', // Link
  featured: 'fldZlWHVADe5glk3g', // Featured
  featuredTagline: 'fldYalqFyaKuPJZDO', // Featured tagline
  sort: 'fldhkOSt89LF6aYE5', // Sort
  publish: 'fldMN0TF3kz41HTQc', // Publish?
  hide: 'fldxzKJV6SnPk7eD8', // Hide?
  lastModified: 'fldg46VoI3zwPRzXR', // Last modified
} as const

export interface MediaChannel {
  id: string
  dateAdded: string | null
  lastModified: string | null
  name: string
  description: string
  logo: string | null
  type: string
  url: string
  featured: '1' | '2' | null
  featuredTagline: string | null
}

/**
 * One Media channels record (fields keyed by field id) → the listing the page
 * renders, or null when the site would skip it (no name). Publish/Hide
 * filtering stays in getMediaChannels(), so an unpublished record can still be
 * mapped — the admin Queue previews proposed records through this.
 */
export function mediaChannelFromRecord(
  record: AirtableRawRecord
): MediaChannel | null {
  const f = record.fields
  const name = fieldString(f[FIELD.name])
  if (!name) return null

  return {
    id: record.id,
    dateAdded: record.createdTime?.slice(0, 10) ?? null,
    lastModified: fieldDateOnly(f[FIELD.lastModified]),
    name,
    description: fieldString(f[FIELD.description]) || '',
    logo: fieldAttachmentUrl(f[FIELD.image]),
    type: fieldText(f[FIELD.type]),
    url: fieldString(f[FIELD.link]) || '#',
    featured: fieldFeatured(f[FIELD.featured]),
    featuredTagline: fieldString(f[FIELD.featuredTagline]),
  }
}

export async function getMediaChannels(): Promise<MediaChannel[]> {
  if (!hasAirtableCredentials())
    return fetchPublicData<MediaChannel>('media-channels')
  const raw = await fetchAirtableRecords({
    tableId: TABLE_ID,
    viewId: VIEW_ID,
    returnFieldsByFieldId: true,
    filterByFormula: publishedFormula(FIELD.publish, FIELD.hide),
    sort: [{ field: FIELD.sort, direction: 'asc' }],
  })

  const results: MediaChannel[] = []
  for (const record of raw) {
    const channel = mediaChannelFromRecord(record)
    if (!channel) continue
    results.push(channel)
  }

  return results
}
