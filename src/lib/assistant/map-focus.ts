/**
 * On the Field map, a chatbot reply that shows a card for an organization on
 * the map moves the map to it, the same way the map's own search does (Søren's
 * request in the feature matrix, 22 Nov 2026). The chatbot announces the first
 * such organization with this window event; the map listens for it.
 */
export const MAP_FOCUS_EVENT = 'aisafety:map-focus'

export interface MapFocusDetail {
  /** Airtable record id of the organization (`rec…`). */
  id: string
}

// `[[card:org:recXXX|note]]`, `[[id:org:recXXX]]`, and the forms the renderer
// forgives: no type (`[[card:recXXX]]`) or a doubled one (`org:org:`).
const TOKEN_RE =
  /\[\[\s*(?:card|id)\s*:\s*((?:[a-z][a-z-]*\s*:\s*)*)(rec[A-Za-z0-9]+)/gi

/**
 * The record id of the first map organization the reply shows as a card, or
 * null when it shows none. A token without a type counts when the turn's
 * search results have that id as an organization (`org:recXXX`).
 */
export function firstMapOrgId(
  answer: string,
  listings: { id: string; type: string }[]
): string | null {
  const orgIds = new Set(
    listings.filter(l => l.type === 'org').map(l => l.id.replace(/^org:/, ''))
  )
  for (const match of answer.matchAll(TOKEN_RE)) {
    const types = match[1]
      .split(':')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
    const id = match[2]
    if (types.length > 0 ? types.includes('org') : orgIds.has(id)) return id
  }
  return null
}
