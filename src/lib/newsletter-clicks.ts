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

  Hardened before the first real sends (29 Sept 2026):
  - A bad entry in a list sends that one link to the homepage; the email's
    other links keep working.
  - The Blob read (Next's fetch cache included) gives up after 2.5 s. A
    list read from the Blob is used only if its content still matches its
    name (the pipeline names each list by the first 16 hex characters of
    its SHA-256), and is then copied to Upstash with no expiry. When the
    Blob is slow, missing or changed, that copy is used instead (given
    1.5 s more); failing that, the homepage. So a reader waits 4 s at most.
  - More link checkers are recognised by name, and a burst (one address
    opening 3+ different links of one email within 10 s) is a scanner, so
    none of that burst is counted. Addresses are kept only as a keyed hash,
    for 30 s.

  NEVER DELETE ANYTHING UNDER newsletter/ IN THE BLOB STORE. Every email
  already sent depends on it for good: its links (newsletter/links/) and its
  images (logos, icons, the wordmark, the hero glow). The Upstash copies
  cover the link lists only, and only lists someone has already clicked.
  To change where a sent link goes, don't edit its list on the Blob: an
  edited list no longer matches its name and is ignored.
*/

import { createHash, createHmac } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Redis } from '@upstash/redis'

/** The site's public Blob store, where the pipeline saves each email's
 *  links (the same store its logos live in). */
export const LINKS_BASE =
  'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/newsletter/links/'

/** Where a link that can't be followed goes instead: the homepage links
 *  everything the newsletters list. */
export const HOMEPAGE = 'https://aisafety.com/'

export const LIST_ID_RE = /^[0-9a-f]{16}$/

/** How long a reader waits on the Blob store before the Upstash copy is
 *  tried, and then on that copy before the homepage. */
const BLOB_TIMEOUT_MS = 2500
const COPY_TIMEOUT_MS = 1500

export interface NewsletterLink {
  /** Where the link goes. */
  u: string
  /** The card's record key, or 'page' for links outside the cards. */
  k: string
  /** The card title or the link text. */
  t: string
  /** Set when the list's entry was unusable and the link goes to the
   *  homepage instead. */
  fallback?: true
}

export interface LinkList {
  /** The ActiveCampaign campaign name ("Training · Week 39, 2026"). */
  c: string
  links: NewsletterLink[]
}

/** Pure: one entry of a list. Anything that isn't a plain http(s) link goes
 *  to the homepage — nothing else is ever redirected to. */
function parseLink(raw: unknown): NewsletterLink {
  const l = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >
  const k = typeof l.k === 'string' ? l.k.slice(0, 100) : 'page'
  const t = typeof l.t === 'string' ? l.t.slice(0, 200) : 'aisafety.com'
  let url: URL | null = null
  try {
    if (typeof l.u === 'string') url = new URL(l.u)
  } catch {
    // Not a URL at all: the homepage below.
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    return { u: HOMEPAGE, k, t, fallback: true }
  return { u: url.href, k, t }
}

/** Pure: a fetched list, checked. Null only when the list as a whole isn't
 *  one of ours; a bad entry keeps its place (so link <n> is still link <n>)
 *  and goes to the homepage, and the rest of the email's links still work. */
export function parseLinkList(data: unknown): LinkList | null {
  const d = data as { v?: unknown; c?: unknown; links?: unknown } | null
  if (
    !d ||
    typeof d !== 'object' ||
    d.v !== 1 ||
    typeof d.c !== 'string' ||
    !Array.isArray(d.links)
  )
    return null
  return { c: d.c.slice(0, 200), links: d.links.map(parseLink) }
}

/** Pure: whether a list's raw bytes are the ones its name was made from
 *  (~/Newsletter/render.py track_links: the first 16 hex characters of the
 *  SHA-256 of the JSON it uploads). */
export function matchesListId(listId: string, raw: Uint8Array): boolean {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16) === listId
}

/** The list from raw bytes, or null (with a warning) when they aren't the
 *  list the id names or aren't a list at all. */
function listFromRaw(listId: string, raw: Uint8Array): LinkList | null {
  if (!matchesListId(listId, raw)) {
    console.warn(
      `[newsletter-clicks] list ${listId} doesn't match its name; not used`
    )
    return null
  }
  try {
    return parseLinkList(JSON.parse(new TextDecoder().decode(raw)))
  } catch {
    console.warn(`[newsletter-clicks] list ${listId} isn't JSON`)
    return null
  }
}

/** Null when `p` hasn't settled within `ms` (the work itself carries on). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** Something to do once the reader has been sent on: the route passes
 *  Next's after(); elsewhere it just runs. */
export type Later = (task: () => Promise<void>) => void
const runNow: Later = task => void task()

/** Lists never change once written, so each is read once per instance. */
const lists = new Map<string, Promise<LinkList | null>>()

/** The list, from the Blob store or else its Upstash copy; null when
 *  neither can be read (the link then goes to the homepage). A list read
 *  from the Blob is copied to Upstash via `later`, so the reader never waits
 *  on the copy. */
export async function loadLinkList(
  listId: string,
  later: Later = runNow
): Promise<LinkList | null> {
  if (!LIST_ID_RE.test(listId)) return null
  const hit = lists.get(listId)
  if (hit) return hit
  // Never rejects: a remembered rejection would break every later click on
  // this list until the instance restarts.
  const read = readList(listId, later).catch(err => {
    console.warn(
      `[newsletter-clicks] list ${listId}: read failed: ${err instanceof Error ? err.message : String(err)}`
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

async function readList(
  listId: string,
  later: Later
): Promise<LinkList | null> {
  // The whole Blob step is timed, not just the network read: Next's fetch
  // looks in its own cache (and waits on its lock) before the signal
  // applies, and a stall there must not hold the reader either.
  const raw = await within(readBlob(listId), BLOB_TIMEOUT_MS)
  const fromBlob = raw && listFromRaw(listId, raw)
  if (raw && fromBlob) {
    try {
      later(() => keepCopy(listId, raw))
    } catch {
      // after() refused (called outside a request): copy it now instead.
      void keepCopy(listId, raw)
    }
    return fromBlob
  }
  const copy = await within(readCopy(listId), COPY_TIMEOUT_MS)
  if (copy) {
    const fromCopy = listFromRaw(listId, copy)
    if (fromCopy) {
      console.warn(`[newsletter-clicks] list ${listId} read from its copy`)
      return fromCopy
    }
  }
  console.warn(`[newsletter-clicks] list ${listId} unreadable; homepage`)
  return null
}

/** The list's bytes from the Blob store, or null (missing, slow, down). */
async function readBlob(listId: string): Promise<Uint8Array | null> {
  // Resolved under the links folder and refused if it escapes it, so the id
  // from the address can never point the read anywhere else.
  const url = new URL(`${listId}.json`, LINKS_BASE)
  if (!url.href.startsWith(LINKS_BASE)) return null
  try {
    const res = await fetch(url, {
      cache: 'force-cache',
      signal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(
        `[newsletter-clicks] list ${listId}: Blob answered ${res.status}`
      )
      return null
    }
    return new Uint8Array(await res.arrayBuffer())
  } catch (err) {
    console.warn(
      `[newsletter-clicks] list ${listId}: Blob read failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

/** Pure: link checkers and prefetchers rather than a reader — mail security
 *  scanners and preview bots open links before anyone clicks. Not caught:
 *  scanners that pretend to be an ordinary browser, so counts can run a
 *  little high (the burst rule below catches the ones that open every link
 *  at once). */
export function isLikelyBot(userAgent: string | null): boolean {
  if (!userAgent) return true
  return /bot|crawl|spider|slurp|preview|prefetch|scan|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|headless|phantom|barracuda|proofpoint|mimecast|symantec|forcepoint|trendmicro|safelinks|microsoft office|ms-office|msoffice|outlook-ios|outlook-android|linkcheck|monitor|facebookexternalhit|whatsapp|google-safety|iframely|embedly|libwww|zgrab|zscaler|cisco/i.test(
    userAgent
  )
}

// ─── Upstash ─────────────────────────────────────────────────────────────────

// The same Upstash database the site's analytics use (see
// src/lib/analytics/events.ts); a local file without it.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null
// The list copies are kept and read back byte for byte (their hash has to
// match), so this client leaves values as the strings they were stored as.
const rawStore =
  restUrl && restToken
    ? new Redis({
        url: restUrl,
        token: restToken,
        automaticDeserialization: false,
      })
    : null

// ─── Link list copies ────────────────────────────────────────────────────────

/** The list's JSON exactly as the Blob served it; no expiry (old emails
 *  keep working for good). */
const COPY_PREFIX = 'aisafety:newsletter:links:'

/** Copy a list read from the Blob to Upstash, once (a list never changes).
 *  Never throws: it runs after the reader has been sent on. */
async function keepCopy(listId: string, raw: Uint8Array): Promise<void> {
  if (!rawStore) return
  try {
    await rawStore.set(COPY_PREFIX + listId, new TextDecoder().decode(raw), {
      nx: true,
    })
  } catch (err) {
    console.warn(
      `[newsletter-clicks] list ${listId}: copy failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/** The list's copy in Upstash, or null (none, no store, store down). */
async function readCopy(listId: string): Promise<Uint8Array | null> {
  if (!rawStore) return null
  try {
    const copy = await rawStore.get<string>(COPY_PREFIX + listId)
    return typeof copy === 'string' ? new TextEncoder().encode(copy) : null
  } catch (err) {
    console.warn(
      `[newsletter-clicks] list ${listId}: copy unreadable: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

// ─── Bursts ──────────────────────────────────────────────────────────────────

/** A scanner rather than readers: one address opening this many different
 *  links of one email within BURST_WINDOW_MS. A reader rarely opens three
 *  cards inside ten seconds; a mail scanner opens every link at once. */
const BURST_LINKS = 3
const BURST_WINDOW_MS = 10_000
/** Per email and hashed address: when each link was last opened from it. */
const BURST_PREFIX = 'aisafety:newsletter:burst:'
const BURST_TTL_SECONDS = 30

/** The address as a short keyed hash, never the address itself. Keyed with
 *  the store's token, so it can't be reversed by hashing every address. */
function addressKey(ip: string): string {
  return createHmac('sha256', `newsletter-burst:${restToken ?? ''}`)
    .update(ip)
    .digest('hex')
    .slice(0, 16)
}

/** Pure: whether a click at `at` belongs to a scanner's burst, given when
 *  (ms) each link of the email was last opened from the same address: some
 *  BURST_WINDOW_MS stretch that includes `at` holds BURST_LINKS or more
 *  different links. */
export function isBurst(times: number[], at: number): boolean {
  const sorted = [...times].sort((a, b) => a - b)
  for (const start of sorted) {
    if (start > at || start + BURST_WINDOW_MS < at) continue
    const inWindow = sorted.filter(
      t => t >= start && t <= start + BURST_WINDOW_MS
    ).length
    if (inWindow >= BURST_LINKS) return true
  }
  return false
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Whether this click is part of a scanner's burst, so not to be counted.
 *  Notes the click, then waits out the window before deciding (it runs
 *  after the reader has been sent on), so the first clicks of a burst are
 *  caught along with the rest. False (count it) with no address, no store,
 *  or a store error. */
export async function isScannerBurst(
  listId: string,
  n: number,
  ip: string | null
): Promise<boolean> {
  if (!store || !ip) return false
  const key = `${BURST_PREFIX}${listId}:${addressKey(ip)}`
  const at = Date.now()
  try {
    const p = store.pipeline()
    p.zadd(key, { score: at, member: String(n) })
    p.expire(key, BURST_TTL_SECONDS)
    await p.exec()
    await sleep(BURST_WINDOW_MS)
    const seen = await store.zrange<string[]>(
      key,
      at - BURST_WINDOW_MS,
      at + BURST_WINDOW_MS,
      { byScore: true, withScores: true }
    )
    // [member, score, member, score, …]
    const times = seen.filter((_, i) => i % 2 === 1).map(Number)
    return isBurst(times, at)
  } catch (err) {
    console.warn(
      `[newsletter-clicks] burst check failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return false
  }
}

// ─── Counts ──────────────────────────────────────────────────────────────────

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
