// A suggestion that takes over a listing already on the site (Bryce, 4 Oct
// 2026: "Fable should have put this one down for publishing and the old one
// changed to not publish", then "add the auto-unpublish too"). Fable Review
// ends a Publish verdict with "Replaces: <record id>" when the suggestion
// is a newer version of a listed org (a rebrand, a new name or link), and
// the Mac keeps it on the row's proposal as `replaces` (~/Queue,
// queue_lib.comb_item). The page shows a box above Publish, ticked by
// default; Publish then takes the old listing off the site and Undo puts it
// back (queue.ts). These are the pure parts, kept apart for the tests.

/** The listing a suggestion takes over. */
export interface ReplacesListing {
  table: string
  record: string
  name: string
  /** The resource page its table feeds ("/events"). */
  page: string | null
  /** The old record in Airtable. */
  url: string | null
}

/** What Publish changed on that listing, kept on the row (the Queue field
 *  "Replaced listing") so Undo can put it back as it was. */
export interface ReplacedListing extends ReplacesListing {
  publish: boolean
  hide: boolean
}

const TABLE_ID_RE = /^tbl[A-Za-z0-9]{14}$/
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** The proposal's `replaces` block, checked: null unless it names a table
 *  and a record by their ids. The link is kept only when it is Airtable's. */
export function replacesOf(v: unknown): ReplacesListing | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const table = text(o.table)
  const record = text(o.record)
  if (!table || !TABLE_ID_RE.test(table)) return null
  if (!record || !RECORD_ID_RE.test(record)) return null
  const url = text(o.url)
  return {
    table,
    record,
    name: text(o.name) ?? record,
    page: text(o.page),
    url: url && url.startsWith('https://airtable.com/') ? url : null,
  }
}

/** The row's "Replaced listing", read back from its JSON. */
export function replacedOf(v: unknown): ReplacedListing | null {
  const base = replacesOf(v)
  if (!base) return null
  const o = v as Record<string, unknown>
  return { ...base, publish: o.publish === true, hide: o.hide === true }
}

/** What Publish sends about the box: the record the page showed, when the
 *  box is ticked; nothing when it is unticked or there is no box. The
 *  server takes a listing off only when it is named here, so a page that
 *  never showed the box cannot do it. */
export function replaceOldOf(
  item: { type: string; replaces?: ReplacesListing | null },
  keepOld: boolean
): { replaceOld?: string } {
  return item.type === 'Add' && item.replaces && !keepOld
    ? { replaceOld: item.replaces.record }
    : {}
}

/** Why a Publish that names a listing to take off must wait: the row no
 *  longer names that one (Fable reviewed it again since the page loaded).
 *  Null when the page and the row agree. */
export function replacesChanged(
  shown: string | null,
  replaces: ReplacesListing | null | undefined
): string | null {
  if (shown === null || shown === replaces?.record) return null
  return replaces
    ? `This page showed a different listing to take off the site than the item names now (${replaces.name}). Check the box above Publish, then publish again.`
    : 'The item no longer names a listing to take off the site. Check it, then publish again.'
}

/** "the /events page", or "the site" when the page is not known. */
function where(page: string | null): string {
  return page ? page : 'the site'
}

/** The box's words before the listing's name, and after it. */
export function replaceBoxWords(old: ReplacesListing): [string, string] {
  return ['Also take', `off ${where(old.page)}`]
}

/** What the decision says once the old listing is off. */
export function tookOffNote(old: ReplacesListing): string {
  return `Took ${old.name} off ${where(old.page)}`
}

/** What the toast adds when Publish could not take the old listing off. */
export function stillOnNote(old: ReplacesListing): string {
  return `${old.name} is still on ${where(old.page)}`
}

/** The row's Error when the new listing went out and the old one stayed. */
export function notTakenOff(old: ReplacesListing, why: string): string {
  return `Published, but ${old.name} could not be taken off ${where(old.page)}: ${why}`.slice(
    0,
    1000
  )
}

/** The comments left on the old listing. */
export const TOOK_OFF_COMMENT =
  'Taken off the site from the Queue: a newer listing that replaces it was published.'
export const PUT_BACK_COMMENT =
  'Back on the site: the Queue Publish that replaced it was undone.'
