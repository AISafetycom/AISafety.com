import {
  fetchAirtableRecords,
  fieldAttachmentUrl,
  fieldDateOnly,
  fieldNumber,
  fieldString,
  fieldStringArray,
  publishedFormula,
  type AirtableRawRecord,
} from './airtable'
import { fetchPublicData, hasAirtableCredentials } from './public-api'

export const TABLE_ID = 'tblvzbGL9q9dOO9Nc'
const VIEW_ID = 'viwJgtDFDmaP8PyoI'

const MAGIC_ROW_NAMES = [
  'Merch',
  'Last updated',
  'Suggest correction',
  'Suggest entry',
]

// Permanent Airtable field IDs for the Map table. Fetching, filtering and
// selecting by ID keeps the page working when fields are renamed.
const FIELD = {
  longName: 'fldqYJa5li27kVOUW', // Long name
  longNameForCards: 'fldPEouzOZbCIZr7p', // Long name for cards
  shortName: 'fldIL5rLAwlbvdhtg', // Short name
  description: 'fldUZfd5kQQP0DoOS', // Description
  categoryText: 'fldddK6whfSl9DWNd', // Category (text)
  category: 'fldhofDtTtJqWXLuf', // Category
  status: 'fld2OFKbXPhO2NQRx', // Status
  logoForCards: 'fldIuProl6IeG0wH2', // Logo (for cards)
  logoForMap: 'fldua2ISy01Yntwof', // Logo (for map)
  link: 'fldOilqj9tDwl70Rp', // Link
  shortUrl: 'fldSLQDvullnrvmut', // Short URL
  dateAdded: 'fldx8pSG2rP7pRRZf', // Date added
  x: 'fld2FlBMPjxhjGuFO', // x
  y: 'fldkAQPZaibRGawVw', // y
  scale: 'fldw2bKsCY0VdTCN6', // Scale
  publish: 'fldCCQ2OYlQluuarR', // Publish?
  hide: 'fldKwedEOWPFuWSe7', // Hide?
  lastModified: 'fld9nL9mSDBN0kaO4', // Last modified
} as const

export interface MapOrg {
  id: string
  dateAdded: string | null
  lastModified: string | null
  title: string
  tooltipTitle: string
  shortName: string | null
  description: string
  category: string
  status: string
  logo: string | null
  mapLogo: string | null
  link: string
  shortUrl: string | null
  x: number | null
  y: number | null
  scale: string | null
  isMagic: boolean
}

export interface MapData {
  records: MapOrg[]
  suggestEntryLink: string
  suggestCorrectionLink: string
}

const FIELD_LIST = [
  FIELD.longName,
  FIELD.longNameForCards,
  FIELD.shortName,
  FIELD.description,
  FIELD.categoryText,
  FIELD.category,
  FIELD.status,
  FIELD.logoForCards,
  FIELD.logoForMap,
  FIELD.link,
  FIELD.shortUrl,
  FIELD.dateAdded,
  FIELD.x,
  FIELD.y,
  FIELD.scale,
  FIELD.lastModified,
]

// Sort order is hardcoded so the Airtable view sort can be changed freely
// without affecting how cards are displayed on /map.
const STATUS_ORDER = ['Active', 'Inactive']
const SCALE_ORDER_LARGE_FIRST = ['Large', 'Medium', 'Small']
const CATEGORY_ORDER = [
  'Advocacy',
  'Blog',
  'Capabilities research',
  'Career support',
  'Conceptual research',
  'Empirical research',
  'Forecasting',
  'Funding',
  'Governance',
  'Newsletter',
  'Podcast',
  'Research support',
  'Resource',
  'Strategy',
  'Training and education',
  'Video',
  'No longer active',
]

function rankIn(value: string | null | undefined, order: string[]): number {
  if (!value) return order.length + 1
  const idx = order.indexOf(value)
  return idx === -1 ? order.length : idx
}

// Multi-select sort: compare categories in selection order (not sorted),
// using each option's index in CATEGORY_ORDER as the rank, then compare
// lexicographically. Records with fewer categories sort first when the
// prefix is equal — matches Airtable's multi-select sort behavior.
function categoryIndices(category: string): number[] {
  if (!category) return [CATEGORY_ORDER.length + 1]
  return category
    .split(',')
    .map(c => c.trim())
    .filter(Boolean)
    .map(c => {
      const i = CATEGORY_ORDER.indexOf(c)
      return i === -1 ? CATEGORY_ORDER.length : i
    })
}

function compareCategoryIndices(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/** One Airtable row (fields keyed by field id) as the map shows it, or null
 *  when the map would skip it (no title or no description). Shared with the
 *  admin queue's card preview. */
export function mapOrgFromRecord(record: AirtableRawRecord): MapOrg | null {
  const f = record.fields

  const title =
    fieldString(f[FIELD.longNameForCards]) || fieldString(f[FIELD.longName])
  const description = fieldString(f[FIELD.description])
  if (!title || !description) return null

  const isMagic = MAGIC_ROW_NAMES.includes(title)
  const link = fieldString(f[FIELD.link])

  const category =
    fieldString(f[FIELD.categoryText]) ||
    fieldStringArray(f[FIELD.category]).join(', ')

  // QA: 'Long name for cards' includes acronyms in brackets (e.g. "CARMA"),
  // which is correct for card titles but not for the map tooltip. The tooltip
  // should use 'Long name' (without brackets), matching the live site's LongLabel.
  const tooltipTitle = fieldString(f[FIELD.longName]) || title

  return {
    id: record.id,
    dateAdded: record.createdTime?.slice(0, 10) ?? null,
    lastModified: fieldDateOnly(f[FIELD.lastModified]),
    title,
    tooltipTitle,
    shortName: fieldString(f[FIELD.shortName]),
    description,
    category,
    status: fieldString(f[FIELD.status]) || 'Active',
    logo: fieldAttachmentUrl(f[FIELD.logoForCards]),
    mapLogo: fieldAttachmentUrl(f[FIELD.logoForMap]),
    link: link || '#',
    shortUrl: fieldString(f[FIELD.shortUrl]),
    x: fieldNumber(f[FIELD.x]),
    y: fieldNumber(f[FIELD.y]),
    scale: fieldString(f[FIELD.scale]),
    isMagic,
  }
}

export async function getMapData(): Promise<MapData> {
  if (!hasAirtableCredentials()) {
    // The public collection excludes the magic control rows (Merch, Last
    // updated, Suggest entry/correction), so those cards don't appear in
    // contributor mode and the suggest links use the defaults below.
    const orgs = await fetchPublicData<Omit<MapOrg, 'isMagic'>>('organizations')
    return {
      records: orgs.map(org => ({ ...org, isMagic: false })),
      suggestEntryLink: '/map/suggest',
      suggestCorrectionLink: '#',
    }
  }

  const raw = await fetchAirtableRecords({
    tableId: TABLE_ID,
    viewId: VIEW_ID,
    // Explicit publish gate so we never depend on the view's filter config to
    // keep unpublished orgs out of the data (and therefore out of the chatbot
    // catalog). The page's magic control rows (Last updated, Suggest entry,
    // etc.) are all published, so they pass this filter unaffected.
    filterByFormula: publishedFormula(FIELD.publish, FIELD.hide),
    returnFieldsByFieldId: true,
    fields: FIELD_LIST,
  })

  const allRecords: MapOrg[] = []
  let suggestEntryLink = '/map/suggest'
  let suggestCorrectionLink = '#'

  for (const record of raw) {
    const org = mapOrgFromRecord(record)
    if (!org) continue
    if (org.title === 'Suggest entry' && org.link !== '#') {
      suggestEntryLink = org.link
    } else if (org.title === 'Suggest correction' && org.link !== '#') {
      suggestCorrectionLink = org.link
    }
    allRecords.push(org)
  }

  allRecords.sort((a, b) => {
    if (a.isMagic !== b.isMagic) return a.isMagic ? 1 : -1

    const statusDiff =
      rankIn(a.status, STATUS_ORDER) - rankIn(b.status, STATUS_ORDER)
    if (statusDiff !== 0) return statusDiff

    const scaleDiff =
      rankIn(a.scale, SCALE_ORDER_LARGE_FIRST) -
      rankIn(b.scale, SCALE_ORDER_LARGE_FIRST)
    if (scaleDiff !== 0) return scaleDiff

    const catDiff = compareCategoryIndices(
      categoryIndices(a.category),
      categoryIndices(b.category)
    )
    if (catDiff !== 0) return catDiff

    return a.title.localeCompare(b.title)
  })

  return {
    records: allRecords,
    suggestEntryLink,
    suggestCorrectionLink,
  }
}
