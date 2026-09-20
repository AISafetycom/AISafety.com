import { RESOURCE_TABLES } from '@/lib/assistant/catalog-coverage'
import type { ListingType } from '@/lib/assistant/types'

// Neutral, generic "go to the page" labels for the unresolved-card fallback.
// Deliberately generic — NEVER the model's per-card note, which may itself be
// fabricated. The point is an honest pointer to the real resource page, not a
// specific promise the (missing) listing can't back up.
const BROWSE_LABEL: Record<ListingType, string> = {
  job: 'Browse jobs',
  person: 'Browse Hire',
  funder: 'Browse funding',
  advisor: 'Browse advisors',
  community: 'Browse communities',
  course: 'Browse self-study',
  'founder-resource': 'Browse the founder toolkit',
  project: 'Browse volunteer projects',
  'media-channel': 'Browse media channels',
  org: 'Browse the field map',
  event: 'Browse events',
  training: 'Browse training programs',
}

// Derived from RESOURCE_TABLES so the page paths never drift from the catalog.
const TYPE_TO_PAGE = new Map<string, { path: string; label: string }>(
  RESOURCE_TABLES.map(t => [
    t.catalogType,
    { path: t.pagePath, label: BROWSE_LABEL[t.catalogType] },
  ])
)
// 'person' (/hire) has no Airtable table (its data comes from Mangrove One's
// API), so it isn't in RESOURCE_TABLES (see the TODO in catalog-coverage.ts)
// — added directly so a fabricated person card id still falls back to an
// honest page link.
TYPE_TO_PAGE.set('person', { path: '/hire', label: BROWSE_LABEL.person })

/** For a card id whose listing can't be resolved (the model fabricated it, or
 *  it's a real listing it never actually retrieved this turn), map its leading
 *  type segment to the matching resource page. The renderer shows an honest
 *  "Browse X" link there instead of dropping the card and orphaning its lead-in
 *  sentence. Returns undefined when there's no parseable known type — then the
 *  caller hides the dangling lead-in instead. */
export function cardTypePage(
  rawId: string
): { path: string; label: string } | undefined {
  const seg = rawId.replace(/\s+/g, '').split(':')[0]?.toLowerCase()
  return seg ? TYPE_TO_PAGE.get(seg) : undefined
}
