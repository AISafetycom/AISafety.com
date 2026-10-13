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
// Words of a query that count; a pasted paragraph mustn't slow every keystroke.
const MAX_WORDS = 12

// Tuned so a whole-word title hit beats hits in other fields, but a
// title prefix can lose to a whole-word hit elsewhere.
const SCORE = {
  TITLE_EXACT: 200,
  TITLE_WORD: 80,
  // The word in another form ("scientists" in a "Research Scientist"
  // title): below the spelling as typed, so the listing called "Research
  // Scientists" still comes first.
  TITLE_FORM: 70,
  TITLE_PREFIX: 40,
  SUBTITLE_WORD: 10,
  SUBTITLE_PREFIX: 6,
  CATEGORY_WORD: 4,
  DESCRIPTION_PER_HIT: 2,
  DESCRIPTION_MAX: 10,
  // Below any hit the result row shows: the last word typed completing a
  // category word ("venture capital"), and card text the row leaves out.
  CATEGORY_PREFIX: 1,
  KEYWORD_WORD: 1,
  // "london events": the word naming a listing's type. Enough for that type
  // to lead, never enough to match on its own.
  TYPE_WORD: 20,
  // An optional small word ("in", "the") the listing contains: a tiebreak.
  STOPWORD: 1,
  // The words typed appear side by side in the listing.
  PHRASE: 20,
}

// Optional once a query has another word, so "fellowship in london" isn't
// limited to listings that happen to contain "in". Question words stay
// required: "what is alignment" should find what explains it.
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'in',
  'on',
  'of',
  'for',
  'to',
  'and',
  'or',
  'with',
  'at',
  'by',
  'from',
  'near',
  'into',
])

const TYPE_WORDS: Partial<Record<SearchType, string[]>> = {
  job: ['job', 'jobs'],
  event: ['event', 'events'],
  course: ['course', 'courses', 'self-study'],
  community: ['community', 'communities'],
  funder: ['funder', 'funders', 'funding', 'grant', 'grants'],
  advisor: ['advisor', 'advisors', 'advice'],
  project: ['project', 'projects', 'volunteer'],
  founder: ['founder', 'founders'],
  training: ['training', 'program', 'programs'],
  media: ['media'],
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

// Words ending in s whose singular means something else ("times" isn't
// "time", which every "Full-time" job has).
const NOT_PLURALS = new Set([
  'analyses',
  'customs',
  'dynamics',
  'economics',
  'ethics',
  'goods',
  'humanities',
  'internals',
  'means',
  'news',
  'physics',
  'politics',
  'posts',
  'savings',
  'series',
  'species',
  'statistics',
  'theses',
  'times',
])

// Letters NFD doesn't split into base letter + accent, and look-alikes of
// plain punctuation ("FAR․AI" is written with a one-dot leader).
const LOOKALIKES: [RegExp, string][] = [
  [/[\u2018\u2019]/g, "'"],
  [/[\u2010\u2011]/g, '-'],
  [/\u2024/g, '.'],
  [/ø/g, 'o'],
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
]

/** Lowercased text with accents dropped and spelling variants evened out,
 *  applied to both the query and the listings: "tubingen" finds Tübingen,
 *  "washington dc" finds "Washington D.C." and "80000" finds "80,000". */
export function foldForSearch(text: string): string {
  let s = text.toLowerCase()
  for (const [from, to] of LOOKALIKES) s = s.replace(from, to)
  return (
    s
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      // Contractions typed without the apostrophe: "don't" → "dont".
      .replace(/(\p{L})'(t|re|ll|ve|d|m)(?![\p{L}\p{N}])/gu, '$1$2')
      // Thousands separators: "80,000" → "80000".
      .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
      // Dotted initials: "d.c." → "dc", "u.s." → "us".
      .replace(
        /(^|[^\p{L}\p{N}])((?:\p{L}\.)+\p{L})\.?(?![\p{L}\p{N}])/gu,
        (_, before: string, initials: string) =>
          before + initials.replace(/\./g, '')
      )
  )
}

// Words only, for comparing a typed title with a listing's title.
function bare(folded: string): string {
  return folded.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

interface FoldedEntry {
  title: string
  titleBare: string
  subtitle: string
  category: string
  // Card text the result row doesn't show.
  keywords: string
  description: string
  // All five, to rule a listing out with one test.
  all: string
  allBare: string
}

// Folded once per entry, not on every keystroke.
const foldedEntries = new WeakMap<SearchEntry, FoldedEntry>()

function folded(entry: SearchEntry): FoldedEntry {
  let f = foldedEntries.get(entry)
  if (!f) {
    const title = foldForSearch(entry.title)
    const subtitle = foldForSearch(entry.subtitle)
    const category = foldForSearch(entry.category)
    const keywords = foldForSearch(entry.keywords ?? '')
    const description = foldForSearch(entry.description)
    const all = [title, subtitle, category, keywords, description].join('\n')
    f = {
      title,
      titleBare: bare(title),
      subtitle,
      category,
      keywords,
      description,
      all,
      allBare: ` ${bare(all)} `,
    }
    foldedEntries.set(entry, f)
  }
  return f
}

/** Folds every entry ahead of the first keystroke, which would otherwise
 *  pay for the whole index at once (tens of milliseconds on a phone). */
export function prepareSearch(index: SearchEntry[]): void {
  for (const entry of index) folded(entry)
}

// Punctuation at either end of a typed word can never sit at a word
// boundary, so "(CAIS)", "&" or "mats?" used to match nothing. A trailing
// + or # stays, for "c++" and "c#".
function cleanToken(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}+#]+$/u, '')
}

/** Other spellings a typed word matches as a whole word in a title,
 *  subtitle, category or keywords: the singular of a plural ("podcasts" →
 *  "podcast", as the cards say), a month's other form ("october" ↔ "oct",
 *  the dates use the short one) and "80k" → "80000". */
function otherForms(token: string): string[] {
  const forms: string[] = []
  // Five letters or more keeps "news", "lens" and "mats" as typed.
  if (
    /^\p{L}{5,}$/u.test(token) &&
    /[^s]s$/.test(token) &&
    !NOT_PLURALS.has(token)
  ) {
    if (token.endsWith('ies')) forms.push(`${token.slice(0, -3)}y`)
    else if (/(?:ch|sh|x|z|ss)es$/.test(token)) forms.push(token.slice(0, -2))
    else forms.push(token.slice(0, -1))
  }
  const month = MONTHS.find(m => m === token || m.slice(0, 3) === token)
  if (month && month !== 'may') {
    forms.push(token === month ? month.slice(0, 3) : month)
  }
  if (token === 'sept') forms.push('sep', 'september')
  const thousands = token.match(/^(\d+)k$/)
  if (thousands) forms.push(String(Number(thousands[1]) * 1000))
  return forms
}

interface TokenRegex {
  token: string
  /** The word as typed. */
  exactWord: RegExp
  exactWordGlobal: RegExp
  /** The word as typed or in another form. */
  wholeWord: RegExp
  wordPrefix: RegExp
  /** Anything the field tests could match, for ruling a listing out fast. */
  anywhere: RegExp
  /** The rest of each category word the typed word starts, when this is
   *  the last of several words typed (see completesCategoryWord). */
  categoryCompletion: RegExp | null
  /** A small word that may be missing from a match. */
  optional: boolean
  /** Listing types this word names ("jobs" → job). */
  typeWordFor: Set<SearchType>
}

interface Scored {
  entry: SearchEntry
  score: number
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A hyphen between letters also matches a space or nothing, so
// "non-profit" finds "nonprofit" and "co-working" finds "coworking".
function pattern(form: string): string {
  return escapeRegex(form).replace(/(\p{L})-(?=\p{L})/gu, '$1[-\\s]?')
}

// Lookbehind (Safari 16.4+) gives word boundaries beyond ASCII letters, so
// words ending in "é" or written in another script still have them. Where
// it's missing, \b keeps search working for everything else.
const NOT_WORD_BEFORE = (() => {
  try {
    new RegExp('(?<!a)b', 'u')
    return '(?<![\\p{L}\\p{N}_])'
  } catch {
    return '\\b'
  }
})()
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}_])'

function compileTokenRegexes(
  tokens: string[],
  optional: Set<string>
): TokenRegex[] {
  const isTypeWord = (t: string) =>
    Object.values(TYPE_WORDS).some(words => words.includes(t))
  // Words about the listing itself, not small words or type words.
  const content = tokens.filter(t => !optional.has(t) && !isTypeWord(t))
  const last = content.length > 1 ? content[content.length - 1] : null
  return tokens.map(token => {
    const typed = pattern(token)
    const forms = [token, ...otherForms(token)].map(pattern).join('|')
    const exact = `${NOT_WORD_BEFORE}${typed}${NOT_WORD_AFTER}`
    const typeWordFor = new Set<SearchType>()
    for (const [type, words] of Object.entries(TYPE_WORDS)) {
      if (words.includes(token)) typeWordFor.add(type as SearchType)
    }
    return {
      token,
      exactWord: new RegExp(exact, 'u'),
      exactWordGlobal: new RegExp(exact, 'gu'),
      wholeWord: new RegExp(
        `${NOT_WORD_BEFORE}(?:${forms})${NOT_WORD_AFTER}`,
        'u'
      ),
      wordPrefix: new RegExp(`${NOT_WORD_BEFORE}${typed}`, 'u'),
      anywhere: new RegExp(`${NOT_WORD_BEFORE}(?:${forms})`, 'u'),
      categoryCompletion:
        token === last
          ? new RegExp(`${NOT_WORD_BEFORE}${typed}([\\p{L}\\p{N}]*)`, 'gu')
          : null,
      optional: optional.has(token),
      typeWordFor,
    }
  })
}

// The last word of a longer query, still being typed, may be most of a
// category word: "venture capital" finds "Venture capitalist". Not a lone
// word, and not a short start ("act" of "Active", "metr" of "metro"),
// which would find every listing with that label.
function completesCategoryWord(r: TokenRegex, category: string): boolean {
  if (!r.categoryCompletion) return false
  for (const m of category.matchAll(r.categoryCompletion)) {
    const typed = m[0].length - m[1].length
    if (typed >= 5 && typed / m[0].length >= 2 / 3) return true
  }
  return false
}

// Word boundaries avoid substring false-positives ("NIST" matches "(NIST)"
// but not "administering"). Description hits scale with occurrence count.
function scoreEntry(
  entry: SearchEntry,
  regexes: TokenRegex[],
  allowTypeWords: boolean
): number {
  const f = folded(entry)
  const typeWord = (r: TokenRegex) =>
    allowTypeWords && r.typeWordFor.has(entry.type)

  // One test per word over the whole listing first, stopping at the first
  // missing word: most listings are ruled out here.
  for (const r of regexes) {
    if (!r.optional && !typeWord(r) && !r.anywhere.test(f.all)) return 0
  }

  let score = 0
  let textHit = false
  for (const r of regexes) {
    if (r.optional) {
      if (r.exactWord.test(f.all)) score += SCORE.STOPWORD
      continue
    }
    let textScore = 0
    if (f.title === r.token) textScore = SCORE.TITLE_EXACT
    else if (r.exactWord.test(f.title)) textScore = SCORE.TITLE_WORD
    else if (r.wholeWord.test(f.title)) textScore = SCORE.TITLE_FORM
    else if (r.wordPrefix.test(f.title)) textScore = SCORE.TITLE_PREFIX
    else if (r.wholeWord.test(f.subtitle)) textScore = SCORE.SUBTITLE_WORD
    else if (r.wordPrefix.test(f.subtitle)) textScore = SCORE.SUBTITLE_PREFIX
    else {
      // The best of the lower fields, so card text added as keywords never
      // lowers a listing that its description already matched. Other forms
      // count in the short labels, not in descriptions, where "futures"
      // finding every "future" is mostly noise.
      const hits = f.description.match(r.exactWordGlobal)?.length ?? 0
      textScore = Math.max(
        r.wholeWord.test(f.category)
          ? SCORE.CATEGORY_WORD
          : completesCategoryWord(r, f.category)
            ? SCORE.CATEGORY_PREFIX
            : 0,
        r.wholeWord.test(f.keywords) ? SCORE.KEYWORD_WORD : 0,
        Math.min(SCORE.DESCRIPTION_PER_HIT * hits, SCORE.DESCRIPTION_MAX)
      )
    }

    if (typeWord(r)) {
      score += Math.max(textScore, SCORE.TYPE_WORD)
    } else if (textScore > 0) {
      textHit = true
      score += textScore
    } else return 0
  }
  return textHit ? score : 0
}

// "deep mind" also tries "deepmind", "less wrong" "lesswrong": the query
// with one pair of neighboring words joined, for names written as one word.
function joinedVariants(tokens: string[], optional: Set<string>): string[][] {
  const variants = [tokens]
  // A name is in a short query; each variant is another pass over the index.
  if (tokens.filter(t => !optional.has(t)).length > 3) return variants
  const joinable = (t: string) => /^\p{L}+$/u.test(t) && !optional.has(t)
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (joinable(tokens[i]) && joinable(tokens[i + 1])) {
      variants.push([
        ...tokens.slice(0, i),
        tokens[i] + tokens[i + 1],
        ...tokens.slice(i + 2),
      ])
    }
  }
  return variants
}

// A name-only entry matches a query that is its title, or the start of it
// once the first word is typed in full: "listing" and "listing pol" find
// Listing policy, "policy" and words from its description don't.
function matchesName(entry: SearchEntry, query: string): boolean {
  const title = folded(entry).title
  const firstWord = title.split(/\s+/)[0]
  return title.startsWith(query) && query.length >= firstWord.length
}

export function search(
  index: SearchEntry[],
  query: string,
  activeType: SearchType | null
): SearchEntry[] {
  const scoped = activeType ? index.filter(e => e.type === activeType) : index
  const trimmed = foldForSearch(query.trim())

  if (!trimmed) {
    return activeType ? scoped.slice(0, BROWSE_LIMIT) : []
  }

  const words = trimmed
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
  // Small words are optional once the query has another word.
  const required = words.filter(w => !STOPWORDS.has(w))
  const optional = new Set(
    required.length > 0 ? words.filter(w => STOPWORDS.has(w)) : []
  )
  const variants = joinedVariants(words, optional).map(tokens => ({
    regexes: compileTokenRegexes(tokens, optional),
    allowTypeWords: tokens.filter(t => !optional.has(t)).length > 1,
  }))
  const phrase = words.join(' ')
  const phraseBare = words.length > 1 ? bare(phrase) : null
  const phraseSpaced = phraseBare !== null ? ` ${phraseBare} ` : null
  const scored: Scored[] = []
  for (const entry of scoped) {
    if (entry.nameOnly && !matchesName(entry, phrase)) continue
    let score = 0
    for (const v of variants) {
      score = Math.max(score, scoreEntry(entry, v.regexes, v.allowTypeWords))
    }
    if (score === 0) continue
    const f = folded(entry)
    // The whole title typed out, punctuation aside, comes first.
    if (phraseBare !== null && f.titleBare === phraseBare) {
      score += SCORE.TITLE_EXACT
    } else if (phraseSpaced !== null && f.allBare.includes(phraseSpaced)) {
      score += SCORE.PHRASE
    }
    scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score)
  // A one-word search keeps the page or two it names ("grants" → Funding)
  // even when that word fills the 50 slots with listings.
  const pages = scored.filter(s => s.entry.type === 'page')
  const top =
    required.length === 1 && pages.length > 0 && pages.length <= 2
      ? [
          ...pages,
          ...scored.filter(s => s.entry.type !== 'page').slice(0, MAX_RESULTS),
        ]
      : scored.slice(0, MAX_RESULTS)

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
