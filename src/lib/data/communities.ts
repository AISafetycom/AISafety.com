import {
  fetchAirtableRecords,
  fieldDateOnly,
  fieldAttachmentUrl,
  fieldFeatured,
  fieldNumber,
  fieldString,
  fieldStringArray,
  publishedFormula,
  type AirtableRawRecord,
} from './airtable'
import { fetchPublicData, hasAirtableCredentials } from './public-api'

export const TABLE_ID = 'tbluI5Dll697WiSm8'
const VIEW_ID = 'viwFIU3lKQHZlpc0b'

// Permanent Airtable field IDs for the Communities table. Fetching,
// filtering and sorting by ID keeps the page working when fields are
// renamed.
const FIELD = {
  name: 'fld6w8ff8niuQCtF8', // Name
  description: 'fld5EkoT2YkkbYaym', // Description
  logo: 'fldAOv9unizM1MOoh', // Logo
  platform: 'fldtB4DH4pavlH2HF', // Platform
  platformWrangled: 'fld4dZD0bxWJn09Uw', // Platform wrangled
  type: 'fldxye7cJo7hUZUvQ', // Type
  activityLevel: 'fldhmpd6FsN0wAED2', // Activity level
  focus: 'fldmV7OYSEPNKlRAk', // Focus
  link: 'flddg6m5nLsQS48Kw', // Link
  locationIfInPerson: 'fldxoaSbAsaLQRKGa', // Location (if in-person)
  size: 'fldwpS0uMsn7KjLw0', // Size
  sort: 'fldKaLNPjKAt10KGo', // Sort
  latitude: 'fldfVGghvBxhEPuH1', // Latitude
  longitude: 'fldlavJcz8Zl6MqsC', // Longitude
  featured: 'fldggxJr1i9yxhFex', // Featured
  featuredTagline: 'fldDxqDvO7vgFo2m0', // Featured tagline
  publish: 'fldV8RYP1CVzOvHpf', // Publish?
  hide: 'fldQAl9W6QDPCpdew', // Hide?
  lastModified: 'fldcsXAugffjhKmEH', // Last modified
} as const

export interface Community {
  id: string
  dateAdded: string | null
  lastModified: string | null
  name: string
  description: string
  logo: string | null
  platform: string[]
  platformText: string
  type: string[]
  activityLevel: string
  focus: string
  joinLink: string
  location: string | null
  size: string | null
  latitude: number | null
  longitude: number | null
  featured: '1' | '2' | null
  featuredTagline: string | null
}

/**
 * One Communities record (fields keyed by field id) → the listing the page
 * renders, or null when the site would skip it (no name). Publish/Hide
 * filtering stays in getCommunities(), so an unpublished record can still be
 * mapped — the admin Queue previews proposed records through this.
 */
export function communityFromRecord(
  record: AirtableRawRecord
): Community | null {
  const f = record.fields
  const name = fieldString(f[FIELD.name])
  if (!name) return null

  return {
    id: record.id,
    dateAdded: record.createdTime?.slice(0, 10) ?? null,
    lastModified: fieldDateOnly(f[FIELD.lastModified]),
    name,
    description: fieldString(f[FIELD.description]) || '',
    logo: fieldAttachmentUrl(f[FIELD.logo]),
    platform: fieldStringArray(f[FIELD.platform]),
    platformText: fieldString(f[FIELD.platformWrangled]) || '',
    type: fieldStringArray(f[FIELD.type]),
    activityLevel: fieldString(f[FIELD.activityLevel]) || '',
    focus: fieldString(f[FIELD.focus]) || '',
    joinLink: fieldString(f[FIELD.link]) || '#',
    location: fieldString(f[FIELD.locationIfInPerson]),
    size: fieldString(f[FIELD.size]),
    latitude: fieldNumber(f[FIELD.latitude]),
    longitude: fieldNumber(f[FIELD.longitude]),
    featured: fieldFeatured(f[FIELD.featured]),
    featuredTagline: fieldString(f[FIELD.featuredTagline]),
  }
}

export async function getCommunities(): Promise<Community[]> {
  if (!hasAirtableCredentials())
    return fetchPublicData<Community>('communities')
  const raw = await fetchAirtableRecords({
    tableId: TABLE_ID,
    viewId: VIEW_ID,
    returnFieldsByFieldId: true,
    filterByFormula: publishedFormula(FIELD.publish, FIELD.hide),
    sort: [{ field: FIELD.sort, direction: 'asc' }],
  })

  const results: Community[] = []
  for (const record of raw) {
    const community = communityFromRecord(record)
    if (!community) continue
    results.push(community)
  }

  return results
}
