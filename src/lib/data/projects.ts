import {
  fetchAirtableRecords,
  fieldDateOnly,
  fieldFeatured,
  fieldString,
  fieldText,
  publishedFormula,
  type AirtableRawRecord,
} from './airtable'
import { fetchPublicData, hasAirtableCredentials } from './public-api'

export const TABLE_ID = 'tblHT29QNgMYKB8iW'
const VIEW_ID = 'viwVgPN3hgpGa8dRE'

// Permanent Airtable field IDs for the Projects table. Fetching, filtering
// and sorting by ID keeps the page working when fields are renamed.
const FIELD = {
  projectName: 'fldtfqsPSKc5ubNs4', // Project Name
  descriptionShort: 'fldbeRqlUCLsgOcCT', // Description (short)
  descriptionLong: 'fldmSMJIiJukmgoEU', // Description (long)
  status: 'fld57KJsNvSKFLoHT', // Status
  contactName: 'fldejiM6qWUfXAeqO', // Contact name
  contactEmail: 'fldNhMihsnXhsHMnc', // Contact email
  featured: 'fldMxxOYWQGlWTZ9D', // Featured
  featuredTagline: 'fld8LvgC3dnT40Vbl', // Featured tagline
  sort: 'fldNvTVR11SJjYu2l', // Sort
  publish: 'fldrGDtZxpFLQfjMz', // Publish?
  hide: 'fldPjPfUW5hK98ysn', // Hide?
  lastModified: 'fld3KsLNUU3IGj5Gg', // Last modified
} as const

export interface Project {
  id: string
  dateAdded: string | null
  lastModified: string | null
  name: string
  description: string
  /** Fuller background from Airtable's "Description (long)". Not displayed
   *  anywhere on the site — it feeds only the chatbot's get_listing detail
   *  view, and is stripped from the public Data API (it can name people who
   *  never agreed to appear in a public dump). */
  descriptionLong: string | null
  logo: string | null
  contact: string
  email: string | null
  status: string
  featured: '1' | '2' | null
  featuredTagline: string | null
}

/**
 * One Projects record (fields keyed by field id) → the listing the page
 * renders, or null when the site would skip it (no name). Publish/Hide
 * filtering stays in getProjects(), so an unpublished record can still be
 * mapped — the admin Queue previews proposed records through this.
 */
export function projectFromRecord(record: AirtableRawRecord): Project | null {
  const f = record.fields
  const name = fieldString(f[FIELD.projectName])
  if (!name) return null

  return {
    id: record.id,
    dateAdded: record.createdTime?.slice(0, 10) ?? null,
    lastModified: fieldDateOnly(f[FIELD.lastModified]),
    name,
    description: fieldString(f[FIELD.descriptionShort]) || '',
    descriptionLong: fieldString(f[FIELD.descriptionLong]),
    logo: null,
    contact: fieldString(f[FIELD.contactName]) || '',
    email: fieldString(f[FIELD.contactEmail]),
    status: fieldText(f[FIELD.status]),
    featured: fieldFeatured(f[FIELD.featured]),
    featuredTagline: fieldString(f[FIELD.featuredTagline]),
  }
}

export async function getProjects(): Promise<Project[]> {
  if (!hasAirtableCredentials()) return fetchPublicData<Project>('projects')
  const raw = await fetchAirtableRecords({
    tableId: TABLE_ID,
    viewId: VIEW_ID,
    returnFieldsByFieldId: true,
    filterByFormula: publishedFormula(FIELD.publish, FIELD.hide),
    sort: [{ field: FIELD.sort, direction: 'asc' }],
  })

  const results: Project[] = []
  for (const record of raw) {
    const project = projectFromRecord(record)
    if (!project) continue
    results.push(project)
  }

  return results
}
