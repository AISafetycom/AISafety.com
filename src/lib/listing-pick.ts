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
  /** Its logo, as the site search shows it. */
  logo: string | null
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

/** The Resource choice a listing falls under: a training program from the
 *  recurring list has a choice of its own. A browser can hold a copy of the
 *  index from before entries were marked recurring (it keeps one for an
 *  hour), so a recurring program is also known by its details, which start
 *  with "Recurring" (getTrainingEntries in search-index.ts). */
function resourceOf(e: SearchEntry): string | undefined {
  const recurring = e.recurring ?? e.category.startsWith('Recurring')
  if (e.type === 'training' && recurring) return 'Recurring training programs'
  return RESOURCE_FOR_TYPE[e.type]
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
    const r = resourceOf(e)
    if (!r || !e.id) continue
    if (resource && r !== resource) continue
    const key = `${r}\n${e.title.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: e.id, title: e.title, resource: r, logo: e.logo })
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
