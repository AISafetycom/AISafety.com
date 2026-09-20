import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, after } from 'next/server'
import { isAdmin } from '@/lib/admin/auth'
import { getCatalog } from '@/lib/assistant/catalog'
import {
  PRODUCTION_PROMPT,
  PROMPT_VERSION,
  PAGES_BLOCK,
  buildContextLine,
  type RequestContext,
} from '@/lib/assistant/prompt'
import { resolveModelId } from '@/lib/assistant/models'
import {
  buildApiMessages,
  runAssistantStream,
  sseResponse,
  validateFullHistoryWithIndices,
  validateLogHistoryWithIndices,
  validateMessages,
  type AssistantRunResult,
} from '@/lib/assistant/stream'
import {
  INTERNAL_TAG,
  storeConversationTurn,
} from '@/lib/assistant/conversation-store'
import { getDonationGuideText } from '@/lib/assistant/donation-guide'
import { getPageLastUpdatedDates } from '@/lib/assistant/page-dates'
import {
  checkAssistantRateLimit,
  getClientIp,
} from '@/lib/assistant/rate-limit'
import type { AssistantRequest, ChatMessage } from '@/lib/assistant/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The only host that serves real visitors. A chat arriving anywhere else came
 *  from a dev server, a preview deployment or a branch URL — i.e. from us. */
const PUBLIC_HOST = 'aisafety.com'

/** True when this turn is ours rather than a visitor's: either it didn't arrive
 *  on the live site, or the browser is signed in to the admin area. The
 *  per-browser "Exclude this browser" flag is separate and stops the write
 *  altogether; this only labels what still gets written. */
function isInternalTurn(req: NextRequest, admin: boolean): boolean {
  if (admin) return true
  const host = (
    req.headers.get('x-forwarded-host') ??
    req.headers.get('host') ??
    ''
  )
    .split(':')[0]
    .toLowerCase()
  return host !== PUBLIC_HOST && host !== `www.${PUBLIC_HOST}`
}

function readGeo(
  req: NextRequest,
  fallback: AssistantRequest['geoFallback']
): RequestContext['geo'] {
  const headerCity = req.headers.get('x-vercel-ip-city')
  const region = req.headers.get('x-vercel-ip-country-region')
  const country = req.headers.get('x-vercel-ip-country')
  // Prefer Vercel's edge geo, but fill any field it omits from the client
  // fallback (ipapi). Vercel often returns region + country but no city; without
  // this merge the city from the fallback was discarded and the admin row fell
  // back to the bare region code (e.g. "ENG").
  const merged = {
    city: headerCity
      ? decodeURIComponent(headerCity)
      : (fallback?.city ?? undefined),
    region: region ?? fallback?.region ?? undefined,
    country: country ?? fallback?.country ?? undefined,
  }
  if (merged.city || merged.region || merged.country) return merged
  return null
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const ip = getClientIp(req.headers)
  const limit = await checkAssistantRateLimit(ip)
  if (!limit.ok) {
    return new Response(
      JSON.stringify({
        error: 'rate_limited',
        message: "You've hit today's message limit. Try again tomorrow.",
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(limit.retryAfterSeconds),
        },
      }
    )
  }

  let body: AssistantRequest
  try {
    body = (await req.json()) as AssistantRequest
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // `messages` is the window the model sees; `logHistory` is the wider window
  // the conversation log stores (same cleaned list, longer tail).
  // `logIndices` maps each stored message back to its position in the
  // widget's own message list, so the admin can attach the widget's
  // position-keyed reports (delivery, ratings, clicks) to the right reply
  // even after windowing or cleaning drops messages.
  let messages: ChatMessage[]
  let logHistory: ChatMessage[]
  let logIndices: number[]
  // The un-windowed cleaned conversation, for the full-transcript blob
  // mirror — the only copy that survives once a chat outgrows the log row.
  let fullHistory: ChatMessage[]
  let fullIndices: number[]
  try {
    messages = validateMessages(body.messages)
    ;({ history: logHistory, indices: logIndices } =
      validateLogHistoryWithIndices(body.messages))
    ;({ history: fullHistory, indices: fullIndices } =
      validateFullHistoryWithIndices(body.messages))
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'invalid messages',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const [catalog, pageDates] = await Promise.all([
    getCatalog(),
    getPageLastUpdatedDates(),
  ])
  const ctx: RequestContext = {
    currentPage: typeof body.currentPage === 'string' ? body.currentPage : '/',
    pageState: body.pageState ?? null,
    referrer: body.referrer ?? null,
    geo: readGeo(req, body.geoFallback),
    utm: body.utm ?? null,
    pageDates,
  }
  const apiMessages = buildApiMessages(messages, buildContextLine(ctx))
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const userQuery = messages[messages.length - 1].content
  const startedAt = Date.now()
  // Settled here rather than inside the stream: isAdmin() reads cookies, which
  // are only available while the request itself is still in scope.
  const internal = isInternalTurn(req, await isAdmin())

  return sseResponse(async ({ send, signal }) => {
    // Persist a turn to the conversation log. Called on success AND on
    // failure: even when the model returned nothing — the visitor closed the
    // tab before the first token, or generation errored — the question they
    // typed is still useful signal. It shows what people asked when the bot
    // failed them, so we keep it instead of dropping the whole turn. `status`
    // marks the incomplete turns so the admin viewer can flag them:
    // 'abandoned' (visitor's connection dropped before generation finished —
    // the reply holds whatever had streamed by then, possibly nothing) or
    // 'error' (generation failed).
    const logTurn = (
      result: AssistantRunResult | null,
      status?: 'abandoned' | 'error'
    ) => {
      // The owner excluded this browser — don't write their own test chats to
      // the conversation log. (Same per-browser flag as the analytics opt-out.)
      if (body.noLog) return

      const assistantText = result?.assistantText ?? ''
      const toolCalls = result?.toolCalls ?? []
      const citations = result?.citations ?? []
      const zeroMatches =
        citations.length === 0 && /\[\[suggest:/.test(assistantText)

      // Snapshot name/url ONLY for listings actually carded in the reply (a
      // handful), not every searched listing – citations can be the whole
      // result set (e.g. 400+ jobs), which would blow past Airtable's cell
      // limit. The viewer only needs refs for [[card:...]] ids anyway.
      const citedById = new Map(citations.map(c => [c.id, c]))
      const cardedIds = new Set<string>()
      const cardRe = /\[\[\s*card\s*:\s*([^\]|\n]+?)(?:\s*\|[^\n]*?)?\s*\]\]/gi
      let cardMatch: RegExpExecArray | null
      while ((cardMatch = cardRe.exec(assistantText)) !== null) {
        cardedIds.add(cardMatch[1].replace(/\s+/g, ''))
      }
      const citationRefs = [...cardedIds]
        .map(id => citedById.get(id))
        .filter((c): c is (typeof citations)[number] => Boolean(c))
        .map(c => ({
          id: c.id,
          name: c.name,
          organization: c.organization,
          url: c.url,
          logo: c.logo,
        }))

      // after() keeps the serverless function alive until the write completes.
      // A bare fire-and-forget promise gets frozen (and usually lost) the
      // moment the response stream closes, so conversations were never
      // reaching Airtable in production.
      //
      // The PROMISE form, deliberately: after(fn) defers fn until the
      // response's 'close' event, and only listens for that event from the
      // first after() call in the request. On an abandoned turn the visitor's
      // disconnect has already fired 'close' by the time the abort reaches
      // this code, so a callback registered here would wait for an event
      // that never comes and silently never run — abandoned turns weren't
      // being logged at all. Handing after() the in-flight promise instead
      // starts the write now and keeps the function alive until it settles,
      // regardless of where the response is in its lifecycle.
      after(
        storeConversationTurn({
          // When the user's message arrived (not when the log write runs), so
          // the admin transcript can show real gaps between turns.
          ts: new Date(startedAt).toISOString(),
          sessionId: body.sessionId ?? null,
          currentPage: ctx.currentPage,
          pageState: ctx.pageState ?? null,
          referrer: ctx.referrer ?? null,
          geo: ctx.geo ?? null,
          utm: ctx.utm ?? null,
          user: userQuery,
          // The log's history window plus the assistant's just-finished reply
          // (empty when generation produced nothing), so the upsert persists
          // the up-to-date History in one row.
          history: [
            ...logHistory,
            { role: 'assistant', content: assistantText },
          ],
          // The appended reply's widget-side position is the raw incoming
          // message count — the widget POSTs its whole list and appends the
          // reply bubble right after it, which is also the turnIndex its
          // delivery/rating/click reports use for this reply.
          historyIndices: [
            ...logIndices,
            Array.isArray(body.messages) ? body.messages.length : 0,
          ],
          // Same list un-windowed, for the blob mirror; the appended reply's
          // widget position is the same as above.
          fullHistory: [
            ...fullHistory,
            { role: 'assistant', content: assistantText },
          ],
          fullIndices: [
            ...fullIndices,
            Array.isArray(body.messages) ? body.messages.length : 0,
          ],
          toolCalls,
          response: assistantText,
          fallbackCards: result?.fallbackCardIds ?? [],
          citations: citations.map(c => c.id),
          citationRefs,
          zeroMatches,
          status,
          latencyMs: Date.now() - startedAt,
          promptVersion: PROMPT_VERSION,
          tags: internal ? [INTERNAL_TAG] : [],
        })
      )
    }

    let result: AssistantRunResult
    try {
      result = await runAssistantStream({
        client,
        systemPrompt: PRODUCTION_PROMPT,
        pagesBlock: PAGES_BLOCK,
        donationGuide: await getDonationGuideText(),
        model: resolveModelId(),
        apiMessages,
        catalog,
        send,
        signal,
      })
    } catch (err) {
      // Generation threw (API/model error). This turn used to vanish entirely;
      // still log the visitor's query so we can see what was asked, then
      // re-throw so sseResponse emits the error event exactly as before. (An
      // abort surfacing here — runAssistantStream normally absorbs those — is
      // still an abandonment, not a bug.)
      logTurn(null, signal.aborted ? 'abandoned' : 'error')
      throw err
    }
    if (result.aborted) {
      // The visitor's connection dropped mid-generation (tab closed, or Stop
      // pressed). Log the partial reply they had received by then — earlier
      // this discarded the text, so the admin log couldn't show what they
      // saw — and skip the citation/fallback bookkeeping, which was never
      // computed for the cut-off text.
      logTurn(result, 'abandoned')
      return
    }
    send('done', {})
    // Log every completed turn — including ones where the visitor left before
    // the first token streamed (empty reply), which we used to drop. An empty
    // completion means nothing streamed, so flag it as abandoned.
    const empty = !result.assistantText && result.toolCalls.length === 0
    logTurn(result, empty ? 'abandoned' : undefined)
  })
}
