// Guards against the failure mode where a new Airtable table is added but
// never wired into the chatbot catalog (what happened with Events & training:
// the page existed as an Airtable embed, but the bot couldn't search it).
//
// Every table in the base must be declared here as either a RESOURCE_TABLE
// (browsable on a page AND searchable by the assistant) or an INTERNAL_TABLE
// (not user-facing). The /api/check-catalog cron compares this declaration
// against the live base and flags anything unaccounted for, so a missing
// "doorway" is caught here instead of by a confused user.
//
// When you add a resource table: add an entry below, create its data source
// (src/lib/data/<x>.ts), wire it into buildCatalog (src/lib/assistant/catalog.ts),
// add its page to PAGES (src/lib/assistant/pages.ts), and add the type to the
// search_listings tool enum (src/lib/assistant/tools.ts).

import { PAGES } from './pages'
import type { ListingType } from './types'

export interface ResourceTable {
  tableId: string
  tableName: string
  /** Catalog id prefix this table maps to (e.g. 'event' for event:rec...). */
  catalogType: ListingType
  /** Resource page that renders this table. Must exist in PAGES. */
  pagePath: string
}

/** Airtable tables the assistant searches and that have a browsable page. */
export const RESOURCE_TABLES: ResourceTable[] = [
  {
    tableId: 'tblyLelYCQjP6w3nV',
    tableName: 'Jobs',
    catalogType: 'job',
    pagePath: '/jobs',
  },
  {
    tableId: 'tblzMTLDZWZKqTxrq',
    tableName: 'Funding',
    catalogType: 'funder',
    pagePath: '/funding',
  },
  {
    tableId: 'tblf3KKYnmgcjVGhD',
    tableName: 'Advisors',
    catalogType: 'advisor',
    pagePath: '/advisors',
  },
  {
    tableId: 'tbluI5Dll697WiSm8',
    tableName: 'Communities',
    catalogType: 'community',
    pagePath: '/communities',
  },
  {
    tableId: 'tblRNYJ0m1cmJXKKk',
    tableName: 'Self-study',
    catalogType: 'course',
    pagePath: '/self-study',
  },
  {
    tableId: 'tbl59Ye8oxvPjoVJv',
    tableName: 'Founder toolkit',
    catalogType: 'founder-resource',
    pagePath: '/founders',
  },
  {
    tableId: 'tblHT29QNgMYKB8iW',
    tableName: 'Projects',
    catalogType: 'project',
    pagePath: '/projects',
  },
  {
    tableId: 'tblCTOMzyH3vILL5I',
    tableName: 'Media channels',
    catalogType: 'media-channel',
    pagePath: '/media-channels',
  },
  {
    tableId: 'tblvzbGL9q9dOO9Nc',
    tableName: 'Map',
    catalogType: 'org',
    pagePath: '/map',
  },
  {
    tableId: 'tblXbN9swwldwq8f7',
    tableName: 'Events',
    catalogType: 'event',
    pagePath: '/events',
  },
  {
    tableId: 'tbli1YSCpIuNY2DvL',
    tableName: 'Training',
    catalogType: 'training',
    pagePath: '/training',
  },
  {
    tableId: 'tblEEIbj6dW5oS4cX',
    tableName: 'Training (recurring)',
    catalogType: 'training',
    pagePath: '/training',
  },
]

/** Non-user-facing tables (logs, feedback, internal metadata). Declared so the
 *  coverage check can tell "internal" apart from "resource table we forgot". */
export const INTERNAL_TABLES: { tableId: string; tableName: string }[] = [
  { tableId: 'tblntD3WITPEgjHRK', tableName: 'Broom: issues' },
  { tableId: 'tblKCBrIxCVIh1lwU', tableName: 'CC Log' },
  { tableId: 'tbloCqIUb9O6vtWf0', tableName: 'Assistant: conversations' },
  { tableId: 'tblPVbkRSV3qNEB5U', tableName: 'Advisors: reviews' },
  { tableId: 'tblzTFjkQ4v7G6saq', tableName: 'Site feedback' },
  { tableId: 'tblKm44KngUDniaDR', tableName: 'Site corrections' },
  { tableId: 'tblHxEuvRUlQ5e3KQ', tableName: 'Contact' },
  { tableId: 'tblonlKwIFJ7Aa8QN', tableName: 'Queue' },
]

export interface CoverageResult {
  ok: boolean
  /** Human-readable problems, each actionable. Empty when everything lines up. */
  issues: string[]
}

/** Cross-checks the declared registry against the live table list. Pure — pass
 *  the tables fetched from the Airtable meta API. */
export function checkCatalogCoverage(
  liveTables: { id: string; name: string }[]
): CoverageResult {
  const issues: string[] = []
  const liveById = new Map(liveTables.map(t => [t.id, t.name]))
  const knownIds = new Set([
    ...RESOURCE_TABLES.map(t => t.tableId),
    ...INTERNAL_TABLES.map(t => t.tableId),
  ])
  const pagePaths = new Set(PAGES.map(p => p.path))

  // 1. A live table we haven't accounted for — the events-style gap.
  for (const t of liveTables) {
    if (!knownIds.has(t.id)) {
      issues.push(
        `Unaccounted Airtable table "${t.name}" (${t.id}). Wire it into the chatbot catalog and add it to RESOURCE_TABLES, or add it to INTERNAL_TABLES if it isn't user-facing.`
      )
    }
  }

  // 2. A declared resource table that's gone from the base (renamed/deleted).
  for (const t of RESOURCE_TABLES) {
    if (!liveById.has(t.tableId)) {
      issues.push(
        `Resource table "${t.tableName}" (${t.tableId}) is no longer in the base — renamed or deleted. Update RESOURCE_TABLES and its data source.`
      )
    }
  }

  // 3. A declared internal table that's gone (lower priority, but worth noting).
  for (const t of INTERNAL_TABLES) {
    if (!liveById.has(t.tableId)) {
      issues.push(
        `Internal table "${t.tableName}" (${t.tableId}) is no longer in the base. Remove it from INTERNAL_TABLES.`
      )
    }
  }

  // 4. A resource table whose page isn't registered in PAGES (no nav/doorway).
  for (const t of RESOURCE_TABLES) {
    if (!pagePaths.has(t.pagePath)) {
      issues.push(
        `Resource table "${t.tableName}" points at page ${t.pagePath}, which is missing from PAGES (src/lib/assistant/pages.ts).`
      )
    }
  }

  return { ok: issues.length === 0, issues }
}
