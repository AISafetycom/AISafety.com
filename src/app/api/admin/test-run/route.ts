import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { canViewPlayground } from '@/lib/admin/auth'
import { getCatalog } from '@/lib/assistant/catalog'
import {
  PAGES_BLOCK,
  buildContextLine,
  type RequestContext,
} from '@/lib/assistant/prompt'
import { DEFAULT_MODEL_ID, isKnownModelId } from '@/lib/assistant/models'
import { getDonationGuideText } from '@/lib/assistant/donation-guide'
import { getPageLastUpdatedDates } from '@/lib/assistant/page-dates'
import {
  buildApiMessages,
  runAssistantStream,
  sseResponse,
  validateMessages,
} from '@/lib/assistant/stream'
import type { ChatMessage } from '@/lib/assistant/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await canViewPlayground())) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }

  let body: {
    prompt?: unknown
    model?: unknown
    messages?: unknown
    currentPage?: unknown
    pageState?: unknown
    referrer?: unknown
    utm?: unknown
    geo?: unknown
  }
  try {
    body = await req.json()
  } catch (err) {
    console.warn('[admin] test-run JSON parse failed', err)
    return new Response('invalid JSON', { status: 400 })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'prompt required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  // Only ids from the model list reach the API and the system prompt.
  const model =
    typeof body.model === 'string' && isKnownModelId(body.model)
      ? body.model
      : DEFAULT_MODEL_ID

  let messages: ChatMessage[]
  try {
    messages = validateMessages(body.messages)
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
    pageState:
      body.pageState && typeof body.pageState === 'object'
        ? (body.pageState as Record<string, unknown>)
        : null,
    referrer: typeof body.referrer === 'string' ? body.referrer : null,
    utm:
      body.utm && typeof body.utm === 'object'
        ? (body.utm as Record<string, string>)
        : null,
    geo:
      body.geo && typeof body.geo === 'object'
        ? (body.geo as { city?: string; region?: string; country?: string })
        : null,
    pageDates,
  }
  const apiMessages = buildApiMessages(messages, buildContextLine(ctx))
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  return sseResponse(async ({ send, signal }) => {
    await runAssistantStream({
      client,
      systemPrompt: prompt,
      pagesBlock: PAGES_BLOCK,
      donationGuide: getDonationGuideText(),
      model,
      apiMessages,
      catalog,
      send,
      signal,
    })
    send('done', {})
  })
}
