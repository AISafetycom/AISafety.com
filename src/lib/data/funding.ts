import {
  fetchAirtableRecords,
  fieldDateOnly,
  fieldAttachmentUrl,
  fieldFeatured,
  fieldNumber,
  fieldString,
  fieldStringArray,
  fieldText,
  publishedFormula,
  type AirtableRawRecord,
} from './airtable'
import { fetchPublicData, hasAirtableCredentials } from './public-api'
import {
  isApplicationStatus,
  resolveApplicationStatus,
} from '@/lib/funding-meta'
import { resolveAcceptingApplications } from '../funding-status'

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
  applicationStatus: 'fldD8GVcdVy4Vonaa', // Application status
  deadline: 'fldv6IKA9WMDJNTbT', // Deadline
  whoCanApply: 'fldubjbVV9Df9MXbk', // Who can apply
  grantSize: 'flddVCzyFr56x9NLs', // Grant size (display)
  grantMin: 'fldcbweKlHR4h2znS', // Grant min (USD)
  grantMax: 'fldbp5nQ1Zzn9KH4D', // Grant max (USD)
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
  /** One of APPLICATION_STATUSES; '' when the record has none yet. */
  applicationStatus: string
  /** Closing date (YYYY-MM-DD) of an open funder; null means rolling. */
  deadline: string | null
  whoCanApply: string[]
  /** The funder's own wording ("Up to £1m"); '' hides the card line. */
  grantSize: string
  /** The numbers behind the Grant size slider, converted to USD. */
  grantMinUsd: number | null
  grantMaxUsd: number | null
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

  const storedStatus = fieldText(f[FIELD.applicationStatus])
  if (storedStatus && !isApplicationStatus(storedStatus)) {
    console.warn(
      `[funding] "${name}" has an unknown Application status "${storedStatus}"; its card shows no status line and the Application status filter skips it.`
    )
  }
  const deadline = fieldDateOnly(f[FIELD.deadline])

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
    // A dated status ("Applications close 23 October 2026") whose date has
    // passed reads "Not accepting applications" from here on, so the card,
    // the Open/Closed filter and the chatbot never show a stale open status
    // while the record waits for its Broom tidy-up.
    acceptingApplications: resolveAcceptingApplications(
      fieldText(f[FIELD.acceptingApplications])
    ),
    // Same rule for the new fields: an open funder whose Deadline has passed
    // reads "Not currently accepting applications" on its card, in the
    // Application status filter and in the Data API.
    applicationStatus: resolveApplicationStatus(storedStatus, deadline),
    deadline,
    whoCanApply: fieldStringArray(f[FIELD.whoCanApply]),
    grantSize: fieldString(f[FIELD.grantSize]) || '',
    grantMinUsd: fieldNumber(f[FIELD.grantMin]),
    grantMaxUsd: fieldNumber(f[FIELD.grantMax]),
    url: fieldString(f[FIELD.website]) || '#',
    featured: fieldFeatured(f[FIELD.featured]),
    featuredTagline: fieldString(f[FIELD.featuredTagline]),
  }
}

// Funders already warned about for having no Application status, so the many
// getFunders() calls in one build log each name once.
const warnedNoStatus = new Set<string>()

// The live Data API serves the status, who-can-apply and grant-size fields only
// once this change has deployed. Until then, contributor mode (and CI, which
// builds that way) fills them in empty so the page still renders. Delete this
// and its use in getFunders() once /api/v1/funding returns them.
const NOT_YET_IN_PUBLIC_API: Pick<
  Funder,
  | 'applicationStatus'
  | 'deadline'
  | 'whoCanApply'
  | 'grantSize'
  | 'grantMinUsd'
  | 'grantMaxUsd'
> = {
  applicationStatus: '',
  deadline: null,
  whoCanApply: [],
  grantSize: '',
  grantMinUsd: null,
  grantMaxUsd: null,
}

export async function getFunders(): Promise<Funder[]> {
  if (!hasAirtableCredentials()) {
    const funders = await fetchPublicData<Funder>('funding')
    // The live Data API serves the status, who-can-apply and grant-size fields
    // only once this change has deployed. Until then, fill them in empty so
    // contributor mode (and CI, which builds that way) still renders. Delete
    // this once /api/v1/funding returns them.
    return funders.map(f => ({ ...NOT_YET_IN_PUBLIC_API, ...f }))
  }
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
    if (!funder.applicationStatus && !warnedNoStatus.has(funder.id)) {
      warnedNoStatus.add(funder.id)
      console.warn(
        `[funding] "${funder.name}" has no Application status; its card shows no status line and the Application status filter skips it.`
      )
    }
    results.push(funder)
  }

  return results
}
