// The corrections form's "Which listing?" box: the listings a visitor can
// pick from (the site search's index, /api/search-index), and which one the
// typed name is. Pure: no fetch, no DOM.

import type { SearchEntry, SearchType } from '@/lib/data/search-index'

/** A listing the corrections form can name. */
export interface PickableListing {
  /** Its Airtable record id. */
  id: string
  title: string
  /** The corrections table's Resource choice for its page. */
  resource: string
}

// The corrections table's Resource choice for each kind of listing in the
// search index. Jobs come from 80,000 Hours, so they aren't corrected here.
const RESOURCE_FOR_TYPE: Partial<Record<SearchType, string>> = {
  event: 'Events',
  training: 'Training programs',
  map: 'Field map',
  community: 'Communities',
  course: 'Self-study',
  funder: 'Funding',
  media: 'Media channels',
  advisor: 'Advisors',
  founder: 'Founder toolkit',
}

/** The Resource choice a listing of this kind falls under. Both training
 *  choices (upcoming and recurring) list every training program. */
function sameResource(a: string, b: string): boolean {
  const training = (r: string) =>
    r.startsWith('Training') || r.startsWith('Recurring training')
  return a === b || (training(a) && training(b))
}

/** The listings the form offers, on one page's choice or on all of them,
 *  each title once per page. */
export function pickableListings(
  index: readonly SearchEntry[],
  resource?: string
): PickableListing[] {
  const seen = new Set<string>()
  const out: PickableListing[] = []
  for (const e of index) {
    const r = RESOURCE_FOR_TYPE[e.type]
    if (!r || !e.id) continue
    if (resource && !sameResource(r, resource)) continue
    const key = `${r}\n${e.title.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: e.id, title: e.title, resource: r })
  }
  return out
}

/** The listing a typed name is: the one with that exact title (ignoring
 *  case and spaces at the ends). 'ambiguous' when listings on more than one
 *  page share it, so the page has to be chosen first. */
export function findListing(
  listings: readonly PickableListing[],
  name: string
): PickableListing | 'ambiguous' | undefined {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return undefined
  const matches = listings.filter(l => l.title.toLowerCase() === wanted)
  if (matches.length === 0) return undefined
  if (new Set(matches.map(m => m.resource)).size > 1) return 'ambiguous'
  return matches[0]
}
