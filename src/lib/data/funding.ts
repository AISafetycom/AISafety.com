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
  WHO_CAN_APPLY,
  isApplicationStatus,
  resolveApplicationStatus,
} from '@/lib/funding-meta'
import {
  acceptingApplicationsText,
  resolveAcceptingApplications,
} from '../funding-status'
import { inOptionOrder } from '../option-order'

export const TABLE_ID = 'tblzMTLDZWZKqTxrq'
const VIEW_ID = 'viwxv2w8utSEhUeiJ'

// Permanent Airtable field IDs for the Funding table. Fetching, filtering
// and sorting by ID keeps the page working when fields are renamed.
const FIELD = {
  name: 'fldsFpgVduYnNuYkN', // Name
  description: 'fldBm7ZehvD2anFg8', // Description
  logo: 'fldVVx7c5jJRvKxDB', // Logo
  type: 'fldu44vSLT2tH4fqh', // Type
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
  /** The old status text ("Applications close 31 October 2026",
   *  "Applications on a rolling basis", "Not accepting applications"),
   *  worked out from Application status and Deadline since its Airtable
   *  field was deleted; Data API v1 keeps serving it. */
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
    // The Recipient type field no longer exists in Airtable (July 2026). It
    // stays '' only so Data API v1 keeps the key; Who can apply replaces it.
    recipientType: '',
    // Data API v1's old status text, worked out from the new fields the way
    // the bots kept the "Accepting applications?" field in step until it was
    // deleted (28 Oct 2026). A dated one whose date has passed reads "Not
    // accepting applications", as it always did.
    acceptingApplications: resolveAcceptingApplications(
      acceptingApplicationsText(storedStatus, deadline)
    ),
    // Same rule for the new fields: an open funder whose Deadline has passed
    // reads "Not currently accepting applications" on its card, in the
    // Application status filter and in the Data API.
    applicationStatus: resolveApplicationStatus(storedStatus, deadline),
    deadline,
    whoCanApply: inOptionOrder(
      fieldStringArray(f[FIELD.whoCanApply]),
      WHO_CAN_APPLY
    ),
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

export async function getFunders(): Promise<Funder[]> {
  if (!hasAirtableCredentials()) {
    return fetchPublicData<Funder>('funding')
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
