/*
  "Also update the listing on the site": when Bryce rewrites a card's
  description on /admin/newsletter and ticks the box, the same text goes into
  the listing's Description in Airtable, so the site and the email say the
  same thing (Bryce, 25 Sept 2026: ask each time). A card's key is the
  Airtable record id Pen stamps on the item; the record can sit in the Events,
  Training or Funding table. Airtable answers a record id through ANY table of
  the base (a Training record read through the Events table comes back fine),
  so the table is told apart by which table's Name field the record carries —
  the first version guessed Events and got a 422 on a Training listing.
*/

import { airtableRequest, isRecordId } from '@/lib/admin/airtable'
import { TABLE_ID as EVENTS_TABLE } from '@/lib/data/events'
import { TABLE_ID as FUNDING_TABLE } from '@/lib/data/funding'
import { TRAINING_TABLE_ID } from '@/lib/data/training'

/** The tables the newsletters draw on: each one's Name field (always filled,
 *  so it identifies the table) and Description field — the same field ids
 *  src/lib/data/events.ts, training.ts and funding.ts read. */
const TABLES: Array<{ table: string; name: string; description: string }> = [
  {
    table: EVENTS_TABLE,
    name: 'fldHDwWtiBFYN9fgf',
    description: 'fldAdLfIFJlJYD3Fm',
  },
  {
    table: TRAINING_TABLE_ID,
    name: 'fldNq08J2QqQ8SreD',
    description: 'fldIRngvk0vjSwjh8',
  },
  {
    table: FUNDING_TABLE,
    name: 'fldsFpgVduYnNuYkN',
    description: 'fldBm7ZehvD2anFg8',
  },
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
    // Any table's URL reads the record; the field ids it comes back with say
    // which table it really belongs to.
    const found = await airtableRequest(
      `${TABLES[0].table}/${recordId}?returnFieldsByFieldId=true`
    )
    if (found.status === 404 || found.status === 403)
      return { ok: false, reason: 'the listing wasn’t found in Airtable' }
    if (!found.ok)
      return { ok: false, reason: `Airtable read failed (${found.status})` }
    const record = (await found.json()) as { fields?: Record<string, unknown> }
    const home = TABLES.find(t => record.fields?.[t.name] !== undefined)
    if (!home)
      return {
        ok: false,
        reason: 'the listing isn’t in the Events, Training or Funding table',
      }
    const { table } = home
    const res = await airtableRequest(`${table}/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { [home.description]: description } }),
    })
    if (!res.ok)
      return {
        ok: false,
        reason:
          res.status === 429
            ? 'Airtable is rate-limiting right now; try again in a few seconds'
            : `Airtable refused the change (${res.status}: ${(
                await res.text()
              ).slice(0, 200)})`,
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
  } catch (err) {
    // The page gets a plain line; what went wrong stays in the server log.
    console.error(
      `[newsletter] listing update ${recordId} failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return {
      ok: false,
      reason: 'Airtable couldn’t be reached; details are in the server log',
    }
  }
}
