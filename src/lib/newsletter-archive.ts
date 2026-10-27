/* Each newsletter's past issues and its feed (10 Oct 2026).

   aisafety.com/newsletter/<key> lists every issue sent through
   ActiveCampaign, newest first, each linking its web version
   (/newsletter/<key>/<issue>); aisafety.com/newsletter/<key>/feed is the
   same list as an RSS feed, each item carrying the issue's text version
   (src/lib/newsletter-text.ts), so a feed reader shows the listings
   themselves. The Substack newsletters had both (/archive, /feed); a reader
   asked for the feed back after the move (Koby Lewis, EA Forum, 9 Oct 2026).

   Issues from before the move stay on Substack, and both pages say so;
   the practice sends to the lists before it aren't listed (MIN_READERS).
   A newsletter with no issue sent through ActiveCampaign yet (Funding,
   until its move) has neither page: they appear with its first issue.

   This module is pure; the reads (ActiveCampaign, the site's own record of
   sent issues, the feed's reader counts) are in
   src/lib/newsletter-archive-store.ts. */

import { createHash } from 'node:crypto'
import {
  WEB_NEWSLETTERS,
  issueName,
  webPath,
  type WebKey,
} from '@/lib/newsletter-web'
import { esc, textHtml, type TextVersion } from '@/lib/newsletter-text'

export const SITE = 'https://aisafety.com'

/** Where each newsletter's issues from before the move are. Events and
 *  Training were one newsletter there. */
export const SUBSTACK_ARCHIVES: Record<WebKey, string> = {
  events: 'https://aisafetyeventsandtraining.substack.com/archive',
  training: 'https://aisafetyeventsandtraining.substack.com/archive',
  funding: 'https://aisafetyfunding.substack.com/archive',
}

/** What each newsletter is, after its name, as its emails' intros put it:
 *  the page's lead and the feed's description. */
export const NEWSLETTER_ABOUT: Record<WebKey, string> = {
  events:
    'is a weekly newsletter that lists newly announced events addressing existential risk from AI.',
  training:
    'is a weekly newsletter that lists newly announced training programs addressing existential risk from AI.',
  funding:
    'is a newsletter that lists new and closing-soon funding opportunities for addressing existential risk from AI.',
}

/** The link under each newsletter page's lead to the resource page it
 *  comes from (WEB_NEWSLETTERS' `page`), worded like /events' and
 *  /training's links to each other: "<lead> <name> →". It says "live list"
 *  so the always-current page stands apart from the newsletter's issues
 *  (Bryce, 23 Oct 2026). */
export const RESOURCE_LINK: Record<WebKey, { lead: string; name: string }> = {
  events: {
    lead: 'For a live list of every upcoming event go to',
    name: 'Events',
  },
  training: {
    lead: 'For a live list of every upcoming training program go to',
    name: 'Training programs',
  },
  funding: {
    lead: 'For a live list of every source of funding go to',
    name: 'Funding',
  },
}

/** Where the Substack issues are, said after the list. */
export const SUBSTACK_NOTE: Record<WebKey, string> = {
  events:
    'Earlier issues, from when Events and Training were one newsletter, are on',
  training:
    'Earlier issues, from when Events and Training were one newsletter, are on',
  funding: 'Earlier issues are on',
}

/** How many issues the feed carries: the newest. Readers keep what they
 *  have already seen. */
export const FEED_ITEMS = 20

/** How many people an issue must have gone to before it's listed. Before
 *  the move, issues went to the real lists while they held only the
 *  owner's own addresses (two or three people) as practice; those were
 *  the Substack issues' copies, not issues of their own. Every real send
 *  since reaches hundreds (the first warm-up wave, 541). */
export const MIN_READERS = 50

export interface ArchiveIssue {
  /** The issue's address under /newsletter/<key>/: "week-41-2026". */
  slug: string
  /** When it first reached readers, as an ISO instant; null when that
   *  isn't known. */
  sentAt: string | null
}

export function archivePath(key: WebKey): string {
  return `/newsletter/${key}`
}

export function feedPath(key: WebKey): string {
  return `/newsletter/${key}/feed`
}

export function issuePath(key: WebKey, slug: string): string {
  return `/newsletter/${key}/${slug}`
}

/** Pure: the issue's address for a campaign name of this newsletter
 *  ("Events · Week 41, 2026" → "week-41-2026"), or null for any other. */
export function issueSlug(key: WebKey, name: string): string | null {
  const path = webPath(name)
  const prefix = `/newsletter/${key}/`
  return path?.startsWith(prefix) ? path.slice(prefix.length) : null
}

/** Pure: the issue's subject, as its email had it ("Week 41, 2026",
 *  "Issue #23, 2026"), or null for an address that isn't an issue's. */
export function issueTitle(key: WebKey, slug: string): string | null {
  const name = issueName(key, slug)
  return name ? name.slice(name.indexOf(' · ') + 3) : null
}

/** Pure: year and number, for ordering ("week-41-2026" → [2026, 41]). */
function issueOrder(slug: string): [number, number] {
  const m = /^(?:week|issue)-(\d+)-(\d{4})$/.exec(slug)
  return m ? [Number(m[2]), Number(m[1])] : [0, 0]
}

/** Pure: lists of issues as one, each issue once, newest first (by year,
 *  then number: what the pipeline counts up). An issue's date is the
 *  earliest any list gives it. Entries that aren't this newsletter's
 *  issues are left out. */
export function mergeIssues(
  key: WebKey,
  ...lists: ArchiveIssue[][]
): ArchiveIssue[] {
  const bySlug = new Map<string, ArchiveIssue>()
  for (const { slug, sentAt } of lists.flat()) {
    if (!issueName(key, slug)) continue
    const at = sentAt && !Number.isNaN(Date.parse(sentAt)) ? sentAt : null
    const known = bySlug.get(slug)
    if (!known) bySlug.set(slug, { slug, sentAt: at })
    else if (at && (!known.sentAt || Date.parse(at) < Date.parse(known.sentAt)))
      known.sentAt = at
  }
  return [...bySlug.values()].sort((a, b) => {
    const [yearA, numberA] = issueOrder(a.slug)
    const [yearB, numberB] = issueOrder(b.slug)
    return yearB - yearA || numberB - numberA
  })
}

/** An issue in the feed, with its text version when it has one. */
export interface FeedEntry {
  issue: ArchiveIssue
  text: TextVersion | null
}

/** Pure: XML text, escaped for an element or an attribute. */
function xml(s: string): string {
  return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Pure: the newsletter's RSS 2.0 feed, `entries` newest first. Each item
 *  is an issue: its subject, its web version, when it went out, and its
 *  text version as the content (the intro and every listing, with the
 *  email's own links, so a click from a feed reader counts as the
 *  newsletter's like any other). An issue without a text version carries a
 *  line linking its web version. Nothing in it depends on when it was
 *  built, so an unchanged feed has an unchanged ETag. */
export function feedXml(key: WebKey, entries: FeedEntry[]): string {
  const nl = WEB_NEWSLETTERS[key]
  const newest = entries.find(e => e.issue.sentAt)?.issue.sentAt
  const items = entries.map(({ issue, text }) => {
    const link = SITE + issuePath(key, issue.slug)
    const title = issueTitle(key, issue.slug) ?? issue.slug
    const body = text
      ? textHtml(text)
      : `<p><a href="${esc(link)}">Read this issue on AISafety.com</a></p>`
    const date = issue.sentAt
      ? `\n<pubDate>${new Date(issue.sentAt).toUTCString()}</pubDate>`
      : ''
    return `<item>
<title>${xml(title)}</title>
<link>${xml(link)}</link>
<guid isPermaLink="true">${xml(link)}</guid>${date}
<description>${xml(body)}</description>
</item>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${xml(nl.sender)}</title>
<link>${xml(SITE + archivePath(key))}</link>
<description>${xml(`${nl.sender} ${NEWSLETTER_ABOUT[key]} From AISafety.com.`)}</description>
<language>en</language>
<atom:link href="${xml(SITE + feedPath(key))}" rel="self" type="application/rss+xml"/>${newest ? `\n<lastBuildDate>${new Date(newest).toUTCString()}</lastBuildDate>` : ''}
${items.join('\n')}
</channel>
</rss>
`
}

/** Pure: a strong validator for the feed's body, for If-None-Match. */
export function feedEtag(body: string): string {
  return `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`
}

/** Pure: whether an If-None-Match header names this ETag (or is "*"). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false
  return header
    .split(',')
    .map(t => t.trim().replace(/^W\//, ''))
    .some(t => t === etag || t === '*')
}

/* ─── Feed readers ────────────────────────────────────────────────────────
   Who fetches the feed, counted per newsletter per day. A feed service
   (Feedly, Inoreader, NewsBlur…) fetches once for all its users and says
   how many in its User-Agent ("… 12 subscribers"); a reader app on
   someone's own device fetches for that person alone. Search engines,
   AI assistants, link previews, checkers and scripts aren't readers, and
   nor is someone opening the feed in a browser tab (the route leaves those
   out by their navigation headers). Anyone can send any User-Agent, so a
   subscriber count is taken only from a known service, under its own
   name, and never above SERVICE_MAX: a made-up one can't add rows or
   inflate the numbers beyond that. */

/** Feed services that report their users' count, by the name they're
 *  stored under. */
const FEED_SERVICES: [string, RegExp][] = [
  ['Feedly', /feedly/i],
  ['Inoreader', /inoreader/i],
  ['NewsBlur', /newsblur/i],
  ['Feedbin', /feedbin/i],
  ['The Old Reader', /theoldreader/i],
  ['Feeder', /feeder\.co\b/i],
  ['Feedspot', /feedspot/i],
  ['Bloglovin', /bloglovin/i],
  ['Netvibes', /netvibes/i],
]
const SUBSCRIBERS_RE = /(\d{1,7})\s+(?:subscribers?|readers?)\b/i
const FEED_ID_RE = /feed-?id[:=\s]\s*(\d{1,12})/i
/** More users than any one service plausibly has for this feed: the
 *  newsletters' own lists hold about 3,000. */
export const SERVICE_MAX = 5000
const NOT_A_READER_RE =
  /bot|crawl|spider|slurp|preview|prefetch|scan|monitor|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|undici|^node$|^deno|^bun\/|libwww|httpclient|headless|phantom|playwright|puppeteer|lighthouse|zgrab|facebookexternalhit|whatsapp|iframely|embedly|-User\b|Meta-External|cohere-ai/i

export type FeedReader =
  /** A known feed service, and how many of its users follow the feed.
   *  `service` is its name, plus the feed id it sends, if any (a service
   *  can follow the feed under two addresses, each with its own users). */
  | { kind: 'service'; service: string; readers: number }
  /** A reader app fetching for one person. */
  | { kind: 'direct' }

/** Pure: what a fetch of the feed with this User-Agent counts as, or null
 *  when it isn't a reader. */
export function feedReader(userAgent: string | null): FeedReader | null {
  const ua = (userAgent ?? '').trim()
  if (!ua) return null
  const count = SUBSCRIBERS_RE.exec(ua)
  const known = FEED_SERVICES.find(([, re]) => re.test(ua))
  if (count && known) {
    const id = FEED_ID_RE.exec(ua)?.[1]
    return {
      kind: 'service',
      service: id ? `${known[0]} ${id}` : known[0],
      readers: Math.min(Number(count[1]), SERVICE_MAX),
    }
  }
  return NOT_A_READER_RE.test(ua) ? null : { kind: 'direct' }
}

/** Pure: whether a request is a browser opening the feed as a page (a
 *  click on the past issues page's link, or the address typed in): a
 *  look, not a reader. Browsers send these headers on every page load;
 *  feed services and reader apps don't. */
export function isBrowserLoad(headers: Headers): boolean {
  return (
    headers.get('sec-fetch-mode') === 'navigate' ||
    ['document', 'iframe'].includes(headers.get('sec-fetch-dest') ?? '')
  )
}
