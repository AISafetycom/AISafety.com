import type { SearchEntry, SearchType } from './data/search-index'

export type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; index: SearchEntry[] }
  | { status: 'error'; message: string }

// Order matches the global nav (Training programs first, etc.). 'page'
// omitted — the nav links themselves are pages, so listing them again is
// noise.
export const BROWSE_TYPES: SearchType[] = [
  'training',
  'event',
  'map',
  'community',
  'course',
  'job',
  'funder',
  'media',
  'advisor',
  'project',
  'founder',
]

export const TYPE_LABEL: Record<SearchType, string> = {
  advisor: 'Advisors',
  community: 'Communities',
  course: 'Self-study',
  event: 'Events',
  founder: 'Founder toolkit',
  funder: 'Funding',
  job: 'Jobs',
  map: 'Field map',
  media: 'Media channels',
  project: 'Volunteer projects',
  training: 'Training programs',
  page: 'Pages',
}

export const TYPE_ICON: Record<SearchType, string | null> = {
  advisor: '/images/icons/person.svg',
  community: '/images/icons/globe.svg',
  course: '/images/icons/book.svg',
  event: '/images/icons/calendar.svg',
  founder: '/images/icons/rocket.svg',
  funder: '/images/icons/coins.svg',
  job: '/images/icons/briefcase.svg',
  map: '/images/icons/map.svg',
  media: '/images/icons/megaphone.svg',
  project: '/images/icons/clipboard.svg',
  training: '/images/icons/grad-cap.svg',
  page: null,
}

// Maps a browseable search type to the URL path whose server-rendered
// count we can borrow for an instant browse-grid render before the
// (heavy) search index has loaded.
export const TYPE_PATH: Record<SearchType, string | null> = {
  advisor: '/advisors',
  community: '/communities',
  course: '/self-study',
  event: '/events',
  founder: '/founders',
  funder: '/funding',
  job: '/jobs',
  map: '/map',
  media: '/media-channels',
  project: '/projects',
  training: '/training',
  page: null,
}

/** The search type whose listings a resource page shows ('/map' → 'map'),
 *  or null for pages without any (the homepage, /about). */
export function typeForPath(pathname: string): SearchType | null {
  for (const [type, path] of Object.entries(TYPE_PATH)) {
    if (path !== null && path === pathname) return type as SearchType
  }
  return null
}

/** The index with one type's entries replaced by `entries`, in the same
 *  place — preview mode lays a live read of the page being looked at over
 *  the prebuilt index (see SearchProvider). Other types are untouched; a
 *  type the index didn't have goes at the end. */
export function withLiveEntries(
  index: SearchEntry[],
  type: SearchType,
  entries: SearchEntry[]
): SearchEntry[] {
  const first = index.findIndex(e => e.type === type)
  if (first === -1) return [...index, ...entries]
  const after = index.slice(first).filter(e => e.type !== type)
  return [...index.slice(0, first), ...entries, ...after]
}

export function countsByType(
  pathCounts: Partial<Record<string, number>>
): Map<SearchType, number> {
  const out = new Map<SearchType, number>()
  for (const type of BROWSE_TYPES) {
    const path = TYPE_PATH[type]
    if (path && pathCounts[path] != null) out.set(type, pathCounts[path]!)
  }
  return out
}

const MAX_RESULTS = 50
const BROWSE_LIMIT = 50

// Tuned so a whole-word title hit beats hits in other fields, but a
// title prefix can lose to a whole-word hit elsewhere.
const SCORE = {
  TITLE_EXACT: 200,
  TITLE_WORD: 80,
  TITLE_PREFIX: 40,
  SUBTITLE_WORD: 10,
  SUBTITLE_PREFIX: 6,
  CATEGORY_WORD: 4,
  DESCRIPTION_PER_HIT: 2,
  DESCRIPTION_MAX: 10,
}

interface TokenRegex {
  token: string
  wholeWord: RegExp
  wholeWordGlobal: RegExp
  wordPrefix: RegExp
}

interface Scored {
  entry: SearchEntry
  score: number
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compileTokenRegexes(tokens: string[]): TokenRegex[] {
  return tokens.map(token => {
    const escaped = escapeRegex(token)
    return {
      token,
      wholeWord: new RegExp(`\\b${escaped}\\b`),
      wholeWordGlobal: new RegExp(`\\b${escaped}\\b`, 'g'),
      wordPrefix: new RegExp(`\\b${escaped}`),
    }
  })
}

// Word boundaries avoid substring false-positives ("NIST" matches "(NIST)"
// but not "administering"). Description hits scale with occurrence count.
function scoreEntry(entry: SearchEntry, regexes: TokenRegex[]): number {
  const title = entry.title.toLowerCase()
  const description = entry.description.toLowerCase()
  const category = entry.category.toLowerCase()
  const subtitle = entry.subtitle.toLowerCase()

  let score = 0
  for (const r of regexes) {
    let tokenScore = 0
    if (title === r.token) tokenScore = SCORE.TITLE_EXACT
    else if (r.wholeWord.test(title)) tokenScore = SCORE.TITLE_WORD
    else if (r.wordPrefix.test(title)) tokenScore = SCORE.TITLE_PREFIX
    else if (r.wholeWord.test(subtitle)) tokenScore = SCORE.SUBTITLE_WORD
    else if (r.wordPrefix.test(subtitle)) tokenScore = SCORE.SUBTITLE_PREFIX
    else if (r.wholeWord.test(category)) tokenScore = SCORE.CATEGORY_WORD
    else if (r.wholeWord.test(description)) {
      const matches = description.match(r.wholeWordGlobal)
      tokenScore = Math.min(
        SCORE.DESCRIPTION_PER_HIT * (matches?.length ?? 1),
        SCORE.DESCRIPTION_MAX
      )
    } else return 0
    score += tokenScore
  }
  return score
}

export function search(
  index: SearchEntry[],
  query: string,
  activeType: SearchType | null
): SearchEntry[] {
  const scoped = activeType ? index.filter(e => e.type === activeType) : index
  const trimmed = query.trim().toLowerCase()

  if (!trimmed) {
    return activeType ? scoped.slice(0, BROWSE_LIMIT) : []
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean)
  const regexes = compileTokenRegexes(tokens)
  const scored: Scored[] = []
  for (const entry of scoped) {
    const score = scoreEntry(entry, regexes)
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, MAX_RESULTS)

  // Pages pinned to top so section landing pages lead their group.
  const groupOrder: SearchType[] = []
  const groups = new Map<SearchType, SearchEntry[]>()
  for (const s of top) {
    let list = groups.get(s.entry.type)
    if (!list) {
      list = []
      groups.set(s.entry.type, list)
      groupOrder.push(s.entry.type)
    }
    list.push(s.entry)
  }
  const pagesIdx = groupOrder.indexOf('page')
  if (pagesIdx > 0) {
    groupOrder.splice(pagesIdx, 1)
    groupOrder.unshift('page')
  }
  return groupOrder.flatMap(type => groups.get(type)!)
}

// Input must be display-ordered; flatIndex lookups depend on it.
export function groupByType(
  entries: SearchEntry[]
): Array<[SearchType, SearchEntry[]]> {
  const groups: Array<[SearchType, SearchEntry[]]> = []
  let current: [SearchType, SearchEntry[]] | null = null
  for (const entry of entries) {
    if (!current || current[0] !== entry.type) {
      current = [entry.type, [entry]]
      groups.push(current)
    } else {
      current[1].push(entry)
    }
  }
  return groups
}
