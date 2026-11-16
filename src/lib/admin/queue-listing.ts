import type { AttachmentInfo, FieldInfo } from './queue'

// A listing found by its record id from the Queue's search box (Bryce,
// 16 Nov 2026: "Let's make searching Q for a record ID come up with that
// listing"). A note from Fable names the listings it compared by id, and
// most of them have nothing waiting in the Queue: the published round of a
// program, an older listing a new one might duplicate. The page reads the
// listing itself and shows it, whatever the Queue holds.

/** Where a listing stands: on the site, a suggestion nobody has published
 *  yet, or hidden (archived). */
export type ListingState = 'published' | 'unpublished' | 'hidden'

export interface FoundListing {
  table: string
  record: string
  /** The resource page its table feeds. */
  page: string
  /** Its name column; empty when the record has none. */
  name: string
  state: ListingState
  /** The record in Airtable; null with no base configured. The link is
   *  built on the server, since the base id stays out of this repository. */
  airtable: string | null
  /** The record as it is now, keyed by field name (pictures as links). */
  fields: Record<string, unknown>
  attachments: Record<string, AttachmentInfo[]>
  schema: FieldInfo[]
}

/** Read off the record's two boxes: Hide? outranks Publish?, as on the
 *  site, which shows a record only with Publish? ticked and Hide? not. */
export function listingState(fields: Record<string, unknown>): ListingState {
  if (fields['Hide?'] === true) return 'hidden'
  return fields['Publish?'] === true ? 'published' : 'unpublished'
}

export const LISTING_STATE_LABEL: Record<ListingState, string> = {
  published: 'Published',
  unpublished: 'Not published',
  hidden: 'Hidden',
}

/** What each state means, for the tag's tooltip. */
export const LISTING_STATE_NOTE: Record<ListingState, string> = {
  published: 'On the site now',
  unpublished: 'A suggestion nobody has published',
  hidden: 'Hidden from the site (archived)',
}

// Recurring programs live under /training's "recurring" view.
const RECURRING_TABLE = 'tblEEIbj6dW5oS4cX'

/** The page as the Queue words it: recurring programs say so. */
export function listingPageLabel(
  listing: Pick<FoundListing, 'table' | 'page'>
): string {
  return listing.table === RECURRING_TABLE
    ? `${listing.page} (recurring)`
    : listing.page
}

/** The live page, landing on the listing's card (every site card carries
 *  its record id as an anchor); null for a listing the site does not show. */
export function listingSiteUrl(
  listing: Pick<FoundListing, 'table' | 'record' | 'page' | 'state'>
): string | null {
  if (listing.state !== 'published') return null
  const view = listing.table === RECURRING_TABLE ? '?view=recurring' : ''
  return `https://aisafety.com${listing.page}${view}#${listing.record}`
}
