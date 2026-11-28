// Which of a record's fields the Queue page shows.
//
// The page lists a listing's fields for the person deciding: every column
// but Airtable's own bookkeeping (by name) and anything Airtable computes
// (formulas, lookups, counts, timestamps, by type) – Bryce, 11 Sept 2026:
// "only the fields I may plausibly want to edit". The site goes by the
// same two rules when it works out what a page showed of an addition's
// record (queue-shown.ts), so they live here, where both read them. Pure.

/** Airtable's bookkeeping columns, by name. */
export const HOUSEKEEPING =
  /^(created|date added|last modified|created time|record id|submitter's email)$/i

/** The field types Airtable computes: nobody edits these. */
export const COMPUTED_TYPES = new Set([
  'formula',
  'rollup',
  'lookup',
  'multipleLookupValues',
  'count',
  'autoNumber',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'button',
])

/** Whether the page shows this field of a record. `type` is the field's
 *  Airtable type, or nothing when the table's field list is not known. */
export function pageShowsField(name: string, type?: string | null): boolean {
  return !HOUSEKEEPING.test(name) && !COMPUTED_TYPES.has(type ?? '')
}
