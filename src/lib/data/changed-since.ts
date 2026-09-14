import { fetchAirtableWithRetry, type FetchRetryOptions } from './airtable'

// Uses LAST_MODIFIED_TIME() (a formula function) rather than any table's
// "Last modified" field. The field may be configured as date-only, which
// collapses intra-day edits to midnight UTC and hides same-day changes from
// a later-that-day build. LAST_MODIFIED_TIME() always returns a full
// timestamp regardless of how the field is displayed.
//
// Shared by /api/check-rebuild (deploy trigger) and /api/admin/preview/changed
// (preview mode's auto-refresh), so both detect edits the same way.
export async function hasChangesSince(
  baseId: string,
  token: string,
  tableId: string,
  since: Date,
  filter?: string,
  retry?: FetchRetryOptions
): Promise<boolean> {
  const sinceIso = since.toISOString()
  const timeCheck = `IS_AFTER(LAST_MODIFIED_TIME(), DATETIME_PARSE("${sinceIso}"))`
  const formula = filter ? `AND(${filter}, ${timeCheck})` : timeCheck

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`)
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('maxRecords', '1')

  const response = await fetchAirtableWithRetry(
    url.toString(),
    token,
    { cache: 'no-store' },
    retry
  )

  if (!response.ok) {
    throw new Error(
      `Airtable fetch failed for ${tableId}: ${response.status} ${response.statusText}`
    )
  }

  const data = await response.json()
  return (data.records?.length ?? 0) > 0
}
