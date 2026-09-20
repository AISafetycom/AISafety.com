import type { Catalog, Listing, ListingType } from './types'
import { geocodeCity, haversineKm } from './geocode'

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
  'want',
  'looking',
  'find',
  'show',
  'me',
  'some',
  'any',
])

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []).filter(
    t => !STOPWORDS.has(t) && t.length > 1
  )
}

interface ScoreInputs {
  nameTokens: Set<string>
  orgTokens: Set<string>
  metaTokens: Set<string>
  descTokens: Set<string>
}

function precompute(listing: Listing): ScoreInputs {
  return {
    nameTokens: new Set(tokenize(listing.name)),
    orgTokens: new Set(tokenize(listing.organization ?? '')),
    metaTokens: new Set(tokenize(Object.values(listing.meta).join(' '))),
    descTokens: new Set(
      tokenize(listing.description + ' ' + (listing.details ?? ''))
    ),
  }
}

function score(queryTokens: string[], pre: ScoreInputs): number {
  let s = 0
  for (const t of queryTokens) {
    if (pre.nameTokens.has(t)) s += 5
    else if (pre.orgTokens.has(t)) s += 3
    else if (pre.metaTokens.has(t)) s += 2
    else if (pre.descTokens.has(t)) s += 1
  }
  return s
}

function matchesFilter(listing: Listing, key: string, want: unknown): boolean {
  const have = listing.meta[key]
  if (!have) return false
  const haveLower = have.toLowerCase()
  const candidates = Array.isArray(want) ? want : [want]
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue
    if (haveLower.includes(c.toLowerCase())) return true
  }
  return false
}

function matchesAllFilters(
  listing: Listing,
  filters: Record<string, unknown>
): boolean {
  for (const [k, v] of Object.entries(filters)) {
    if (v == null || (Array.isArray(v) && v.length === 0)) continue
    if (!matchesFilter(listing, k, v)) return false
  }
  return true
}

export interface NearOptions {
  /** Free-text city/region/country, geocoded to lat/lng. */
  city?: string
  /** Or pass coords directly. */
  lat?: number
  lng?: number
  /** Search radius in km. Defaults to 500km — wide net so the bot rarely
   *  comes back empty for a "near X" query. */
  radiusKm?: number
}

export type RecencySort = 'recently-added' | 'recently-updated'

export interface SearchOptions {
  query?: string
  type?: ListingType
  filters?: Record<string, unknown>
  /** Geo filter — keeps only listings within radius of the city/coords. */
  near?: NearOptions
  limit?: number
  /** Re-rank matches by dateAdded/lastModified desc. Capped at 10 results
   *  unless an explicit limit is passed. Listings without the date sort last. */
  sort?: RecencySort
}

export interface SearchHit {
  listing: Listing
  score: number
  distanceKm?: number
}

// The /training page opens on its Upcoming tab; mirror that default here:
// dated rounds outrank evergreen recurring listings in any browse — even
// featured ones — so a generic "what programs are there" surfaces things to
// apply to now. A recurring listing still leads when the user filters
// recurring: 'Yes' (every result is recurring) or names the program (its
// name match dominates the score).
function isRecurringTraining(l: Listing): boolean {
  return l.type === 'training' && l.meta.recurring === 'Yes'
}

function recencyKey(listing: Listing, sort: RecencySort): string {
  return (
    (sort === 'recently-added' ? listing.dateAdded : listing.lastModified) ?? ''
  )
}

/** Date-desc re-rank for recency-sorted searches; undated listings last. */
function sortHitsByRecency(hits: SearchHit[], sort: RecencySort): SearchHit[] {
  return [...hits].sort((a, b) =>
    recencyKey(b.listing, sort).localeCompare(recencyKey(a.listing, sort))
  )
}

export async function searchCatalog(
  catalog: Catalog,
  options: SearchOptions
): Promise<SearchHit[]> {
  const queryTokens = options.query ? tokenize(options.query) : []
  // Default: no limit — except recency sorts, which cap at 10 so "what's new"
  // answers don't ship the whole catalog. An explicit limit always wins.
  const limit =
    typeof options.limit === 'number'
      ? Math.max(1, options.limit)
      : options.sort
        ? 10
        : Infinity
  const filters = options.filters ?? {}

  // Resolve geo center if `near` is present
  let center: { lat: number; lng: number } | null = null
  if (options.near) {
    if (
      typeof options.near.lat === 'number' &&
      typeof options.near.lng === 'number'
    ) {
      center = { lat: options.near.lat, lng: options.near.lng }
    } else if (options.near.city) {
      center = await geocodeCity(options.near.city)
    }
  }
  const radiusKm = options.near?.radiusKm ?? 500

  const catalogIndex = new Map<string, number>()
  catalog.listings.forEach((l, i) => catalogIndex.set(l.id, i))

  const candidates: Array<{ listing: Listing; distanceKm?: number }> = []
  for (const listing of catalog.listings) {
    if (options.type && listing.type !== options.type) continue
    if (!matchesAllFilters(listing, filters)) continue

    if (center) {
      if (
        typeof listing.latitude !== 'number' ||
        typeof listing.longitude !== 'number'
      ) {
        // For listings without coords, fall back to substring match on city
        // name in the meta.location field (best-effort).
        const cityHint = options.near?.city?.toLowerCase()
        const loc = (listing.meta.location ?? '').toLowerCase()
        if (cityHint && loc.includes(cityHint)) {
          candidates.push({ listing })
        }
        continue
      }
      const distanceKm = haversineKm(center, {
        lat: listing.latitude,
        lng: listing.longitude,
      })
      if (distanceKm <= radiusKm) {
        candidates.push({ listing, distanceKm })
      }
      continue
    }

    candidates.push({ listing })
  }

  if (queryTokens.length === 0 && !center) {
    // Filter-only browse — dated training rounds before recurring listings,
    // featured items first within that, then catalog order
    const sorted = [...candidates].sort((a, b) => {
      const aRec = isRecurringTraining(a.listing) ? 1 : 0
      const bRec = isRecurringTraining(b.listing) ? 1 : 0
      if (aRec !== bRec) return aRec - bRec
      const aFeat = a.listing.featured ? 1 : 0
      const bFeat = b.listing.featured ? 1 : 0
      if (bFeat !== aFeat) return bFeat - aFeat
      return (
        (catalogIndex.get(a.listing.id) ?? Infinity) -
        (catalogIndex.get(b.listing.id) ?? Infinity)
      )
    })
    const browseHits = sorted.map(c => ({ listing: c.listing, score: 1 }))
    return (
      options.sort ? sortHitsByRecency(browseHits, options.sort) : browseHits
    ).slice(0, limit)
  }

  const hits: SearchHit[] = []
  for (const c of candidates) {
    if (queryTokens.length > 0) {
      const s = score(queryTokens, precompute(c.listing))
      if (s === 0 && !center) continue
      hits.push({ listing: c.listing, score: s, distanceKm: c.distanceKm })
    } else {
      // Geo-only search: every candidate is a hit, ranked by distance asc
      hits.push({ listing: c.listing, score: 1, distanceKm: c.distanceKm })
    }
  }

  hits.sort((a, b) => {
    // If we have distances, prefer closer first; ties broken by score then site order.
    if (typeof a.distanceKm === 'number' && typeof b.distanceKm === 'number') {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
    }
    if (b.score !== a.score) return b.score - a.score
    const aRec = isRecurringTraining(a.listing) ? 1 : 0
    const bRec = isRecurringTraining(b.listing) ? 1 : 0
    if (aRec !== bRec) return aRec - bRec
    const aFeat = a.listing.featured ? 1 : 0
    const bFeat = b.listing.featured ? 1 : 0
    if (bFeat !== aFeat) return bFeat - aFeat
    return (
      (catalogIndex.get(a.listing.id) ?? Infinity) -
      (catalogIndex.get(b.listing.id) ?? Infinity)
    )
  })

  return (options.sort ? sortHitsByRecency(hits, options.sort) : hits).slice(
    0,
    limit
  )
}
