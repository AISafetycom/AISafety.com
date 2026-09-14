/*
  Airtable schema for the admin conversation log.

  ─── assistant_conversations ───
  ID env var: ADMIN_CONVERSATIONS_TABLE_ID
  One row per CONVERSATION (keyed by Session). Each turn updates the row
  in place: refresh the latest fields, replace Data.history with the
  latest turn's window (the widget resends the whole conversation each
  turn; the route windows it to the last 50 messages before logging),
  accumulate Data.tools/citations.

  Fields:
    Session         (single line text)  — natural key
    Page            (single line text)  — page the conversation started on
    Latency ms      (number)            — latest turn's latency
    Prompt version  (single line text)  — latest, e.g. "2026-05-07-1"
    Notes           (long text)         — admin notes as signed entries
                                          (annotation-log.ts: parseNotes)
    Tags            (multi-select)      — admin annotations; new options are
                                          created on the fly (typecast) when a
                                          reviewer labels a conversation
    Reviewed by     (text)              — admin name behind the current verdict
    Review log      (long text)         — who changed which annotation, when
    Review          (single select)     — reviewer's verdict on the whole
                                          conversation: Good / Bad / Unsure
    Created at      (created time)      — auto, first-turn timestamp
    Data            (long text)         — JSON payload, see ConversationData
                                          below for shape
    Clicked         (long text)         — JSON array of click keys, written
                                          out-of-band by the click logger
    Ratings         (long text)         — JSON map of turn index → 'up'/'down',
                                          written out-of-band by the rating
                                          logger
    Delivery        (long text)         — JSON map of turn index → what the
                                          visitor's browser reported about
                                          the reply (received / stopped /
                                          failed, with the error text / left
                                          the page mid-answer, panel closed,
                                          tab hidden, seen later); see
                                          TurnDelivery. Written out-of-band by
                                          the delivery logger

  Prompt drafts are NOT persisted to Airtable. They live in browser
  localStorage in the admin editor. Production prompts ship via code.
*/

import {
  replyIndexOf,
  slicePerTurn,
  turnsToKeep,
} from '@/lib/admin/conversation-turns'
import { readTranscript, writeTranscript } from '@/lib/admin/transcript-blob'
import {
  appendLog,
  appendNote,
  describeAnnotationChanges,
  formatLogLines,
  removeNote,
} from './annotation-log'

/** A note deletion aimed at an entry that has since moved or gone. */
export class NoteNotFoundError extends Error {
  constructor() {
    super('That note has changed since the page loaded. Reload and try again.')
  }
}

const TOKEN = process.env.AIRTABLE_TOKEN
const BASE = process.env.AIRTABLE_BASE_ID
const CONVERSATIONS_TABLE = process.env.ADMIN_CONVERSATIONS_TABLE_ID
// Ceiling for the serialized Data JSON, under Airtable's 100,000-character
// long-text limit with margin. See upsertConversation.
const MAX_DATA_CHARS = 90_000

// Permanent Airtable field IDs for the conversations table. All reads set
// returnFieldsByFieldId and all writes key fields by ID, so renaming a
// field in Airtable can't break the log.
const FIELD = {
  session: 'flds7cVOnzozLsaAl', // Session
  page: 'fld36UU20Zc9JNvHt', // Page
  latencyMs: 'fldD1AMzmTp4EVQUq', // Latency ms
  promptVersion: 'fldZi6qb5G5bsdfFH', // Prompt version
  notes: 'fldpjWWpS9R0cFXRU', // Notes
  tags: 'fldAkUlONRN894SZN', // Tags
  review: 'fldaQaobQ98Whc5pV', // Review
  reviewedBy: 'flddIHuDdVFQXrE8o', // Reviewed by — who set the current verdict
  reviewLog: 'fldZ6fQMLRahkc9wl', // Review log — one line per annotation change
  data: 'fld9TbBixMYVOssja', // Data
  searchOverflow: 'fldEUemATrZA3Dfa4', // Search overflow
  clicked: 'fld3PKIZx3Oo1oxkm', // Clicked
  ratings: 'fld0ZRhDFjpcHTJnm', // Ratings
  delivery: 'fld2HdrWqxHN7BSTH', // Delivery
  createdAt: 'fldterZrwZHKm2taI', // Created at
} as const

function ensureConfig(table: string | undefined): asserts table is string {
  if (!TOKEN || !BASE) {
    throw new Error('Airtable credentials missing (AIRTABLE_TOKEN/BASE_ID)')
  }
  if (!table) {
    throw new Error('Admin Airtable table id missing in env')
  }
}

export interface AirtableRow<F> {
  id: string
  createdTime: string
  fields: F
}

export interface AirtableListResponse<F> {
  records: AirtableRow<F>[]
  offset?: string
}

const AIRTABLE_ORIGIN = 'https://api.airtable.com'

/** Airtable record ids are "rec" plus 14 letters or digits. Ids arrive from
 *  request bodies and query strings, so anything else is refused before it
 *  can become part of a URL. */
const RECORD_ID_RE = /^rec[A-Za-z0-9]{14}$/
export function isRecordId(id: string): boolean {
  return RECORD_ID_RE.test(id)
}

export async function airtableRequest(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  // Resolve the path against this base's URL and refuse anything that
  // escapes it, so a request-supplied value can never point the call at
  // another table, another base, or another host.
  const base = `${AIRTABLE_ORIGIN}/v0/${BASE}/`
  const url = new URL(path, base)
  if (url.origin !== AIRTABLE_ORIGIN || !url.href.startsWith(base)) {
    throw new Error('Airtable request path escapes the base')
  }
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })
}

export async function listAll<F>(
  table: string,
  params: URLSearchParams = new URLSearchParams()
): Promise<AirtableRow<F>[]> {
  const out: AirtableRow<F>[] = []
  let offset: string | undefined
  do {
    const search = new URLSearchParams(params)
    if (offset) search.set('offset', offset)
    const url = `${table}?${search.toString()}`
    const res = await airtableRequest(url)
    if (!res.ok) {
      throw new Error(`Airtable list failed: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as AirtableListResponse<F>
    out.push(...data.records)
    offset = data.offset
  } while (offset)
  return out
}

// ─── Conversation log ───────────────────────────────────────────────────────

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Name/url snapshot of a cited listing, captured at log time so the viewer
 *  can still render a card after the listing is deleted from the catalog
 *  (events especially get cycled out once they end). */
export interface StoredCitation {
  id: string
  name: string
  /** The org behind the listing (a job's hiring org, a course's creator).
   *  Absent on rows logged before it was captured. */
  organization?: string
  url: string
  logo?: string
}

/** Shape of the JSON stored in the `Data` column. */
export interface ConversationData {
  user: string
  response: string
  /** The conversation as of the latest turn, WINDOWED: the last 50 messages
   *  (25 exchanges; rows written before 17 Aug 2026 kept only the model's
   *  14-message window), then trimmed further if the row would overflow
   *  Airtable's long-text limit. Per-turn arrays (`tools`, `turnTimes`,
   *  `pages`) are never windowed, so their length is the true turn count and
   *  they align with `history` from the END. A re-sent turn (the widget's
   *  Edit / Try again) replaces its earlier entries rather than adding to
   *  them, so the count stays true. */
  history: HistoryTurn[]
  /** Each history message's position in the VISITOR's message list — the
   *  indexing the widget's delivery/rating/click reports key on. Aligned
   *  with `history` (windowing and trims shift both together). Absent on
   *  rows written before this was tracked; for those, position-keyed badges
   *  are only trustworthy while nothing was dropped from the history. */
  historyIndices?: unknown[]
  /** URL of this conversation's full-transcript blob mirror — present once
   *  the conversation outgrew what this row can hold (window or size trim;
   *  see upsertConversation). The blob stores EVERY message with the same
   *  widget-position indexing, so the viewer can show the whole chat. */
  transcript?: string
  tools: unknown[]
  /** One entry per logged turn (aligned with `tools`): card ids in that
   *  turn's reply that rendered as a generic "Browse X" fallback link (or
   *  nothing) in the visitor's chat instead of a real card. Absent on rows
   *  written before this was tracked. */
  fallbackCards?: unknown[]
  /** One entry per logged turn (aligned with `tools`): ISO timestamp of when
   *  that turn's user message arrived. Absent on rows written before this was
   *  tracked. */
  turnTimes?: unknown[]
  /** One entry per logged turn (aligned with `tools`): the site page the
   *  visitor was on when they sent that turn's message. The Page FIELD only
   *  holds one value, so mid-conversation navigation is recorded here. Absent
   *  on rows written before this was tracked. */
  pages?: unknown[]
  /** One entry per logged turn (aligned with `tools`): the position of that
   *  turn's REPLY in the visitor's message list — the turnIndex the widget's
   *  delivery/rating/click reports key on. What lets a re-sent turn replace
   *  its earlier entry (see upsertConversation) and the viewer place each
   *  stored message exactly. Absent on rows written before 2 Sept 2026. */
  turnIndices?: unknown[]
  citations: string[]
  /** Resolved name/url for each cited listing, so cards survive deletion. */
  citationRefs: StoredCitation[]
  geo: { city?: string; region?: string; country?: string } | null
  referrer: string | null
  utm: Record<string, string> | null
  pageState: Record<string, unknown> | null
  zeroMatches: boolean
  /** Set when the latest turn didn't complete: 'abandoned' (the visitor's
   *  connection dropped — tab closed or Stop pressed — before generation
   *  finished; `response` holds whatever had streamed by then, possibly
   *  nothing) or 'error' (generation failed). Absent on normal turns. */
  status?: 'abandoned' | 'error'
}

/** What the visitor's browser reported about one reply — the signals the
 *  server can't see. Every duration is milliseconds from the moment the
 *  visitor sent their message. Exactly one of received/stopped/error/left is
 *  expected per turn (the outcome); the rest are context around it. Absent
 *  entirely on turns from before this was tracked, on browsers the owner
 *  excluded from logging, and when the report never reached us (e.g. the tab
 *  was closed and the browser dropped the final request). */
export interface TurnDelivery {
  /** The stream finished in the visitor's browser — the whole reply arrived. */
  received?: number
  /** The visitor pressed Stop (or cleared the chat) mid-reply. */
  stopped?: number
  /** The browser hit an error mid-reply (network drop, malformed frame). */
  error?: number
  /** What that error was, as the browser saw it — the exception's name and
   *  message, the server's error event, or 'empty reply' — plus how much of
   *  the reply had arrived by then. Only ever set alongside `error`. */
  errorText?: string
  /** The page was unloaded (tab closed, full navigation) mid-reply. */
  left?: number
  /** The chat panel was closed while the reply was still streaming (first
   *  time it happened during this turn). */
  panelClosed?: number
  /** The tab went to the background while the reply was still streaming
   *  (first time). */
  tabHidden?: number
  /** Whether the chat panel was open at the moment of the outcome. */
  panelOpen?: boolean
  /** Whether the tab was visible at the moment of the outcome. */
  tabVisible?: boolean
  /** A reply that arrived with the panel closed or the tab hidden was later
   *  brought into view (panel reopened / tab refocused). Absent means it
   *  hadn't been, as of the last report. */
  seen?: number
}
export type DeliveryByTurn = Record<string, TurnDelivery>

const DELIVERY_NUMBER_KEYS = [
  'received',
  'stopped',
  'error',
  'left',
  'panelClosed',
  'tabHidden',
  'seen',
] as const
const DELIVERY_BOOLEAN_KEYS = ['panelOpen', 'tabVisible'] as const
const DELIVERY_STRING_KEYS = ['errorText'] as const
/** Cap on a stored error text — room for an HTTP status line plus the start
 *  of the server's message, without a runaway body bloating the field. */
export const DELIVERY_TEXT_MAX = 300

/** Raw record fields, keyed by permanent field ID (see FIELD above). The
 *  Clicked field holds a JSON array of listing ids whose cards the visitor
 *  clicked — kept separate from Data so a click write never clobbers a turn
 *  write. */
type ConversationFields = Record<string, unknown>

export interface ConversationRow {
  id: string
  createdAt: string
  session: string
  page: string
  latencyMs: number | null
  promptVersion: string
  notes: string
  tags: string[]
  /** Reviewer's verdict on the whole conversation ('' when not yet rated) —
   *  distinct from `ratings`, the visitor's own thumbs on individual replies. */
  review: ReviewValue | ''
  /** Admin sign-in name of whoever set the current verdict ('' when unrated). */
  reviewedBy: string
  /** Who did what to this row's annotations, one line per change, oldest
   *  first — see annotation-log.ts for the format. */
  reviewLog: string
  data: ConversationData | null
  /** Listing ids whose cards the visitor clicked during this conversation. */
  clickedCitations: string[]
  /** Visitor's thumbs ratings of the bot's replies, keyed by the reply's index
   *  in the message list ('up' | 'down'). Empty when nothing was rated. */
  ratings: MessageRatings
  /** What the visitor's browser reported about each reply (did it arrive, was
   *  the panel open, did they leave mid-answer…), keyed by the reply's index
   *  in the message list. Empty when nothing was reported. */
  delivery: DeliveryByTurn
}

export type MessageRatingValue = 'up' | 'down'
export type MessageRatings = Record<string, MessageRatingValue>

/** The Review single select's options, exactly as named in Airtable. */
export const REVIEW_VALUES = ['Good', 'Bad', 'Unsure'] as const
export type ReviewValue = (typeof REVIEW_VALUES)[number]

function parseReview(value: unknown): ReviewValue | '' {
  return REVIEW_VALUES.includes(value as ReviewValue)
    ? (value as ReviewValue)
    : ''
}

const EMPTY_DATA: ConversationData = {
  user: '',
  response: '',
  history: [],
  tools: [],
  citations: [],
  citationRefs: [],
  geo: null,
  referrer: null,
  utm: null,
  pageState: null,
  zeroMatches: false,
}

function parseData(raw: string | undefined): ConversationData | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ConversationData>
    return { ...EMPTY_DATA, ...parsed }
  } catch {
    return null
  }
}

/** Dedupe citation snapshots by id, keeping the last occurrence (most recent
 *  turn's name/url wins if a listing was cited more than once). */
function dedupeCitationRefs(refs: StoredCitation[]): StoredCitation[] {
  const byId = new Map<string, StoredCitation>()
  for (const r of refs) byId.set(r.id, r)
  return [...byId.values()]
}

/** The Clicked field holds a JSON array of listing-id strings. */
function parseClicked(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

/** The Ratings field holds a JSON object of turn index → 'up' | 'down'.
 *  Anything malformed (or any entry that isn't a valid rating) is dropped. */
function parseRatings(raw: string | undefined): MessageRatings {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const out: MessageRatings = {}
    for (const [turn, value] of Object.entries(parsed)) {
      if (value === 'up' || value === 'down') out[turn] = value
    }
    return out
  } catch {
    return {}
  }
}

/** The Delivery field holds a JSON object of turn index → TurnDelivery. Each
 *  entry is rebuilt from only the known keys with the right types, so a
 *  malformed value can't leak odd shapes into the viewer. */
function parseDelivery(raw: string | undefined): DeliveryByTurn {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const out: DeliveryByTurn = {}
    for (const [turn, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const v = value as Record<string, unknown>
      const entry: TurnDelivery = {}
      for (const key of DELIVERY_NUMBER_KEYS) {
        if (typeof v[key] === 'number') entry[key] = v[key]
      }
      for (const key of DELIVERY_BOOLEAN_KEYS) {
        if (typeof v[key] === 'boolean') entry[key] = v[key]
      }
      for (const key of DELIVERY_STRING_KEYS) {
        const text = v[key]
        if (typeof text === 'string' && text.trim() !== '') {
          entry[key] = text.slice(0, DELIVERY_TEXT_MAX)
        }
      }
      if (Object.keys(entry).length > 0) out[turn] = entry
    }
    return out
  } catch {
    return {}
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function rowToConversation(
  row: AirtableRow<ConversationFields>
): ConversationRow {
  const f = row.fields
  const latency = f[FIELD.latencyMs]
  const tags = f[FIELD.tags]
  return {
    id: row.id,
    createdAt: row.createdTime,
    session: str(f[FIELD.session]),
    page: str(f[FIELD.page]),
    latencyMs: typeof latency === 'number' ? latency : null,
    promptVersion: str(f[FIELD.promptVersion]),
    notes: str(f[FIELD.notes]),
    tags: Array.isArray(tags)
      ? tags.filter((t): t is string => typeof t === 'string')
      : [],
    review: parseReview(f[FIELD.review]),
    reviewedBy: str(f[FIELD.reviewedBy]),
    reviewLog: str(f[FIELD.reviewLog]),
    data: parseData(str(f[FIELD.data]) || undefined),
    clickedCitations: parseClicked(str(f[FIELD.clicked]) || undefined),
    ratings: parseRatings(str(f[FIELD.ratings]) || undefined),
    delivery: parseDelivery(str(f[FIELD.delivery]) || undefined),
  }
}

/** One batch of conversations, newest first, plus an opaque cursor for the
 *  next batch (null when there are no older conversations left). Used by the
 *  admin viewer's "Load more" button so it only fetches what it shows rather
 *  than the whole — ever-growing — log on every load. */
/** Airtable filterByFormula that matches rows whose content contains every word
 *  in `search` (case-insensitive, any order). Searches the conversation JSON
 *  plus the page, notes and labels. Returns undefined for a blank search. */
function searchFormula(search: string | undefined): string | undefined {
  // Strip quotes/backslashes that would break the formula string, then split
  // into words so "fast grants" matches a chat containing both words anywhere.
  const words = (search ?? '')
    .replace(/["\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return undefined
  const haystack = `LOWER({${FIELD.data}} & " " & {${FIELD.searchOverflow}} & " " & {${FIELD.page}} & " " & {${FIELD.notes}} & " " & ARRAYJOIN({${FIELD.tags}}, " "))`
  const terms = words.map(w => `SEARCH(LOWER("${w}"), ${haystack})`)
  return terms.length === 1 ? terms[0] : `AND(${terms.join(', ')})`
}

/** filterByFormula terms for the reviewer filters: Review verdicts (with
 *  'Unrated' for conversations nobody has judged yet) and/or exact labels.
 *  Several picks within one filter broaden the match (OR, like the site's
 *  filter pills); the two filters combine as AND. The label match joins the
 *  Tags list with a delimiter and looks for the whole delimited label, so
 *  "scope" can't match a "scope-creep" tag. */
function reviewFilterTerms(opts: {
  review?: string[]
  label?: string[]
}): string[] {
  const terms: string[] = []
  const reviewTerms: string[] = []
  for (const r of opts.review ?? []) {
    if (r.toLowerCase() === 'unrated') {
      reviewTerms.push(`{${FIELD.review}} = ""`)
    } else if (REVIEW_VALUES.includes(r as ReviewValue)) {
      reviewTerms.push(`{${FIELD.review}} = "${r}"`)
    }
  }
  if (reviewTerms.length === 1) terms.push(reviewTerms[0])
  if (reviewTerms.length > 1) terms.push(`OR(${reviewTerms.join(', ')})`)
  const labelTerms: string[] = []
  for (const raw of opts.label ?? []) {
    const label = raw.replace(/["\\|]/g, ' ').trim()
    if (!label) continue
    const joined = `"|" & LOWER(ARRAYJOIN({${FIELD.tags}}, "|")) & "|"`
    labelTerms.push(`FIND("|" & LOWER("${label}") & "|", ${joined}) > 0`)
  }
  if (labelTerms.length === 1) terms.push(labelTerms[0])
  if (labelTerms.length > 1) terms.push(`OR(${labelTerms.join(', ')})`)
  return terms
}

export async function listConversationsPage(opts: {
  pageSize?: number
  /** Airtable cursor returned by a previous call; omit for the first page. */
  offset?: string
  /** Free-text filter across the conversation content (omit for all). */
  search?: string
  /** Reviewer-verdict filter: any of 'Good' | 'Bad' | 'Unsure' | 'Unrated'. */
  review?: string[]
  /** Only conversations carrying any of these exact labels. */
  label?: string[]
}): Promise<{ conversations: ConversationRow[]; offset: string | null }> {
  ensureConfig(CONVERSATIONS_TABLE)
  const want = Math.max(1, opts.pageSize ?? 200)
  const terms = [
    ...(searchFormula(opts.search) ? [searchFormula(opts.search)!] : []),
    ...reviewFilterTerms(opts),
  ]
  const formula =
    terms.length === 0
      ? undefined
      : terms.length === 1
        ? terms[0]
        : `AND(${terms.join(', ')})`
  const out: AirtableRow<ConversationFields>[] = []
  // Airtable caps a single request at 100 records, so loop until we've
  // gathered `want` (or run out), carrying Airtable's offset between requests.
  let cursor: string | undefined = opts.offset
  do {
    const params = new URLSearchParams()
    params.set('pageSize', String(Math.min(100, want - out.length)))
    params.set('sort[0][field]', FIELD.createdAt)
    params.set('sort[0][direction]', 'desc')
    params.set('returnFieldsByFieldId', 'true')
    if (formula) params.set('filterByFormula', formula)
    if (cursor) params.set('offset', cursor)
    const res = await airtableRequest(
      `${CONVERSATIONS_TABLE}?${params.toString()}`
    )
    if (!res.ok) {
      throw new Error(`Airtable list failed: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as AirtableListResponse<ConversationFields>
    out.push(...data.records)
    cursor = data.offset
  } while (cursor && out.length < want)
  return {
    conversations: out.map(rowToConversation),
    offset: cursor ?? null,
  }
}

/** Every conversation created inside the given window (epoch-ms bounds, either
 *  side open), fetched with only the fields the analytics dashboard's chatbot
 *  panels read — Data (the transcript), Clicked and Ratings — so the payload
 *  stays as small as the ever-growing log allows. */
export async function listConversationsForStats(range: {
  startMs: number | null
  endMs: number | null
}): Promise<ConversationRow[]> {
  ensureConfig(CONVERSATIONS_TABLE)
  // IS_AFTER/IS_BEFORE are strict, so widen each bound by 1ms to keep the
  // range's own endpoints included.
  const parts: string[] = []
  if (range.startMs != null) {
    const iso = new Date(range.startMs - 1).toISOString()
    parts.push(`IS_AFTER(CREATED_TIME(), '${iso}')`)
  }
  if (range.endMs != null) {
    const iso = new Date(range.endMs + 1).toISOString()
    parts.push(`IS_BEFORE(CREATED_TIME(), '${iso}')`)
  }
  const params = new URLSearchParams()
  if (parts.length > 0) {
    params.set(
      'filterByFormula',
      parts.length === 1 ? parts[0] : `AND(${parts.join(', ')})`
    )
  }
  params.set('returnFieldsByFieldId', 'true')
  params.append('fields[]', FIELD.data)
  params.append('fields[]', FIELD.clicked)
  params.append('fields[]', FIELD.ratings)
  const rows = await listAll<ConversationFields>(CONVERSATIONS_TABLE, params)
  return rows.map(rowToConversation)
}

export async function updateConversation(
  id: string,
  patch: {
    notes?: string
    tags?: string[]
    review?: ReviewValue | null
    /** A new signed note, appended to the Notes field under the actor's name. */
    addNote?: string
    /** An existing signed note to remove (anyone may delete any note). */
    deleteNote?: { index: number; at: string; actor: string }
  },
  /** Admin sign-in name of whoever is making the change, for the row's
   *  Review log and Reviewed by. */
  actor: string
): Promise<ConversationRow> {
  ensureConfig(CONVERSATIONS_TABLE)
  if (!isRecordId(id)) throw new Error('not an Airtable record id')
  // Read the row first so the log can say what actually changed (a re-sent
  // identical label list or unchanged notes writes no line).
  const current = await airtableRequest(
    `${CONVERSATIONS_TABLE}/${id}?returnFieldsByFieldId=true`
  )
  if (!current.ok) {
    throw new Error(
      `Airtable read failed: ${current.status} ${await current.text()}`
    )
  }
  const before = rowToConversation(
    (await current.json()) as AirtableRow<ConversationFields>
  )
  const changes = describeAnnotationChanges(
    { review: before.review, tags: before.tags, notes: before.notes },
    patch
  )

  const fields: ConversationFields = {}
  if (patch.notes !== undefined) fields[FIELD.notes] = patch.notes
  if (patch.addNote !== undefined && patch.addNote.trim()) {
    fields[FIELD.notes] = appendNote(
      patch.notes ?? before.notes,
      actor,
      patch.addNote
    )
  }
  if (patch.deleteNote) {
    const next = removeNote(before.notes, patch.deleteNote)
    if (next === null) throw new NoteNotFoundError()
    fields[FIELD.notes] = next
  }
  if (patch.tags !== undefined) fields[FIELD.tags] = patch.tags
  // null clears the verdict (the reviewer clicked their rating off again).
  if (patch.review !== undefined) {
    fields[FIELD.review] = patch.review
    if ((patch.review ?? '') !== before.review) {
      fields[FIELD.reviewedBy] = patch.review ? actor : ''
    }
  }
  if (changes.length > 0) {
    fields[FIELD.reviewLog] = appendLog(
      before.reviewLog,
      formatLogLines(actor, changes)
    )
  }
  // typecast lets a label that isn't yet a Tags option create itself, so
  // reviewers can define new labels on the go. The route validates Review
  // against REVIEW_VALUES, so typecast can't invent verdict options.
  const res = await airtableRequest(`${CONVERSATIONS_TABLE}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields,
      returnFieldsByFieldId: true,
      typecast: true,
    }),
  })
  if (!res.ok) {
    throw new Error(`Airtable update failed: ${res.status} ${await res.text()}`)
  }
  return rowToConversation(
    (await res.json()) as AirtableRow<ConversationFields>
  )
}

/** Restores a conversation's complete history from its blob mirror, when it
 *  has one. The blob can be a turn stale (its write is best-effort), so only
 *  messages from BEFORE the row's own window are taken from it — the window
 *  always carries the newest turns. Any failure returns the windowed row
 *  unchanged. */
async function withFullTranscript(
  row: ConversationRow
): Promise<ConversationRow> {
  const data = row.data
  if (!data?.transcript) return row
  // The first stored message's widget position — everything below it was cut
  // from the row. Rows with a transcript always store the mapping.
  const firstKept = data.historyIndices?.[0]
  if (typeof firstKept !== 'number') return row
  const full = await readTranscript(data.transcript)
  if (!full) return row
  const history: HistoryTurn[] = []
  const indices: number[] = []
  for (let i = 0; i < full.history.length; i++) {
    if (full.historyIndices[i] < firstKept) {
      history.push(full.history[i])
      indices.push(full.historyIndices[i])
    }
  }
  if (history.length > 0) {
    data.history = [...history, ...data.history]
    data.historyIndices = [...indices, ...(data.historyIndices ?? [])]
  }
  return row
}

/** One conversation by record id — for the log's shareable links, which may
 *  point at a conversation older than the page the viewer has loaded. Null
 *  when the id doesn't exist (a deleted row, or a mangled link). Long
 *  conversations come back with their blob-mirrored full transcript merged
 *  in (the list endpoints stay windowed — one blob fetch per row would not
 *  scale to a 200-row page). */
export async function getConversation(
  id: string
): Promise<ConversationRow | null> {
  ensureConfig(CONVERSATIONS_TABLE)
  // Not a record id, so not a conversation either.
  if (!isRecordId(id)) return null
  const params = new URLSearchParams()
  params.set('returnFieldsByFieldId', 'true')
  const res = await airtableRequest(
    `${CONVERSATIONS_TABLE}/${encodeURIComponent(id)}?${params.toString()}`
  )
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Airtable get failed: ${res.status} ${await res.text()}`)
  }
  return withFullTranscript(
    rowToConversation((await res.json()) as AirtableRow<ConversationFields>)
  )
}

/** How many conversations carry each label and each Review verdict (with
 *  'Unrated' for rows nobody has judged), for the filter pills' counts and
 *  the label pickers' vocabulary. Reads only the Tags and Review columns, so
 *  the scan stays light as the log grows. */
export async function listAnnotationFacets(): Promise<{
  labels: Record<string, number>
  ratings: Record<string, number>
}> {
  ensureConfig(CONVERSATIONS_TABLE)
  const params = new URLSearchParams()
  params.set('returnFieldsByFieldId', 'true')
  params.append('fields[]', FIELD.tags)
  params.append('fields[]', FIELD.review)
  const rows = await listAll<ConversationFields>(CONVERSATIONS_TABLE, params)
  const labels: Record<string, number> = {}
  const ratings: Record<string, number> = {
    Good: 0,
    Bad: 0,
    Unsure: 0,
    Unrated: 0,
  }
  for (const row of rows) {
    const tags = row.fields[FIELD.tags]
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (typeof t === 'string' && t.trim()) {
          labels[t] = (labels[t] ?? 0) + 1
        }
      }
    }
    const review = parseReview(row.fields[FIELD.review])
    ratings[review === '' ? 'Unrated' : review] += 1
  }
  return { labels, ratings }
}

async function findConversationBySession(
  session: string
): Promise<AirtableRow<ConversationFields> | null> {
  ensureConfig(CONVERSATIONS_TABLE)
  // Quote the value for the formula literal: backslashes first, then double
  // quotes, so neither can end the string early.
  const escaped = session.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const params = new URLSearchParams()
  params.set('filterByFormula', `{${FIELD.session}} = "${escaped}"`)
  params.set('maxRecords', '1')
  params.set('returnFieldsByFieldId', 'true')
  const res = await airtableRequest(
    `${CONVERSATIONS_TABLE}?${params.toString()}`
  )
  if (!res.ok) {
    throw new Error(`Airtable lookup failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as AirtableListResponse<ConversationFields>
  return data.records[0] ?? null
}

export async function upsertConversation(input: {
  /** ISO timestamp of when this turn's user message arrived. */
  turnAt: string
  session: string | null
  page: string
  user: string
  response: string
  history: HistoryTurn[]
  historyIndices: number[]
  /** The whole cleaned conversation — `history` is a window of this — with
   *  its widget positions, for the full-transcript blob mirror. */
  fullHistory: HistoryTurn[]
  fullIndices: number[]
  tools: unknown
  fallbackCards: string[]
  citations: string[]
  citationRefs: StoredCitation[]
  geo: ConversationData['geo']
  referrer: string | null
  utm: Record<string, string> | null
  pageState: Record<string, unknown> | null
  latencyMs: number
  zeroMatches: boolean
  status?: 'abandoned' | 'error'
  promptVersion: string
  /** Labels for a NEW row only (the 'internal' marker on our own test chats).
   *  Deliberately not patched onto an existing row: later turns must never
   *  overwrite labels a reviewer added by hand in the log. */
  tags?: string[]
}): Promise<void> {
  ensureConfig(CONVERSATIONS_TABLE)

  // Without a session id we can't dedupe across turns; just create a new row.
  const existing = input.session
    ? await findConversationBySession(input.session)
    : null
  const previous = existing
    ? parseData(str(existing.fields[FIELD.data]) || undefined)
    : null

  // A re-sent message — the widget's Edit or Try again cut the visitor's
  // list back to an earlier position and sent again — arrives at a reply
  // position this row has already logged. This write's history replaces the
  // old text from that point on, and the per-turn arrays must follow: drop
  // the entries of every turn at that position or later, then append this
  // one. Appending regardless let the arrays outgrow the transcript, and the
  // viewer (which lines them up from the end) then pinned tool calls and
  // times on the wrong turns.
  const replyIndex = replyIndexOf(input.historyIndices)
  const loggedTurns = previous?.tools.length ?? 0
  const keptTurns = previous ? turnsToKeep(previous, replyIndex) : 0
  const perTurn = <T>(arr: T[] | undefined, next: T): T[] => [
    ...slicePerTurn(arr, loggedTurns, keptTurns),
    next,
  ]

  const data: ConversationData = {
    user: input.user,
    response: input.response,
    history: input.history,
    historyIndices: input.historyIndices,
    tools: perTurn(previous?.tools, input.tools),
    // Older rows have no fallbackCards/turnTimes/pages key; starting an array
    // now still aligns because the viewer matches turns from the END —
    // pre-tracking turns simply resolve to no entry.
    fallbackCards: perTurn(previous?.fallbackCards, input.fallbackCards),
    turnTimes: perTurn(previous?.turnTimes, input.turnAt),
    pages: perTurn(previous?.pages, input.page),
    turnIndices: perTurn(previous?.turnIndices, replyIndex),
    citations: previous
      ? Array.from(new Set([...previous.citations, ...input.citations]))
      : input.citations,
    // Accumulate name/url snapshots across turns, deduped by id (latest wins).
    citationRefs: dedupeCitationRefs([
      ...(previous?.citationRefs ?? []),
      ...input.citationRefs,
    ]),
    geo: input.geo,
    referrer: input.referrer,
    utm: input.utm,
    pageState: input.pageState,
    // Sticky once any turn returned no matches.
    zeroMatches: (previous?.zeroMatches ?? false) || input.zeroMatches,
    // Reflects the latest turn only (unlike zeroMatches): if a visitor
    // abandoned or errored a turn and then asked again successfully, the row
    // is no longer flagged. Omitted entirely on a normal turn.
    ...(input.status ? { status: input.status } : {}),
  }

  // Airtable rejects long-text values over 100,000 characters, and a rejected
  // write loses the whole turn. The route already windows history to 50
  // messages, which fits comfortably at typical message sizes; this is the
  // backstop for the rare chat of very long replies. Drop the oldest messages
  // until the serialized row fits — the transcript viewer already handles a
  // window that opens mid-exchange, and the per-turn arrays keep the true
  // turn count.
  const fitToLimit = () => {
    let s = JSON.stringify(data)
    while (s.length > MAX_DATA_CHARS && data.history.length > 2) {
      data.history = data.history.slice(1)
      // Keep the position map aligned with what remains.
      data.historyIndices = data.historyIndices?.slice(1)
      s = JSON.stringify(data)
    }
    return s
  }
  let serialized = fitToLimit()

  // Whatever the window or the size trim cut is gone from this row — mirror
  // the COMPLETE transcript to a blob and keep its URL, so the viewer can
  // still show the whole conversation. Short chats (the vast majority) never
  // need one; once a conversation has one, every later turn refreshes it. A
  // failed write keeps pointing at the previous copy: this row's own window
  // always carries the newest turns, so the viewer merges the older blob
  // with the window and at worst re-loses the same middle turns.
  if (input.fullHistory.length > data.history.length || previous?.transcript) {
    const url = await writeTranscript(previous?.transcript, {
      history: input.fullHistory,
      historyIndices: input.fullIndices,
    })
    const kept = url ?? previous?.transcript
    if (kept) {
      data.transcript = kept
      // Adding the URL can nudge the row back over the ceiling.
      serialized = fitToLimit()
    }
  }

  // The messages cut from Data above are invisible to the log's free-text
  // search (an Airtable formula over this row's fields). Mirror their PLAIN
  // TEXT into the Search overflow field — searched, never displayed (the
  // transcript blob is the display copy). Capped under Airtable's 100k cell
  // limit by dropping the OLDEST text first; only a conversation whose
  // overflow alone tops ~95k (roughly 45+ exchanges) ever escapes search.
  const cutCount = input.fullHistory.length - data.history.length
  let overflowText = ''
  if (cutCount > 0) {
    overflowText = input.fullHistory
      .slice(0, cutCount)
      .map(m => m.content)
      .join('\n\n')
    const MAX_OVERFLOW_CHARS = 95_000
    if (overflowText.length > MAX_OVERFLOW_CHARS) {
      overflowText = overflowText.slice(-MAX_OVERFLOW_CHARS)
    }
  }

  const fields: ConversationFields = {
    [FIELD.session]: input.session ?? '',
    // The page where the conversation STARTED — written on create, never
    // patched. It has to match the greeting the visitor actually saw, and a
    // real conversation once got stamped /self-study because its last turn
    // overwrote the /map it began on. Per-turn pages (including any
    // mid-conversation navigation) live in Data's `pages` array.
    ...(existing ? {} : { [FIELD.page]: input.page }),
    // Create-only, for the same reason as Page above: a reviewer's hand-added
    // labels must survive every later turn of the conversation.
    ...(existing || !input.tags?.length ? {} : { [FIELD.tags]: input.tags }),
    [FIELD.latencyMs]: input.latencyMs,
    [FIELD.promptVersion]: input.promptVersion,
    [FIELD.data]: serialized,
    // Skipped while empty so short conversations never touch the field.
    ...(overflowText ? { [FIELD.searchOverflow]: overflowText } : {}),
  }

  // typecast lets the 'internal' label create itself as a Tags option the
  // first time it's used, the same way hand-typed labels do in
  // updateConversation. Only set when a label is actually being written, so a
  // plain turn keeps the strict write it has always had.
  const writingTags = !existing && Boolean(input.tags?.length)
  const res = existing
    ? await airtableRequest(`${CONVERSATIONS_TABLE}/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields }),
      })
    : await airtableRequest(CONVERSATIONS_TABLE, {
        method: 'POST',
        body: JSON.stringify(
          writingTags ? { fields, typecast: true } : { fields }
        ),
      })

  if (!res.ok) {
    const verb = existing ? 'update' : 'append'
    throw new Error(
      `Airtable ${verb} failed: ${res.status} ${await res.text()}`
    )
  }
}

/** Records that the visitor clicked a listing's card during a conversation.
 *  Reads-modifies-writes only the Clicked field (disjoint from the turn
 *  upsert's fields, so concurrent writes don't clobber each other). No-ops if
 *  the conversation row doesn't exist yet or the click is already recorded. */
export async function recordCitationClick(
  session: string,
  citationId: string
): Promise<void> {
  ensureConfig(CONVERSATIONS_TABLE)
  const existing = await findConversationBySession(session)
  // The turn write (via after()) usually lands before the visitor can click,
  // but if the row isn't there yet we simply drop the click rather than
  // creating a dataless row.
  if (!existing) return
  const current = parseClicked(str(existing.fields[FIELD.clicked]) || undefined)
  if (current.includes(citationId)) return
  const next = [...current, citationId]
  const res = await airtableRequest(`${CONVERSATIONS_TABLE}/${existing.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: { [FIELD.clicked]: JSON.stringify(next) },
    }),
  })
  if (!res.ok) {
    throw new Error(
      `Airtable click update failed: ${res.status} ${await res.text()}`
    )
  }
}

/** Records the visitor's thumbs rating of one bot reply. Reads-modifies-writes
 *  only the Ratings field (disjoint from the turn upsert's fields and from
 *  Clicked, so none of the three writers can clobber another). A switched
 *  thumb overwrites the earlier value for that turn; a null value removes the
 *  turn's rating (the visitor clicked their thumb off again); re-sending the
 *  same value is a no-op. Like clicks, a rating that arrives before the
 *  conversation row exists is dropped rather than creating a dataless row. */
export async function recordMessageRating(
  session: string,
  turnIndex: number,
  value: MessageRatingValue | null
): Promise<void> {
  ensureConfig(CONVERSATIONS_TABLE)
  const existing = await findConversationBySession(session)
  if (!existing) return
  const current = parseRatings(str(existing.fields[FIELD.ratings]) || undefined)
  const key = String(turnIndex)
  if ((current[key] ?? null) === value) return
  const next: MessageRatings = { ...current }
  if (value === null) delete next[key]
  else next[key] = value
  const res = await airtableRequest(`${CONVERSATIONS_TABLE}/${existing.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: { [FIELD.ratings]: JSON.stringify(next) },
    }),
  })
  if (!res.ok) {
    throw new Error(
      `Airtable rating update failed: ${res.status} ${await res.text()}`
    )
  }
}

// How long to wait for a conversation's row to appear before giving up on a
// delivery report (see recordTurnDelivery).
const DELIVERY_ROW_WAIT_ATTEMPTS = 4
const DELIVERY_ROW_WAIT_MS = 1500

/** Records what the visitor's browser reported about one reply. Merges the
 *  patch into that turn's entry, so the outcome ('received' with the panel
 *  state) and a later 'seen' land in the same object. Reads-modifies-writes
 *  only the Delivery field — its own column, like Clicked and Ratings, so
 *  none of the out-of-band writers can clobber the turn upsert or each other.
 *
 *  Unlike clicks and ratings, the main report ('received') fires the instant
 *  the stream ends in the browser — the same moment the server's own turn
 *  write starts (in after(), once the stream closes). On a conversation's
 *  FIRST turn the row usually doesn't exist yet when the report arrives, so
 *  rather than dropping it we wait briefly for the row. Still missing after
 *  that (the turn write failed, or the browser is excluded from logging)
 *  → warn and drop, never create a dataless row. */
export async function recordTurnDelivery(
  session: string,
  turnIndex: number,
  patch: Partial<TurnDelivery>
): Promise<void> {
  ensureConfig(CONVERSATIONS_TABLE)
  let existing = await findConversationBySession(session)
  for (
    let attempt = 0;
    !existing && attempt < DELIVERY_ROW_WAIT_ATTEMPTS;
    attempt++
  ) {
    await new Promise(resolve => setTimeout(resolve, DELIVERY_ROW_WAIT_MS))
    existing = await findConversationBySession(session)
  }
  if (!existing) {
    console.warn(
      `[assistant] delivery report dropped — no conversation row for session ${session} after ${(DELIVERY_ROW_WAIT_ATTEMPTS * DELIVERY_ROW_WAIT_MS) / 1000}s`
    )
    return
  }
  const current = parseDelivery(
    str(existing.fields[FIELD.delivery]) || undefined
  )
  const key = String(turnIndex)
  const next: DeliveryByTurn = {
    ...current,
    [key]: { ...current[key], ...patch },
  }
  const res = await airtableRequest(`${CONVERSATIONS_TABLE}/${existing.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: { [FIELD.delivery]: JSON.stringify(next) },
    }),
  })
  if (!res.ok) {
    throw new Error(
      `Airtable delivery update failed: ${res.status} ${await res.text()}`
    )
  }
}

export function isConversationsTableConfigured(): boolean {
  return Boolean(TOKEN && BASE && CONVERSATIONS_TABLE)
}
