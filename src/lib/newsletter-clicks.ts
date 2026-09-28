/*
  Newsletter click counting (28 Sept 2026). ActiveCampaign's own click
  tracking is off — its tracker dropped about half the connections — so the
  pipeline points every link of an email at /api/nl/<list>/<n> instead. It
  saves the email's links as one JSON list on the site's Blob store
  (newsletter/links/<list>.json, named by its content, so a list never
  changes once written): `{ v: 1, c: <campaign name>, links: [{ u, k, t }] }`
  — u the destination, k the card's record key ('page' outside the cards),
  t a label (the card title or the link text).

  The route looks the link up in that list, counts the click here and
  redirects. Only links from our own lists can be followed, so the address
  can't be used to send people elsewhere. Counts are anonymous: per campaign
  name, per link, nothing about who clicked.
*/

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Redis } from '@upstash/redis'

/** The site's public Blob store, where the pipeline saves each email's
 *  links (the same store its logos live in). */
const LINKS_BASE =
  'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/newsletter/links/'

export const LIST_ID_RE = /^[0-9a-f]{16}$/

export interface NewsletterLink {
  /** Where the link goes. */
  u: string
  /** The card's record key, or 'page' for links outside the cards. */
  k: string
  /** The card title or the link text. */
  t: string
}

export interface LinkList {
  /** The ActiveCampaign campaign name ("Training · Week 39, 2026"). */
  c: string
  links: NewsletterLink[]
}

/** Pure: a fetched list, checked. Null for anything malformed or any link
 *  that isn't plain http(s) — nothing else is ever redirected to. */
export function parseLinkList(data: unknown): LinkList | null {
  const d = data as { v?: unknown; c?: unknown; links?: unknown } | null
  if (!d || d.v !== 1 || typeof d.c !== 'string' || !Array.isArray(d.links))
    return null
  const links: NewsletterLink[] = []
  for (const l of d.links as Array<Record<string, unknown>>) {
    if (
      !l ||
      typeof l.u !== 'string' ||
      typeof l.k !== 'string' ||
      typeof l.t !== 'string'
    )
      return null
    let url: URL
    try {
      url = new URL(l.u)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    links.push({ u: url.href, k: l.k.slice(0, 100), t: l.t.slice(0, 200) })
  }
  return { c: d.c.slice(0, 200), links }
}

/** Lists never change once written, so each is fetched once per instance. */
const lists = new Map<string, Promise<LinkList | null>>()

export async function loadLinkList(listId: string): Promise<LinkList | null> {
  if (!LIST_ID_RE.test(listId)) return null
  const hit = lists.get(listId)
  if (hit) return hit
  // Resolved under the links folder and refused if it escapes it, so the id
  // from the address can never point the read anywhere else.
  const url = new URL(`${listId}.json`, LINKS_BASE)
  if (!url.href.startsWith(LINKS_BASE)) return null
  const read = fetch(url, { cache: 'force-cache' })
    .then(async res => (res.ok ? parseLinkList(await res.json()) : null))
    .catch(err => {
      console.warn(
        `[newsletter-clicks] list ${listId} unreadable: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    })
  lists.set(listId, read)
  // A failed read is retried next time rather than remembered.
  void read.then(list => {
    if (!list) lists.delete(listId)
  })
  return read
}

/** Pure: link checkers and prefetchers rather than a reader — mail security
 *  scanners and preview bots open links before anyone clicks. Not caught:
 *  scanners that pretend to be an ordinary browser, so counts can run a
 *  little high. */
export function isLikelyBot(userAgent: string | null): boolean {
  if (!userAgent) return true
  return /bot|crawl|spider|slurp|preview|prefetch|scan|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|headless|phantom|barracuda|proofpoint|mimecast|symantec|forcepoint|trendmicro|safelinks|microsoft office|outlook-ios|linkcheck|monitor/i.test(
    userAgent
  )
}

// ─── Counts ──────────────────────────────────────────────────────────────────

// The same Upstash database the site's analytics use (see
// src/lib/analytics/events.ts); a local file without it.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

/** One hash per campaign: a field per link (its label and destination as
 *  JSON) holding the click count, plus the campaign total. */
const KEY_PREFIX = 'aisafety:newsletter:clicks:'
const TOTAL_FIELD = '__total'

const DEV_FILE = path.join(
  process.cwd(),
  '.analytics-dev',
  'newsletter-clicks.json'
)

async function readDevCounts(): Promise<
  Record<string, Record<string, number>>
> {
  try {
    return JSON.parse(await fs.readFile(DEV_FILE, 'utf8'))
  } catch {
    return {}
  }
}

/** Count one click. Never throws: it runs after the reader has been sent on
 *  (via after()), and a failed count must not matter to them. */
export async function recordClick(
  campaign: string,
  link: NewsletterLink
): Promise<void> {
  const field = JSON.stringify({ t: link.t, u: link.u })
  try {
    if (store) {
      const p = store.pipeline()
      p.hincrby(KEY_PREFIX + campaign, field, 1)
      p.hincrby(KEY_PREFIX + campaign, TOTAL_FIELD, 1)
      await p.exec()
      return
    }
    const all = await readDevCounts()
    const c = (all[campaign] ??= {})
    c[field] = (c[field] ?? 0) + 1
    c[TOTAL_FIELD] = (c[TOTAL_FIELD] ?? 0) + 1
    await fs.mkdir(path.dirname(DEV_FILE), { recursive: true })
    await fs.writeFile(DEV_FILE, JSON.stringify(all))
  } catch (err) {
    console.warn(
      `[newsletter-clicks] count failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export interface CampaignClicks {
  total: number
  /** Most-clicked first. */
  links: Array<{ label: string; url: string; clicks: number }>
}

/** Pure: a campaign's hash as stored, turned into totals. */
export function summariseClicks(
  hash: Record<string, unknown> | null
): CampaignClicks {
  const links: CampaignClicks['links'] = []
  let total = 0
  for (const [field, raw] of Object.entries(hash ?? {})) {
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    if (field === TOTAL_FIELD) {
      total = n
      continue
    }
    try {
      const { t, u } = JSON.parse(field) as { t?: unknown; u?: unknown }
      if (typeof u === 'string')
        links.push({ label: typeof t === 'string' ? t : u, url: u, clicks: n })
    } catch {
      // A field that isn't ours; nothing to show for it.
    }
  }
  links.sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label))
  return { total, links }
}

/** Clicks for each campaign name (campaigns nobody clicked get zero). */
export async function readClicks(
  campaigns: string[]
): Promise<Map<string, CampaignClicks>> {
  const out = new Map<string, CampaignClicks>()
  if (campaigns.length === 0) return out
  try {
    if (store) {
      const p = store.pipeline()
      for (const c of campaigns) p.hgetall(KEY_PREFIX + c)
      const hashes = (await p.exec()) as Array<Record<string, unknown> | null>
      campaigns.forEach((c, i) => out.set(c, summariseClicks(hashes[i])))
      return out
    }
    const all = await readDevCounts()
    for (const c of campaigns) out.set(c, summariseClicks(all[c] ?? null))
  } catch (err) {
    // The sends table still shows without click counts.
    console.warn(
      `[newsletter-clicks] read failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  return out
}
