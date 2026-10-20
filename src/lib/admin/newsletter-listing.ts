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

  Removing a card (9 Oct 2026) clears the listing's Newsletter tick, Pen's
  rule for an item Bryce drops during review: Pen picks listings with the tick
  clear, so it can go in a later issue.
*/

import { airtableRequest, isRecordId } from '@/lib/admin/airtable'
import { TABLE_ID as EVENTS_TABLE } from '@/lib/data/events'
import { TABLE_ID as FUNDING_TABLE } from '@/lib/data/funding'
import { TRAINING_TABLE_ID } from '@/lib/data/training'

/** The tables the newsletters draw on: each one's Name field (always filled,
 *  so it identifies the table), Description field — the same field ids
 *  src/lib/data/events.ts, training.ts and funding.ts read — and Newsletter
 *  tick (Pen's; Funding has none: Pen tracks its issues by snapshot). */
const TABLES: Array<{
  table: string
  name: string
  description: string
  newsletter: string | null
}> = [
  {
    table: EVENTS_TABLE,
    name: 'fldHDwWtiBFYN9fgf',
    description: 'fldAdLfIFJlJYD3Fm',
    newsletter: 'fldRdDbcWhCsoLrQj',
  },
  {
    table: TRAINING_TABLE_ID,
    name: 'fldNq08J2QqQ8SreD',
    description: 'fldIRngvk0vjSwjh8',
    newsletter: 'fldirVkgSCVk726Di',
  },
  {
    table: FUNDING_TABLE,
    name: 'fldsFpgVduYnNuYkN',
    description: 'fldBm7ZehvD2anFg8',
    newsletter: null,
  },
]

/** The listing behind a card key: its table and its fields (only filled
 *  ones — Airtable leaves out an unticked box), or why there is none
 *  (`elsewhere`: the card isn't a newsletter table's listing at all, like a
 *  callout card for a /map organization). */
async function findListing(
  recordId: string
): Promise<
  | { home: (typeof TABLES)[number]; fields: Record<string, unknown> }
  | { missing: string; elsewhere: boolean }
> {
  if (!isRecordId(recordId))
    return { missing: 'this card isn’t linked to a listing', elsewhere: true }
  // Any table's URL reads the record; the field ids it comes back with say
  // which table it really belongs to.
  const found = await airtableRequest(
    `${TABLES[0].table}/${recordId}?returnFieldsByFieldId=true`
  )
  if (found.status === 404 || found.status === 403)
    return { missing: 'the listing wasn’t found in Airtable', elsewhere: false }
  if (!found.ok)
    return {
      missing: `Airtable read failed (${found.status})`,
      elsewhere: false,
    }
  const record = (await found.json()) as { fields?: Record<string, unknown> }
  const fields = record.fields ?? {}
  const home = TABLES.find(t => fields[t.name] !== undefined)
  if (!home)
    return {
      missing: 'the listing isn’t in the Events, Training or Funding table',
      elsewhere: true,
    }
  return { home, fields }
}

/** Airtable's answer to a write, as a line for the page. */
async function refusal(res: Response): Promise<string> {
  return res.status === 429
    ? 'Airtable is rate-limiting right now; try again in a few seconds'
    : `Airtable refused the change (${res.status}: ${(await res.text()).slice(
        0,
        200
      )})`
}

/** Leave a comment on the record saying where a change came from. The change
 *  is already saved, so a failed comment is logged, not reported. */
async function noteOnRecord(table: string, recordId: string, text: string) {
  const comment = await airtableRequest(`${table}/${recordId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  }).catch((err: unknown) => err)
  if (!(comment instanceof Response) || !comment.ok)
    console.warn(
      `[newsletter] comment on ${recordId} failed: ${
        comment instanceof Response ? comment.status : String(comment)
      }`
    )
}

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
  try {
    const found = await findListing(recordId)
    if ('missing' in found) return { ok: false, reason: found.missing }
    const { table, description: field } = found.home
    const res = await airtableRequest(`${table}/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { [field]: description } }),
    })
    if (!res.ok) return { ok: false, reason: await refusal(res) }
    // The comment tells whoever looks at the record later where the change
    // came from.
    await noteOnRecord(
      table,
      recordId,
      'Description updated from the newsletter editor'
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

export type NewsletterTickUpdate =
  /** The tick was cleared. */
  | { status: 'unticked' }
  /** Nothing to clear: why (not a listing, Funding, or not ticked). */
  | { status: 'none'; why: string }
  | { status: 'failed'; reason: string }

/** Clear the Newsletter tick of the listing behind a card that was removed
 *  from a draft, and leave a record comment saying why. Never throws: the
 *  card is already out of the email when this runs, so a failure here is
 *  reported next to the removal, not instead of it. */
export async function untickNewsletter(
  recordId: string
): Promise<NewsletterTickUpdate> {
  try {
    const found = await findListing(recordId)
    if ('missing' in found)
      return found.elsewhere
        ? { status: 'none', why: found.missing }
        : { status: 'failed', reason: found.missing }
    const { table, newsletter } = found.home
    if (!newsletter)
      return { status: 'none', why: 'Funding listings have no Newsletter tick' }
    if (found.fields[newsletter] !== true)
      return { status: 'none', why: 'its Newsletter box wasn’t ticked' }
    const res = await airtableRequest(`${table}/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { [newsletter]: false } }),
    })
    if (!res.ok) return { status: 'failed', reason: await refusal(res) }
    await noteOnRecord(
      table,
      recordId,
      'Newsletter unticked: its card was removed from a newsletter draft'
    )
    return { status: 'unticked' }
  } catch (err) {
    console.error(
      `[newsletter] untick ${recordId} failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return {
      status: 'failed',
      reason: 'Airtable couldn’t be reached; details are in the server log',
    }
  }
}
