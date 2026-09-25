// Shared streaming + tool-use loop for the assistant. Both the public
// /api/assistant route and the admin /api/admin/test-run route call into
// runAssistantStream so the protocol stays in lockstep.

import Anthropic from '@anthropic-ai/sdk'
import { auditCardCitations, extractCitations } from './citations'
import {
  modelDisplayName,
  outputConfig,
  thinkingAlwaysOn,
  thinkingParam,
} from './models'
import { looksLikeAnswerText, splitAnswerRedoMessage } from './split-answer'
import { LISTING_POLICY_BLOCK } from './prompt'
import { TOOL_DEFINITIONS, executeTool } from './tools'
import type { Catalog, ChatMessage, CitationRef, Listing } from './types'

// Generous so multi-card responses never truncate mid-token. Anthropic
// requires this parameter, so it can't be "unlimited" — pick a value well
// above any realistic response size.
const MAX_TOKENS = 4096
// Messages the MODEL sees each turn (25 exchanges) — bounds prompt size on
// marathon chats. Raised from 14 (28 Aug 2026): the bot forgetting turn 3 by
// turn 11 hurt exactly the engaged visitors, and the extra input cost only
// applies to the rare conversation that runs past 7 exchanges.
const MAX_HISTORY = 50
// Messages the conversation LOG keeps in the Airtable row (25 exchanges) —
// bounded so the serialized row stays well inside Airtable's
// 100,000-character long-text limit (a typical message is ~1,000 chars;
// upsertConversation also trims further if a row would still overflow, and
// mirrors the complete transcript to a blob once anything is cut).
const LOG_HISTORY = 50
const MAX_TOOL_ITERATIONS = 10
// Hard server-side budget matching the prompt's "at most 5 page reads per
// turn" rule — each read is a multi-second external fetch, so a runaway model
// must not be able to chain 10 of them.
const MAX_PAGE_READS_PER_TURN = 5

export type SseSend = (event: string, data: unknown) => void

/** Corrective message injected when the model's finished answer carded ids
 *  that exist neither in this turn's tool results nor anywhere in the catalog.
 *  Sent as a user turn so the model regenerates; the widget renders only what
 *  follows the LAST [[/thinking]] marker, so the visitor never sees the draft. */
function fabricationRedoMessage(ids: string[]): string {
  return `[AUTOMATED CARD AUDIT — this is a server-side check, not the visitor. The visitor will not see your previous draft, so never reference it.]
Your draft carded listing id(s) that do not exist in the catalog: ${ids.join(', ')}. No tool result in this turn returned these ids, so they are fabricated and their cards would render broken.
Redo the answer from scratch: run the search_listings call(s) you skipped, card ONLY ids copied verbatim from those fresh results, and if nothing fitting comes back, recommend what search DID return or link the relevant resource page in prose instead of carding anything. Format as always: any reasoning ends with [[/thinking]], then the visible answer, then follow-up chips. Do not apologize for or mention this correction — just deliver the corrected answer.`
}

/** Per-type suggest-form tags. Deliberately excludes correction, contact and
 *  feedback, which have their own triggers and are never solicitation. */
const PER_TYPE_SUGGEST_RE =
  /\[\[suggest:(?:community|event|training|funder|course|media-channel|founder-resource|advisor|project|org):/i

/** Corrective message injected when the model's finished answer both shows
 *  listings and volunteers a per-type suggest form. The prompt forbids the
 *  combination but the model keeps slipping into it, so the server enforces
 *  it. The two legitimate pairings (the user asked to add/report something;
 *  the "once it's up and running" note for someone planning their own) can't
 *  be detected server-side, so the redo asks the model to re-judge them —
 *  and the redo runs once, so a kept form on the rewrite is accepted. */
function suggestGateRedoMessage(): string {
  return `[AUTOMATED SUGGEST-FORM AUDIT — this is a server-side check, not the visitor. The visitor will not see your previous draft, so never reference it.]
Your draft both shows listings and offers a suggest-a-listing form. That combination is not allowed: the form is only for turns with NOTHING to show, or for a user who explicitly asked to add, report, or get something listed (including the "once it's up and running" closing note for someone planning their own). Unless one of those exceptions genuinely applies to THIS turn, rewrite the complete answer without the [[suggest:...]] tag and without any "if you know of one that's missing" prose — the listings you showed plus a resource-page link already complete the answer. If an exception does apply, keep the form. Start your reply with [[/thinking]] on its own line, then the full final answer, then follow-up chips. Do not call any more tools, and do not apologize for or mention this correction — just deliver the final answer.`
}

/** Text that looks like a tool call written into the reply instead of made
 *  through the API's tool-use mechanism (`<invoke name="search_listings">`,
 *  `<parameter ...>`, a `<function_calls>` wrapper — with or without a
 *  namespace prefix). A model that emits this believed it was acting: no tool
 *  ran, so the reply is built on results that don't exist, and the visitor
 *  would see raw markup. Seen in production on 2 August 2026 (two turns in a
 *  row on /jobs). */
const PSEUDO_TOOL_CALL_RE =
  /<\/?\s*(?:\w+:)?(?:function_calls|invoke|parameter)\b/gi

/** Corrective message injected when the model's finished reply contains tool
 *  calls written as literal text. */
function textToolCallRedoMessage(): string {
  return `[AUTOMATED TOOL-CALL AUDIT — this is a server-side check, not the visitor. The visitor will not see your previous draft, so never reference it.]
Your draft wrote tool calls as literal text (<invoke ...> markup) instead of invoking the tools. Text never executes a tool: no search ran, you have no results from it, and the visitor would have seen raw markup. Redo the turn from scratch: make the search_listings call(s) for real through the tool-use mechanism, wait for their results, and answer only from what they return. Format as always: any reasoning ends with [[/thinking]], then the visible answer, then follow-up chips. Do not apologize for or mention this correction — just deliver the corrected answer.`
}

/** First-person announcements of a search that only make sense as tool
 *  intents ("Let me search for orgs…", "I'm going to look for…", "Let me run
 *  several searches"). A finished reply containing one when NO tool ran this
 *  turn narrated the search instead of making it — and any "findings" that
 *  follow are invented. Seen in production on 22 August 2026: five
 *  consecutive turns narrated searches with zero tool calls, one of them
 *  fabricating results ("Two useful hits: EleutherAI and …"). Deliberately
 *  tight — generic "let me" phrasing ("let me be precise", "let me know")
 *  must never match, only search/look-up verbs. */
export const NARRATED_SEARCH_RE =
  /\b(?:let me|i(?:['’]ll| will|['’]m (?:going|about) to))\s+(?:now\s+|also\s+|quickly\s+|first\s+)?(?:search|look\s+(?:up|for|at\s+(?:which|what))|run\s+(?:a|an|some|several|the|two|three|more)?\s*search(?:es)?|check\s+(?:the\s+)?(?:catalog|listings|database))/i

/** Corrective message injected when the model's finished reply narrates
 *  searching without any tool having run this turn. */
function narratedSearchRedoMessage(): string {
  return `[AUTOMATED TOOL-CALL AUDIT — this is a server-side check, not the visitor. The visitor will not see your previous draft, so never reference it.]
Your draft says it is searching ("let me search…", "I'm going to look for…") but no tool call was made this turn. Narrating a search never executes it: nothing ran, and any findings your draft describes are invented. Redo the turn from scratch: if the answer needs listings, call search_listings for real through the tool-use mechanism and answer only from what it returns; if it doesn't, answer directly without claiming to search. Format as always: any reasoning ends with [[/thinking]], then the visible answer, then follow-up chips. Do not apologize for or mention this correction — just deliver the corrected answer.`
}

/** Whether a finished, marker-less reply reads as the model's private
 *  reasoning rather than an answer to the visitor: it opens by talking ABOUT
 *  the visitor in the third person ("The user has shared…") or planning to
 *  itself ("Let me…", "I need to…"), or leans on that self-talk repeatedly.
 *  Used only as a tie-breaker for replies that never emitted [[/thinking]] —
 *  a genuine short answer ("MATS Winter 2027 closes 6 September") matches
 *  neither test, and a false positive costs one redo, not the answer. */
export function looksLikeReasoningText(text: string): boolean {
  const head = text.trimStart().slice(0, 200)
  if (
    /^(?:okay|so|hmm|right)?[,.\s]*(?:the (?:user|visitor)\b|let me\b|i (?:should|need to|want to|will)\b|i['’](?:ll|m going)\b|my (?:job|task) here\b)/i.test(
      head
    )
  ) {
    return true
  }
  const selfTalk = text.match(
    /\b(?:the (?:user|visitor)(?:['’]s)?\s+(?:has|asks?|wants?|is|was|shared|needs?|said|question)|let me|i should|i need to)\b/gi
  )
  return (selfTalk?.length ?? 0) >= 2
}

/** Corrective message injected when a finished reply never emitted the
 *  [[/thinking]] marker at all: with no marker and no tool calls, every
 *  renderer's last-resort fallback shows the WHOLE text, so a reasoning dump
 *  would reach the visitor verbatim. A real visitor got 11,000 characters of
 *  private reasoning — "the user has shared their rejected proposal… that's
 *  the most useful thing I can give him" — as their answer on 22 August 2026. */
function missingMarkerRedoMessage(): string {
  return `[AUTOMATED FORMAT AUDIT — this is a server-side check, not the visitor. The visitor will not see your previous draft, so never reference it.]
Your draft never emitted the [[/thinking]] marker, and it reads as internal reasoning about the visitor rather than an answer to them — without the marker, that raw reasoning would be shown to the visitor word for word. Redo the turn: reason briefly if you need to, end the reasoning with [[/thinking]] on its own line, then write the complete final answer addressed directly to the visitor as "you", then follow-up chips. If your draft was cut off, write the full answer now. If the answer needs listings, call the tools for real first. Do not apologize for or mention this correction — just deliver the answer.`
}

/** Encodes a single SSE frame. */
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const THINKING_MARKER_RE = /\[\[\s*\/\s*thinking\s*\]\]/gi
const THINKING_MARKER_CANON = '[[/thinking]]'

// A retraction only counts when the content it would preserve is substantial
// enough that the visitor plausibly read it. Below this, moving the boundary
// (the widget's normal last-marker rule) loses almost nothing, while a wrong
// truncation would abort the real answer and ship the junk between two
// stuttered markers as the whole reply. Observed retracted drafts run
// 1,800+ chars; marker-stutter junk is a few bytes.
const MIN_RETRACTED_CHARS = 80

/** The prompt makes [[/thinking]] a one-way door: once the model emits it and
 *  the answer begins, re-emitting it retracts everything already streamed —
 *  the widget shows only what follows the LAST marker, so the visitor watches
 *  their answer get deleted and rewritten. Returns the index (within one
 *  generation's text) of the first marker that retracts a substantial visible
 *  answer, or -1. Two deliberate blind spots, because this guard ends
 *  generations and a wrong cut aborts the real answer: markers not at the
 *  start of a line don't count (a marker merely QUOTED mid-sentence — the
 *  prompt's own rules quote it — must never trigger a cut), and markers with
 *  under MIN_RETRACTED_CHARS of content since the last accepted marker just
 *  move the boundary like the widget would. Missed genuine re-marks degrade
 *  to the widget's pre-existing last-marker handling, never worse. */
function findRetractionMarker(genText: string): number {
  let acceptedEnd = -1
  for (const m of genText.matchAll(THINKING_MARKER_RE)) {
    const idx = m.index ?? 0
    const lineStart = genText.lastIndexOf('\n', idx - 1) + 1
    if (idx > 0 && genText.slice(lineStart, idx).trim()) continue
    if (
      acceptedEnd !== -1 &&
      genText.slice(acceptedEnd, idx).trim().length >= MIN_RETRACTED_CHARS
    ) {
      return idx
    }
    acceptedEnd = idx + m[0].length
  }
  return -1
}

/** Length of the trailing chunk of `text` that might still grow into a
 *  [[/thinking]] marker as more deltas arrive (e.g. ends in "[[", "[[/thin").
 *  Those bytes are held back from the client until disambiguated, so that
 *  when a retraction is cut mid-stream the client never receives any
 *  fragment of the second marker. */
function markerPrefixHold(text: string): number {
  const start = text.lastIndexOf('[[')
  if (start !== -1) {
    const tail = text.slice(start)
    if (!tail.includes(']]')) {
      const canon = tail.replace(/\s+/g, '').toLowerCase()
      if (THINKING_MARKER_CANON.startsWith(canon)) return text.length - start
    }
  }
  return text.endsWith('[') ? 1 : 0
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

interface GenerateContext {
  send: SseSend
  /** Aborted if the client disconnects mid-stream. Pass into Anthropic SDK
   *  calls so token generation stops as soon as no one is listening. */
  signal: AbortSignal
}

/** Wraps an async generator function in a streaming SSE Response. The
 *  generator receives `send(event, data)` and an AbortSignal that fires when
 *  the client disconnects. Errors thrown from the generator are emitted as
 *  an `error` SSE event before the stream closes. */
export function sseResponse(
  generate: (ctx: GenerateContext) => Promise<void>
): Response {
  const encoder = new TextEncoder()
  const ac = new AbortController()
  const stream = new ReadableStream({
    async start(controller) {
      const send: SseSend = (event, data) => {
        if (ac.signal.aborted) return
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)))
        } catch {
          // Controller was closed (e.g. client disconnected mid-frame).
        }
      }
      try {
        await generate({ send, signal: ac.signal })
      } catch (err) {
        if (ac.signal.aborted) return
        const message = err instanceof Error ? err.message : 'unknown error'
        console.error('[assistant] stream error:', message)
        send('error', { message })
      } finally {
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      ac.abort()
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}

/** Validates and normalises the incoming messages array, then windows it to
 *  the last MAX_HISTORY messages — the slice the MODEL sees. Throws on bad
 *  input so the route can return a 400 with a useful message. */
export function validateMessages(messages: unknown): ChatMessage[] {
  return cleanMessages(messages).slice(-MAX_HISTORY)
}

/** The same cleaned messages, windowed to the last LOG_HISTORY — the slice
 *  the conversation LOG stores. The widget sends the whole conversation every
 *  turn, so long chats keep their earlier turns in the admin transcript even
 *  though the model only ever sees the last MAX_HISTORY. Always a superset of
 *  validateMessages() for the same input (both are tails of one list).
 *
 *  `indices` carries each kept message's position in the RAW incoming array —
 *  the widget's own message-list positions, which is the indexing its
 *  delivery reports, thumbs ratings, and turn-scoped click keys use. The
 *  cleaning below can drop messages mid-list (an errored turn's empty reply)
 *  and the windowing/size-trim drops them from the front, so a stored
 *  message's array position stops matching the widget's — the admin viewer
 *  needs the original positions to attach those reports to the right reply. */
export function validateLogHistoryWithIndices(messages: unknown): {
  history: ChatMessage[]
  indices: number[]
} {
  const { history, indices } = cleanMessagesIndexed(messages)
  return {
    history: history.slice(-LOG_HISTORY),
    indices: indices.slice(-LOG_HISTORY),
  }
}

/** The ENTIRE cleaned conversation with the same widget positions — no
 *  window at all. This is what the full-transcript blob mirror stores for
 *  conversations that outgrow the Airtable row (see upsertConversation). */
export function validateFullHistoryWithIndices(messages: unknown): {
  history: ChatMessage[]
  indices: number[]
} {
  return cleanMessagesIndexed(messages)
}

function cleanMessages(messages: unknown): ChatMessage[] {
  return cleanMessagesIndexed(messages).history
}

function cleanMessagesIndexed(messages: unknown): {
  history: ChatMessage[]
  indices: number[]
} {
  if (!Array.isArray(messages)) throw new Error('messages must be an array')
  const out: ChatMessage[] = []
  const indices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m || typeof m !== 'object') continue
    const msg = m as { role?: unknown; content?: unknown }
    if (msg.role !== 'user' && msg.role !== 'assistant') continue
    if (typeof msg.content !== 'string') continue
    if (msg.content.length === 0) continue
    // User messages are bounded by the composer (4000 chars); assistant
    // history is the bot's own raw replies (reasoning + tokens included),
    // which routinely exceed 4000 — dropping those silently deleted long
    // replies from the bot's memory and from the stored transcript.
    if (msg.content.length > (msg.role === 'user' ? 4000 : 12000)) continue
    out.push({ role: msg.role, content: msg.content })
    indices.push(i)
  }
  if (out.length === 0) throw new Error('no valid messages')
  if (out[out.length - 1].role !== 'user') {
    throw new Error('last message must be from user')
  }
  return { history: out, indices }
}

/** Builds the Anthropic message list, prepending the context line to the
 *  final user turn so the model sees it as ambient setup. */
export function buildApiMessages(
  messages: ChatMessage[],
  contextLine: string
): Anthropic.MessageParam[] {
  return messages.map((m, idx) => {
    if (idx === messages.length - 1 && m.role === 'user') {
      return { role: m.role, content: `${contextLine}\n\n${m.content}` }
    }
    return { role: m.role, content: m.content }
  })
}

interface ToolCallLogEntry {
  name: string
  input: unknown
  ok: boolean
}

export interface AssistantRunResult {
  assistantText: string
  toolCalls: ToolCallLogEntry[]
  citations: CitationRef[]
  /** Card ids in the visible answer that the live widget degraded to a
   *  generic "Browse X" fallback link (or dropped entirely) instead of a real
   *  card — the model wrote them without a tool having returned the listing.
   *  Logged per turn so the admin transcript can show the same degraded state
   *  the visitor saw rather than a full card the model only pretended to have. */
  fallbackCardIds: string[]
  /** True when the visitor's connection dropped (or they pressed Stop) before
   *  generation finished. `assistantText`/`toolCalls` then hold whatever had
   *  streamed by that point; citations and fallback cards are not computed. */
  aborted?: boolean
}

interface RunOptions {
  client: Anthropic
  systemPrompt: string
  pagesBlock: string
  donationGuide: string
  model: string
  apiMessages: Anthropic.MessageParam[]
  catalog: Catalog
  send: SseSend
  /** Cancels the in-flight Anthropic call when the client disconnects. */
  signal?: AbortSignal
}

/** Runs the assistant tool-use loop, streaming text deltas and tool events
 *  via `send`, and returns the final assistant text + citations once the
 *  model stops with a non-tool reason or hits MAX_TOOL_ITERATIONS. */
export async function runAssistantStream(
  opts: RunOptions
): Promise<AssistantRunResult> {
  const {
    client,
    systemPrompt,
    pagesBlock,
    donationGuide,
    model,
    apiMessages,
    catalog,
    send,
    signal,
  } = opts
  let assistantText = ''
  const cited: Listing[] = []
  const toolCalls: ToolCallLogEntry[] = []
  let redoneFabrication = false
  let redoneSplitAnswer = false
  let redoneSuggestGate = false
  let redoneTextToolCall = false
  let redoneNarratedSearch = false
  let redoneMissingMarker = false
  // Whether any tool actually executed this turn — the narrated-search audit
  // below only fires when the model claimed to search without one running.
  let ranTools = false
  // Where the final answer can begin at the earliest: the text length after
  // the last tool round (or redo). Text before this point is treated as
  // reasoning — it preceded a tool call — which lets us repair a reply whose
  // [[/thinking]] marker never arrived. The split-answer redo below covers
  // the case where that treatment would be wrong.
  let answerStartOffset = 0

  // What the visitor had received when their connection dropped. Returned
  // instead of thrown so the route can log the partial reply they actually
  // saw (marked aborted) rather than losing the turn's text entirely.
  const abortedResult = (): AssistantRunResult => ({
    assistantText,
    toolCalls,
    citations: [],
    fallbackCardIds: [],
    aborted: true,
  })

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      if (signal?.aborted) return abortedResult()
      const response = await client.messages.create(
        {
          model,
          // A model that always thinks spends part of the budget on thinking
          // tokens before the visible answer, so it gets more room.
          max_tokens: thinkingAlwaysOn(model) ? MAX_TOKENS * 4 : MAX_TOKENS,
          // Off wherever the API allows it: the assistant does its reasoning in
          // visible text ending with the [[/thinking]] marker. Fable-tier
          // models and Opus 5.5 can't have it off (a 400), so for them the
          // field is left out and the thinking blocks they return are echoed
          // back below.
          thinking: thinkingParam(model),
          // A visitor is waiting on a live reply, so the production model runs
          // at medium effort: enough thinking for a good answer without a long
          // pause before the first visible text.
          output_config: outputConfig(model, 'medium'),
          system: [
            { type: 'text', text: systemPrompt },
            { type: 'text', text: pagesBlock },
            { type: 'text', text: donationGuide },
            { type: 'text', text: LISTING_POLICY_BLOCK },
            {
              type: 'text',
              text: `You are currently running on ${modelDisplayName(model)}. If a user asks what model powers you, this is the answer.`,
              // Cache the whole static prefix (tools + all system blocks). The
              // prefix is byte-identical across the up-to-10 tool-use iterations
              // in a turn and across conversation turns, so after the first
              // write each request reads it at ~0.1x cost. 5-minute TTL (the
              // default) comfortably covers both. Render order is
              // tools -> system -> messages, so this one breakpoint on the last
              // system block caches the tool definitions too.
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: TOOL_DEFINITIONS,
          messages: apiMessages,
          stream: true,
        },
        { signal }
      )

      // Reconstruct the assistant turn so we can append it to apiMessages and
      // feed tool results back in the next iteration.
      const blocks: Anthropic.ContentBlockParam[] = []
      let currentTextBlock = ''
      let currentToolUse: {
        id: string
        name: string
        inputJson: string
      } | null = null
      // A thinking block in progress (always-on-thinking models only). It
      // must go back to the API exactly as received — empty text and all —
      // or the next tool round is rejected.
      let currentThinking: { thinking: string; signature: string } | null = null
      let stopReason: string | null = null
      // This generation's text, forwarded to the client through a gate that
      // holds back a tail that might still become a [[/thinking]] marker. When
      // the model re-emits the marker to retract an answer the visitor has
      // already watched stream in, we cut the generation at the retraction and
      // keep the first answer — without the gate, fragments of the second
      // marker would already have been sent.
      let genText = ''
      let sentUpTo = 0
      let truncatedRewrite = false
      const flushText = (upTo: number) => {
        if (upTo > sentUpTo) {
          send('text', { delta: genText.slice(sentUpTo, upTo) })
          sentUpTo = upTo
        }
      }

      for await (const event of response) {
        if (event.type === 'message_start') {
          // One-line cache-stats log per API call so we can confirm prompt
          // caching is working in the Vercel logs. `cache_read_input_tokens > 0`
          // means the static tools+system prefix was served from cache.
          const u = event.message.usage
          console.log(
            `[assistant] cache iter=${iter} read=${u.cache_read_input_tokens ?? 0} write=${u.cache_creation_input_tokens ?? 0} input=${u.input_tokens}`
          )
        } else if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            currentTextBlock = ''
          } else if (event.content_block.type === 'thinking') {
            currentThinking = { thinking: '', signature: '' }
          } else if (event.content_block.type === 'redacted_thinking') {
            blocks.push({
              type: 'redacted_thinking',
              data: event.content_block.data,
            })
          } else if (event.content_block.type === 'tool_use') {
            // Any held-back text belongs before this tool call — flush it now
            // so the client's event order matches the model's output order.
            flushText(genText.length)
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: '',
            }
            send('tool_call_start', {
              id: event.content_block.id,
              name: event.content_block.name,
            })
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            currentTextBlock += event.delta.text
            assistantText += event.delta.text
            genText += event.delta.text
            const retractionAt = findRetractionMarker(genText)
            if (retractionAt !== -1) {
              // The model is retracting the answer it already streamed (it
              // re-emitted [[/thinking]] and would now rewrite from scratch —
              // observed rewrites are near-verbatim). Keep the answer the
              // visitor has, cut the generation here, and skip the rewrite.
              flushText(retractionAt)
              const dropped = genText.length - retractionAt
              assistantText = assistantText.slice(
                0,
                assistantText.length - dropped
              )
              // The dropped bytes usually sit in the current (open) text block,
              // but a marker can span a block boundary — trim any remainder off
              // blocks already pushed, so the apiMessages transcript matches
              // assistantText, the client stream, and the stored log exactly.
              let leftover = dropped - currentTextBlock.length
              currentTextBlock = currentTextBlock.slice(
                0,
                Math.max(0, currentTextBlock.length - dropped)
              )
              while (leftover > 0) {
                const lastBlock = blocks[blocks.length - 1]
                if (!lastBlock || lastBlock.type !== 'text') break
                const take = Math.min(leftover, lastBlock.text.length)
                lastBlock.text = lastBlock.text.slice(
                  0,
                  lastBlock.text.length - take
                )
                if (!lastBlock.text) blocks.pop()
                leftover -= take
              }
              truncatedRewrite = true
              stopReason = 'end_turn'
              console.warn(
                '[assistant] re-emitted [[/thinking]] after the answer began — kept the first answer and dropped the rewrite'
              )
              // Surfaces in the admin log's tool list, so affected turns are
              // visible when skimming conversations.
              toolCalls.push({
                name: 'kept_first_answer_dropped_rewrite',
                input: {},
                ok: true,
              })
              break
            }
            flushText(genText.length - markerPrefixHold(genText))
          } else if (
            event.delta.type === 'input_json_delta' &&
            currentToolUse
          ) {
            currentToolUse.inputJson += event.delta.partial_json
          } else if (event.delta.type === 'thinking_delta' && currentThinking) {
            currentThinking.thinking += event.delta.thinking
          } else if (
            event.delta.type === 'signature_delta' &&
            currentThinking
          ) {
            currentThinking.signature += event.delta.signature
          }
        } else if (event.type === 'content_block_stop') {
          if (currentThinking) {
            blocks.push({ type: 'thinking', ...currentThinking })
            currentThinking = null
          } else if (currentToolUse) {
            let parsedInput: Record<string, unknown> = {}
            try {
              parsedInput = currentToolUse.inputJson
                ? JSON.parse(currentToolUse.inputJson)
                : {}
            } catch (err) {
              console.warn(
                `[assistant] tool ${currentToolUse.name} sent malformed JSON, treating input as empty`,
                err
              )
            }
            blocks.push({
              type: 'tool_use',
              id: currentToolUse.id,
              name: currentToolUse.name,
              input: parsedInput,
            })
            currentToolUse = null
          } else if (currentTextBlock) {
            blocks.push({ type: 'text', text: currentTextBlock })
            currentTextBlock = ''
          }
        } else if (event.type === 'message_delta') {
          if (event.delta.stop_reason) stopReason = event.delta.stop_reason
        }
      }

      if (truncatedRewrite) {
        // Stop the model from generating the rest of the retracted rewrite.
        try {
          response.controller.abort()
        } catch {
          // Stream already closed.
        }
      } else {
        flushText(genText.length)
      }
      // Normally every text block was pushed at its content_block_stop; after a
      // truncation break the current (cut) block still needs capturing so the
      // transcript matches what the visitor saw.
      if (currentTextBlock) {
        blocks.push({ type: 'text', text: currentTextBlock })
        currentTextBlock = ''
      }

      apiMessages.push({ role: 'assistant', content: blocks })
      if (stopReason === 'max_tokens') {
        // The generation was cut off mid-sentence at MAX_TOKENS. The loop
        // treats it like a normal finish (there's no continuation mechanism),
        // so record it where the admin's per-turn tool list will show it —
        // otherwise a truncated reply is indistinguishable from a complete one
        // when skimming conversations.
        console.warn(
          `[assistant] generation hit MAX_TOKENS (${MAX_TOKENS}) — the reply is cut off`
        )
        toolCalls.push({ name: 'reply_hit_token_limit', input: {}, ok: false })
      }
      if (stopReason !== 'tool_use') {
        // The model considers its answer finished. The first way it can be
        // broken: the "answer" is one or more tool calls written as literal
        // text (see PSEUDO_TOOL_CALL_RE). Nothing ran, so nothing in the reply
        // can be trusted — send the model back to call the tools for real.
        // Once per turn, with enough iteration budget left for the tool round
        // plus the regenerated answer. The injected [[/thinking]] marker hides
        // the draft from the visitor (the widget shows only what follows the
        // last marker) exactly like the split-answer and suggest-form redos.
        const pseudoToolCalls = assistantText
          .slice(answerStartOffset)
          .match(PSEUDO_TOOL_CALL_RE)
        if (
          pseudoToolCalls &&
          !redoneTextToolCall &&
          !signal?.aborted &&
          iter < MAX_TOOL_ITERATIONS - 2
        ) {
          redoneTextToolCall = true
          console.warn(
            `[assistant] tool call(s) written as text — ${pseudoToolCalls.length} pseudo-call tag(s) in the finished reply; sending the model back to call the tools for real`
          )
          // Surfaces in the admin log's tool list, so redone turns are visible
          // when skimming conversations.
          toolCalls.push({
            name: 'redo_after_text_tool_calls',
            input: { pseudoCallTags: pseudoToolCalls.length },
            ok: true,
          })
          apiMessages.push({
            role: 'user',
            content: textToolCallRedoMessage(),
          })
          // Tell the widget a redo is starting, then close the discarded draft
          // with a real marker (same trick as the split-answer redo below) so
          // the boundary moves past the draft even if the rewrite forgets its
          // own marker. The redo event lets the widget keep a draft the visitor
          // already read on screen — swapped for the rewrite once it streams —
          // instead of blanking to a loading indicator.
          send('redo', {})
          send('text', { delta: '\n[[/thinking]]\n' })
          assistantText += '\n[[/thinking]]\n'
          answerStartOffset = assistantText.length
          continue
        }
        // The prose variant of the same failure: the reply ANNOUNCES searching
        // ("Let me search for orgs…") but no tool ran this turn — the model
        // narrated the search instead of calling it, so any findings it goes
        // on to describe are invented. The tag-based check above can't see
        // this (there's no markup), so match the announcement phrasing itself.
        // Once per turn, with budget left for the real search plus the
        // regenerated answer.
        if (
          !ranTools &&
          !redoneNarratedSearch &&
          !signal?.aborted &&
          iter < MAX_TOOL_ITERATIONS - 2 &&
          NARRATED_SEARCH_RE.test(assistantText.slice(answerStartOffset))
        ) {
          redoneNarratedSearch = true
          console.warn(
            '[assistant] narrated search — the finished reply announces searching but no tool ran this turn; sending the model back to call the tools for real'
          )
          // Surfaces in the admin log's tool list, so redone turns are visible
          // when skimming conversations.
          toolCalls.push({
            name: 'redo_after_narrated_search',
            input: {},
            ok: true,
          })
          apiMessages.push({
            role: 'user',
            content: narratedSearchRedoMessage(),
          })
          // Same trick as the other redos: tell the widget a redo is starting,
          // then close the discarded draft with a real marker so the boundary
          // moves past it even if the rewrite forgets its own marker.
          send('redo', {})
          send('text', { delta: '\n[[/thinking]]\n' })
          assistantText += '\n[[/thinking]]\n'
          answerStartOffset = assistantText.length
          continue
        }
        // The next way it can be broken: audit
        // the [[card:...]] ids it wrote: an id matching neither a tool result
        // from this turn nor any catalog listing is fabricated, and its card
        // would render broken. Send the model back to redo the answer — once
        // per turn, and only with enough iteration budget left for the search
        // it skipped plus the regenerated answer. If the redo fabricates again,
        // fall through to the existing graceful degradation (fallback link in
        // the widget, UNRESOLVED badge in the admin).
        const refsSoFar = new Map<string, CitationRef>()
        for (const l of cited) refsSoFar.set(l.id, toCitationRef(l))
        for (const c of extractCitations(assistantText, catalog)) {
          refsSoFar.set(c.id, c)
        }
        const { fabricated } = auditCardCitations(
          assistantText,
          Array.from(refsSoFar.values()),
          catalog
        )
        if (
          fabricated.length > 0 &&
          !redoneFabrication &&
          iter < MAX_TOOL_ITERATIONS - 2
        ) {
          redoneFabrication = true
          console.warn(
            `[assistant] fabricated card id(s) ${fabricated.join(', ')} — sending the model back to redo the answer`
          )
          // Surfaces in the admin log's tool list, so redone turns are visible
          // when skimming conversations.
          toolCalls.push({
            name: 'redo_after_fabricated_cards',
            input: { fabricated },
            ok: true,
          })
          // Tell the widget a redo is starting (it keeps the draft on screen
          // until the corrected answer streams, instead of blanking to a
          // loading indicator), then close the discarded draft with a real
          // marker like the other redos, so the boundary moves past the draft
          // even if the rewrite forgets its own marker.
          send('redo', {})
          send('text', { delta: '\n[[/thinking]]\n' })
          assistantText += '\n[[/thinking]]\n'
          apiMessages.push({
            role: 'user',
            content: fabricationRedoMessage(fabricated),
          })
          answerStartOffset = assistantText.length
          continue
        }
        // The other way a "finished" reply can be broken: the model began its
        // user-facing answer, then ran a tool round, then finished without
        // emitting [[/thinking]] after it. Every renderer treats text before
        // the last tool round as reasoning in that case, so the visitor would
        // get a reply that opens mid-thought — a real visitor received "Two
        // that could give you a useful second opinion:" as the whole reply and
        // complained. Short pre-search narration is what the marker-injection
        // repair below is for; when the text that injection would hide is too
        // long to be narration, send the model back to rewrite the complete
        // answer instead of amputating it. Skipped after a fabrication redo:
        // there the pre-redo text is a discarded draft that SHOULD stay
        // hidden, and the injection repair already handles it.
        const hiddenIfInjected =
          assistantText
            .slice(0, answerStartOffset)
            .split(/\[\[\s*\/\s*thinking\s*\]\]/i)
            .pop() ?? ''
        if (
          answerStartOffset > 0 &&
          !redoneFabrication &&
          !redoneSplitAnswer &&
          !signal?.aborted &&
          iter < MAX_TOOL_ITERATIONS - 1 &&
          !/\[\[\s*\/\s*thinking\s*\]\]/i.test(
            assistantText.slice(answerStartOffset)
          ) &&
          looksLikeAnswerText(hiddenIfInjected)
        ) {
          redoneSplitAnswer = true
          console.warn(
            `[assistant] split answer — ${hiddenIfInjected.trim().length} chars of answer text sat before the last tool round with no [[/thinking]] after them; sending the model back to rewrite`
          )
          // Surfaces in the admin log's tool list, so redone turns are visible
          // when skimming conversations.
          toolCalls.push({
            name: 'redo_after_split_answer',
            input: { hiddenChars: hiddenIfInjected.trim().length },
            ok: true,
          })
          apiMessages.push({ role: 'user', content: splitAnswerRedoMessage() })
          // Tell the widget a redo is starting, then close the discarded draft
          // with a real marker, sent as a text delta so the live widget's
          // boundary moves past the draft even if the rewrite forgets its own
          // marker — and so the stored transcript and the client's own copy of
          // the reply stay identical.
          send('redo', {})
          send('text', { delta: '\n[[/thinking]]\n' })
          assistantText += '\n[[/thinking]]\n'
          answerStartOffset = assistantText.length
          continue
        }
        // A third way a finished reply can be wrong: it shows listings AND
        // volunteers a per-type suggest form. The prompt's Honest-failure rule
        // forbids the combination, but the model keeps closing carded answers
        // with "if you know of one that's missing…" anyway, so enforce it
        // here. The redo asks the model to drop the form unless an exception
        // applies (a judgment the server can't make); it runs once per turn,
        // so a form kept on the rewrite is accepted.
        const visibleAnswer =
          assistantText.split(/\[\[\s*\/\s*thinking\s*\]\]/i).pop() ?? ''
        if (
          visibleAnswer.includes('[[card:') &&
          PER_TYPE_SUGGEST_RE.test(visibleAnswer) &&
          !redoneSuggestGate &&
          !signal?.aborted &&
          iter < MAX_TOOL_ITERATIONS - 1
        ) {
          redoneSuggestGate = true
          console.warn(
            '[assistant] unearned suggest form — the answer both cards listings and offers a suggest form; sending the model back to rewrite'
          )
          // Surfaces in the admin log's tool list, so redone turns are visible
          // when skimming conversations.
          toolCalls.push({
            name: 'redo_after_unearned_suggest_form',
            input: {},
            ok: true,
          })
          apiMessages.push({ role: 'user', content: suggestGateRedoMessage() })
          // Tell the widget a redo is starting, then close the discarded draft
          // with a real marker (same trick as the split-answer redo above) so
          // the live widget's boundary moves past the draft even if the rewrite
          // forgets its own marker.
          send('redo', {})
          send('text', { delta: '\n[[/thinking]]\n' })
          assistantText += '\n[[/thinking]]\n'
          answerStartOffset = assistantText.length
          continue
        }
        // Last catch-all: the reply finished with NO [[/thinking]] marker
        // anywhere and no tool calls. Both renderers' last-resort fallback for
        // that shape is "treat the whole text as the answer" (it normally
        // means a short direct reply that skipped reasoning), so a reply
        // that's actually a reasoning dump — or was cut off at the token
        // limit before reaching its marker — would be shown to the visitor
        // verbatim, private reasoning and all. Redo once when the text reads
        // as self-talk or was truncated; a genuine short answer matches
        // neither and passes through untouched.
        if (
          answerStartOffset === 0 &&
          !redoneMissingMarker &&
          !signal?.aborted &&
          iter < MAX_TOOL_ITERATIONS - 2 &&
          assistantText.trim() !== '' &&
          !/\[\[\s*\/\s*thinking\s*\]\]/i.test(assistantText) &&
          (stopReason === 'max_tokens' || looksLikeReasoningText(assistantText))
        ) {
          redoneMissingMarker = true
          console.warn(
            `[assistant] missing [[/thinking]] with no tool calls — the finished reply ${stopReason === 'max_tokens' ? 'hit the token limit mid-reasoning' : 'reads as raw reasoning'}; sending the model back to rewrite`
          )
          // Surfaces in the admin log's tool list, so redone turns are visible
          // when skimming conversations.
          toolCalls.push({
            name: 'redo_after_missing_marker',
            input: { truncated: stopReason === 'max_tokens' },
            ok: true,
          })
          apiMessages.push({
            role: 'user',
            content: missingMarkerRedoMessage(),
          })
          // Same trick as the other redos: tell the widget a redo is starting,
          // then close the discarded draft with a real marker so the boundary
          // moves past it even if the rewrite forgets its own marker.
          send('redo', {})
          send('text', { delta: '\n[[/thinking]]\n' })
          assistantText += '\n[[/thinking]]\n'
          answerStartOffset = assistantText.length
          continue
        }
        break
      }

      const toolUseBlocks = blocks.filter(
        (b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use'
      )
      if (toolUseBlocks.length === 0) break

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUseBlocks) {
        const overReadBudget =
          tu.name === 'read_listing_page' &&
          toolCalls.filter(c => c.name === 'read_listing_page').length >=
            MAX_PAGE_READS_PER_TURN
        const result = overReadBudget
          ? {
              ok: false,
              content:
                'Page-read budget for this turn is used up. Answer from what you already have — do not request another page read.',
              listings: [],
            }
          : await executeTool(tu.name, tu.input as unknown, catalog)
        toolCalls.push({ name: tu.name, input: tu.input, ok: result.ok })
        cited.push(...result.listings)
        const n = result.listings.length
        const summary =
          result.summary ??
          (tu.name === 'search_listings'
            ? `${n} match${n === 1 ? '' : 'es'}`
            : tu.name === 'get_listing'
              ? result.ok
                ? 'fetched'
                : 'not found'
              : tu.name === 'read_listing_page'
                ? result.ok
                  ? 'read'
                  : 'unreadable'
                : 'done')
        send('tool_call_done', {
          id: tu.id,
          name: tu.name,
          ok: result.ok,
          summary,
          input: tu.input,
          listings: result.listings.map(toCitationRef),
        })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.content,
          is_error: !result.ok,
        })
      }
      apiMessages.push({ role: 'user', content: toolResults })
      ranTools = true
      answerStartOffset = assistantText.length
    }
  } catch (err) {
    // The Anthropic call rejects when `signal` fires mid-generation (the
    // visitor closed the tab or pressed Stop). That's an abandonment, not a
    // failure: hand back what streamed so far and let the route log it.
    // Anything else is a real error and propagates as before.
    if (!signal?.aborted) throw err
    return abortedResult()
  }

  // Citations come from the listings the model actually used (via tools).
  // If it also wrote bare [[id:...]] markers, fold those in too.
  const byId = new Map<string, CitationRef>()
  for (const l of cited) byId.set(l.id, toCitationRef(l))
  for (const c of extractCitations(assistantText, catalog)) byId.set(c.id, c)

  // Telemetry: a reply should carry exactly one [[/thinking]] marker (two when
  // the fabrication redo above injected a second generation). More than that
  // means the model re-entered thinking mid-answer — the renderer keeps only
  // what follows the LAST marker, so everything the model wrote before its
  // spurious re-emission was hidden from the visitor. Counted before the
  // missing-marker repair below so it reflects what the model actually wrote.
  const markerCount =
    assistantText.match(/\[\[\s*\/\s*thinking\s*\]\]/gi)?.length ?? 0
  // Baseline 1; each redo adds the synthetic marker that closed the draft
  // plus, at most, a marker the draft itself carried. Upper bounds, so the
  // warn below still catches genuine mid-answer re-emission.
  const expectedMarkers =
    1 +
    (redoneFabrication ? 2 : 0) +
    (redoneSplitAnswer ? 2 : 0) +
    (redoneSuggestGate ? 2 : 0) +
    (redoneTextToolCall ? 2 : 0) +
    (redoneNarratedSearch ? 2 : 0) +
    (redoneMissingMarker ? 2 : 0)
  if (markerCount > expectedMarkers) {
    console.warn(
      `[assistant] re-emitted [[/thinking]] mid-answer (${markerCount} markers, expected ${expectedMarkers}) — earlier answer text was hidden from the visitor`
    )
  }

  // The opposite failure: the model ran tools but never emitted [[/thinking]]
  // after its last tool round, leaving pre-search narration ("I'll search
  // for…") glued to the answer. The live widget hides that (its boundary
  // falls back to the last tool call), but the stored transcript is a flat
  // string with no tool positions, so the admin log — and the model reading
  // its own history next turn — would see the leak. The server knows where
  // the last tool round ended, which is exactly where the marker belongs, so
  // repair the transcript by injecting it there.
  if (
    answerStartOffset > 0 &&
    !/\[\[\s*\/\s*thinking\s*\]\]/i.test(assistantText.slice(answerStartOffset))
  ) {
    console.warn(
      '[assistant] missing [[/thinking]] after the last tool call — injected the marker so the reasoning trail stays out of the stored answer'
    )
    assistantText = `${assistantText.slice(0, answerStartOffset).trimEnd()}\n[[/thinking]]\n${assistantText.slice(answerStartOffset).trimStart()}`
  }

  // The visible answer is whatever follows the last [[/thinking]] marker — a
  // redone draft sits before its marker, so it drops out here.
  const answer = assistantText.split(/\[\[\s*\/\s*thinking\s*\]\]/i).pop() ?? ''

  // Audit the [[card:...]] ids in the visible answer. A card naming a REAL
  // listing the model never tool-surfaced is backfilled so the stored snapshot
  // carries it; a card naming NOTHING in the catalog is fabricated.
  // Fabrications normally trigger the in-loop redo above, so anything still
  // flagged here survived (or had no budget for) that redo — log it; the live
  // renderer shows a "Browse X" link and the admin flags it UNRESOLVED.
  const { backfill, fabricated } = auditCardCitations(
    answer,
    Array.from(byId.values()),
    catalog
  )
  for (const ref of backfill) byId.set(ref.id, ref)
  if (fabricated.length > 0) {
    console.warn(
      `[assistant] fabricated card id(s) with no matching listing: ${fabricated.join(', ')}`
    )
  }

  // Which of the answer's cards did the live widget degrade to a "Browse X"
  // fallback link? The widget resolves cards only against listings its tools
  // returned during the conversation, so fabricated ids always degrade, and
  // backfilled ids (real listings no tool surfaced this turn) degrade too —
  // unless an earlier reply already carded the listing, in which case the
  // widget still holds its citation and renders the real card. Prior replies
  // are the history messages, whose content is a plain string (this run's own
  // assistant turns were appended as content-block arrays).
  const priorAssistantText = apiMessages
    .filter(m => m.role === 'assistant' && typeof m.content === 'string')
    .map(m => m.content as string)
    .join('\n')
  const fallbackCardIds = [
    ...fabricated,
    ...backfill
      .map(ref => ref.id)
      .filter(id => {
        const rec = id.match(/rec[A-Za-z0-9]+$/)?.[0]
        return !(rec && priorAssistantText.includes(rec))
      }),
  ]

  // Telemetry: a turn that finishes with no user-facing answer (truly empty, or
  // only a reasoning trail before [[/thinking]]) leaves the visitor with a blank
  // reply. Log it so we can measure how often it happens instead of letting it
  // pass silently. The client surfaces a retry prompt for the same condition.
  if (!answer.trim()) {
    console.warn(
      `[assistant] blank answer — no user-facing text produced (chars=${assistantText.length}, toolCalls=${toolCalls.length})`
    )
  }

  return {
    assistantText,
    toolCalls,
    citations: Array.from(byId.values()),
    fallbackCardIds,
  }
}

function toCitationRef(l: Listing): CitationRef {
  return {
    id: l.id,
    type: l.type,
    name: l.name,
    organization: l.organization,
    logo: l.logo,
    url: l.url,
    pageUrl: l.pageUrl,
    description: l.description,
    meta: l.meta,
  }
}
