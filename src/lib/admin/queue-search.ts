import type { QueueItem } from './queue'

// Search for the /admin Queue (Bryce, 23 Sept 2026: "please add a search
// feature"). Everything the page has loaded is searched in the browser: the
// open items of every kind and today's decisions. Each word typed has to
// start a word somewhere in the item ("pause" finds PauseAI, "ai" does not
// find "email"), case and accents aside, as the site's own search does.

/** One piece of an item's text, with the name shown beside an excerpt of
 *  it. `shown` parts are already on the item's row (its name, page,
 *  source, verdict), so a match there needs no excerpt. */
export interface SearchPart {
  label: string
  text: string
  shown?: boolean
}

export interface SearchDoc {
  parts: SearchPart[]
  /** The row's name (the first part), folded. */
  name: string
  /** Every part, folded, one per line. */
  all: string
  /** The `shown` parts, folded. */
  shown: string
  /** The record ids (the row's own and its target's), lower case: a pasted
   *  id finds its item. */
  ids: string[]
}

export interface SearchQuery {
  words: string[]
  res: RegExp[]
}

/** Where the row's excerpt comes from, with the matched stretches marked
 *  as [start, end) positions in `text`. */
export interface SearchExcerpt {
  label: string
  text: string
  marks: Array<[number, number]>
}

export interface SearchHit {
  /** Every word is in the row's name: these rows lead the results. */
  inName: boolean
  /** Null when every word is on the row already. */
  excerpt: SearchExcerpt | null
}

const RECORD_ID_RE = /^rec[a-z0-9]{14}$/
const COMBINING_RE = /[\u0300-\u036f]/g

/** Lower case with the accents off: "Zürich" and "zurich" are one word. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(COMBINING_RE, '').toLowerCase()
}

/** `fold`, one character at a time, keeping where each folded character
 *  came from in `text` (with the end of `text` as a last entry), so a
 *  match in the folded text can be marked in the original. */
function foldWithMap(text: string): { folded: string; at: number[] } {
  let folded = ''
  const at: number[] = []
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) ?? 0
    const ch = String.fromCodePoint(cp)
    const f = fold(ch)
    for (let k = 0; k < f.length; k++) at.push(i)
    folded += f
    i += ch.length
  }
  at.push(text.length)
  return { folded, at }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A word matches where it starts a word: not straight after a letter or
 *  digit, so "/events" and "events" both find "/events". */
function wordRe(word: string, flags = ''): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}`, `u${flags}`)
}

/** The words of a search, folded, each once; null for an empty box. */
export function parseQuery(query: string): SearchQuery | null {
  const words = [...new Set(fold(query).split(/\s+/).filter(Boolean))]
  if (!words.length) return null
  return { words, res: words.map(w => wordRe(w)) }
}

/** The searchable text of a field value: text, numbers, lists of them, and
 *  a picture's file name. Ticked boxes and dates' objects say nothing a
 *  search would look for. */
export function textsOf(v: unknown): string[] {
  if (typeof v === 'string') return v.trim() ? [v] : []
  if (typeof v === 'number' && Number.isFinite(v)) return [String(v)]
  if (Array.isArray(v)) return v.flatMap(textsOf)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.filename === 'string') return [o.filename]
    if (typeof o.name === 'string') return [o.name]
  }
  return []
}

/** What search looks through for one item, in the order an excerpt is
 *  picked from, the row's name first. `row` is what the page shows: the
 *  row's name, the rest of the title when the row shows only the name (a
 *  Change's finding), the page tag, and the source text as the detail pane
 *  words it (Comb's line without its clock time). */
export function itemParts(
  item: QueueItem,
  row: {
    title: string
    heading: string | null
    page: string | null
    source?: string | null
  }
): SearchPart[] {
  const parts: SearchPart[] = []
  const add = (label: string, v: unknown, shown = false) => {
    for (const text of textsOf(v)) parts.push({ label, text, shown })
  }
  add('Title', row.title, true)
  add('Page', row.page, true)
  add('Source', item.source, true)
  add('Verdict', item.verdict, true)
  if (item.status !== 'Pending') add('Status', item.status, true)
  if (row.heading && row.heading !== row.title) add('Finding', row.heading)
  if (item.name && item.name !== row.title) add('Name', item.name)
  add('Link', item.url)
  for (const [field, v] of Object.entries(item.edits ?? {})) add(field, v)
  for (const [field, v] of Object.entries(item.fields ?? {})) add(field, v)
  for (const c of item.changes) {
    add('Field', c.field)
    add(c.field, c.to)
    add(`${c.field} (now)`, c.from)
  }
  add('Rule', item.summary)
  add('Applies to', item.appliesTo)
  if (item.saidBy) {
    add('From', item.saidBy.name)
    add('From', item.saidBy.handle)
  }
  add('Reply to', item.replyTo)
  add(
    item.source === 'Email' ||
      item.source === 'Discord' ||
      item.source === 'Form'
      ? 'Message'
      : item.source === 'Broom'
        ? 'Broom'
        : item.source === 'Comb'
          ? 'Found'
          : 'Source',
    row.source === undefined ? item.sourceExcerpt : row.source
  )
  add('Fable', item.reasons)
  add('Note', item.note)
  add('Reply', item.replyDraft)
  add('Rejected', item.rejectReason)
  return parts
}

export function searchDoc(parts: SearchPart[], ids: string[]): SearchDoc {
  return {
    parts,
    name: fold(parts[0]?.text ?? ''),
    all: fold(parts.map(p => p.text).join('\n')),
    shown: fold(
      parts
        .filter(p => p.shown)
        .map(p => p.text)
        .join('\n')
    ),
    ids: ids.map(id => id.toLowerCase()),
  }
}

/** Null unless every word is found somewhere in the item. A word that is
 *  a whole record id matches that record only. */
export function matchDoc(doc: SearchDoc, q: SearchQuery): SearchHit | null {
  const offRow: string[] = []
  let inName = true
  for (let i = 0; i < q.words.length; i++) {
    const word = q.words[i]
    if (RECORD_ID_RE.test(word)) {
      if (!doc.ids.includes(word)) return null
      continue
    }
    if (!q.res[i].test(doc.all)) return null
    if (!q.res[i].test(doc.name)) inName = false
    if (!q.res[i].test(doc.shown)) offRow.push(word)
  }
  if (!offRow.length) return { inName, excerpt: null }
  const res = offRow.map(w => wordRe(w))
  for (const part of doc.parts) {
    if (part.shown) continue
    const folded = fold(part.text)
    if (!res.some(re => re.test(folded))) continue
    return { inName, excerpt: excerptOf(part, offRow) }
  }
  return { inName, excerpt: null }
}

/** The part as one line, starting at a word a little before the first
 *  match so the match sits near the front; the page clips the end. */
function excerptOf(part: SearchPart, words: string[]): SearchExcerpt {
  const text = part.text.replace(/\s+/g, ' ').trim()
  const first = markRanges(text, words)[0]?.[0] ?? 0
  let start = 0
  if (first > 40) {
    const space = text.indexOf(' ', first - 30)
    start = space !== -1 && space < first ? space + 1 : first
  }
  const shown = text.slice(start, start + 240)
  return { label: part.label, text: shown, marks: markRanges(shown, words) }
}

/** Every stretch of `text` a word matches, in order, overlaps merged. */
export function markRanges(
  text: string,
  words: string[]
): Array<[number, number]> {
  if (!text || !words.length) return []
  const { folded, at } = foldWithMap(text)
  const found: Array<[number, number]> = []
  for (const word of words) {
    for (const m of folded.matchAll(wordRe(word, 'g'))) {
      const from = m.index
      const last = from + word.length - 1
      // The end is the next original character after the last one matched.
      let end = last + 1
      while (end < at.length - 1 && at[end] === at[last]) end++
      found.push([at[from], at[end]])
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = []
  for (const r of found) {
    const prev = merged[merged.length - 1]
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}
