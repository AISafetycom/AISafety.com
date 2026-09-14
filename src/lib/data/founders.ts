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

export const TABLE_ID = 'tbl59Ye8oxvPjoVJv'
const VIEW_ID = 'viwzMBhPBk1GpQXnn'

// Permanent Airtable field IDs for the Founder toolkit table. Fetching,
// filtering and sorting by ID keeps the page working when fields are
// renamed.
const FIELD = {
  name: 'fldylwo2fwYtfMqM8', // Name
  sort: 'fldBoK9MKNijwTzBl', // Sort
  type: 'fldu8ymguU2ndeGgF', // Type
  image: 'fld2MY1ilx2i6Gqll', // Image
  description: 'fld904S9bZ6oECDte', // Description
  website: 'fldWDaTU33sdnQC5A', // Website
  featured: 'fldzM3TDpR4RGllFT', // Featured
  featuredTagline: 'fldhf703nHwICgQyl', // Featured tagline
  publish: 'fld9Epdrxu9n0FV20', // Publish?
  hide: 'fldPKsUP3i4UVujDf', // Hide?
  lastModified: 'fldMM2jKZeORMO5mP', // Last modified
} as const

export interface FounderResource {
  id: string
  dateAdded: string | null
  lastModified: string | null
  name: string
  type: string
  image: string | null
  description: string
  website: string
  featured: '1' | '2' | null
  featuredTagline: string | null
}

/**
 * One Founder toolkit record (fields keyed by field id) → the listing the page
 * renders, or null when the site would skip it (no name). Publish/Hide
 * filtering stays in getFounderResources(), so an unpublished record can still be
 * mapped — the admin Queue previews proposed records through this.
 */
export function founderResourceFromRecord(
  record: AirtableRawRecord
): FounderResource | null {
  const f = record.fields
  const name = fieldString(f[FIELD.name])
  if (!name) return null

  return {
    id: record.id,
    dateAdded: record.createdTime?.slice(0, 10) ?? null,
    lastModified: fieldDateOnly(f[FIELD.lastModified]),
    name,
    type: fieldText(f[FIELD.type]),
    image: fieldAttachmentUrl(f[FIELD.image]),
    description: fieldString(f[FIELD.description]) || '',
    website: fieldString(f[FIELD.website]) || '#',
    featured: fieldFeatured(f[FIELD.featured]),
    featuredTagline: fieldString(f[FIELD.featuredTagline]),
  }
}

export async function getFounderResources(): Promise<FounderResource[]> {
  if (!hasAirtableCredentials())
    return fetchPublicData<FounderResource>('founder-resources')
  const raw = await fetchAirtableRecords({
    tableId: TABLE_ID,
    viewId: VIEW_ID,
    returnFieldsByFieldId: true,
    filterByFormula: publishedFormula(FIELD.publish, FIELD.hide),
    sort: [
      { field: FIELD.sort, direction: 'asc' },
      { field: FIELD.name, direction: 'asc' },
    ],
  })

  const results: FounderResource[] = []
  for (const record of raw) {
    const resource = founderResourceFromRecord(record)
    if (!resource) continue
    results.push(resource)
  }

  return results
}
