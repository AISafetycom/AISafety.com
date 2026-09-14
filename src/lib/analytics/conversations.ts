// Chatbot conversation stats for the admin analytics dashboard, derived from
// the Airtable conversation log (the same table the Conversation Log viewer
// reads). Everything here is computed per-query from the raw transcripts —
// nothing is precomputed or stored — so the panels are fully date-range aware.

import {
  entryFromEnd,
  historyIsComplete,
  loggedTurnCount,
  turnFromEnd,
} from '@/lib/admin/conversation-turns'
import { franc } from 'franc-min'
import { PAGES, DEFAULT_CHIPS } from '@/lib/assistant/pages'
import { extractChips, stripChipTokens } from '@/lib/assistant/tokens'
import {
  isConversationsTableConfigured,
  listConversationsForStats,
  type ConversationRow,
} from '@/lib/admin/airtable'
import type { Counted, DateRange } from './events'

export interface TopQuestion {
  /** The question as the first visitor to ask it typed it. */
  text: string
  /** Conversations that started with this question. */
  count: number
  /** True when it matches one of the chatbot's suggested-question chips. */
  suggested: boolean
}

/** One thumbs-rated bot reply, for the dashboard's rated-replies table. */
export interface RatedReply {
  /** When the visitor sent the message this reply answered (ISO). Falls back
   *  to the conversation's creation time for rows without per-turn times. */
  at: string
  rating: 'up' | 'down'
  /** The visitor's message the reply answered, or null when that turn has
   *  fallen out of the stored (windowed) history. */
  question: string | null
  /** The reply itself as plain text (card/chip markers stripped), or null
   *  when it's fallen out of the stored history. */
  reply: string | null
  /** Page the chat was open on for that turn ('/funding', …), when stored. */
  page: string | null
}

export interface ConversationStats {
  /** False when the log table isn't configured or couldn't be reached; the
   *  dashboard shows a notice instead of the transcript-derived panels. */
  available: boolean
  /** Conversations created inside the selected range. */
  totalConversations: number
  /** Median user messages per conversation, or null with no data. */
  medianLength: number | null
  /** Share (0–1) of conversations whose first message is one of the suggested
   *  question chips, or null with no data. */
  suggestedShare: number | null
  /** Share (0–1) of ALL user messages that clicked one of the follow-up
   *  pills the bot offers after each reply (a message matching a `[[chip:…]]`
   *  the previous reply carried). Conversation-STARTING chips are deliberately
   *  excluded — they're `suggestedShare`'s job — so the two tiles never count
   *  the same click. Computed over the stored histories, so both sides of the
   *  fraction cover the same messages. Null with no data. */
  followUpMessageShare: number | null
  /** Share (0–1) of conversations where the visitor clicked a listing card or
   *  link out of a reply, or null with no data. */
  clickedShare: number | null
  /** Bot replies the visitor rated thumbs up / thumbs down (each reply counts
   *  once, under its final rating — a switched thumb overwrites). */
  ratedUp: number
  ratedDown: number
  /** Share (0–1) of rated replies that got a thumbs up, or null when nothing
   *  in the range was rated. */
  thumbsUpShare: number | null
  /** Share (0–1) of conversations where the visitor rated at least one reply,
   *  or null with no data. */
  ratedConversationShare: number | null
  /** Every rated reply in the range, newest first. */
  ratedReplies: RatedReply[]
  /** Conversations bucketed by how many messages the visitor sent. */
  lengthBuckets: Counted[]
  /** Conversations bucketed by auto-detected language, busiest first. */
  languages: Counted[]
  /** The most common conversation-opening questions, busiest first. */
  topQuestions: TopQuestion[]
}

const EMPTY_STATS: ConversationStats = {
  available: false,
  totalConversations: 0,
  medianLength: null,
  suggestedShare: null,
  followUpMessageShare: null,
  clickedShare: null,
  ratedUp: 0,
  ratedDown: 0,
  thumbsUpShare: null,
  ratedConversationShare: null,
  ratedReplies: [],
  lengthBuckets: [],
  languages: [],
  topQuestions: [],
}

/** Whitespace-collapsed lowercase form, for grouping repeats of one question
 *  and matching against the chip texts. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Every suggested-question chip the site shows, normalized. First messages
 *  matching one of these were (almost certainly) started from a chip click.
 *  Matches the CURRENT chip set — if a chip's wording changes, conversations
 *  started from the old wording read as typed. */
const CHIP_TEXTS = new Set(
  [...PAGES.flatMap(p => p.chips), ...DEFAULT_CHIPS].map(normalize)
)

/** The visitor's messages in a conversation, oldest first. The stored history
 *  is windowed for long chats, so this can miss a long conversation's earliest
 *  messages; `data.user` (the latest message) covers rows with no history at
 *  all (e.g. an abandoned first turn). */
function userMessages(row: ConversationRow): string[] {
  const d = row.data
  if (!d) return []
  const fromHistory = d.history
    .filter(t => t.role === 'user')
    .map(t => t.content)
    .filter(Boolean)
  if (fromHistory.length > 0) return fromHistory
  return d.user ? [d.user] : []
}

/** How many messages the visitor sent, from the per-turn arrays the log
 *  appends to on every turn (turnTimes, else tools — one entry each per
 *  logged turn, never windowed). Falls back to counting the history's user
 *  messages for rows older than per-turn tracking. */
function conversationLength(row: ConversationRow): number {
  const d = row.data
  if (!d) return 0
  // A complete history is the truth itself; the per-turn count can only
  // overshoot it (re-sent turns logged twice, before 2 Sept 2026).
  if (historyIsComplete(d)) return userMessages(row).length
  return loggedTurnCount(d) || userMessages(row).length
}

/** `[[card:ID|note]]` and `[[suggest:type]]` markers in a reply — dropped for
 *  the plain-text snippet. */
const CARD_OR_SUGGEST_TOKEN = /\[\[\s*(?:card|suggest)\s*:[^\]\n]*\]\]/gi
/** End of the model's reasoning; the answer is what follows the LAST one
 *  (same rule as the transcript viewer and the live renderer). */
const THINKING_DONE = /\[\[\s*\/\s*thinking\s*\]\]/gi

/** A stored reply as the readable answer: reasoning before the final
 *  thinking marker dropped, card/suggest/chip markers removed, whitespace
 *  collapsed. */
function replyText(raw: string): string {
  let answer = raw
  let last: RegExpExecArray | null = null
  THINKING_DONE.lastIndex = 0
  for (let m = THINKING_DONE.exec(raw); m; m = THINKING_DONE.exec(raw)) {
    last = m
  }
  if (last) answer = raw.slice(last.index + last[0].length)
  return stripChipTokens(answer.replace(CARD_OR_SUGGEST_TOKEN, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

/** The rated replies on one conversation row. The rating's turn index is the
 *  reply's position in the message list, which matches the stored history
 *  unless the conversation outgrew the history window (or an errored turn
 *  left the two out of step) — then the reply text can't be recovered and
 *  the entry keeps only its rating and time. */
function ratedRepliesOf(row: ConversationRow): RatedReply[] {
  const out: RatedReply[] = []
  const d = row.data
  for (const [key, rating] of Object.entries(row.ratings)) {
    const idx = Number(key)
    if (!Number.isInteger(idx) || idx < 0) continue
    const reply = d?.history[idx]
    const question = idx > 0 ? d?.history[idx - 1] : undefined
    const aligned = reply?.role === 'assistant' && question?.role === 'user'
    // The reply's own logged turn (turnFromEnd resolves a reply to the turn
    // of the question it answers), so the time/page belong to this reply.
    const turn = aligned ? turnFromEnd(d!, idx) : 0
    const at = aligned ? entryFromEnd(d!.turnTimes, turn) : undefined
    const page = aligned ? entryFromEnd(d!.pages, turn) : undefined
    out.push({
      at: typeof at === 'string' ? at : row.createdAt,
      rating,
      question: aligned ? question!.content : null,
      reply: aligned ? replyText(reply!.content) : null,
      page: typeof page === 'string' ? page : null,
    })
  }
  return out
}

/** ISO 639-3 codes franc may return here, mapped to display names. Detection
 *  is restricted to exactly these languages: a whitelist keeps short queries
 *  from being misread as exotic near-neighbours (e.g. English as Scots). */
const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  spa: 'Spanish',
  por: 'Portuguese',
  fra: 'French',
  deu: 'German',
  nld: 'Dutch',
  ita: 'Italian',
  pol: 'Polish',
  ron: 'Romanian',
  ces: 'Czech',
  hun: 'Hungarian',
  ell: 'Greek',
  swe: 'Swedish',
  rus: 'Russian',
  ukr: 'Ukrainian',
  tur: 'Turkish',
  arb: 'Arabic',
  pes: 'Persian',
  hin: 'Hindi',
  ben: 'Bengali',
  urd: 'Urdu',
  tam: 'Tamil',
  tel: 'Telugu',
  mar: 'Marathi',
  cmn: 'Chinese',
  jpn: 'Japanese',
  kor: 'Korean',
  vie: 'Vietnamese',
  ind: 'Indonesian',
  tha: 'Thai',
}
const DETECTABLE = Object.keys(LANGUAGE_NAMES)

/** Common English words (function words plus the content words this site's
 *  queries actually use). Trigram detection is unreliable on short texts —
 *  "show me jobs" reads as Hungarian, "Communities near me" as Spanish — so
 *  a text where these words dominate is called English before franc runs. */
const ENGLISH_WORDS = new Set(
  `the a an and or but of to in on for with at from by about as into out up
   over is are am was were be been being do does did done have has had will
   would can could should shall may might must not no yes if then than so
   because i im i'm me my mine we our us you your it its this that these
   those there here what which who whom whose how when where why any some
   all more most best good great new near also just like want wants need
   needs looking look find show get give go going help know think thinks
   make start started starting work working worked learn learning apply
   applying applied interested interesting course courses program programs
   programme training event events conference conferences community
   communities group groups people person role roles remote entry level
   career careers research researcher researchers policy governance funding
   grant grants fund funds funders donate donation donations money
   organization organizations organisation organisations volunteer
   volunteering project projects please thanks thank hi hello hey very
   really much many lot again still currently upcoming accepting
   application applications open now soon today part full time week month
   year long short beginner beginners friendly technical individual orgs
   ok okay cool test message messages model models dear u r ur pls plz
   wheres whats hows thats dont cant wont ive ill id youre yeah sure maybe`
    .split(/\s+/)
    .filter(Boolean)
)

/** Words that are the same in visitor queries regardless of language ("AI",
 *  "safety", "job" — German and Spanish speakers write these too). They count
 *  as neither English nor foreign evidence. */
const NEUTRAL_WORDS = new Set([
  'ai',
  'agi',
  'ml',
  'llm',
  'llms',
  'safety',
  'alignment',
  'job',
  'jobs',
])

/** Best-effort language of a conversation, from everything the visitor wrote.
 *
 *  Suggested-chip messages are site-authored English, so they say nothing
 *  about the visitor's own language and are set aside — a chip-only
 *  conversation counts as English (that's the language the visitor chose to
 *  interact in). For typed text, a simple word check runs first: if common
 *  English words dominate, it's English — this is what actually decides most
 *  real queries, because trigram detection (franc) misreads short English as
 *  its Latin-script neighbours. franc then only judges texts that don't look
 *  English, which is what it's good at. 'Unknown' when there's too little to
 *  call.
 *
 *  The word check judges each message on its own, not the conversation
 *  joined: a conversation that starts in English and switches language would
 *  otherwise read as English overall, because the joined text stays mostly
 *  English words. When both English and non-English messages exist, the
 *  non-English side names the conversation (the visitor's own language is
 *  the informative one) — but only when it carries enough words
 *  (FOREIGN_WORDS_MIN) for franc's verdict to be trustworthy. Below that,
 *  everything is judged joined as one text, exactly as before per-message
 *  checks existed — franc misreads short English tech-speak ("Full stack
 *  engineer JavaScript angular Java" reads as Swedish), so a few odd words
 *  must not outvote clear English. */
const FOREIGN_WORDS_MIN = 12
/** Non-Latin letters it takes for the non-Latin part of a conversation to be
 *  judged on its own (fewer could be a stray symbol in a pasted formula). */
const NON_LATIN_MIN = 20
/** Pasted links say nothing about the writer's language. */
const stripUrls = (text: string) => text.replace(/\bhttps?:\/\/\S+/gi, ' ')
function detectLanguage(messages: string[]): string {
  const typed = messages
    .filter(m => !CHIP_TEXTS.has(normalize(m)))
    .map(stripUrls)
  if (typed.length === 0) return messages.length > 0 ? 'English' : 'Unknown'

  const scorableWords = (text: string) =>
    (text.toLowerCase().match(/[\p{L}']+/gu) ?? []).filter(
      w => !NEUTRAL_WORDS.has(w)
    )
  const looksEnglish = (scorable: string[]) => {
    const hits = scorable.filter(w => ENGLISH_WORDS.has(w)).length
    return hits / scorable.length >= 0.4
  }

  let sawEnglish = false
  let sawWords = false
  const foreign: string[] = []
  let foreignWords = 0
  for (const m of typed) {
    const words = m.toLowerCase().match(/[\p{L}']+/gu) ?? []
    if (words.length === 0) continue // numbers/punctuation say nothing
    sawWords = true
    const scorable = words.filter(w => !NEUTRAL_WORDS.has(w))
    if (scorable.length === 0 || looksEnglish(scorable)) {
      sawEnglish = true // all-neutral ("AI safety") counts as English
      continue
    }
    foreign.push(m)
    foreignWords += scorable.length
  }
  if (!sawWords) return 'Unknown'
  if (foreign.length === 0) return 'English'

  // A clear-English conversation with a substantial non-English part: the
  // non-English part names it. franc still gets the messages joined, so
  // short ones don't starve it.
  if (!sawEnglish || foreignWords >= FOREIGN_WORDS_MIN) {
    // The visitor's own script is decisive. Pasted English paper titles and
    // similar Latin-script noise can outvote a non-Latin script in franc's
    // trigram counts — but nobody writes Arabic (or Chinese, Russian, …) by
    // accident, so when the non-English part holds real non-Latin text,
    // judge just the messages written mostly in it.
    const letters = (t: string) => (t.match(/\p{L}/gu) ?? []).length
    const latin = (t: string) => (t.match(/\p{Script=Latin}/gu) ?? []).length
    const nonLatinTotal = foreign.reduce(
      (sum, m) => sum + letters(m) - latin(m),
      0
    )
    const decisive =
      nonLatinTotal >= NON_LATIN_MIN
        ? foreign.filter(m => latin(m) < letters(m) / 2)
        : foreign
    const code = franc(decisive.join(' '), { only: DETECTABLE })
    const name = LANGUAGE_NAMES[code]
    // franc couldn't call it (or thinks it's English after all): fall back
    // on the clear English evidence when there is some.
    if (name == null || name === 'English')
      return sawEnglish ? 'English' : (name ?? 'Unknown')
    return name
  }

  // Too little non-English text to trust a verdict on it alone — judge
  // everything joined, the way single-language conversations always were.
  const text = typed.join(' ').trim()
  const scorable = scorableWords(text)
  if (scorable.length === 0 || looksEnglish(scorable)) return 'English'
  const code = franc(text, { only: DETECTABLE })
  return LANGUAGE_NAMES[code] ?? 'Unknown'
}

/** Bucket labels for the length distribution, in display order. */
const LENGTH_BUCKETS: { label: string; max: number }[] = [
  { label: '1 message', max: 1 },
  { label: '2 messages', max: 2 },
  { label: '3–5 messages', max: 5 },
  { label: '6–10 messages', max: 10 },
  { label: '11+ messages', max: Infinity },
]

function bucketFor(length: number): string {
  return LENGTH_BUCKETS.find(b => length <= b.max)!.label
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

/** A conversation's user messages, and how many of them clicked a follow-up
 *  pill: a message matching a `[[chip:…]]` suggestion the previous reply
 *  offered (the stored history keeps the raw markers the visitor-facing chat
 *  strips). Conversation-starting chips are NOT counted here — the
 *  started-from-a-suggestion stat covers those. A visitor who types an
 *  offered suggestion verbatim counts as a click — they took the suggestion
 *  either way. */
function countFollowUpMessages(row: ConversationRow): {
  messages: number
  followUps: number
} {
  const history = row.data?.history ?? []
  let messages = 0
  let followUps = 0
  let offered = new Set<string>()
  for (const turn of history) {
    if (turn.role === 'assistant') {
      offered = new Set(extractChips(turn.content).map(normalize))
      continue
    }
    if (!turn.content) continue
    messages += 1
    if (offered.has(normalize(turn.content))) followUps += 1
    offered = new Set() // an offer only applies to the very next message
  }
  // Rows with no stored history but a latest message (e.g. an abandoned
  // first turn) still count that one message.
  if (messages === 0 && row.data?.user) messages = 1
  return { messages, followUps }
}

/** The typed (non-suggested-chip) first message of every conversation in the
 *  range — the input for the question-theme summarizer. Chip messages are
 *  site-authored, so they'd pollute the themes with our own wording. */
export async function listTypedQuestions(range: DateRange): Promise<string[]> {
  const rows = await listConversationsForStats(range)
  const out: string[] = []
  for (const row of rows) {
    const first = userMessages(row)[0]?.trim().replace(/\s+/g, ' ')
    if (!first) continue
    if (CHIP_TEXTS.has(first.toLowerCase())) continue
    out.push(first)
  }
  return out
}

/** Cap on distinct questions sent to the browser — same reasoning as the click
 *  tables' row cap: organic data stays far below it. */
const MAX_QUESTIONS = 500

/** Compute the Chatbot tab's transcript-derived stats for a date range.
 *  Returns `available: false` instead of throwing when the log can't be read —
 *  a hiccup there must not take down the rest of the dashboard. */
export async function readConversationStats(
  range: DateRange
): Promise<ConversationStats> {
  if (!isConversationsTableConfigured()) return EMPTY_STATS
  let rows: ConversationRow[]
  try {
    rows = await listConversationsForStats(range)
  } catch (err) {
    console.warn(
      `[analytics] conversation stats read failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return EMPTY_STATS
  }

  const lengths: number[] = []
  const languages: string[] = []
  const questions = new Map<string, TopQuestion>()
  let withQuestion = 0
  let suggested = 0
  let clicked = 0
  let totalMessages = 0
  let pillMessages = 0
  let ratedUp = 0
  let ratedDown = 0
  let ratedConversations = 0
  const ratedReplies: RatedReply[] = []

  for (const row of rows) {
    const messages = userMessages(row)
    const length = conversationLength(row)
    if (length > 0) {
      lengths.push(length)
      languages.push(detectLanguage(messages))
    }
    if (row.clickedCitations.length > 0) clicked += 1
    const rated = ratedRepliesOf(row)
    if (rated.length > 0) ratedConversations += 1
    for (const r of rated) {
      if (r.rating === 'up') ratedUp += 1
      else ratedDown += 1
      ratedReplies.push(r)
    }
    const pills = countFollowUpMessages(row)
    totalMessages += pills.messages
    pillMessages += pills.followUps

    const first = messages[0]?.trim().replace(/\s+/g, ' ')
    if (!first) continue
    withQuestion += 1
    const key = first.toLowerCase()
    const isChip = CHIP_TEXTS.has(key)
    if (isChip) suggested += 1
    const q = questions.get(key)
    if (q) q.count += 1
    else questions.set(key, { text: first, count: 1, suggested: isChip })
  }

  const langCounts = new Map<string, number>()
  for (const l of languages) langCounts.set(l, (langCounts.get(l) ?? 0) + 1)

  const bucketCounts = new Map<string, number>()
  for (const l of lengths) {
    const b = bucketFor(l)
    bucketCounts.set(b, (bucketCounts.get(b) ?? 0) + 1)
  }

  return {
    available: true,
    totalConversations: rows.length,
    medianLength: median(lengths.sort((a, b) => a - b)),
    suggestedShare: withQuestion > 0 ? suggested / withQuestion : null,
    followUpMessageShare:
      totalMessages > 0 ? pillMessages / totalMessages : null,
    clickedShare: rows.length > 0 ? clicked / rows.length : null,
    ratedUp,
    ratedDown,
    thumbsUpShare:
      ratedUp + ratedDown > 0 ? ratedUp / (ratedUp + ratedDown) : null,
    ratedConversationShare:
      rows.length > 0 ? ratedConversations / rows.length : null,
    // ISO timestamps compare chronologically as strings.
    ratedReplies: ratedReplies.sort((a, b) => (a.at < b.at ? 1 : -1)),
    // Buckets in display order (1 → 11+), only the non-empty ones.
    lengthBuckets: LENGTH_BUCKETS.map(b => ({
      name: b.label,
      count: bucketCounts.get(b.label) ?? 0,
    })).filter(b => b.count > 0),
    languages: [...langCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    topQuestions: [...questions.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_QUESTIONS),
  }
}
