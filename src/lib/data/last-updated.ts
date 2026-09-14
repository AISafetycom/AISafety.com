import { DONATION_GUIDE_LAST_UPDATED } from '@/lib/donation-guide-date'
import { formatDate } from '@/lib/format-date'
import { fetchAirtableWithRetry } from './airtable'
import { isPreviewRequest, shareLiveRead } from '@/lib/preview'

// All field references below use permanent field IDs (rename-proof); the
// requests set returnFieldsByFieldId so responses are keyed the same way.

type QueryConfig = {
  type: 'query'
  tableId: string
  viewId?: string
  filter?: string
  sortField: string
}

type RecordConfig = {
  type: 'record'
  tableId: string
  recordId: string
  dateField: string
}

type ConstantConfig = {
  type: 'constant'
  value: string
}

// For pages that draw from several tables; resolves to the latest edit
// across all of them.
type MultiQueryConfig = {
  type: 'multi'
  queries: Omit<QueryConfig, 'type'>[]
}

type ResourceConfig =
  | QueryConfig
  | RecordConfig
  | ConstantConfig
  | MultiQueryConfig

const configs: Record<string, ResourceConfig> = {
  events: {
    type: 'query',
    tableId: 'tblXbN9swwldwq8f7',
    filter: '{flddgpgNm090Uftsq} = TRUE()', // Publish?
    sortField: 'fldB3qONkXobywxmp', // Last modified
  },
  map: {
    type: 'record',
    tableId: 'tblvzbGL9q9dOO9Nc',
    recordId: 'recvDWyM9MW9q1GUj',
    dateField: 'fldUZfd5kQQP0DoOS', // Description
  },
  communities: {
    type: 'query',
    tableId: 'tbluI5Dll697WiSm8',
    filter: '{fldV8RYP1CVzOvHpf} = TRUE()', // Publish?
    sortField: 'fldcsXAugffjhKmEH', // Last modified
  },
  'self-study': {
    type: 'query',
    tableId: 'tblRNYJ0m1cmJXKKk',
    viewId: 'viwblgaia3x1gsqBo',
    sortField: 'fld4gwoM3vldhbyiE', // Last modified
  },
  training: {
    type: 'multi',
    queries: [
      {
        tableId: 'tbli1YSCpIuNY2DvL', // Training
        filter: '{fldqlN36P6BVFP151} = TRUE()', // Publish?
        sortField: 'fldG0Cn6ozrw0c0N9', // Last modified
      },
      {
        tableId: 'tblEEIbj6dW5oS4cX', // Training (recurring)
        filter: '{fldpjcvh7n6w4cIsi} = TRUE()', // Publish?
        sortField: 'fldq0bMboXuM1lYX4', // Last modified
      },
    ],
  },
  jobs: {
    type: 'query',
    tableId: 'tblyLelYCQjP6w3nV',
    viewId: 'viwDXZcviPykFzt4g',
    sortField: 'fldo9SdkQLyzUI9yp', // Date published
  },
  funding: {
    type: 'query',
    tableId: 'tblzMTLDZWZKqTxrq',
    filter: '{fldoH88AbtQLEViD7} = TRUE()', // Publish?
    sortField: 'fldMZXYm96wdeq5jw', // Last modified
  },
  'media-channels': {
    type: 'query',
    tableId: 'tblCTOMzyH3vILL5I',
    filter: '{fldMN0TF3kz41HTQc} = TRUE()', // Publish?
    sortField: 'fldg46VoI3zwPRzXR', // Last modified
  },
  advisors: {
    type: 'query',
    tableId: 'tblf3KKYnmgcjVGhD',
    filter: '{fldaOmFd67ORPMfTC} = TRUE()', // Publish?
    sortField: 'fld8rTAfTkJBhnO0L', // Last modified
  },
  projects: {
    type: 'query',
    tableId: 'tblHT29QNgMYKB8iW',
    filter: '{fldrGDtZxpFLQfjMz} = TRUE()', // Publish?
    sortField: 'fld3KsLNUU3IGj5Gg', // Last modified
  },
  founders: {
    type: 'query',
    tableId: 'tbl59Ye8oxvPjoVJv',
    viewId: 'viwzMBhPBk1GpQXnn',
    filter: '{fld9Epdrxu9n0FV20} = TRUE()', // Publish?
    sortField: 'fldMM2jKZeORMO5mP', // Last modified
  },
  'donation-guide': {
    type: 'constant',
    value: DONATION_GUIDE_LAST_UPDATED,
  },
}

export const validResources = Object.keys(configs)

/** The table(s) whose records feed this resource's page — the polling
 *  targets for preview mode's auto-refresh (see /api/admin/preview/changed).
 *  Deliberately without the page's publish filter: preview must notice a
 *  record being unpublished, or a draft being published, just as much as an
 *  edit to a live record, and the odd extra refresh for a change to a draft
 *  is harmless. Empty when the page's content doesn't live in Airtable
 *  (/donation-guide). */
export function resourceTables(resource: string): string[] {
  const config = configs[resource]
  if (!config) throw new Error(`Unknown resource: '${resource}'`)
  if (config.type === 'constant') return []
  if (config.type === 'multi') return config.queries.map(q => q.tableId)
  return [config.tableId]
}

interface LastUpdatedResult {
  lastUpdated: string | null
  formattedDate: string | null
}

export async function fetchLastUpdated(
  resource: string
): Promise<LastUpdatedResult> {
  const config = configs[resource]
  if (!config) throw new Error(`Unknown resource: '${resource}'`)

  if (config.type === 'constant') {
    const date = new Date(config.value)
    return { lastUpdated: config.value, formattedDate: formatDate(date) }
  }

  const token = process.env.AIRTABLE_TOKEN
  const baseId = process.env.AIRTABLE_BASE_ID
  // Contributor mode: last-edit dates aren't in the public API, so pages
  // simply omit their "Updated X ago" line.
  if (!token || !baseId) return { lastUpdated: null, formattedDate: null }

  // Preview mode skips the hourly fetch cache, so the "Updated X ago" line
  // reflects the edit the admin just made (see src/lib/preview.ts); the
  // requests one page view fans out into share the read.
  if (await isPreviewRequest()) {
    return shareLiveRead(`last-updated:${resource}`, () =>
      readLastUpdated(config, resource, token, baseId, { cache: 'no-store' })
    )
  }
  return readLastUpdated(config, resource, token, baseId, {
    next: { revalidate: 3600 },
  })
}

async function readLastUpdated(
  config: Exclude<ResourceConfig, ConstantConfig>,
  resource: string,
  token: string,
  baseId: string,
  requestInit: RequestInit
): Promise<LastUpdatedResult> {
  if (config.type === 'record') {
    const response = await fetchAirtableWithRetry(
      `https://api.airtable.com/v0/${baseId}/${config.tableId}/${config.recordId}?returnFieldsByFieldId=true`,
      token,
      requestInit
    )
    if (!response.ok)
      throw new Error(
        `Airtable fetch failed for '${resource}': ${response.status} ${response.statusText}`
      )

    const record = await response.json()
    const dateStr = record.fields?.[config.dateField]
    if (!dateStr) return { lastUpdated: null, formattedDate: null }

    const date = new Date(dateStr as string)
    if (isNaN(date.getTime()))
      throw new Error(
        `Invalid date in Airtable field '${config.dateField}' for resource '${resource}': "${dateStr}"`
      )
    return {
      lastUpdated: date.toISOString(),
      formattedDate: formatDate(date),
    }
  }

  if (config.type === 'multi') {
    const results = await Promise.all(
      config.queries.map(query =>
        fetchQueryLastUpdated(query, resource, token, baseId, requestInit)
      )
    )
    const dated = results.filter(r => r.lastUpdated !== null)
    if (dated.length === 0) return { lastUpdated: null, formattedDate: null }
    return dated.reduce((a, b) => (a.lastUpdated! >= b.lastUpdated! ? a : b))
  }

  return fetchQueryLastUpdated(config, resource, token, baseId, requestInit)
}

async function fetchQueryLastUpdated(
  config: Omit<QueryConfig, 'type'>,
  resource: string,
  token: string,
  baseId: string,
  requestInit: RequestInit
): Promise<LastUpdatedResult> {
  const url = new URL(`https://api.airtable.com/v0/${baseId}/${config.tableId}`)
  if (config.viewId) url.searchParams.set('view', config.viewId)
  if (config.filter) url.searchParams.set('filterByFormula', config.filter)
  url.searchParams.set('sort[0][field]', config.sortField)
  url.searchParams.set('sort[0][direction]', 'desc')
  url.searchParams.set('maxRecords', '1')
  url.searchParams.set('fields[]', config.sortField)
  url.searchParams.set('returnFieldsByFieldId', 'true')

  const response = await fetchAirtableWithRetry(
    url.toString(),
    token,
    requestInit
  )
  if (!response.ok)
    throw new Error(
      `Airtable fetch failed for '${resource}': ${response.status} ${response.statusText}`
    )

  const data = await response.json()
  if (data.records?.length > 0) {
    const dateValue = data.records[0].fields[config.sortField]
    if (dateValue) {
      const date = new Date(dateValue as string)
      if (isNaN(date.getTime()))
        throw new Error(
          `Invalid date in Airtable field '${config.sortField}' for resource '${resource}': "${dateValue}"`
        )
      return {
        lastUpdated: date.toISOString(),
        formattedDate: formatDate(date),
      }
    }
  }

  return { lastUpdated: null, formattedDate: null }
}

// Serialized to avoid hitting Airtable's 5 req/sec rate limit.
// Called at build time (static generation) so latency doesn't matter.
export async function fetchAllLastUpdated(): Promise<
  Record<string, string | null>
> {
  const result: Record<string, string | null> = {}
  for (const name of validResources) {
    const data = await fetchLastUpdated(name)
    result[name] = data.lastUpdated
  }
  return result
}
