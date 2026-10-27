import {
  fetchAirtableRecords,
  fieldDateOnly,
  fieldAttachmentUrl,
  fieldFeatured,
  fieldString,
  fieldStringArray,
  fieldText,
  publishedFormula,
  type AirtableRawRecord,
} from './airtable'
import { fetchPublicData, hasAirtableCredentials } from './public-api'
import { FOCUS_AREAS, WHO_ITS_FOR, isApplications } from '@/lib/advisor-meta'
import { inOptionOrder } from '../option-order'

export const TABLE_ID = 'tblf3KKYnmgcjVGhD'
const VIEW_ID = 'viwIdRmaCar2Y6gPi'

// Permanent Airtable field IDs for the Advisors table. Fetching, filtering
// and sorting by ID keeps the page working when fields are renamed.
const FIELD = {
  name: 'fldDCHQmcF8HLOz5S', // Name
  description: 'fldKAGrIoU5VBZJ85', // Description
  logo: 'fldlN4rEUvhZBt8Bk', // Logo
  focus: 'fldJw9XfXOInZ7mCq', // Focus
  whoItsFor: 'fldV0iU04GFzGMypK', // Who it's for
  focusAreas: 'fldKAVyL9lBOFy8Ht', // Focus areas
  applications: 'fldb32mL5jiHvtN9J', // Applications
  status: 'flduXnbMW0gaLpSgE', // Status
  link: 'fldAOckkk19f4aNTm', // Link
  featured: 'fldEp3grkZngt3fmk', // Featured
  featuredTagline: 'fldqzI3RhC7hwYJN2', // Featured tagline
  sort: 'fldbIK2vKzWm61CGr', // Sort
  publish: 'fldaOmFd67ORPMfTC', // Publish?
  hide: 'fldBOSo9B5KSaTZRq', // Hide?
  lastModified: 'fld8rTAfTkJBhnO0L', // Last modified
} as const

export interface Advisor {
  id: string
  dateAdded: string | null
  lastModified: string | null
  name: string
  description: string
  logo: string | null
  /** The old Focus field; Focus areas replaces it on the page. */
  focus: string
  whoItsFor: string[]
  focusAreas: string[]
  /** One of APPLICATIONS; '' when the record has none yet. */
  applications: string
  status: string
  url: string
  featured: '1' | '2' | null
  featuredTagline: string | null
}

// Inactive advisors aren't taking guidance calls, so they're left off the page
// entirely rather than surfaced behind a status filter.
const isActiveAdvisor = (a: Advisor) => a.status === 'Active'

// The live Data API serves who-it's-for, focus areas and applications only once
// this change has deployed. Until then, contributor mode (and CI, which builds
// that way) fills them in empty so the page still renders. Delete this and its
// use in getAdvisors() once /api/v1/advisors returns them.
const NOT_YET_IN_PUBLIC_API: Pick<
  Advisor,
  'whoItsFor' | 'focusAreas' | 'applications'
> = {
  whoItsFor: [],
  focusAreas: [],
  applications: '',
}

// Advisors already warned about for missing the new fields, so the many
// getAdvisors() calls in one build log each name once.
const warnedIncomplete = new Set<string>()

function warnIfIncomplete(advisor: Advisor) {
  if (warnedIncomplete.has(advisor.id)) return
  const missing = [
    advisor.whoItsFor.length === 0 && "Who it's for",
    advisor.focusAreas.length === 0 && 'Focus areas',
    !advisor.applications && 'Applications',
  ].filter(Boolean)
  if (missing.length === 0) return
  warnedIncomplete.add(advisor.id)
  console.warn(
    `[advisors] "${advisor.name}" has no ${missing.join(', ')}; its card leaves those lines out and the matching filters skip it.`
  )
}

/**
 * One Advisors record (fields keyed by field id) → the listing the page
 * renders, or null when the site would skip it (no name). Publish/Hide
 * filtering stays in getAdvisors(), so an unpublished record can still be
 * mapped — the admin Queue previews proposed records through this.
 */
export function advisorFromRecord(record: AirtableRawRecord): Advisor | null {
  const f = record.fields
  const name = fieldString(f[FIELD.name])
  if (!name) return null

  const applications = fieldText(f[FIELD.applications])
  if (applications && !isApplications(applications)) {
    console.warn(
      `[advisors] "${name}" has an unknown Applications value "${applications}"; its card shows no applications line and the Applications filter skips it.`
    )
  }

  return {
    id: record.id,
    dateAdded: record.createdTime?.slice(0, 10) ?? null,
    lastModified: fieldDateOnly(f[FIELD.lastModified]),
    name,
    description: fieldString(f[FIELD.description]) || '',
    logo: fieldAttachmentUrl(f[FIELD.logo]),
    focus: fieldText(f[FIELD.focus]),
    whoItsFor: inOptionOrder(fieldStringArray(f[FIELD.whoItsFor]), WHO_ITS_FOR),
    focusAreas: inOptionOrder(
      fieldStringArray(f[FIELD.focusAreas]),
      FOCUS_AREAS
    ),
    applications,
    status: fieldText(f[FIELD.status]),
    url: fieldString(f[FIELD.link]) || '#',
    featured: fieldFeatured(f[FIELD.featured]),
    featuredTagline: fieldString(f[FIELD.featuredTagline]),
  }
}

export async function getAdvisors(): Promise<Advisor[]> {
  if (!hasAirtableCredentials()) {
    const advisors = await fetchPublicData<Advisor>('advisors')
    return advisors
      .map(a => ({ ...NOT_YET_IN_PUBLIC_API, ...a }))
      .filter(isActiveAdvisor)
  }
  const raw = await fetchAirtableRecords({
    tableId: TABLE_ID,
    viewId: VIEW_ID,
    returnFieldsByFieldId: true,
    filterByFormula: publishedFormula(FIELD.publish, FIELD.hide),
    sort: [{ field: FIELD.sort, direction: 'asc' }],
  })

  const results: Advisor[] = []
  for (const record of raw) {
    const advisor = advisorFromRecord(record)
    if (!advisor) continue
    results.push(advisor)
  }

  const active = results.filter(isActiveAdvisor)
  active.forEach(warnIfIncomplete)
  return active
}
