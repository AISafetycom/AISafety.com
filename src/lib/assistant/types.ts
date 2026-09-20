export type ListingType =
  | 'job'
  | 'funder'
  | 'advisor'
  | 'community'
  | 'course'
  | 'founder-resource'
  | 'project'
  | 'media-channel'
  | 'org'
  | 'event'
  | 'training'
  | 'person'

export interface Listing {
  id: string
  type: ListingType
  name: string
  description: string
  organization?: string
  logo?: string
  url: string
  pageUrl: string
  meta: Record<string, string>
  /** Geographic coordinates if known (currently only communities have these). */
  latitude?: number
  longitude?: number
  featured?: boolean
  /** YYYY-MM-DD the record was added to Airtable. Not set for jobs (their
   *  datePublished meta covers recency). Kept out of `meta` so it only reaches
   *  the model in recency-sorted searches and get_listing. */
  dateAdded?: string
  /** YYYY-MM-DD any field of the record last changed (edits of any kind,
   *  including routine maintenance). Same visibility rules as dateAdded. */
  lastModified?: string
  /** Fuller background reaching the model only via get_listing — search
   *  results stay lean. Currently only projects have it (Airtable's
   *  "Description (long)"). NOT displayed anywhere on the site, so the
   *  prompt forbids citing it as on-page content or repeating names from it. */
  details?: string
}

export interface Catalog {
  listings: Listing[]
  generatedAt: string
}

export type Role = 'user' | 'assistant'

export interface ChatMessage {
  role: Role
  content: string
}

export interface AssistantRequest {
  messages: ChatMessage[]
  currentPage: string
  pageState?: Record<string, unknown> | null
  referrer?: string | null
  utm?: Record<string, string> | null
  /** Per-tab stable id so multiple turns can be grouped */
  sessionId?: string | null
  /** Client-supplied geo (used when Vercel headers absent, e.g. dev) */
  geoFallback?: { city?: string; region?: string; country?: string } | null
  /** When the owner has excluded this browser, skip writing the turn to the
   *  conversation log so their own testing doesn't clutter it. */
  noLog?: boolean
}

export interface UIToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  resultSummary?: string
  /** Listings the tool returned (used to populate the citation lookup) */
  listings?: CitationRef[]
}

/** Streamed assistant message is an ordered sequence of text segments,
 *  tool calls, and an optional `thinking_done` boundary that splits
 *  internal reasoning from the user-facing answer. Everything before the
 *  boundary collapses into a "Searched N times" toggle once it appears. */
export type MessageEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; toolCallId: string }
  | { kind: 'thinking_done' }
  /** Server sent the model back to redo an answer that carded fabricated
   *  ids. Text after this event is the redo's reasoning (never shown); the
   *  widget keeps the retracted draft on screen until the corrected answer
   *  (after the redo's own thinking_done) starts streaming. */
  | { kind: 'redo' }

export interface CitationRef {
  id: string
  type: ListingType
  name: string
  organization?: string
  logo?: string
  url: string
  pageUrl: string
  description: string
  meta: Record<string, string>
}
