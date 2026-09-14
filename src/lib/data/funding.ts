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

export const TABLE_ID = 'tblzMTLDZWZKqTxrq'
const VIEW_ID = 'viwxv2w8utSEhUeiJ'

// Permanent Airtable field IDs for the Funding table. Fetching, filtering
// and sorting by ID keeps the page working when fields are renamed.
const FIELD = {
  name: 'fldsFpgVduYnNuYkN', // Name
  description: 'fldBm7ZehvD2anFg8', // Description
  logo: 'fldVVx7c5jJRvKxDB', // Logo
  type: 'fldu44vSLT2tH4fqh', // Type
  acceptingApplications: 'fld398tQjtRGz0Pk1', // Accepting applications?
  website: 'fldpc3AO5j2k3PU3b', // Website
  featured: 'fldS0WL2vXJ0h2HQs', // Featured
  featuredTagline: 'fldNevMnRCmCzv4Jt', // Featured tagline
  sort: 'fldDDTHjJHiUUBz7k', // Sort
  publish: 'fldoH88AbtQLEViD7', // Publish?
  hide: 'fldU5a381Lcgjgzp8', // Hide?
  lastModified: 'fldMZXYm96wdeq5jw', // Last modified
} as const

export interface Funder {
  id: string
  dateAdded: string | null
  lastModified: string | null
  name: string
  description: string
  logo: string | null
  type: string
  recipientType: string
  acceptingApplications: string
  url: string
  featured: '1' | '2' | null
  featuredTagline: string | null
}

/**
 * One Funding record (fields keyed by field id) → the listing the page
 * renders, or null when the site would skip it (no name). Publish/Hide
 * filtering stays in getFunders(), so an unpublished record can still be
 * mapped — the admin Queue previews proposed records through this.
 */
export function funderFromRecord(record: AirtableRawRecord): Funder | null {
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
    type: fieldText(f[FIELD.type]),
    // The Recipient type field no longer exists in Airtable.
    recipientType: '',
    acceptingApplications: fieldText(f[FIELD.acceptingApplications]),
    url: fieldString(f[FIELD.website]) || '#',
    featured: fieldFeatured(f[FIELD.featured]),
    featuredTagline: fieldString(f[FIELD.featuredTagline]),
  }
}

export async function getFunders(): Promise<Funder[]> {
  if (!hasAirtableCredentials()) return fetchPublicData<Funder>('funding')
  const raw = await fetchAirtableRecords({
    tableId: TABLE_ID,
    viewId: VIEW_ID,
    returnFieldsByFieldId: true,
    filterByFormula: publishedFormula(FIELD.publish, FIELD.hide),
    sort: [{ field: FIELD.sort, direction: 'asc' }],
  })

  const results: Funder[] = []
  for (const record of raw) {
    const funder = funderFromRecord(record)
    if (!funder) continue
    results.push(funder)
  }

  return results
}
