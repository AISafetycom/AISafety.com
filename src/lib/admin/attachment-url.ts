/*
  Airtable attachment links (v5.airtableusercontent.com) carry the moment
  they stop working as a 13-digit timestamp in the path, and last a few
  hours. Anything that keeps such a link for a while – the queue's card
  cache, a list row's logo – has to know when it has gone stale, or the
  picture quietly vanishes (a failed image is hidden, not shown broken).
  Shared by the server (queue.ts) and the browser (SitePreview).
*/

const EXPIRY_RE = /airtableusercontent\.com\/.*?\/(\d{13})\//

/** When the link stops working, in ms since the epoch; null when the URL
 *  is not an Airtable attachment link. */
export function attachmentExpiry(url: string): number | null {
  const m = EXPIRY_RE.exec(url)
  return m ? Number(m[1]) : null
}

/** True when an Airtable attachment link has expired or is about to (within
 *  `marginMs`, ten minutes by default). Any other URL never expires. */
export function isExpiredAttachment(
  url: string,
  marginMs = 10 * 60 * 1000,
  now = Date.now()
): boolean {
  const at = attachmentExpiry(url)
  return at !== null && at < now + marginMs
}
