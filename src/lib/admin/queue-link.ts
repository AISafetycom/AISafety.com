/*
  The link the S key opens on /admin/queue: the shown listing's own address.

  A Queue row is born with the link its listing had that day (`item.url`,
  the proposal's `url`). The listing can get a better one afterwards – from
  the Fable chat, from Airtable by hand – so the record as it reads NOW
  comes first, and the row's own copy is only what is left when the record
  has not been read yet or holds no link (Bryce, 12 Nov 2026, Fulcrum: the
  chat had swapped an EA Forum post for the program's own site and "when I
  press S, it still goes to the old link").
*/

/** Fields that hold a link, the listing's main one first: a Join or Apply
 *  link is only the answer when there is no URL, Website or Link. The same
 *  order as the Mac side's URL_FIELDS (~/Queue queue_lib.py). */
const LINK_FIELDS = [
  'url',
  'website',
  'link',
  'join link',
  'apply link',
  'application link',
]

/** A field name that holds a link (the Queue page shows these right under
 *  the name). */
export const URL_KEYS = new RegExp(`^(${LINK_FIELDS.join('|')})$`, 'i')

/** Pure: the link among these fields – the main one before a Join or
 *  Apply link – else null. Only a full http(s) address counts, so a link
 *  half typed on the page is passed over. */
export function linkIn(
  fields: Record<string, unknown> | null | undefined
): string | null {
  let found: string | null = null
  let rank = LINK_FIELDS.length
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (typeof v !== 'string' || !/^https?:\/\//.test(v)) continue
    const at = LINK_FIELDS.indexOf(k.trim().toLowerCase())
    if (at >= 0 && at < rank) {
      found = v
      rank = at
    }
  }
  return found
}

/** Pure: the listing's own link, newest knowledge first.
 *  1. `overrides` – what the item proposes and what was typed on the page:
 *     a Change that moves the link (a rename, a new domain) means the NEW
 *     address, as the card shows it (Bryce, 25 Sept 2026, Atlas Computing →
 *     Atlas Ignota: "S is going to the old link").
 *  2. `live` – the record as read from Airtable just now.
 *  3. `item.url` – the link the row was born with, or the site catalog's.
 *  4. `item.fields` – the snapshot the row was born with. */
export function listingLink(
  item: { url: string | null; fields: Record<string, unknown> | null },
  live: Record<string, unknown> | null | undefined,
  overrides: Record<string, unknown> = {}
): string | null {
  return (
    linkIn(overrides) ?? linkIn(live) ?? item.url ?? linkIn(item.fields) ?? null
  )
}
