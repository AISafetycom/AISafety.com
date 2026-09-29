/*
  Server-side ActiveCampaign I/O for the newsletter approval page
  (/admin/newsletter).

  The weekly pipeline on Bryce's Mac (~/Newsletter/issue.py) turns a Pen draft
  into an ActiveCampaign DRAFT campaign whose message carries a hidden content
  marker: `<!--aisafety-issue:<checksum>-->`. This module is the other half:
  it lists those drafts, re-checks them exactly the way the pipeline's
  `ac.py verify` does, and on approval schedules the send.

  Guardrails mirrored from ac.py (see ~/Newsletter/PLAN.md "Two verified traps"):
  - the campaign must still be a draft, wired to exactly ONE list (per-list
    one-click unsubscribe depends on it), with one message;
  - the message's marker must be present and match a fresh checksum of its
    HTML — a missing marker means someone saved the email in AC's visual
    designer (which silently wipes code-injected HTML); a mismatch means the
    content changed outside the pipeline. Either way: refuse to send.

  Sending: AC's v1 API has no "send now" for an existing draft, so approval
  creates the sending campaign from the verified message (status 1, sdate a
  couple of minutes out, in the account's local time) and deletes the draft
  shell. Reads use the v3 API; the two writes use v1, the only API that can
  schedule a send (unlocked on the paid plan, 30 Aug 2026).

  Reordering (10 Sept 2026): the renderer wraps every card in
  `<!--card:gN:KEY-->…<!--/card-->` and ends the email with one
  `<!--aisafety-cards:BASE64(JSON)-->` manifest (groups + titles + the plain
  text as keyed segments). `reorderDraft()` moves the cards inside a group,
  rebuilds the text from the manifest, re-stamps the marker and writes the
  message back through the v3 API (which returns HTML byte-identical, checked
  10 Sept 2026). Same algorithm as ~/Newsletter/render.py `reorder_cards()`.

  Editing (16 Sept 2026): a funding card's "Consider applying if" line can be
  rewritten from the same panel. `setFitHtml()` swaps the line inside the
  card, updates the manifest's text segment for it, rebuilds the plain text
  in the cards' current order and the draft is written back the same way.
  The manifest also carries Pen's original line per card (`fit`), so the page
  can show what was edited and offer it back. Mirrors render.py `set_fit()`;
  `issue.py build` carries edits over to a rebuild.

  Test copies (29 Sept 2026): `sendTestCopy()` mails a draft to the approver
  alone through ActiveCampaign's own test send, so the issue can be read and
  clicked through in a real inbox before it goes to the list.

  Send safety (29 Sept 2026, before ~2,900 real readers join lists 6/7):
  - one approval at a time per list + issue + wave: an Upstash SET NX lock,
    held 15 minutes and released only when the approval fails before
    `campaign_create`, so two tabs, a reload or two approvers can't both send;
  - the campaigns are read again, uncached, right before the create, and any
    campaign of the same issue on the list counts as "already sent" unless
    it is a draft or was stopped/disabled before reaching anyone;
  - once `campaign_create` has been called, every error says "may have been
    scheduled – don't press again": the create may have landed even when the
    answer didn't;
  - `sendChecks()` refuses emails with missing footer tags, the wrong sender
    for the list, broken click-counter links, oversized HTML or an older issue
    still waiting, and asks the approver to tick edited card text, leftover
    words (TEST, TODO…) and dates already past;
  - only production may send to (or edit drafts on) the real lists 6/7/8,
    and while NEWSLETTER_WARMUP is on a send to more than
    MAX_UNSEGMENTED_SEND people must name a wave;
  - every real-list approval is recorded in Upstash for the send watcher.
*/

import { createHash } from 'node:crypto'
import { Redis } from '@upstash/redis'
import {
  type CampaignClicks,
  LIST_ID_RE,
  readClicks,
} from '@/lib/newsletter-clicks'

const MARKER_RE = /<!--aisafety-issue:([0-9a-f]{16})-->/
/** Minutes between approval and the send. AC rejects sdates in the past and
 *  runs its scheduler about once a minute, so two is the practical minimum. */
const SEND_DELAY_MINUTES = 2
/** Used for the account's local time when AC's own timestamps can't be read
 *  (account set up from Colombia, 2026). */
const FALLBACK_UTC_OFFSET = '-05:00'
/** Replaces %SENDER-INFO-SINGLELINE% in previews; AC fills the real one. */
const SENDER_INFO =
  'AISafety.com, 2810 N Church St PMB 49028, Wilmington, DE 19802-4447, US'

/** Warm-up (from the first real sends, 8 October 2026): while on, a send to
 *  a real list with more than MAX_UNSEGMENTED_SEND active contacts must go
 *  to one wave (an AC segment), never the whole list in one press. */
export const NEWSLETTER_WARMUP = true
export const MAX_UNSEGMENTED_SEND = 50

/** The real newsletter lists: the campaign name each issue carries in front
 *  ("Events · Week 41, 2026") and the one sender allowed on it. */
const REAL_LISTS: Record<string, { prefix: string; from: string }> = {
  '6': { prefix: 'Events', from: 'events@news.aisafety.com' },
  '7': { prefix: 'Training', from: 'training@news.aisafety.com' },
  '8': { prefix: 'Funding', from: 'funding@news.aisafety.com' },
}
/** Bryce's test lists (aliases only): exempt from the name/sender pairing,
 *  and sendable from any copy of the site. No other list can be sent to. */
const TEST_LISTS = new Set(['4', '5'])
/** The authenticated sending domain; From and Reply-To must be on it. */
const SENDING_DOMAIN = '@news.aisafety.com'

export function isRealList(listId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REAL_LISTS, listId)
}

/** Only the production site may send to, or edit drafts on, the real lists:
 *  every worktree's .env.local holds the full ActiveCampaign key, so a
 *  localhost or preview copy must not be a way round the checks here. */
export function canWriteRealListsHere(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

/** Why this copy of the site may not send to `listId`, or null. */
function listRefusal(listId: string): string | null {
  if (isRealList(listId)) {
    return canWriteRealListsHere()
      ? null
      : `list ${listId} is a real newsletter list: only aisafety.com itself can send to it or change its drafts, not a local or preview copy`
  }
  return TEST_LISTS.has(listId)
    ? null
    : `list ${listId} isn’t a newsletter list (Events 6, Training 7, Funding 8, or test lists 4/5)`
}

/** One approval per list + issue + wave at a time; long enough to cover the
 *  slowest approval and to make a second press soon after a sent one fail. */
const APPROVE_LOCK_SECONDS = 15 * 60
/** Writes give up after this and are never retried (the write may have
 *  landed); reads give up after READ_TIMEOUT_MS per attempt. */
const WRITE_TIMEOUT_MS = 25_000
const READ_TIMEOUT_MS = 20_000
/** Gmail clips an email at about 102 KB; stay well under it. */
const MAX_HTML_BYTES = 90 * 1024
/** How many campaigns one read covers (AC's page maximum). */
const CAMPAIGN_READ_WINDOW = 100
/** Where the pipeline saves each email's click-counter link list. The same
 *  value as LINKS_BASE in src/lib/newsletter-clicks.ts, which doesn't export
 *  it (that file belongs to the click counter); keep the two identical. */
const LINKS_BASE =
  'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/newsletter/links/'

export function isNewsletterConfigured(): boolean {
  return Boolean(
    process.env.ACTIVECAMPAIGN_URL && process.env.ACTIVECAMPAIGN_KEY
  )
}

function base(): string {
  return (process.env.ACTIVECAMPAIGN_URL ?? '').replace(/\/+$/, '')
}

function apiKey(): string {
  return process.env.ACTIVECAMPAIGN_KEY ?? ''
}

/** The account's v3 API root; every v3 call is resolved under it. */
function v3root(): string {
  return `${base()}/api/3/`
}

/** Resolve `path` under the v3 API root and refuse anything that escapes it,
 *  so an id that arrived in a request can never point a call at another path
 *  or host (the same guard as `airtableRequest`). */
function v3url(path: string): URL {
  const root = v3root()
  const url = new URL(path, root)
  if (url.origin !== new URL(root).origin || !url.href.startsWith(root)) {
    throw new Error('ActiveCampaign request path escapes the API')
  }
  return url
}

/** ActiveCampaign ids are plain numbers. Ids reach these helpers from request
 *  bodies and query strings (the routes check them too); anything else is
 *  refused before it can become part of a URL. */
function acId(id: string): string {
  if (!/^\d{1,12}$/.test(id))
    throw new Error(`not an ActiveCampaign id: ${id.slice(0, 20)}`)
  return id
}

/** Gateway errors ActiveCampaign's edge returns for a few seconds at a time
 *  (a 502 page from Cloudflare, 25 Sept 2026), and its rate limit (429, five
 *  requests a second). Reads retry them; writes never retry, because a write
 *  may have landed before the error came back. */
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504])
const READ_RETRY_DELAYS_MS = [1000, 3000]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function v3<T = any>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(v3url(path), {
      headers: { 'Api-Token': apiKey() },
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (res.ok) return res.json() as Promise<T>
    const delay = READ_RETRY_DELAYS_MS[attempt]
    if (TRANSIENT_STATUSES.has(res.status) && delay !== undefined) {
      console.warn(
        `[newsletter] ActiveCampaign ${path.split('?')[0]}: ${res.status}, retrying in ${delay} ms`
      )
      await new Promise(r => setTimeout(r, delay))
      continue
    }
    // AC's gateway errors are whole HTML pages; keep the log line readable.
    const text = TRANSIENT_STATUSES.has(res.status)
      ? 'gateway error from ActiveCampaign'
      : (await res.text()).slice(0, 500)
    throw new Error(
      `ActiveCampaign ${path.split('?')[0]}: ${res.status} ${text}`
    )
  }
}

/** PUT, returning what ActiveCampaign answers — for a message, the message
 *  as stored, so a write needs no separate read to check it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function v3put<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(v3url(path), {
    method: 'PUT',
    headers: { 'Api-Token': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(
      `ActiveCampaign PUT ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 500)}`
    )
  }
  return (await res.json().catch(() => ({}))) as T
}

/** DELETE through the v3 API (never retried, like every write). AC answers
 *  `{ succeeded: 1 }` or `{ succeeded: 0, message }` with a 200 either way. */
async function v3delete(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(v3url(path), {
    method: 'DELETE',
    headers: { 'Api-Token': apiKey() },
    cache: 'no-store',
    signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(
      `ActiveCampaign DELETE ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`
    )
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>
}

/* ─── Fewer, parallel reads ───────────────────────────────────────────────
   ActiveCampaign can take 10+ seconds per request (25 Sept 2026), so the page
   asks as little as it can, side by side: the drafts and the recent sends
   (read at the same time) share one campaigns read and one lists read, a sent
   campaign's lists are remembered (they never change), and per-draft reads
   run a few at a time — never more, AC allows five requests a second. */

const shared = new Map<string, { at: number; value: Promise<unknown> }>()

function sharedRead<T>(
  key: string,
  ttlMs: number,
  read: () => Promise<T>
): Promise<T> {
  const hit = shared.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
  const value = read()
  shared.set(key, { at: Date.now(), value })
  value.catch(() => shared.delete(key))
  return value
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  )
  return out
}

const sentListIds = new Map<string, string[]>()

/** A v1 call and ActiveCampaign's answer as it came, refusals included
 *  (`result_code` 0, reason in `result_message`). Every v1 call here is a
 *  write: one attempt, WRITE_TIMEOUT_MS, never retried. */
async function v1answer(
  action: string,
  fields: Record<string, string | number>
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({
    api_action: action,
    api_output: 'json',
    api_key: apiKey(),
  })
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) body.set(k, String(v))
  const res = await fetch(`${base()}/admin/api.php?${qs}`, {
    method: 'POST',
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
  })
  if (!res.ok) {
    // AC's gateway errors are whole HTML pages; the status says enough.
    throw new Error(`ActiveCampaign ${action}: HTTP ${res.status}`)
  }
  return (await res.json()) as Record<string, unknown>
}

async function v1(
  action: string,
  fields: Record<string, string | number>
): Promise<Record<string, unknown>> {
  const out = await v1answer(action, fields)
  if (Number(out.result_code) !== 1) {
    throw new Error(
      `ActiveCampaign ${action} failed: ${String(out.result_message)}`
    )
  }
  return out
}

/** Checksum of the message content, ignoring the marker itself. Identical to
 *  ac.py `content_digest()`: AC decodes `&amp;` one level and appends a
 *  trailing newline when it stores HTML, so both are canonicalised away —
 *  anything else still changes the digest. */
export function contentDigest(html: string): string {
  let s = html.replace(MARKER_RE, '')
  while (s.includes('&amp;')) s = s.replace(/&amp;/g, '&')
  s = s.replace(/\s+$/, '')
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)
}

interface RawCampaign {
  id: string
  name: string
  status: string
  cdate: string | null
  sdate: string | null
  ldate: string | null
  send_amt: string | null
  uniqueopens?: string | null
  unsubscribes?: string | null
  /** 'none' when ActiveCampaign's click tracker is off (always, for ours). */
  tracklinks?: string | null
  /** '0' when AC adds no utm tags of its own. */
  tracklinksanalytics?: string | null
  segmentid?: string | null
}

interface RawMessage {
  id: string
  subject: string
  fromemail: string
  fromname: string
  reply2?: string | null
  html: string | null
  text?: string | null
}

export interface DraftSummary {
  id: string
  name: string
  subject: string
  fromEmail: string
  fromName: string
  createdAt: string | null
  messageId: string | null
  listId: string | null
  listName: string | null
  /** Active contacts on the list right now (who would receive the send). */
  activeContacts: number | null
  /** Empty when the draft passes the pipeline's checks (still a draft, one
   *  list, content untouched): it can then be previewed, tested and edited. */
  problems: string[]
  /** Reasons it may not be sent even so (sendChecks, the list, the
   *  warm-up); empty when Approve may be pressed. */
  blocks: string[]
  /** What the approver must tick in the confirm dialog before it sends. */
  warnings: SendWarning[]
  /** This issue already went (or is going) to this list as another
   *  campaign: Approve stays off. */
  alreadySent: { campaignId: string; status: string } | null
  /** Card edits may be saved into this draft from this copy of the site. */
  editable: boolean
  /** The inbox preview line (the email's hidden preheader), as Gmail shows it
   *  after the subject. Null when the email has none. */
  preview: string | null
  /** The email's cards by section, in their current order — what the
   *  Reorder panel edits. Null for emails built before card markers existed. */
  cards: CardGroup[] | null
}

export interface SentSummary {
  id: string
  name: string
  /** 'held' = ActiveCampaign's "Pending Approval" (its compliance team
   *  reviews some sends, e.g. a new account's first big one); it goes out
   *  once they approve it. */
  status:
    | 'scheduled'
    | 'sending'
    | 'sent'
    | 'stopped'
    | 'paused'
    | 'held'
    | 'disabled'
  scheduledFor: string | null
  sentAt: string | null
  sentTo: number
  uniqueOpens: number | null
  unsubscribes: number | null
  listNames: string[]
  /** Clicks counted on aisafety.com (the email's links go through
   *  /api/nl since 28 Sept 2026); zero for older sends, whose links went
   *  through ActiveCampaign's tracker. */
  clicks: CampaignClicks
}

// ActiveCampaign's campaign statuses (0 = draft is handled separately). 6 and
// 7 are "Disabled" and "Pending Approval" in AC's API reference.
const STATUS_NAMES: Record<string, SentSummary['status']> = {
  '1': 'scheduled',
  '2': 'sending',
  '3': 'paused',
  '4': 'stopped',
  '5': 'sent',
  '6': 'disabled',
  '7': 'held',
}

/** Pure: has this campaign gone, is it going, or could it still go out to
 *  anyone? Everything but a draft counts — scheduled, sending, paused, sent,
 *  held for review, and any status code this file doesn't know — except a
 *  stopped or disabled campaign that provably reached nobody (send_amt 0).
 *  A stop after 1,200 people got it still counts: approving the issue again
 *  would send it to them twice. */
export function isLiveCampaign(c: {
  status: string
  send_amt?: string | null
}): boolean {
  if (c.status === '0') return false
  if (c.status === '4' || c.status === '6') {
    const sent = String(c.send_amt ?? '').trim()
    return !(sent !== '' && Number(sent) === 0)
  }
  return true
}

/* ─── Waves (warm-up) ─────────────────────────────────────────────────────
   A wave's campaign is named `${issue} · wave ${k}/${N}` ("Events · Week 41,
   2026 · wave 2/4"); the issue's base name is that name without the suffix.
   Clicks, Recent sends and Analytics group by the base name. */

const WAVE_SUFFIX_RE = / · wave (\d+)\/(\d+)$/

/** Pure: the issue's name without any wave suffix. */
export function baseIssueName(name: string): string {
  return name.replace(WAVE_SUFFIX_RE, '')
}

/** Pure: the campaign name for wave `wave` of `waves`. */
export function waveCampaignName(
  issueName: string,
  wave: number,
  waves: number
): string {
  return `${baseIssueName(issueName)} · wave ${wave}/${waves}`
}

/** Pure: which wave a campaign name carries, or null for a whole-list send. */
export function waveOf(name: string): { wave: number; waves: number } | null {
  const m = WAVE_SUFFIX_RE.exec(name)
  return m ? { wave: Number(m[1]), waves: Number(m[2]) } : null
}

/** Other live campaigns of this issue (same base name) — candidates for
 *  "this issue already went out" (the caller checks they were on the same
 *  list; a test-list send of the same issue doesn't count). With `wave`,
 *  only the ones that reached that wave's readers: a whole-list send or the
 *  same wave; without, any of them. */
export function liveCampaignsNamed<
  C extends {
    id: string
    name: string
    status: string
    send_amt?: string | null
  },
>(
  campaigns: C[],
  draftId: string,
  name: string,
  wave: number | null = null
): C[] {
  const issue = baseIssueName(name)
  return campaigns.filter(c => {
    if (c.id === draftId || !isLiveCampaign(c)) return false
    if (baseIssueName(c.name) !== issue) return false
    if (wave == null) return true
    const theirs = waveOf(c.name)
    return theirs == null || theirs.wave === wave
  })
}

/** The live campaigns of this issue that went to `listId`, newest first. */
async function sentOnList(
  campaigns: RawCampaign[],
  draftId: string,
  name: string,
  listId: string,
  wave: number | null
): Promise<RawCampaign[]> {
  const candidates = liveCampaignsNamed(campaigns, draftId, name, wave)
  const lists = await mapLimit(candidates, 3, c => knownListIds(c))
  return candidates
    .filter((_, i) => lists[i].includes(listId))
    .sort((a, b) => Number(b.id) - Number(a.id))
}

/** A campaign's lists; a sent campaign's are remembered (they never change). */
async function knownListIds(c: RawCampaign): Promise<string[]> {
  const known = sentListIds.get(c.id)
  if (known) return known
  const ids = await campaignListIds(c.id)
  if (c.status === '5') sentListIds.set(c.id, ids)
  return ids
}

function statusLabel(status: string): string {
  return status === '7'
    ? 'held for review'
    : (STATUS_NAMES[status] ?? `status ${status}`)
}

async function campaignListIds(campaignId: string): Promise<string[]> {
  const data = await v3<{ campaignLists: Array<{ list: string }> }>(
    `campaigns/${acId(campaignId)}/campaignLists`
  )
  return (data.campaignLists ?? []).map(l => String(l.list))
}

async function campaignMessageIds(campaignId: string): Promise<string[]> {
  const data = await v3<{ campaignMessages: Array<{ messageid: string }> }>(
    `campaigns/${acId(campaignId)}/campaignMessages`
  )
  return (data.campaignMessages ?? []).map(m => String(m.messageid))
}

async function message(messageId: string): Promise<RawMessage> {
  const data = await v3<{ message: RawMessage }>(`messages/${acId(messageId)}`)
  return data.message
}

async function listNames(): Promise<Map<string, string>> {
  return sharedRead('lists', 5 * 60_000, async () => {
    const data = await v3<{ lists: Array<{ id: string; name: string }> }>(
      'lists?limit=100'
    )
    return new Map((data.lists ?? []).map(l => [String(l.id), l.name]))
  })
}

/** Active contacts on a list — the number an approved send goes to. */
async function activeContactCount(listId: string): Promise<number | null> {
  try {
    const data = await v3<{ meta?: { total?: string | number } }>(
      `contacts?listid=${encodeURIComponent(listId)}&status=1&limit=1`
    )
    const total = data.meta?.total
    return total == null ? null : Number(total)
  } catch {
    return null
  }
}

/** The newest CAMPAIGN_READ_WINDOW campaigns, newest first. AC ignores
 *  `orders[cdate]` (it returned the OLDEST first, 29 Sept 2026) but honours
 *  `orders[id]`, and ids only grow. `fresh` skips the few seconds' sharing
 *  between reads: the approval path reads right before it creates. */
async function allCampaigns({ fresh = false } = {}): Promise<RawCampaign[]> {
  const read = async () => {
    const data = await v3<{
      campaigns: RawCampaign[]
      meta?: { total?: string | number }
    }>(`campaigns?limit=${CAMPAIGN_READ_WINDOW}&orders[id]=DESC`)
    const total = Number(data.meta?.total ?? 0)
    if (total > CAMPAIGN_READ_WINDOW) {
      console.warn(
        `[newsletter] ActiveCampaign has ${total} campaigns; only the newest ${CAMPAIGN_READ_WINDOW} are read`
      )
    }
    return data.campaigns ?? []
  }
  return fresh ? read() : sharedRead('campaigns', 5_000, read)
}

/** The checks `ac.py verify` runs, as a list of problems (empty = OK), on
 *  what has already been read. */
function draftProblems(
  campaign: RawCampaign,
  listIds: string[],
  messageIds: string[],
  msg: RawMessage | null,
  expectedListId: string | null
): string[] {
  const problems: string[] = []
  if (campaign.status !== '0') {
    problems.push(
      `campaign status is ${STATUS_NAMES[campaign.status] ?? campaign.status}, expected draft`
    )
  }
  if (listIds.length !== 1) {
    problems.push(
      `campaign is wired to ${listIds.length} lists, expected exactly one`
    )
  } else if (expectedListId != null && listIds[0] !== expectedListId) {
    problems.push(
      `campaign is wired to list ${listIds[0]}, expected ${expectedListId}`
    )
  }
  if (messageIds.length !== 1) {
    problems.push(
      `campaign has ${messageIds.length} messages, expected exactly one`
    )
  } else if (msg) {
    const html = msg.html ?? ''
    const m = MARKER_RE.exec(html)
    if (!m) {
      problems.push(
        'content marker missing — the email was probably saved in the ActiveCampaign designer, which wipes pipeline content; rebuild the issue'
      )
    } else if (m[1] !== contentDigest(html)) {
      problems.push(
        'checksum mismatch — the content was changed outside the pipeline; rebuild the issue'
      )
    }
  }
  return problems
}

/** Read a draft and run the checks. The campaign, its lists and its messages
 *  are read side by side; `knownMessageId` (the page sends the one it
 *  listed) lets the message be read alongside them too, confirmed against
 *  the campaign's own message list afterwards. */
async function readDraft(
  draftId: string,
  expectedListId: string | null,
  knownMessageId?: string
): Promise<{
  campaign: RawCampaign
  problems: string[]
  listIds: string[]
  messageId: string | null
  msg: RawMessage | null
}> {
  // A draft the page still lists can be gone by the time a button is pressed
  // (approved in another tab, or replaced by a rebuild): every one of these
  // reads then answers 404, and that is "not found", not a failure.
  const gone = (err: Error) => {
    if (/: 404 /.test(err.message)) return null
    throw err
  }
  const [campaign, listIds, messageIds, early] = await Promise.all([
    v3<{ campaign?: RawCampaign }>(`campaigns/${acId(draftId)}`)
      .then(d => d.campaign ?? null)
      .catch(gone),
    campaignListIds(draftId).catch(gone),
    campaignMessageIds(draftId).catch(gone),
    knownMessageId
      ? message(knownMessageId).catch(() => null)
      : Promise.resolve(null),
  ])
  if (!campaign || !listIds || !messageIds)
    throw new DraftProblemError(['draft campaign not found'])
  const messageId = messageIds.length === 1 ? messageIds[0] : null
  const msg =
    messageId == null
      ? null
      : early && messageId === knownMessageId
        ? early
        : await message(messageId)
  return {
    campaign,
    problems: draftProblems(campaign, listIds, messageIds, msg, expectedListId),
    listIds,
    messageId,
    msg,
  }
}

/* ─── Pre-send checks ─────────────────────────────────────────────────────
   Run on every listed draft (the page shows them) and again inside the
   approval, which refuses on any block and on any warning the approver
   didn't tick in the confirm dialog. The pipeline's `ac.verify()` checks the
   same email from the other side. */

/** Something the approver must look at and tick before the send. */
export interface SendWarning {
  /** Stable while the finding is the same; changes when the text changes,
   *  so a tick given to older text doesn't count for newer text. */
  id: string
  kind: 'edited' | 'words' | 'date'
  text: string
  /** Edited card text: as Pen wrote it, and now. */
  from?: string
  to?: string
}

export interface SendChecks {
  /** Refusals, one line each. */
  blocks: string[]
  warnings: SendWarning[]
}

/** AC's merge tags the pipeline writes on purpose; any other %TAG% is a
 *  leftover. */
const KNOWN_TAGS = new Set([
  'UNSUBSCRIBELINK',
  'WEBCOPY',
  'SENDER-INFO-SINGLELINE',
])
/** Words a finished issue never contains (the 28 Sept 2026 Training
 *  rehearsal went out with "TEST" and "test" typed into two cards).
 *  Standalone only: "test-time compute" and "Testing" pass. */
const LEFTOVER_RE =
  /(?<![\w-])(?:TEST|test|TODO|TBD|FIXME|lorem|Lorem|LOREM|xxx|XXX)(?![\w-])|\{\{|\}\}/g
const TAG_RE = /%([A-Z][A-Z0-9_-]*)%/g
/** Card lines that carry an event's dates or an application deadline. */
const DATE_FIELD_LABELS = new Set([
  'Dates',
  'Applications',
  'Accepting applications',
])
/** Older drafts (no field markers): the plain-text lines with a deadline. */
const DEADLINE_LINE_RE = /^\s+(?:Deadline:|Apply by|Closes\b|Applications? )/i

function shortHash(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 10)
}

/** What a reader sees of the HTML: no comments, head or styles, tags as
 *  spaces (so text in neighbouring cells can't run together), entities
 *  resolved. */
function visibleText(html: string): string {
  return stripHtml(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<head[\s\S]*?<\/head>/i, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
}

const MONTH_NAMES =
  'January|February|March|April|May|June|July|August|September|October|November|December|Sept|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec'
const DAY_MONTH_RE = new RegExp(
  `\\b(\\d{1,2})\\s+(${MONTH_NAMES})\\b\\.?(?:,?\\s+(\\d{4}))?`,
  'gi'
)
const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

/** Pure: today's date where the day starts last (UTC−12), as UTC midnight.
 *  A date or deadline is only "past" once it is past everywhere. */
export function todayAnywhere(now: Date): Date {
  const t = new Date(now.getTime() - 12 * 3_600_000)
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
}

/** Pure: the latest date a card line names, as UTC midnight ("Apply by 5
 *  October for priority, 25 October at the latest" → 25 October; "20–21
 *  November" → 21 November). A date without a year takes the year that puts
 *  it nearest `today`. Null when the line names no date. */
export function latestDateIn(line: string, today: Date): Date | null {
  let latest: Date | null = null
  for (const m of line.matchAll(DAY_MONTH_RE)) {
    const day = Number(m[1])
    const month = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()]
    const years = m[3]
      ? [Number(m[3])]
      : [-1, 0, 1].map(d => today.getUTCFullYear() + d)
    let best: Date | null = null
    for (const y of years) {
      const d = new Date(Date.UTC(y, month, day))
      if (d.getUTCDate() !== day) continue // 31 September and the like
      if (
        !best ||
        Math.abs(d.getTime() - today.getTime()) <
          Math.abs(best.getTime() - today.getTime())
      )
        best = d
    }
    if (best && (!latest || best > latest)) latest = best
  }
  return latest
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Pure: every check that needs nothing but the email itself. */
export function contentChecks(input: {
  name: string
  listId: string
  subject: string
  html: string
  text: string
  fromEmail: string
  replyTo: string | null
  now: Date
}): SendChecks {
  const { name, listId, html, text } = input
  const blocks: string[] = []
  const warnings: SendWarning[] = []

  // The footer: one-click unsubscribe and the postal address (CAN-SPAM).
  for (const [tag, what] of [
    ['%UNSUBSCRIBELINK%', 'unsubscribe link'],
    ['%SENDER-INFO-SINGLELINE%', 'postal address'],
  ]) {
    if (!html.includes(tag))
      blocks.push(`the HTML has no ${what} (${tag}) – rebuild the issue`)
    if (!text.includes(tag))
      blocks.push(
        `the plain-text version has no ${what} (${tag}) – rebuild the issue`
      )
  }

  // The sender: our authenticated domain, and the address that belongs to
  // the list (a Training issue from events@ on the Events list is a mix-up).
  const from = input.fromEmail.trim().toLowerCase()
  const replyTo = (input.replyTo ?? '').trim().toLowerCase()
  if (!from.endsWith(SENDING_DOMAIN))
    blocks.push(
      `it comes from ${from || 'no address'}, not an address on news.aisafety.com`
    )
  if (replyTo && !replyTo.endsWith(SENDING_DOMAIN))
    blocks.push(`replies go to ${replyTo}, not an address on news.aisafety.com`)
  const real = REAL_LISTS[listId]
  if (real) {
    if (!name.startsWith(`${real.prefix} · `))
      blocks.push(
        `“${name}” isn’t a ${real.prefix} issue, but list ${listId} is the ${real.prefix} list`
      )
    if (from !== real.from)
      blocks.push(
        `list ${listId} sends from ${real.from}, but this draft comes from ${from}`
      )
  } else if (!TEST_LISTS.has(listId)) {
    blocks.push(`list ${listId} isn’t a newsletter list`)
  }

  const bytes = Buffer.byteLength(html.replace(MARKER_RE, ''), 'utf8')
  if (bytes > MAX_HTML_BYTES)
    blocks.push(
      `the email is ${Math.round(bytes / 1024)} KB, over the ${MAX_HTML_BYTES / 1024} KB limit (Gmail cuts emails off at about 102 KB) – shorten the issue`
    )

  // Card text changed on this page since Pen wrote it.
  const groups = cardGroups(html) ?? []
  for (const g of groups) {
    for (const c of g.cards) {
      for (const f of c.fields) {
        if (f.original == null) continue
        warnings.push({
          id: `edited:${g.id}:${c.key}:${f.name}:${shortHash(f.value)}`,
          kind: 'edited',
          text: `“${c.title}” – ${f.label}`,
          from: f.original,
          to: f.value,
        })
      }
      if (c.fit != null && c.pipelineFit != null && c.fit !== c.pipelineFit)
        warnings.push({
          id: `edited:${g.id}:${c.key}:fit:${shortHash(c.fit)}`,
          kind: 'edited',
          text: `“${c.title}” – Consider applying if`,
          from: c.pipelineFit,
          to: c.fit || '(removed)',
        })
    }
  }

  // Leftovers: TEST, TODO, {{…}}, merge tags we never use. Every place in
  // the subject and the email; the plain-text version (rebuilt from the same
  // cards) only for what the email didn't already show.
  const seen = new Set<string>()
  const found = new Set<string>()
  const scan = (where: string, s: string, repeats: boolean) => {
    const plain = s.replace(/https?:\/\/\S+/g, ' ')
    for (const m of plain.matchAll(LEFTOVER_RE)) {
      if (!repeats && found.has(m[0])) continue
      const at = m.index ?? 0
      const around = plain
        .slice(Math.max(0, at - 40), at + m[0].length + 40)
        .replace(/\s+/g, ' ')
        .trim()
      const key = `${where}|${m[0]}|${around}`
      if (seen.has(key)) continue
      seen.add(key)
      found.add(m[0])
      warnings.push({
        id: `words:${shortHash(key)}`,
        kind: 'words',
        text: `“${m[0]}” in the ${where}: “${around}”`,
      })
    }
    for (const m of plain.matchAll(TAG_RE)) {
      if (KNOWN_TAGS.has(m[1]) || found.has(m[0])) continue
      found.add(m[0])
      warnings.push({
        id: `words:${shortHash(m[0])}`,
        kind: 'words',
        text: `${m[0]} in the ${where} (a merge tag the pipeline never writes)`,
      })
    }
  }
  scan('subject', input.subject, true)
  scan('email', visibleText(html), true)
  scan('plain-text version', text, false)

  // Dates and deadlines already past (a late wave carries last week's
  // deadlines), read from the card lines, or from the plain text on drafts
  // built before the lines were marked (25 Sept 2026).
  const today = todayAnywhere(input.now)
  const past = (line: string) => {
    const d = latestDateIn(line, today)
    return d && d < today ? d : null
  }
  const segments = new Map(
    (readManifest(html)?.text ?? [])
      .filter(s => s.c)
      .map(s => [s.c as string, s.t])
  )
  for (const g of groups) {
    for (const c of g.cards) {
      const lines = c.fields.length
        ? c.fields
            .filter(f => DATE_FIELD_LABELS.has(f.label))
            .map(f => ({ name: f.name, label: f.label, value: f.value }))
        : (segments.get(`${g.id}:${c.key}`) ?? '')
            .split('\n')
            .filter(l => DEADLINE_LINE_RE.test(l))
            .map((l, i) => ({
              name: `t${i}`,
              label: 'Deadline',
              value: l.trim(),
            }))
      for (const l of lines) {
        const d = past(l.value)
        if (!d) continue
        warnings.push({
          id: `date:${g.id}:${c.key}:${l.name}:${shortHash(l.value)}`,
          kind: 'date',
          text: `“${c.title}” – ${l.label}: “${l.value}” (${formatDay(d)} has passed)`,
        })
      }
    }
  }
  return { blocks, warnings }
}

/** Pure: the click-counter links in an email, by link list:
 *  https://aisafety.com/api/nl/<list>/<n>. Anything under /api/nl/ that
 *  isn't that shape comes back under `bad` (a truncated or mangled link). */
export function nlLinkRefs(
  html: string,
  text: string
): { lists: Map<string, number[]>; bad: string[] } {
  const lists = new Map<string, number[]>()
  const bad = new Set<string>()
  const re = /https:\/\/(?:www\.)?aisafety\.com\/api\/nl\/[^\s"'<>]*/g
  for (const m of `${html}\n${text}`.matchAll(re)) {
    const link = m[0].replace(/&amp;/g, '&')
    const parts =
      /^https:\/\/(?:www\.)?aisafety\.com\/api\/nl\/([^/?#]+)\/(\d+)(?:[?#].*)?$/.exec(
        link
      )
    if (!parts || !LIST_ID_RE.test(parts[1])) {
      bad.add(link)
      continue
    }
    const ns = lists.get(parts[1]) ?? []
    if (!ns.includes(Number(parts[2]))) ns.push(Number(parts[2]))
    lists.set(parts[1], ns)
  }
  return { lists, bad: [...bad] }
}

/** Pure: what's wrong with one link list, for the links that use it.
 *  `data` is the parsed JSON, or 'missing' / 'unreadable' / 'malformed'. */
export function linkListProblems(
  listId: string,
  used: number[],
  data: unknown
): string[] {
  if (data === 'missing')
    return [
      `link list ${listId} isn’t on the Blob store, so every counted link would land on the homepage – rebuild the issue`,
    ]
  if (data === 'unreadable')
    return [
      `link list ${listId} couldn’t be read just now – try again in a minute`,
    ]
  const d = data as { v?: unknown; links?: unknown } | null
  if (data === 'malformed' || !d || d.v !== 1 || !Array.isArray(d.links))
    return [`link list ${listId} is malformed – rebuild the issue`]
  const links = d.links as Array<{ u?: unknown } | null>
  const out: string[] = []
  for (const n of [...used].sort((a, b) => a - b)) {
    const entry = links[n]
    if (n >= links.length || !entry) {
      out.push(
        `link ${n} of list ${listId} doesn’t exist (the list has ${links.length}) – rebuild the issue`
      )
      continue
    }
    let ok = false
    try {
      const url = new URL(String(entry.u ?? ''))
      ok = url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
      ok = false
    }
    if (!ok)
      out.push(
        `link ${n} of list ${listId} isn’t a web address (${String(entry.u ?? '').slice(0, 80)}) – fix it and rebuild`
      )
  }
  return out
}

/** Link lists never change once written: a good read is kept. */
const goodLinkLists = new Map<string, unknown>()

async function readLinkListRaw(listId: string): Promise<unknown> {
  const hit = goodLinkLists.get(listId)
  if (hit) return hit
  const url = new URL(`${listId}.json`, LINKS_BASE)
  if (!url.href.startsWith(LINKS_BASE)) return 'malformed'
  let res: Response
  try {
    res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    return 'unreadable'
  }
  if (res.status === 404 || res.status === 403) return 'missing'
  if (!res.ok) return 'unreadable'
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return 'malformed'
  }
  goodLinkLists.set(listId, data)
  return data
}

/** Every click-counter link in the email resolves to a real destination. */
async function linkListBlocks(html: string, text: string): Promise<string[]> {
  const { lists, bad } = nlLinkRefs(html, text)
  const out = bad.map(
    b =>
      `a click-counter link is malformed (${b.slice(0, 80)}) – rebuild the issue`
  )
  const ids = [...lists.keys()]
  const data = await Promise.all(ids.map(readLinkListRaw))
  ids.forEach((id, i) =>
    out.push(...linkListProblems(id, lists.get(id) ?? [], data[i]))
  )
  return out
}

/** Pure: an issue's place in its newsletter's run (year, then week or issue
 *  number), from "Events · Week 41, 2026" / "Funding · Issue #21, 2026".
 *  Null for names the pipeline didn't write. */
export function issueOrder(name: string): number | null {
  const m = /(?:Week|Issue #)\s*(\d+),\s*(\d{4})/.exec(baseIssueName(name))
  return m ? Number(m[2]) * 1000 + Number(m[1]) : null
}

/** Pure: a block for each draft of an OLDER issue still waiting on the same
 *  list (`others` are the other drafts on it). Clear the old one first, so
 *  last week's issue can't go out later by habit. */
export function olderIssueBlocks(
  name: string,
  others: Array<{ id: string; name: string }>
): string[] {
  const mine = issueOrder(name)
  if (mine == null) return []
  return others
    .filter(o => {
      const theirs = issueOrder(o.name)
      return (
        theirs != null &&
        theirs < mine &&
        baseIssueName(o.name).split(' · ')[0] ===
          baseIssueName(name).split(' · ')[0]
      )
    })
    .map(
      o =>
        `an older issue, “${o.name}” (campaign ${o.id}), is still waiting on this list – have it deleted first (ac.py delete-draft ${o.id}), so it can’t be sent later by mistake`
    )
}

/** Pipeline drafts waiting for approval: draft campaigns whose message carries
 *  the content marker. Hand-made drafts in AC never show here. */
export async function listDrafts(): Promise<DraftSummary[]> {
  const [campaigns, names] = await Promise.all([allCampaigns(), listNames()])
  const drafts = campaigns.filter(c => c.status === '0')
  const found = await mapLimit(drafts, 3, async c => {
    const [messageIds, listIds] = await Promise.all([
      campaignMessageIds(c.id),
      campaignListIds(c.id),
    ])
    if (messageIds.length === 0) return null
    const msg = await message(messageIds[0])
    if (!MARKER_RE.test(msg.html ?? '')) return null
    return { c, messageIds, listIds, msg }
  })
  const pipeline = found.filter(f => f !== null)
  const now = new Date()
  return mapLimit(pipeline, 3, async ({ c, messageIds, listIds, msg }) => {
    const listId = listIds.length === 1 ? listIds[0] : null
    const problems = draftProblems(c, listIds, messageIds, msg, null)
    const sameList = pipeline
      .filter(
        o =>
          o.c.id !== c.id && o.listIds.length === 1 && o.listIds[0] === listId
      )
      .map(o => ({ id: o.c.id, name: o.c.name }))
    const [activeContacts, checks, sent] = listId
      ? await Promise.all([
          activeContactCount(listId),
          sendChecks({ name: c.name, listId }, msg, sameList, now),
          sentOnList(campaigns, c.id, c.name, listId, null),
        ])
      : [null, { blocks: [], warnings: [] }, []]
    const refusal = listId ? listRefusal(listId) : null
    const warmup = listId ? warmupRefusal(listId, activeContacts, null) : null
    const row: DraftSummary = {
      id: c.id,
      name: c.name,
      subject: msg.subject,
      fromEmail: msg.fromemail,
      fromName: msg.fromname,
      createdAt: c.cdate,
      messageId: msg.id,
      listId,
      listName: listId ? (names.get(listId) ?? null) : null,
      activeContacts,
      problems,
      blocks: [
        ...(refusal ? [refusal] : []),
        ...checks.blocks,
        ...(warmup ? [warmup] : []),
      ],
      warnings: checks.warnings,
      alreadySent: sent[0]
        ? { campaignId: sent[0].id, status: statusLabel(sent[0].status) }
        : null,
      editable:
        problems.length === 0 &&
        listId != null &&
        (!isRealList(listId) || canWriteRealListsHere()),
      preview: previewText(msg.html ?? ''),
      cards: cardGroups(msg.html ?? ''),
    }
    return row
  })
}

/** Every pre-send check for one draft: the email's own (contentChecks), its
 *  click-counter links, and older issues still waiting on the same list
 *  (`sameListDrafts` = the other drafts on its list). */
async function sendChecks(
  draft: { name: string; listId: string },
  msg: RawMessage,
  sameListDrafts: Array<{ id: string; name: string }>,
  now: Date
): Promise<SendChecks> {
  const html = msg.html ?? ''
  const text = msg.text ?? ''
  const own = contentChecks({
    name: draft.name,
    listId: draft.listId,
    subject: msg.subject ?? '',
    html,
    text,
    fromEmail: msg.fromemail ?? '',
    replyTo: msg.reply2 ?? null,
    now,
  })
  return {
    blocks: [
      ...own.blocks,
      ...(await linkListBlocks(html, text)),
      ...olderIssueBlocks(draft.name, sameListDrafts),
    ],
    warnings: own.warnings,
  }
}

/** Why a send to this many people must name a wave, or null. */
function warmupRefusal(
  listId: string,
  active: number | null,
  wave: number | null
): string | null {
  if (!NEWSLETTER_WARMUP || !isRealList(listId) || wave != null) return null
  if (active == null)
    return `couldn’t read how many people are on list ${listId} – try again in a minute`
  return active > MAX_UNSEGMENTED_SEND
    ? `the warm-up is on: list ${listId} has ${active} active contacts, more than ${MAX_UNSEGMENTED_SEND}, so this issue must go out in waves – choose a wave to send`
    : null
}

const PREHEADER_RE = /<div style="display:none[^"]*"[^>]*>([\s\S]*?)<\/div>/

/** The preheader the renderer hides at the top of the email: the text mail
 *  apps show after the subject in the inbox. Tags stripped, the invisible
 *  padding (nbsp + zero-width non-joiner, as entities or characters) and
 *  common entities resolved. */
export function previewText(html: string): string | null {
  const m = PREHEADER_RE.exec(html)
  if (!m) return null
  const text = stripHtml(m[1])
  return text || null
}

/** An HTML fragment as one line of plain text: tags dropped, the entities
 *  the renderer writes resolved, whitespace collapsed. */
function stripHtml(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&zwnj;|&#8204;|\u00a0|\u200c/g, ' ')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&middot;/g, '\u00b7')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The most recent sends (and anything scheduled or stuck), newest first. */
export async function listRecent(limit = 12): Promise<SentSummary[]> {
  const [campaigns, names] = await Promise.all([allCampaigns(), listNames()])
  const recent = campaigns
    .filter(c => c.status in STATUS_NAMES)
    .sort((a, b) =>
      String(b.ldate ?? b.sdate ?? '').localeCompare(
        String(a.ldate ?? a.sdate ?? '')
      )
    )
    .slice(0, limit)
  // Clicks are counted per issue: every wave of one shares its base name.
  const [lists, clicks] = await Promise.all([
    mapLimit(recent, 3, knownListIds),
    readClicks([...new Set(recent.map(c => baseIssueName(c.name)))]),
  ])
  return recent.map((c, i) => {
    const listIds = lists[i]
    return {
      id: c.id,
      name: c.name,
      status: STATUS_NAMES[c.status],
      scheduledFor: c.sdate,
      sentAt: c.ldate,
      sentTo: Number(c.send_amt ?? 0),
      uniqueOpens: c.uniqueopens == null ? null : Number(c.uniqueopens),
      unsubscribes: c.unsubscribes == null ? null : Number(c.unsubscribes),
      listNames: listIds.map(id => names.get(id) ?? `list ${id}`),
      clicks: clicks.get(baseIssueName(c.name)) ?? { total: 0, links: [] },
    }
  })
}

/* ─── Reorderable cards ─────────────────────────────────────────────── */

const CARD_RE = /<!--card:(g\d+):([^>]+?)-->([\s\S]*?)<!--\/card-->/g
const MANIFEST_RE = /<!--aisafety-cards:([A-Za-z0-9+/=]+)-->/

export interface CardInfo {
  key: string
  title: string
  /** Hosted logo PNG (the same one the email shows), when the listing has one. */
  logo: string | null
  /** The card's "Consider applying if" line as plain text ('' when the card
   *  has none yet). Null when the card cannot carry one (events, training,
   *  or a funding draft built before the manifest recorded it). */
  fit: string | null
  /** Pen's original line as plain text, from the manifest, so an edit can
   *  be recognised and undone. Null for drafts built before 16 Sept 2026. */
  pipelineFit: string | null
  /** Every piece of text on the card that can be edited, in the order the
   *  email shows it (title, lines under it, description, rows at the
   *  bottom). Empty for drafts built before 25 Sept 2026. */
  fields: CardField[]
}

export interface CardField {
  /** The marker name: `title`, `m0`… (lines under the title), `desc`,
   *  `b0`… (rows at the bottom). */
  name: string
  /** What the editor calls it ("Title", "Dates", "Stipend"…). */
  label: string
  /** The text now, plain. */
  value: string
  /** The text as the pipeline built it, when it has been edited since;
   *  null when it never was. */
  original: string | null
  /** The text carries a link, which a plain-text edit would drop. */
  hasLink: boolean
}

export interface CardGroup {
  /** `g0`, `g1`… — the section's id in the card markers. */
  id: string
  /** The section heading ("New events", "Closing in the next two weeks"…). */
  label: string
  /** In document order. */
  cards: CardInfo[]
}

interface ManifestCard {
  key: string
  title: string
  logo?: string | null
  /** Funding cards: Pen's "Consider applying if" HTML ('' when none). */
  fit?: string
  /** Text as built, per field, recorded on the field's first edit. */
  o?: Record<string, string>
}

interface Manifest {
  v: number
  groups: Array<{ id: string; label: string; cards: ManifestCard[] }>
  /** The plain-text email as segments; card segments carry `c` = `gN:KEY`. */
  text: Array<{ t: string; c?: string }>
}

function readManifest(html: string): Manifest | null {
  const m = MANIFEST_RE.exec(html)
  if (!m) return null
  try {
    const data = JSON.parse(
      Buffer.from(m[1], 'base64').toString('utf8')
    ) as Manifest
    if (
      data?.v !== 1 ||
      !Array.isArray(data.groups) ||
      !Array.isArray(data.text)
    )
      return null
    return data
  } catch {
    return null
  }
}

interface Block {
  gid: string
  key: string
  start: number
  end: number
  raw: string
}

function cardBlocks(html: string): Block[] {
  const out: Block[] = []
  for (const m of html.matchAll(CARD_RE)) {
    out.push({
      gid: m[1],
      key: m[2],
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      raw: m[0],
    })
  }
  return out
}

/** The cards as they currently sit in the email, grouped by section. Null
 *  when the email carries no markers (built before 10 Sept 2026). */
export function cardGroups(html: string): CardGroup[] | null {
  const manifest = readManifest(html)
  if (!manifest) return null
  const info = new Map<
    string,
    {
      title: string
      logo: string | null
      fit: string | null
      o: Record<string, string>
    }
  >()
  for (const g of manifest.groups)
    for (const c of g.cards)
      info.set(`${g.id}:${c.key}`, {
        title: c.title,
        logo: typeof c.logo === 'string' && c.logo ? c.logo : null,
        fit: typeof c.fit === 'string' ? c.fit : null,
        o: c.o && typeof c.o === 'object' ? c.o : {},
      })
  const groups = new Map<string, CardGroup>(
    manifest.groups.map(g => [g.id, { id: g.id, label: g.label, cards: [] }])
  )
  for (const b of cardBlocks(html)) {
    const g = groups.get(b.gid)
    if (!g) continue
    const meta = info.get(`${b.gid}:${b.key}`)
    const fit = FIT_HTML_RE.exec(b.raw)
    const pipelineFit = meta?.fit ?? null
    g.cards.push({
      key: b.key,
      title: meta?.title ?? b.key,
      logo: meta?.logo ?? null,
      fit: fit ? stripHtml(fit[1]) : pipelineFit != null ? '' : null,
      pipelineFit: pipelineFit != null ? stripHtml(pipelineFit) : null,
      fields: cardFields(b.raw, meta?.o ?? {}, meta?.fit != null),
    })
  }
  const out = [...groups.values()].filter(g => g.cards.length > 0)
  return out.length > 0 ? out : null
}

export class ReorderError extends Error {}

/** Pure: the email with each listed group's cards in the given order, plus
 *  the plain-text version rebuilt to match. Throws ReorderError when `order`
 *  is not exactly a permutation of a group's cards. Mirrors render.py
 *  `reorder_cards()`. */
export function reorderHtml(
  html: string,
  order: Record<string, string[]>
): { html: string; text: string } {
  const manifest = readManifest(html)
  if (!manifest) throw new ReorderError('no card manifest in this email')
  let blocks = cardBlocks(html)
  for (const [gid, keys] of Object.entries(order)) {
    const mine = blocks.filter(b => b.gid === gid)
    if (mine.length === 0) throw new ReorderError(`unknown group ${gid}`)
    const want = [...keys].sort()
    const have = mine.map(b => b.key).sort()
    if (
      want.length !== have.length ||
      new Set(keys).size !== keys.length ||
      want.some((k, i) => k !== have[i])
    ) {
      throw new ReorderError(
        `group ${gid}: the keys must be exactly its cards, each once`
      )
    }
    const first = mine[0]
    const last = mine[mine.length - 1]
    const span = html.slice(first.start, last.end)
    if (span !== mine.map(b => b.raw).join(''))
      throw new ReorderError(`group ${gid}: cards are not contiguous`)
    const byKey = new Map(mine.map(b => [b.key, b.raw]))
    html =
      html.slice(0, first.start) +
      keys.map(k => byKey.get(k) ?? '').join('') +
      html.slice(last.end)
    blocks = cardBlocks(html)
  }
  return { html, text: rebuildText(manifest, order) }
}

/** The plain-text email from the manifest's segments, with each listed
 *  group's card segments in `order`. */
function rebuildText(
  manifest: Manifest,
  order: Record<string, string[]>
): string {
  const textByKey = new Map<string, string>()
  for (const seg of manifest.text) if (seg.c) textByKey.set(seg.c, seg.t)
  const slots = new Map<string, string[]>(
    Object.entries(order).map(([gid, keys]) => [gid, [...keys]])
  )
  return manifest.text
    .map(seg => {
      if (!seg.c) return seg.t
      const gid = seg.c.split(':', 1)[0]
      const queue = slots.get(gid)
      if (!queue || queue.length === 0) return seg.t
      return textByKey.get(`${gid}:${queue.shift()}`) ?? seg.t
    })
    .join('')
}

/* ─── "Consider applying if" on funding cards ────────────────────────── */

// Exactly what render.py funding_card() writes under the description, and
// the matching plain-text line — change both sides together.
const FIT_HTML_RE =
  /<div style="margin-top:12px;"><span style="font-weight:600;">Consider applying if<\/span>: ([\s\S]*?)<\/div>/
const FIT_TEXT_PREFIX = '  Consider applying if: '
/** A program sub-link line; a new fit line goes in front of the first one. */
const SUBLINK_OPEN = '<div style="margin-top:8px;">'
/** The description block the fit line lives in. */
const DESCRIPTION_OPEN_RE = /<div class="pb"[^>]*>/

/** A "Consider applying if" edit the page can't make; `detail` is written
 *  for the page (routes send it, never a caught error's message). */
export class FitError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

function fitDiv(fitHtml: string): string {
  return `<div style="margin-top:12px;"><span style="font-weight:600;">Consider applying if</span>: ${fitHtml}</div>`
}

/** Index of the `</div>` closing the div whose opening tag ends at `from`. */
function divEnd(html: string, from: number): number {
  const re = /<div\b|<\/div>/g
  re.lastIndex = from
  let depth = 1
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1
    if (depth === 0) return m.index
  }
  return -1
}

/** A card with no fit line yet: put `line` at the end of its description
 *  block, ahead of any program sub-links (where the renderer puts it). */
function insertFit(card: string, line: string): string {
  const open = DESCRIPTION_OPEN_RE.exec(card)
  if (!open)
    throw new FitError('this card has no description to add the line to')
  const start = open.index + open[0].length
  const end = divEnd(card, start)
  if (end < 0) throw new FitError('malformed description block')
  const sub = card.indexOf(SUBLINK_OPEN, start)
  const at = sub >= 0 && sub < end ? sub : end
  return card.slice(0, at) + line + card.slice(at)
}

/** The card's plain-text segment with its fit line replaced, removed
 *  (`plain` empty) or added after the description. */
function setFitLine(segment: string, plain: string): string {
  const lines = segment.split('\n')
  const at = lines.findIndex(l => l.startsWith(FIT_TEXT_PREFIX))
  if (at >= 0) {
    if (plain) lines[at] = FIT_TEXT_PREFIX + plain
    else lines.splice(at, 1)
  } else if (plain) {
    let i = lines.findIndex(
      (l, n) => n > 0 && (/^  (- |https?:\/\/)/.test(l) || l === '')
    )
    if (i < 0) i = lines.length
    lines.splice(i, 0, FIT_TEXT_PREFIX + plain)
  }
  return lines.join('\n')
}

/** Pure: the email with one card's "Consider applying if" line set to `fit`
 *  (plain text; empty removes the line), the manifest's text segment for
 *  the card updated to match, and the plain-text email rebuilt in the
 *  cards' current order. Throws FitError for an unknown card or one the
 *  line cannot be added to. Mirrors render.py `set_fit()`. */
export function setFitHtml(
  html: string,
  gid: string,
  key: string,
  fit: string
): { html: string; text: string } {
  const manifest = readManifest(html)
  if (!manifest) throw new FitError('no card manifest in this email')
  const block = cardBlocks(html).find(b => b.gid === gid && b.key === key)
  if (!block) throw new FitError(`unknown card ${gid}:${key}`)
  const plain = fit.replace(/\s+/g, ' ').trim()
  const line = plain ? fitDiv(escapeHtml(plain)) : ''
  let card: string
  if (FIT_HTML_RE.test(block.raw)) {
    card = block.raw.replace(FIT_HTML_RE, () => line)
  } else if (!plain) {
    card = block.raw
  } else {
    card = insertFit(block.raw, line)
  }
  const seg = manifest.text.find(s => s.c === `${gid}:${key}`)
  if (seg) seg.t = setFitLine(seg.t, plain)
  const encoded = Buffer.from(JSON.stringify(manifest), 'utf8').toString(
    'base64'
  )
  const out = (
    html.slice(0, block.start) +
    card +
    html.slice(block.end)
  ).replace(MANIFEST_RE, () => `<!--aisafety-cards:${encoded}-->`)
  const order: Record<string, string[]> = {}
  for (const b of cardBlocks(out)) (order[b.gid] ??= []).push(b.key)
  return { html: out, text: rebuildText(manifest, order) }
}

/* ─── Card text (title, lines, description, rows) ───────────────────── */

// render.py wraps every piece of text on a card in `<!--f:NAME-->…<!--/f-->`
// (rows: `<!--f:NAME:ICON-->`). `setFieldsHtml()` is the same algorithm as
// render.py `set_fields()` — keep them in step.
const FIELD_RE = /<!--f:([a-z]+\d*)(?::([a-z0-9-]+))?-->([\s\S]*?)<!--\/f-->/g

/** A text edit the page can't make; `detail` is written for the page. */
export class FieldError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

/** What a row is, from the icon the renderer chose for it. */
const ICON_LABELS: Record<string, string> = {
  pin: 'Location',
  computer: 'Location',
  calendar: 'Dates',
  person: 'Host',
  money: 'Stipend',
  'money-off': 'Stipend',
  timer: 'Time commitment',
  'timer-half': 'Time commitment',
  'entry-low': 'Entry bar',
  'entry-mid': 'Entry bar',
  'entry-high': 'Entry bar',
  paper: 'Applications',
  'paper-closed': 'Applications',
  'form-check': 'Accepting applications',
  'form-pause': 'Accepting applications',
  target: 'Detail',
}

function fieldLabel(name: string, icon: string | undefined, funding: boolean) {
  if (name === 'title') return 'Title'
  if (name === 'desc') return 'Description'
  if (icon === 'tag') return funding ? 'Type' : 'Cost'
  return (icon && ICON_LABELS[icon]) || 'Detail'
}

function cardFields(
  raw: string,
  origs: Record<string, string>,
  funding: boolean
): CardField[] {
  const out: CardField[] = []
  for (const m of raw.matchAll(FIELD_RE)) {
    const orig = origs[m[1]]
    const value = stripHtml(m[3])
    out.push({
      name: m[1],
      label: fieldLabel(m[1], m[2], funding),
      value,
      original:
        typeof orig === 'string' && stripHtml(orig) !== value
          ? stripHtml(orig)
          : null,
      hasLink: /<a\s/i.test(m[3]),
    })
  }
  return out
}

/** The card's text segment with `old` swapped for `next` (both plain): a
 *  whole line first (after its "* " or "  " lead), else the first
 *  occurrence inside a line; unchanged when `old` isn't there. */
function replacePlain(segment: string, old: string, next: string): string {
  if (!old || old === next) return segment
  const lines = segment.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const lead = l.startsWith('* ') || l.startsWith('  ') ? l.slice(0, 2) : ''
    if (l.slice(lead.length) === old) {
      lines[i] = lead + next
      return lines.join('\n')
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].indexOf(old)
    if (at >= 0) {
      lines[i] = lines[i].slice(0, at) + next + lines[i].slice(at + old.length)
      return lines.join('\n')
    }
  }
  return segment
}

/** Pure: the email with text on one card replaced — `values` maps field
 *  names to HTML fragments — the manifest updated (the text as built is
 *  kept under `o` on a field's first edit, the title follows an edited
 *  title) and the plain-text email rebuilt in the cards' current order.
 *  Mirrors render.py `set_fields()`. */
export function setFieldsRaw(
  html: string,
  gid: string,
  key: string,
  values: Record<string, string>
): { html: string; text: string } {
  const manifest = readManifest(html)
  if (!manifest) throw new FieldError('no card manifest in this email')
  const block = cardBlocks(html).find(b => b.gid === gid && b.key === key)
  if (!block) throw new FieldError(`unknown card ${gid}:${key}`)
  const entry = manifest.groups
    .find(g => g.id === gid)
    ?.cards.find(c => c.key === key)
  if (!entry)
    throw new FieldError(`card ${gid}:${key} is missing from the manifest`)
  const names = new Set([...block.raw.matchAll(FIELD_RE)].map(m => m[1]))
  for (const name of Object.keys(values)) {
    if (!names.has(name))
      throw new FieldError(`card ${gid}:${key} has no '${name}' text`)
  }
  const seg = manifest.text.find(s => s.c === `${gid}:${key}`)
  const card = block.raw.replace(
    FIELD_RE,
    (whole, name: string, icon: string | undefined, old: string) => {
      const next = Object.prototype.hasOwnProperty.call(values, name)
        ? values[name]
        : undefined
      if (next === undefined || next === old) return whole
      entry.o ??= {}
      if (!Object.prototype.hasOwnProperty.call(entry.o, name))
        entry.o[name] = old
      if (seg) seg.t = replacePlain(seg.t, stripHtml(old), stripHtml(next))
      if (name === 'title') entry.title = stripHtml(next)
      return `<!--f:${name}${icon ? `:${icon}` : ''}-->${next}<!--/f-->`
    }
  )
  const encoded = Buffer.from(JSON.stringify(manifest), 'utf8').toString(
    'base64'
  )
  const out = (
    html.slice(0, block.start) +
    card +
    html.slice(block.end)
  ).replace(MANIFEST_RE, () => `<!--aisafety-cards:${encoded}-->`)
  const order: Record<string, string[]> = {}
  for (const b of cardBlocks(out)) (order[b.gid] ??= []).push(b.key)
  return { html: out, text: rebuildText(manifest, order) }
}

/** `setFieldsRaw()` for plain text from the editor: whitespace collapsed,
 *  escaped. A field can't be emptied (a line with no text would still show
 *  its icon). */
export function setFieldsHtml(
  html: string,
  gid: string,
  key: string,
  values: Record<string, string>
): { html: string; text: string } {
  const escaped: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    const clean = value.replace(/\s+/g, ' ').trim()
    if (!clean) throw new FieldError(`the ${name} text can't be empty`)
    escaped[name] = escapeHtml(clean)
  }
  return setFieldsRaw(html, gid, key, escaped)
}

/** Edit text on one card inside a draft — any of its fields, and on funding
 *  cards the "Consider applying if" line — in one write: verify, rewrite
 *  HTML + text, re-stamp, write back, re-check. Returns the cards. */
export async function editDraftCard(
  draftId: string,
  gid: string,
  key: string,
  values: Record<string, string>,
  fit?: string,
  knownMessageId?: string
): Promise<{ cards: CardGroup[] }> {
  if (Object.keys(values).length === 0 && fit === undefined)
    throw new FieldError('nothing to change')
  return rewriteDraft(
    draftId,
    body => {
      let out = { html: body, text: '' }
      if (Object.keys(values).length > 0)
        out = setFieldsHtml(out.html, gid, key, values)
      if (fit !== undefined) out = setFitHtml(out.html, gid, key, fit)
      return out
    },
    `card ${gid}:${key} edited (${[
      ...Object.keys(values),
      ...(fit !== undefined ? ['fit'] : []),
    ].join(', ')})`,
    knownMessageId
  )
}

/** Move the cards of a draft into `order` ({ groupId: keys }) inside
 *  ActiveCampaign: verify the draft first (same checks as approval), rewrite
 *  the message HTML + text, re-stamp the content marker, write it back, and
 *  re-check the live message. Returns the new card order. */
export async function reorderDraft(
  draftId: string,
  order: Record<string, string[]>,
  knownMessageId?: string
): Promise<{ cards: CardGroup[] }> {
  return rewriteDraft(
    draftId,
    body => reorderHtml(body, order),
    `reordered: ${Object.entries(order)
      .map(([g, k]) => `${g}=${k.join(',')}`)
      .join(' ')}`,
    knownMessageId
  )
}

/** Set one funding card's "Consider applying if" line inside a draft
 *  (plain text; empty removes it), the same way as a reorder: verify, rewrite
 *  HTML + text, re-stamp, write back, re-check. Returns the cards. */
export async function editDraftFit(
  draftId: string,
  gid: string,
  key: string,
  fit: string
): Promise<{ cards: CardGroup[] }> {
  return rewriteDraft(
    draftId,
    body => setFitHtml(body, gid, key, fit),
    `fit line of ${gid}:${key} ${fit.trim() ? 'set' : 'removed'}`
  )
}

/** The write path shared by every edit: verify the draft (same checks as
 *  approval), apply `change` to the message body, re-stamp the content
 *  marker, write it back through the v3 API and check the stored message AC
 *  answers with. Two round trips when the page passes the message id. */
async function rewriteDraft(
  draftId: string,
  change: (body: string) => { html: string; text: string },
  logLine: string,
  knownMessageId?: string
): Promise<{ cards: CardGroup[] }> {
  const { problems, messageId, msg, listIds } = await readDraft(
    draftId,
    null,
    knownMessageId
  )
  if (problems.length > 0 || !messageId || !msg) {
    throw new DraftProblemError(
      problems.length > 0 ? problems : ['no message on the draft']
    )
  }
  // A real list's draft is edited from production only (see
  // canWriteRealListsHere); test lists stay editable anywhere.
  const refusals = listIds
    .filter(isRealList)
    .map(listRefusal)
    .filter((r): r is string => r !== null)
  if (refusals.length > 0) throw new DraftProblemError(refusals)
  const body = (msg.html ?? '').replace(MARKER_RE, '')
  const { html, text } = change(body)
  const stamped = `<!--aisafety-issue:${contentDigest(html)}-->` + html
  const stored = await v3put<{ message?: RawMessage }>(
    `messages/${acId(messageId)}`,
    { message: { html: stamped, text } }
  )
  const liveHtml =
    typeof stored.message?.html === 'string'
      ? stored.message.html
      : ((await message(messageId)).html ?? '')
  const m = MARKER_RE.exec(liveHtml)
  if (!m || m[1] !== contentDigest(liveHtml)) {
    throw new Error(
      `message ${messageId} failed verification after the edit — check the ActiveCampaign dashboard`
    )
  }
  const cards = cardGroups(liveHtml)
  if (!cards) throw new Error('card markers missing after the edit')
  console.info(`[newsletter] draft ${draftId} ${logLine}`)
  return { cards }
}

/* ─── Analytics: sends in a date range ────────────────────────────────── */

export interface SendStats {
  id: string
  name: string
  /** 'Events', 'Training', 'Funding' — the list's name without the site's. */
  newsletter: string
  sentAt: string | null
  delivered: number
  opens: number | null
  unsubscribes: number | null
  clicks: CampaignClicks
}

/** The sent issues of the real newsletter lists (test lists left out) whose
 *  send finished inside [startMs, endMs], newest first, with the clicks
 *  counted on aisafety.com. For /admin/analytics' Newsletters tab. */
export async function readSendStats(range: {
  startMs: number | null
  endMs: number | null
}): Promise<SendStats[]> {
  const [campaigns, names] = await Promise.all([allCampaigns(), listNames()])
  const inRange = campaigns.filter(c => {
    if (c.status !== '5') return false
    const at = Date.parse(c.ldate ?? c.sdate ?? '')
    if (Number.isNaN(at)) return false
    return (
      (range.startMs == null || at >= range.startMs) &&
      (range.endMs == null || at <= range.endMs)
    )
  })
  const lists = await mapLimit(inRange, 3, async c => {
    const known = sentListIds.get(c.id)
    if (known) return known
    const ids = await campaignListIds(c.id)
    sentListIds.set(c.id, ids)
    return ids
  })
  const real = inRange
    .map((c, i) => ({ c, list: names.get(lists[i][0] ?? '') ?? '' }))
    .filter(
      ({ c, list }, i) =>
        lists[i].length === 1 &&
        list !== '' &&
        !/\(test\)/i.test(list) &&
        c.name !== ''
    )
  const clicks = await readClicks([
    ...new Set(real.map(({ c }) => baseIssueName(c.name))),
  ])
  return real
    .map(({ c, list }) => ({
      id: c.id,
      name: c.name,
      newsletter: list.replace(/^AISafety\.com\s+/i, ''),
      sentAt: c.ldate ?? c.sdate,
      delivered: Number(c.send_amt ?? 0),
      opens: c.uniqueopens == null ? null : Number(c.uniqueopens),
      unsubscribes: c.unsubscribes == null ? null : Number(c.unsubscribes),
      clicks: clicks.get(baseIssueName(c.name)) ?? { total: 0, links: [] },
    }))
    .sort((a, b) =>
      String(b.sentAt ?? '').localeCompare(String(a.sentAt ?? ''))
    )
}

/** The message HTML as a subscriber will see it, with AC's personalisation
 *  tags neutralised so the preview renders cleanly. */
export async function previewHtml(
  campaignId: string,
  messageId?: string
): Promise<string | null> {
  // With the message id the page listed, one read instead of two (AC can take
  // 10+ seconds a request). Only pipeline emails (content marker) show either way.
  let id = messageId
  if (!id) {
    const messageIds = await campaignMessageIds(campaignId)
    if (messageIds.length !== 1) return null
    id = messageIds[0]
  }
  const msg = await message(id).catch(() => null)
  if (!msg) return null
  const html = msg.html ?? ''
  if (!MARKER_RE.test(html)) return null
  return html
    .replace(MARKER_RE, '')
    .replace(/%UNSUBSCRIBELINK%/g, '#')
    .replace(/%WEBCOPY%/g, '#')
    .replace(/%SENDER-INFO-SINGLELINE%/g, SENDER_INFO)
}

/** AC stores sdate in the account's local time. Read the current UTC offset
 *  from a timestamp AC itself returns, so DST can never shift a send. */
async function accountUtcOffset(
  read: RawCampaign[] | null = null
): Promise<string> {
  const campaigns = read ?? (await allCampaigns())
  for (const c of campaigns) {
    const m = /([+-]\d{2}:\d{2})$/.exec(c.cdate ?? '')
    if (m) return m[1]
  }
  return FALLBACK_UTC_OFFSET
}

/** `YYYY-MM-DD HH:MM:SS` for `at`, expressed in the given UTC offset. */
export function formatLocal(at: Date, offset: string): string {
  const sign = offset.startsWith('-') ? -1 : 1
  const minutes =
    sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)))
  const shifted = new Date(at.getTime() + minutes * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ` +
    `${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`
  )
}

export class DraftProblemError extends Error {
  problems: string[]
  constructor(problems: string[]) {
    super(`draft failed verification: ${problems.join('; ')}`)
    this.problems = problems
  }
}

/** A test copy ActiveCampaign wouldn't send; `detail` is written for the
 *  page and carries ActiveCampaign's own reason. */
export class TestSendError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

/** Mail one copy of a draft to `to` through ActiveCampaign's own test send:
 *  the real sender, HTML and text, tags filled in the way a send fills them,
 *  and "TEST: " in front of the subject. Nobody on the list gets anything and
 *  the draft stays a draft. Runs the same checks as approval first, so a test
 *  is always of an email that could go out. `to` must come from the session,
 *  never from a request (the route passes the signed-in approver's own
 *  address). Same call as ~/Newsletter/ac.py `test_send()`. */
export async function sendTestCopy(
  draftId: string,
  to: string,
  knownMessageId?: string
): Promise<{ to: string }> {
  const { problems, messageId } = await readDraft(draftId, null, knownMessageId)
  if (problems.length > 0 || !messageId) {
    throw new DraftProblemError(
      problems.length > 0 ? problems : ['no message on the draft']
    )
  }
  const out = await v1answer('campaign_send', {
    email: to,
    campaignid: draftId,
    messageid: messageId,
    type: 'mime',
    action: 'test',
  })
  if (Number(out.result_code) !== 1) {
    throw new TestSendError(
      `ActiveCampaign didn't send it: ${String(out.result_message ?? 'no reason given').slice(0, 300)}`
    )
  }
  console.info(`[newsletter] test copy of draft ${draftId} sent`)
  return { to }
}

/* ─── Approval: the lock and the record (Upstash) ─────────────────────── */

// The same Upstash database the analytics, the admin users and the click
// counts use (same env fallbacks). Read at call time; null on a laptop
// without it, where only the test lists can be approved.
let kvClient: { key: string; redis: Redis } | null = null
function kv(): Redis | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  const key = `${url} ${token}`
  if (kvClient?.key !== key)
    kvClient = { key, redis: new Redis({ url, token }) }
  return kvClient.redis
}

const LOCK_PREFIX = 'aisafety:newsletter:approve-lock:'
/** Read by the send watcher: one key per approved campaign (no expiry) and
 *  an index scored by approval time. */
const APPROVED_PREFIX = 'aisafety:newsletter:approved:'
const APPROVED_INDEX = 'aisafety:newsletter:approved'

/** Who holds an approval lock, and since when. */
export interface LockHolder {
  draftId: string
  approver: string
  /** ISO timestamp. */
  at: string
}

/** One key per list + issue + wave (`all` for a whole-list send). */
function approveLockKey(
  listId: string,
  baseName: string,
  wave: number | null
): string {
  return `${LOCK_PREFIX}${listId}:${baseName}:${wave ?? 'all'}`
}

/** Test lists on a laptop without Upstash: locks held in this process. */
const localLocks = new Map<string, { holder: LockHolder; until: number }>()

/** SET NX: `ok` when this approval took the lock, else who holds it. */
async function claimApproveLock(
  key: string,
  holder: LockHolder,
  listId: string
): Promise<{ ok: true } | { ok: false; holder: LockHolder | null }> {
  const redis = kv()
  if (redis) {
    const set = await redis.set(key, holder, {
      nx: true,
      ex: APPROVE_LOCK_SECONDS,
    })
    if (set === 'OK') return { ok: true }
    const held = await redis.get<LockHolder>(key).catch(() => null)
    return { ok: false, holder: held }
  }
  if (isRealList(listId)) {
    throw new DraftProblemError([
      'the approval lock needs Upstash, which isn’t set up on this copy of the site',
    ])
  }
  const now = Date.now()
  const hit = localLocks.get(key)
  if (hit && hit.until > now) return { ok: false, holder: hit.holder }
  localLocks.set(key, { holder, until: now + APPROVE_LOCK_SECONDS * 1000 })
  return { ok: true }
}

async function releaseApproveLock(key: string): Promise<void> {
  const redis = kv()
  if (redis) await redis.del(key)
  else localLocks.delete(key)
}

/** What the send watcher knows about each real-list approval. */
export interface ApprovalRecord {
  campaignId: string
  listId: string
  /** The sending campaign's name (with any wave suffix). */
  name: string
  baseName: string
  wave: number | null
  waves: number | null
  /** The wave's AC segment (segmentsV2 id); null for a whole-list send. */
  segmentId: string | null
  /** How many contacts it should reach, as counted at approval. */
  expected: number | null
  /** ISO timestamp. */
  approvedAt: string
  approver: string
}

async function recordApproval(r: ApprovalRecord): Promise<void> {
  const redis = kv()
  if (!redis) throw new Error('Upstash isn’t set up on this copy of the site')
  const p = redis.pipeline()
  p.set(`${APPROVED_PREFIX}${r.campaignId}`, r)
  p.zadd(APPROVED_INDEX, {
    score: Date.parse(r.approvedAt),
    member: r.campaignId,
  })
  await p.exec()
}

/** Another approval of this issue for this list (and wave) holds the lock:
 *  still running, or finished less than 15 minutes ago. */
export class ApprovalLockedError extends Error {
  readonly detail: string
  readonly holder: LockHolder | null
  constructor(issue: string, holder: LockHolder | null) {
    const detail = `Another approval of “${issue}” for this list ${
      holder ? `(${holder.approver}) ` : ''
    }started less than 15 minutes ago and may already have scheduled it. Don’t press again: check Recent sends, which updates by itself.`
    super(detail)
    this.detail = detail
    this.holder = holder
  }
}

/** The email has warnings the approver hasn't ticked: none sent, or new
 *  ones since the dialog opened. Carries the current list to tick. */
export class NeedsConfirmationError extends Error {
  readonly warnings: SendWarning[]
  constructor(warnings: SendWarning[]) {
    super('tick every check in the dialog before sending')
    this.warnings = warnings
  }
}

/** Something went wrong at or after `campaign_create`: ActiveCampaign may
 *  have scheduled the send even though the answer said otherwise (or never
 *  came). The lock stays, and the page says not to press again. */
export class MaybeScheduledError extends Error {
  readonly detail: string
  readonly campaignId: string | null
  constructor(detail: string, campaignId: string | null) {
    super(detail)
    this.detail = detail
    this.campaignId = campaignId
  }
}

/** ActiveCampaign created the send with its link tracker on, and the new
 *  campaign was deleted at once: nothing goes out. */
export class LinkTrackingError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

export interface ScheduledSend {
  /** The new, sending campaign (the draft shell is deleted). */
  campaignId: string
  /** ActiveCampaign is holding the send for its compliance review ("Pending
   *  Approval"); it goes out once they approve it. */
  held: boolean
  draftId: string
  sdate: string | null
  listName: string | null
  activeContacts: number | null
  /** Who approved it (the signed-in admin's name). */
  approver: string
  /** Things that went wrong after the send was safely scheduled. */
  notes: string[]
}

export interface ApproveOptions {
  /** The signed-in approver's name: logged, returned and recorded. */
  approver: string
  /** Ids of the warnings ticked in the confirm dialog. */
  confirmed?: string[]
}

/** Verify the draft one last time, then schedule it to send in a couple of
 *  minutes. Refuses (DraftProblemError) on any verification problem or
 *  block, NeedsConfirmationError for unticked warnings, ApprovalLockedError
 *  while another approval of the issue holds the lock. Any error once the
 *  create has been asked for is a MaybeScheduledError (or a
 *  LinkTrackingError, when the new campaign was deleted again). */
export async function approveAndSend(
  draftId: string,
  listId: string,
  opts: ApproveOptions
): Promise<ScheduledSend> {
  const approver = opts.approver.trim() || 'an unnamed approver'
  const refusal = listRefusal(listId)
  if (refusal) throw new DraftProblemError([refusal])
  const { campaign, problems, messageId, msg } = await readDraft(
    draftId,
    listId
  )
  if (problems.length > 0 || !messageId || !msg) {
    throw new DraftProblemError(
      problems.length > 0 ? problems : ['no message on the draft']
    )
  }
  const baseName = baseIssueName(campaign.name)
  // Whole-list sends only for now (wave = null); a wave send passes its
  // number here, in the lock, the duplicate check and the record.
  const lockKey = approveLockKey(listId, baseName, null)
  const claim = await claimApproveLock(
    lockKey,
    { draftId, approver, at: new Date().toISOString() },
    listId
  )
  if (!claim.ok) throw new ApprovalLockedError(baseName, claim.holder)

  let createAsked = false
  try {
    // The email itself, and how many it would reach.
    const [checks, active] = await Promise.all([
      sendChecks({ name: campaign.name, listId }, msg, [], new Date()),
      activeContactCount(listId),
    ])
    if (checks.blocks.length > 0) throw new DraftProblemError(checks.blocks)
    const warmup = warmupRefusal(listId, active, null)
    if (warmup) throw new DraftProblemError([warmup])
    const ticked = new Set(opts.confirmed ?? [])
    if (checks.warnings.some(w => !ticked.has(w.id)))
      throw new NeedsConfirmationError(checks.warnings)

    // Then ActiveCampaign as it is now, uncached, right before the create:
    // an earlier approval may have gone through even though the page showed
    // an error, and a second one would reach every subscriber again.
    const campaigns = await allCampaigns({ fresh: true })
    const current = campaigns.find(c => c.id === draftId)
    if (!current || current.status !== '0') {
      throw new DraftProblemError([
        'this draft is no longer waiting: it was approved or replaced a moment ago – check Recent sends',
      ])
    }
    const otherDrafts = campaigns.filter(
      c => c.status === '0' && c.id !== draftId && issueOrder(c.name) != null
    )
    const [sent, otherLists] = await Promise.all([
      sentOnList(campaigns, draftId, campaign.name, listId, null),
      mapLimit(otherDrafts, 3, c => campaignListIds(c.id)),
    ])
    if (sent.length > 0) {
      throw new DraftProblemError(
        sent.map(
          c =>
            `this issue already went to this list as campaign ${c.id} (${statusLabel(c.status)}) – approving it again would send it twice`
        )
      )
    }
    const older = olderIssueBlocks(
      campaign.name,
      otherDrafts.filter((_, i) => otherLists[i].includes(listId))
    )
    if (older.length > 0) throw new DraftProblemError(older)

    const offset = await accountUtcOffset(campaigns)
    const sdate = formatLocal(
      new Date(Date.now() + SEND_DELAY_MINUTES * 60_000),
      offset
    )
    // From here on the send may exist even when an answer says it doesn't:
    // the lock stays, and every error tells the approver not to press again.
    createAsked = true
    return await createAndConfirm({
      draftId,
      listId,
      messageId,
      name: campaign.name,
      baseName,
      sdate,
      active,
      approver,
    })
  } catch (err) {
    if (!createAsked) {
      await releaseApproveLock(lockKey).catch(e =>
        console.error(
          `[newsletter] releasing the approval lock for draft ${draftId} failed: ${e instanceof Error ? e.message : String(e)}`
        )
      )
    }
    throw err
  }
}

/** The create and everything after it. Every failure here is a
 *  MaybeScheduledError unless the new campaign is known to be gone. */
async function createAndConfirm(a: {
  draftId: string
  listId: string
  messageId: string
  name: string
  baseName: string
  sdate: string
  active: number | null
  approver: string
}): Promise<ScheduledSend> {
  let newId: string | null = null
  try {
    const created = await v1answer('campaign_create', {
      type: 'single',
      name: a.name,
      status: 1,
      public: 0,
      // Off (28 Sept 2026): ActiveCampaign's click tracker
      // (alignment23684.emlnk9.com) dropped about half the connections after
      // ~5 s from 8 test locations, so readers got "This site can't be
      // reached". Links go straight to their pages. Same flag in ac.py.
      tracklinks: 'none',
      // Off: ActiveCampaign's Google Analytics link tracking would append its
      // own utm_source/medium/content/campaign after the ones the renderer has
      // already put on every aisafety.com link (issue #20, 16 Sept 2026: two
      // utm_source values on one URL). Same flag in ac.py.
      tracklinksanalytics: 0,
      sdate: a.sdate,
      [`p[${a.listId}]`]: a.listId,
      [`m[${a.messageId}]`]: 100,
    })
    if (Number(created.result_code) !== 1) {
      throw new Error(
        `ActiveCampaign answered campaign_create with: ${String(created.result_message ?? 'no reason given').slice(0, 200)}`
      )
    }
    newId = acId(String(created.id))
    const live = (await v3<{ campaign: RawCampaign }>(`campaigns/${newId}`))
      .campaign

    // Read back what AC stored: its click tracker must be off, or readers'
    // clicks go through the tracker that dropped half the connections.
    if (
      live.tracklinks !== 'none' ||
      String(live.tracklinksanalytics ?? '') !== '0'
    ) {
      await deleteBadSend(
        newId,
        `link tracking came back as ${String(live.tracklinks)}/${String(live.tracklinksanalytics)}`
      )
    }
    // '7' = ActiveCampaign holds the send for its compliance review. The
    // campaign exists and will go out once they approve it, so this counts as
    // scheduled: the draft shell must go, or it could be approved a second time.
    const held = live.status === '7'
    if (live.status !== '1' && live.status !== '2' && !held) {
      throw new Error(
        `the new campaign ${newId} has status ${statusLabel(live.status)} – check the ActiveCampaign dashboard`
      )
    }

    const notes: string[] = []
    // The message now belongs to the sending campaign; the draft shell is
    // noise — and harmless if it stays: the page shows it as already sent.
    try {
      await v1('campaign_delete', { id: a.draftId })
    } catch (err) {
      console.error(
        `[newsletter] deleting draft ${a.draftId} after approval failed: ${err instanceof Error ? err.message : String(err)}`
      )
      notes.push(
        `The draft (campaign ${a.draftId}) couldn’t be deleted; it now shows as already sent.`
      )
    }
    const approvedAt = new Date().toISOString()
    if (isRealList(a.listId)) {
      try {
        await recordApproval({
          campaignId: newId,
          listId: a.listId,
          name: a.name,
          baseName: a.baseName,
          wave: null,
          waves: null,
          segmentId: null,
          expected: a.active,
          approvedAt,
          approver: a.approver,
        })
      } catch (err) {
        console.error(
          `[newsletter] recording approval of campaign ${newId} failed: ${err instanceof Error ? err.message : String(err)}`
        )
        notes.push(
          'The approval couldn’t be recorded for the send watcher, so it may flag this send as not approved here.'
        )
      }
    }
    const names = await listNames().catch(() => new Map<string, string>())
    console.info(
      `[newsletter] draft ${a.draftId} approved by ${a.approver} → campaign ${newId} ${held ? 'held for ActiveCampaign review' : 'scheduled'} for ${live.sdate ?? a.sdate} on list ${a.listId}`
    )
    return {
      campaignId: newId,
      held,
      draftId: a.draftId,
      sdate: live.sdate ?? a.sdate,
      listName: names.get(a.listId) ?? null,
      activeContacts: a.active,
      approver: a.approver,
      notes,
    }
  } catch (err) {
    if (err instanceof MaybeScheduledError || err instanceof LinkTrackingError)
      throw err
    const reason = err instanceof Error ? err.message : String(err)
    console.error(
      `[newsletter] approval of draft ${a.draftId} by ${a.approver} failed after campaign_create${newId ? ` (campaign ${newId})` : ''}: ${reason}`
    )
    throw new MaybeScheduledError(
      `It may have been scheduled anyway${newId ? ` (campaign ${newId})` : ''}: something went wrong after ActiveCampaign was asked to schedule it. Don’t press Approve again – check Recent sends, which updates by itself.`,
      newId
    )
  }
}

/** Delete a send that came back wrong, inside the couple of minutes before
 *  it goes out. Throws LinkTrackingError when it is gone, and a
 *  MaybeScheduledError when it couldn't be deleted. */
async function deleteBadSend(campaignId: string, why: string): Promise<never> {
  let gone = false
  try {
    const out = await v3delete(`campaigns/${acId(campaignId)}/delete`)
    gone = Number(out.succeeded) === 1
  } catch (err) {
    console.error(
      `[newsletter] deleting campaign ${campaignId} (${why}) failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  console.error(
    `[newsletter] campaign ${campaignId}: ${why}; ${gone ? 'deleted' : 'NOT deleted'}`
  )
  if (!gone) {
    throw new MaybeScheduledError(
      `ActiveCampaign turned its link tracking on for campaign ${campaignId}, and it couldn’t be deleted. Delete it in ActiveCampaign now (Campaigns → ${campaignId}), before it sends.`,
      campaignId
    )
  }
  throw new LinkTrackingError(
    `ActiveCampaign turned its link tracking on for the new campaign ${campaignId}, so it was deleted at once. Nothing was sent. Tell Claude before trying again.`
  )
}
