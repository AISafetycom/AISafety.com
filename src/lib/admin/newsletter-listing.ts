/*
  "Also update the listing on the site": when Bryce rewrites a card's
  description on /admin/newsletter and ticks the box, the same text goes into
  the listing's Description in Airtable, so the site and the email say the
  same thing (Bryce, 25 Sept 2026: ask each time). A card's key is the
  Airtable record id Pen stamps on the item; the record can sit in the Events,
  Training or Funding table, so each is tried in turn.
*/

import { airtableRequest, isRecordId } from '@/lib/admin/airtable'
import { TABLE_ID as EVENTS_TABLE } from '@/lib/data/events'
import { TABLE_ID as FUNDING_TABLE } from '@/lib/data/funding'
import { TRAINING_TABLE_ID } from '@/lib/data/training'

/** Description field of each table the newsletters draw on — the same field
 *  ids src/lib/data/events.ts, training.ts and funding.ts read. */
const DESCRIPTION_FIELDS: Array<{ table: string; field: string }> = [
  { table: EVENTS_TABLE, field: 'fldAdLfIFJlJYD3Fm' },
  { table: TRAINING_TABLE_ID, field: 'fldIRngvk0vjSwjh8' },
  { table: FUNDING_TABLE, field: 'fldBm7ZehvD2anFg8' },
]

export type ListingUpdate =
  | { ok: true; table: string }
  | { ok: false; reason: string }

/** Write `description` (plain text) into the listing's Description and leave
 *  a record comment saying where the change came from. Never throws: the
 *  draft edit has already been saved when this runs, so a failure here is
 *  reported next to it, not instead of it. */
export async function updateListingDescription(
  recordId: string,
  description: string
): Promise<ListingUpdate> {
  if (!isRecordId(recordId))
    return { ok: false, reason: 'this card isn’t linked to a listing' }
  try {
    for (const { table, field } of DESCRIPTION_FIELDS) {
      const found = await airtableRequest(`${table}/${recordId}`)
      if (found.status === 404 || found.status === 403) continue
      if (!found.ok)
        return { ok: false, reason: `Airtable read failed (${found.status})` }
      const res = await airtableRequest(`${table}/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { [field]: description } }),
      })
      if (!res.ok)
        return {
          ok: false,
          reason:
            res.status === 429
              ? 'Airtable is rate-limiting right now; try again in a few seconds'
              : `Airtable refused the change (${res.status})`,
        }
      // The comment tells whoever looks at the record later where the change
      // came from. The description is already saved, so a failed comment is
      // logged, not reported as a failed update.
      const comment = await airtableRequest(`${table}/${recordId}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          text: 'Description updated from the newsletter editor',
        }),
      }).catch((err: unknown) => err)
      if (!(comment instanceof Response) || !comment.ok)
        console.warn(
          `[newsletter] comment on ${recordId} failed: ${
            comment instanceof Response ? comment.status : String(comment)
          }`
        )
      return { ok: true, table }
    }
    return { ok: false, reason: 'the listing wasn’t found in Airtable' }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}
