import type { NextFetchEvent, NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// AI assistants (ChatGPT, Claude, Perplexity, ...) fetch pages without running
// JavaScript, so the Matomo snippet in layout.tsx never sees them. They do
// identify themselves in the User-Agent header, though — this proxy runs on
// every page request, spots those signatures, and reports the hit server-side
// via Matomo's HTTP Tracking API. recMode=1 files the hit under Matomo's
// separate "AI Chatbots" report; it never counts as a human visit or session.
//
// Covers the assistants' live fetchers (ChatGPT-User, Claude-User,
// Perplexity-User, ...) and their crawlers (GPTBot, ClaudeBot, CCBot, ...).
// Matomo classifies and names the bot from the raw User-Agent we pass along,
// so new variants from these families need no changes here.
const AI_BOT_UA =
  /GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Google-CloudVertexBot|Meta-ExternalAgent|Meta-ExternalFetcher|Amazonbot|Applebot-Extended|Bytespider|CCBot|cohere-ai|DuckAssistBot|YouBot|MistralAI-User|AI2Bot|Diffbot/i

const MATOMO_ENDPOINT = 'https://aisafety.matomo.cloud/matomo.php'
const MATOMO_SITE_ID = '1'

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const ua = request.headers.get('user-agent') ?? ''

  if (request.method === 'GET' && AI_BOT_UA.test(ua)) {
    const hit = new URL(MATOMO_ENDPOINT)
    hit.searchParams.set('idsite', MATOMO_SITE_ID)
    hit.searchParams.set('rec', '1')
    hit.searchParams.set('recMode', '1')
    hit.searchParams.set('ua', ua)
    hit.searchParams.set('url', request.nextUrl.href)

    // Only the real site reports to Matomo — preview deploys and localhost
    // would otherwise pollute the report with test hits.
    const host = request.nextUrl.hostname
    if (host === 'aisafety.com' || host === 'www.aisafety.com') {
      // waitUntil: the ping happens after the response is sent, so bots (and
      // humans, if a bot UA ever overlaps) are never slowed down. Failures are
      // swallowed — analytics must never break a page.
      event.waitUntil(fetch(hit).catch(() => {}))
    } else if (process.env.NODE_ENV === 'development') {
      console.log(`[ai-bot-tracking] would send: ${hit}`)
    }
  }

  return NextResponse.next()
}

export const config = {
  // Page routes only: skip API routes, Next.js internals/assets, the internal
  // admin area, orgs' private pages (/stats/<token>: the token never goes to
  // Matomo), and anything with a file extension (favicon, sitemap, images).
  matcher: ['/((?!api|_next|admin|stats/|.*\\..*).*)'],
}
