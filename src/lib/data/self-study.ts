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

export const TABLE_ID = 'tblRNYJ0m1cmJXKKk'
const VIEW_ID = 'viwblgaia3x1gsqBo'

// Permanent Airtable field IDs for the Self-study table. Fetching,
// filtering and sorting by ID keeps the page working when fields are
// renamed.
const FIELD = {
  name: 'fldQQt1WHmasrayDD', // Name
  description: 'fld3BWX1PMV9R3lA5', // Description
  focus: 'fldkyFFjqE02A5nPP', // Focus
  format: 'fld5x5ek1pBqG9FNV', // Format
  createdBy: 'fldQAhN1cBrYe5RSY', // Created by
  link: 'fldkkeUHGbVSFit1g', // Link
  logo: 'fldtcSqZB0sKbzVCK', // Logo
  featured: 'fldETJCJIuQwxEvmu', // Featured
  featuredTagline: 'fldvZjLjgSlDbtfre', // Featured tagline
  sort: 'fldThp6KjSXk03P7p', // Sort
  publish: 'fldWShxP7GkMeh6rg', // Publish?
  hide: 'fldTF2A1ibOD8w3RO', // Hide?
  lastModified: 'fld4gwoM3vldhbyiE', // Last modified
} as const

export interface Course {
  id: string
  dateAdded: string | null
  lastModified: string | null
  name: string
  description: string
  category: string
  courseType: string
  organizer: string
  url: string
  image: string | null
  featured: '1' | '2' | null
  featuredTagline: string | null
}

/**
 * One Self-study record (fields keyed by field id) → the listing the page
 * renders, or null when the site would skip it (no name). Publish/Hide
 * filtering stays in getCourses(), so an unpublished record can still be
 * mapped — the admin Queue previews proposed records through this.
 */
export function courseFromRecord(record: AirtableRawRecord): Course | null {
  const f = record.fields
  const name = fieldString(f[FIELD.name])
  if (!name) return null

  return {
    id: record.id,
    dateAdded: record.createdTime?.slice(0, 10) ?? null,
    lastModified: fieldDateOnly(f[FIELD.lastModified]),
    name,
    description: fieldString(f[FIELD.description]) || '',
    category: fieldText(f[FIELD.focus]),
    courseType: fieldText(f[FIELD.format]),
    organizer: fieldString(f[FIELD.createdBy]) || '',
    url: fieldString(f[FIELD.link]) || '#',
    image: fieldAttachmentUrl(f[FIELD.logo]),
    featured: fieldFeatured(f[FIELD.featured]),
    featuredTagline: fieldString(f[FIELD.featuredTagline]),
  }
}

export async function getCourses(): Promise<Course[]> {
  if (!hasAirtableCredentials()) return fetchPublicData<Course>('courses')
  const raw = await fetchAirtableRecords({
    tableId: TABLE_ID,
    viewId: VIEW_ID,
    returnFieldsByFieldId: true,
    filterByFormula: publishedFormula(FIELD.publish, FIELD.hide),
    sort: [{ field: FIELD.sort, direction: 'asc' }],
  })

  const results: Course[] = []
  for (const record of raw) {
    const course = courseFromRecord(record)
    if (!course) continue
    results.push(course)
  }

  return results
}
