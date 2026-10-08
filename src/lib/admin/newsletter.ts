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
  creates the sending campaign from the verified message (status 1, sdate
  sendDelayMinutes out, in the account's local time) and deletes the draft
  shell (after the last wave, when it goes out in waves). Reads use the v3
  API; the writes use v1, the only API that can schedule a send (unlocked on
  the paid plan, 30 Aug 2026), except the stop calls (v3).

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
  - one approval at a time per list + issue, whole list or any wave: an
    Upstash SET NX lock, held 15 minutes and released only when the approval
    fails before `campaign_create`, so two tabs, a reload or two approvers
    can't both send; card edits to the issue wait while it is held;
  - the campaigns are read again, uncached, right before the create, and any
    campaign of the same issue on the list counts as "already sent" unless
    it is a draft or was stopped/disabled before reaching anyone; the email
    is read again too, and must be the one the checks passed;
  - once `campaign_create` has been called, every error says "may have been
    scheduled – don't press again": the create may have landed even when the
    answer didn't;
  - `sendChecks()` refuses emails with missing footer tags, the wrong sender
    for the list, broken click-counter links, oversized HTML or an older issue
    still waiting, and asks the approver to tick leftover words (TEST,
    TODO…) and dates already past;
  - only production may send to (or edit drafts on) the real lists 6/7/8,
    and while NEWSLETTER_WARMUP is on a send to more than
    MAX_UNSEGMENTED_SEND people must name a wave;
  - every real-list approval is recorded in Upstash for the send watcher.

  Waves and stopping (29 Sept 2026, stage B of the same work):
  - the first sends go out in warm-up waves: saved segments in AC named
    "Newsletter wave 1" … "Newsletter wave N (everyone else)" (made by
    ~/Newsletter/waves.py; the WAVE CONTRACT is in its docstring). A wave's
    campaign carries the segment (`segmentid`), is named
    "<issue> · wave k/N", and is read back and deleted at once if AC didn't
    keep the segment (or can't be read back to show it did); Recent sends
    flags a wave-named send without one. Waves go in order, one at a time,
    each once the one before has finished and WAVE_MIN_GAP_HOURS have passed
    (or the watcher's verdict on it isn't red) unless the approver types a
    reason; the draft stays until the last wave, and card edits wait while a
    wave is going out;
  - a real-list send goes out SEND_DELAY_MINUTES_REAL after approval, and
    Recent sends can cancel it until then, then pause, stop or resume it
    (stopSend); the owner is emailed about every real-list approval.
*/

import { createHash } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { newsletterApprovalMail, sendAdminMail } from '@/lib/admin/mail'
import { ROOT_ADMINS } from '@/lib/admin/users'
import {
  MAX_UNSEGMENTED_SEND,
  NEWSLETTER_WARMUP,
} from '@/lib/admin/newsletter-warmup'
import {
  type CampaignClicks,
  LINKS_BASE,
  LIST_ID_RE,
  noteSendTime,
  noteTestCopy,
  readClicks,
} from '@/lib/newsletter-clicks'

/** Re-exported for callers that already import them from here. */
export { MAX_UNSEGMENTED_SEND, NEWSLETTER_WARMUP }

const MARKER_RE = /<!--aisafety-issue:([0-9a-f]{16})-->/
/** Minutes between approval and the send. On the real lists that is time to
 *  notice a mistake and cancel the send under Recent sends before anyone gets
 *  it; the test lists keep two, the practical minimum (AC rejects sdates in
 *  the past and runs its scheduler about once a minute). */
const SEND_DELAY_MINUTES_REAL = 5
const SEND_DELAY_MINUTES_TEST = 2

export function sendDelayMinutes(listId: string): number {
  return isRealList(listId) ? SEND_DELAY_MINUTES_REAL : SEND_DELAY_MINUTES_TEST
}
/** Used for the account's local time when AC's own timestamps can't be read
 *  (account set up from Colombia, 2026). */
const FALLBACK_UTC_OFFSET = '-05:00'
/** Replaces %SENDER-INFO-SINGLELINE% in previews; AC fills the real one. */
const SENDER_INFO =
  'AISafety.com, 2810 N Church St PMB 49028, Wilmington, DE 19802-4447, US'

/** Wave k+1 waits this long after wave k finished sending: the send watcher
 *  judges each wave 18 hours after it ends, and a red verdict holds the next
 *  one. Sending sooner takes a typed reason, which is logged. */
export const WAVE_MIN_GAP_HOURS = 18
/** The shortest reason accepted for sending a held wave anyway. */
const OVERRIDE_MIN_CHARS = 10
/** The saved segments that are waves, by name (~/Newsletter/waves.py makes
 *  them): "Newsletter wave 1" … "Newsletter wave N (everyone else)" for the
 *  real lists, and the test run's "SWEEP TEST wave …" for test lists 4/5. */
const WAVE_PREFIX_REAL = 'Newsletter wave '
const WAVE_PREFIX_TEST = 'SWEEP TEST wave '

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
 *  localhost or preview copy must not be a way round the checks here. A dev
 *  server never counts, even with VERCEL_ENV=production pulled into its
 *  .env.local (`vercel env pull --environment=production` writes it). */
export function canWriteRealListsHere(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' &&
    process.env.NODE_ENV !== 'development'
  )
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
/** Gmail clips an email at about 102 KB; stay under it. 96 KiB since 8 October
 *  2026: ActiveCampaign's link tracking is off (28 September), so at send time
 *  it adds only the open pixel and the filled-in merge tags (under 1 KB), not
 *  the ~12% the old 90 KiB allowed for. The pipeline now declares the font once
 *  per email (render.hoist_type), so 15 Events cards fit (~96 KB). Keep
 *  SITE_MAX_HTML_BYTES in ~/Newsletter/issue.py in step. */
const MAX_HTML_BYTES = 96 * 1024
/** How many campaigns one read covers (AC's page maximum). */
const CAMPAIGN_READ_WINDOW = 100

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

/** Saved segments (segmentsV2) have UUIDs; same guard as acId. */
export const SEGMENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function segmentId(id: string): string {
  if (!SEGMENT_ID_RE.test(id))
    throw new Error(`not an ActiveCampaign segment id: ${id.slice(0, 40)}`)
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

/** After a create, cancel, pause…: the page's next read (it rereads at once)
 *  sees ActiveCampaign as it is now, not the few seconds' shared copy from
 *  before — which could still list a deleted draft, or offer a wave that
 *  was just approved. On this server instance; others keep theirs for at
 *  most a few seconds. */
function forgetSharedCampaigns(ids: string[] = []): void {
  shared.delete('campaigns')
  for (const id of ids) shared.delete(`campaign:${id}`)
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

/** A v1 report (a read: GET, READ_TIMEOUT_MS, no retry). Null when AC has
 *  nothing to say (`result_code` 0) or the read fails; the numbers it feeds
 *  are shown, never decided on. */
async function v1report(
  action: string,
  params: Record<string, string>
): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams({
    api_action: action,
    api_output: 'json',
    api_key: apiKey(),
    ...params,
  })
  try {
    const res = await fetch(`${base()}/admin/api.php?${qs}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const out = (await res.json()) as Record<string, unknown>
    return Number(out.result_code) === 1 ? out : null
  } catch (err) {
    console.warn(
      `[newsletter] ActiveCampaign ${action} unreadable: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
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
  /** '0' for a whole-list send; a wave's campaign carries the id of the
   *  hidden segment row AC made from the wave's saved segment. */
  segmentid?: string | null
  hardbounces?: string | null
  softbounces?: string | null
  /** Opens by people, without Apple Mail's automatic image loads. */
  verified_unique_opens?: string | null
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
   *  campaign — the whole list, or every one of its waves: Approve stays
   *  off. */
  alreadySent: { campaignId: string; status: string } | null
  /** The list's warm-up waves and how far this issue has got through them;
   *  null when the list has none (then it can only go out whole). */
  waves: WavePlan | null
  /** Minutes between approval and the send on this list. */
  sendDelayMinutes: number
  /** Card edits may be saved into this draft from this copy of the site. */
  editable: boolean
  /** The draft may be deleted from this copy of the site. */
  deletable: boolean
  /** Why card edits are off just now (a wave of the issue is going out and
   *  shares this draft's email), or null. */
  editLock: string | null
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
  /** When a scheduled send goes out, as an ISO instant (AC's own sdate is in
   *  the account's local time), for the countdown. */
  scheduledAt: string | null
  sentAt: string | null
  sentTo: number
  uniqueOpens: number | null
  unsubscribes: number | null
  listNames: string[]
  /** The issue's name without any wave suffix. */
  baseName: string
  /** Which wave this campaign is, or null for a whole-list send. */
  wave: { wave: number; waves: number } | null
  /** Named as a wave, but ActiveCampaign holds no segment for it: it goes
   *  (or went) to the whole list. An approval deletes such a send at once,
   *  but not if it was cut off before its read back. */
  segmentLost: boolean
  /** Rows of one issue on one list share this: they are shown together, and
   *  the clicks (counted per issue) once for the lot. */
  group: string
  /** Clicks counted on aisafety.com (the email's links go through
   *  /api/nl since 28 Sept 2026); zero for older sends, whose links went
   *  through ActiveCampaign's tracker. Per issue: every wave of it carries
   *  the same numbers. */
  clicks: CampaignClicks
  /** What may be done to it from the page right now (approvers only). */
  actions: StopAction[]
}

/** Cancel a scheduled or held send (it is deleted: nobody gets it), pause
 *  one that is sending, stop a sending or paused one for good, resume a
 *  paused one. */
export type StopAction = 'cancel' | 'pause' | 'stop' | 'resume'

/** One wave of the list, and this issue's send of it if it has gone. */
export interface WaveInfo {
  wave: number
  waves: number
  /** The saved segment's name ("Newsletter wave 2"). */
  label: string
  segmentId: string
  /** Active contacts on this list in the wave right now; null if unread. */
  count: number | null
  sent: WaveSent | null
}

/** A wave this issue has sent (or is sending), with its numbers. */
export interface WaveSent {
  campaignId: string
  status: string
  /** When it finished sending (ISO), once it has. */
  finishedAt: string | null
  sent: number
  /** Hard + soft bounces. */
  bounces: number | null
  unsubscribes: number | null
  /** Opens by people (ActiveCampaign's verified_unique_opens). */
  verifiedOpens: number | null
  /** Non-Gmail complaints only: Gmail doesn't tell ActiveCampaign. */
  spamComplaints: number | null
  /** The send watcher's 18-hour verdict, once it has one. */
  health: 'green' | 'amber' | 'red' | null
}

/** A list's waves and where one issue stands in them. */
export interface WavePlan {
  /** The waves couldn't be read or don't fit the wave contract; the list
   *  can't be sent in waves until that's fixed. */
  error: string | null
  waves: WaveInfo[]
  /** Active on the list now, and how many this issue has reached so far
   *  (send_amt over its waves): the rest are still to get it. */
  active: number | null
  reached: number
  /** The wave that may go next, or null. */
  next: number | null
  /** The 18-hour gap after the previous wave ends at this instant (ISO);
   *  sending sooner needs a typed reason. */
  notBefore: string | null
  /** Other reasons the next wave is held that a typed reason can override
   *  (the watcher flagged the previous wave red, say). */
  holds: string[]
  /** Why the next wave has to wait (the previous one is still sending). */
  wait: string | null
  /** Why no further wave of this issue can go (a wave was stopped, the
   *  waves changed, it already went to the whole list). */
  blocked: string | null
  /** It may still go to the whole list at once instead (small lists only
   *  while the warm-up is on). */
  wholeList: boolean
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

/** A saved segment that is one wave of a list. */
export interface WaveSegment {
  wave: number
  waves: number
  name: string
  segmentId: string
  /** The wave's tag (waves 1…N−1); null for the last, "everyone else". */
  tagId: string | null
}

/** Pure: the waves among the account's saved segments, in order, or why
 *  they don't make a set: named `${prefix}1` … `${prefix}${N-1}` and
 *  `${prefix}${N} (everyone else)`, N from 2 to 9, each number once. */
export function parseWaveSegments(
  prefix: string,
  saved: Array<{ name: string; segmentId: string }>
):
  | Array<{ wave: number; name: string; segmentId: string; last: boolean }>
  | {
      error: string
    } {
  const re = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)( \\(everyone else\\))?$`
  )
  const found = saved
    .map(s => ({ s, m: re.exec(s.name) }))
    .filter(x => x.m && x.s.name.startsWith(prefix))
    .map(({ s, m }) => ({
      wave: Number(m![1]),
      name: s.name,
      segmentId: s.segmentId,
      last: Boolean(m![2]),
    }))
    .sort((a, b) => a.wave - b.wave)
  if (found.length === 0) return []
  const names = found.map(f => `“${f.name}”`).join(', ')
  const n = found.length
  const numbered = found.every((f, i) => f.wave === i + 1)
  const lastOnly = found.every((f, i) => f.last === (i === n - 1))
  if (n < 2 || n > 9 || !numbered || !lastOnly)
    return {
      error: `the wave segments in ActiveCampaign (${names}) aren’t numbered 1 to N with only the last one “(everyone else)” – ask Claude to check ~/Newsletter/waves.py`,
    }
  if (found.some(f => !SEGMENT_ID_RE.test(f.segmentId)))
    return { error: `a wave segment has an unexpected id (${names})` }
  return found
}

/** Pure: each wave's tag, read from its segment's conditions, or why they
 *  don't fit the wave contract: wave k < N has exactly "has tag T_k"; the
 *  last has "doesn't have tag T" for every earlier wave's tag and nothing
 *  else, all joined with AND — so nobody is in two waves or in none. */
export function waveTags(
  defs: Array<{
    wave: number
    name: string
    last: boolean
    conditions: Array<{ field: string; op: string; value: string }>
    groupOps: string[]
  }>
): { tags: Array<string | null> } | { error: string } {
  const tags: Array<string | null> = []
  for (const d of defs) {
    if (d.last) continue
    const c = d.conditions
    if (
      c.length !== 1 ||
      c[0].field !== 'tagid' ||
      c[0].op !== '=' ||
      !/^\d+$/.test(c[0].value)
    )
      return {
        error: `the segment “${d.name}” isn’t “has tag X” – ask Claude to check ~/Newsletter/waves.py`,
      }
    tags.push(c[0].value)
  }
  if (new Set(tags).size !== tags.length)
    return { error: 'two wave segments use the same tag' }
  const last = defs[defs.length - 1]
  const excluded = last.conditions.map(c => c.value)
  if (
    !last.last ||
    last.conditions.some(c => c.field !== 'tagid' || c.op !== '!=') ||
    last.groupOps.some(op => op.toLowerCase() !== 'and') ||
    excluded.length !== tags.length ||
    !tags.every(t => excluded.includes(t as string))
  )
    return {
      error: `the segment “${last.name}” doesn’t leave out exactly the earlier waves’ tags, so some people could get an issue twice or never – ask Claude to check ~/Newsletter/waves.py`,
    }
  return { tags: [...tags, null] }
}

/** A campaign of this issue on the list, as waveProgress reads it. */
export interface IssueSend {
  id: string
  name: string
  status: string
  send_amt?: string | null
  ldate?: string | null
}

/** The send watcher's 18-hour verdict on a wave (its HealthRecord; only
 *  these fields are read). */
export interface WaveHealth {
  verdict?: string
  reasons?: string[]
  /** Too few recipients to judge. */
  smallSample?: boolean
}

export interface WaveProgress {
  next: number | null
  /** Epoch ms when the gap after the previous wave ends. */
  notBefore: number | null
  holds: string[]
  wait: string | null
  blocked: string | null
  /** Every wave went (or the issue went to the whole list). */
  done: boolean
  /** This issue's live campaign for each wave (index = wave − 1). */
  byWave: Array<IssueSend | null>
}

/** Pure: which wave of `waves` may go next, given this issue's live
 *  campaigns on the list (`live`, as sentOnList returns them) and the
 *  watcher's verdicts. Waves go in order; wave k+1 needs wave k finished
 *  (status 5) and WAVE_MIN_GAP_HOURS since then (see holdsAt). A wave that
 *  was stopped after reaching people ends the issue's run. `offset` is the
 *  account's UTC offset: a finish time written without a zone is read in
 *  it, never in the server's own zone. */
export function waveProgress(
  waves: number,
  live: IssueSend[],
  health: Map<string, WaveHealth> = new Map(),
  offset: string = FALLBACK_UTC_OFFSET
): WaveProgress {
  const out: WaveProgress = {
    next: null,
    notBefore: null,
    holds: [],
    wait: null,
    blocked: null,
    done: false,
    byWave: Array.from({ length: waves }, () => null),
  }
  const whole = live.find(c => waveOf(c.name) == null)
  if (whole) {
    out.blocked = `this issue already went to the whole list as campaign ${whole.id} (${statusLabel(whole.status)})`
    out.done = true
    return out
  }
  for (const c of live) {
    const w = waveOf(c.name)!
    if (w.waves !== waves) {
      out.blocked = `the waves changed after this issue started going out: campaign ${c.id} was wave ${w.wave} of ${w.waves}, and there are ${waves} waves now – ask Claude before sending more`
      return out
    }
    if (w.wave < 1 || w.wave > waves) {
      out.blocked = `campaign ${c.id} is named as wave ${w.wave} of ${w.waves}, which can’t be – ask Claude before sending more`
      return out
    }
    const had = out.byWave[w.wave - 1]
    if (had) {
      out.blocked = `wave ${w.wave} of this issue went out twice (campaigns ${had.id} and ${c.id}) – ask Claude before sending more`
      return out
    }
    out.byWave[w.wave - 1] = c
  }
  let highest = 0
  out.byWave.forEach((c, i) => {
    if (c) highest = i + 1
  })
  const missing = out.byWave.findIndex((c, i) => !c && i < highest)
  if (missing >= 0) {
    out.blocked = `wave ${missing + 1} of this issue never went out, but wave ${highest} did – ask Claude before sending more`
    return out
  }
  if (highest === waves) {
    out.done = true
    return out
  }
  out.next = highest + 1
  if (highest === 0) return out
  const prev = out.byWave[highest - 1]!
  if (prev.status === '4' || prev.status === '6') {
    out.blocked = `wave ${highest} was ${statusLabel(prev.status)} after reaching ${Number(prev.send_amt ?? 0) || 'some'} people, so no further wave of this issue goes out (see ~/Newsletter/ROLLBACK.md)`
    out.next = null
    return out
  }
  if (prev.status !== '5') {
    out.wait = `wave ${out.next} can go once wave ${highest} has finished sending (it is ${statusLabel(prev.status)} now)`
    return out
  }
  const finished = instantMs(prev.ldate ?? null, offset)
  if (Number.isNaN(finished))
    out.holds.push(
      `ActiveCampaign doesn’t say when wave ${highest} finished, so the ${WAVE_MIN_GAP_HOURS}-hour gap can’t be checked`
    )
  else out.notBefore = finished + WAVE_MIN_GAP_HOURS * 3_600_000
  const h = health.get(prev.id)
  if (h?.verdict === 'red' && !h.smallSample)
    out.holds.push(
      `the send watcher flagged wave ${highest} red${h.reasons?.length ? `: ${h.reasons.join('; ')}` : ''}`
    )
  return out
}

/** Pure: the holds on the next wave at `now`: the gap, if it hasn't passed,
 *  then the others. */
export function holdsAt(p: WaveProgress, now: Date): string[] {
  const gap =
    p.notBefore != null && now.getTime() < p.notBefore
      ? [
          `wave ${(p.next ?? 1) - 1} finished less than ${WAVE_MIN_GAP_HOURS} hours ago; wave ${p.next} is due from ${formatUtc(new Date(p.notBefore))}`,
        ]
      : []
  return [...gap, ...p.holds]
}

/** "8 October 2026, 14:32 UTC". */
function formatUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${formatDay(d)}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

/** Pure: what the page may do to a send in this state. Only the newsletter
 *  lists' single-list campaigns (lists 5–8); status 1 or 7 can only be
 *  canceled (AC deletes it), 2 paused, 3 stopped for good or resumed. */
export function stopActionsFor(
  status: string,
  listIds: string[]
): StopAction[] {
  if (listIds.length !== 1 || !STOPPABLE_LISTS.has(listIds[0])) return []
  if (status === '1' || status === '7') return ['cancel']
  if (status === '2') return ['pause']
  if (status === '3') return ['stop', 'resume']
  return []
}

const STOPPABLE_LISTS = new Set(['5', '6', '7', '8'])
/** Scheduled, sending, paused, held: not finished, so a Stop button may
 *  still apply. */
const STILL_GOING = new Set(['1', '2', '3', '7'])

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
  return contactCount(
    `contacts?listid=${encodeURIComponent(listId)}&status=1&limit=1`
  )
}

/** How many contacts a contacts query matches (its meta.total); null when
 *  it can't be read, which every caller treats as "unknown", never 0. */
async function contactCount(query: string): Promise<number | null> {
  try {
    const data = await v3<{ meta?: { total?: string | number } }>(query)
    const total = data.meta?.total
    return total == null ? null : Number(total)
  } catch (err) {
    console.warn(
      `[newsletter] counting ${query.split('&limit')[0]} failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

/* ─── Waves: what ActiveCampaign holds ────────────────────────────────────
   ~/Newsletter/waves.py tags the contacts and makes one saved segment per
   wave (the WAVE CONTRACT in its docstring). Here the segments are found by
   name, their conditions checked, and each wave counted on the list. */

function wavePrefix(listId: string): string | null {
  if (isRealList(listId)) return WAVE_PREFIX_REAL
  if (TEST_LISTS.has(listId)) return WAVE_PREFIX_TEST
  return null
}

/** The list's waves with their tags; null when it has none; `{ error }`
 *  when they can't be used. `fresh` skips the minute's sharing (approval). */
async function readWaveSegments(
  listId: string,
  { fresh = false } = {}
): Promise<WaveSegment[] | { error: string } | null> {
  const prefix = wavePrefix(listId)
  if (!prefix) return null
  const read = async (): Promise<WaveSegment[] | { error: string } | null> => {
    let saved: Array<{ name: string; segmentId: string }>
    try {
      const data = await v3<{
        data?: Array<{
          id?: string
          attributes?: { name?: string; segment_id?: string }
        }>
      }>(`audiences?search=${encodeURIComponent(prefix.trim())}&page_size=100`)
      saved = (data.data ?? []).map(d => ({
        name: String(d.attributes?.name ?? ''),
        segmentId: String(d.attributes?.segment_id ?? d.id ?? ''),
      }))
    } catch (err) {
      // 404 = no saved segment matches: an empty result, not an error.
      if (err instanceof Error && /: 404 /.test(err.message)) saved = []
      else throw err
    }
    const found = parseWaveSegments(prefix, saved)
    if (!Array.isArray(found)) return found
    if (found.length === 0) return null
    const defs = await mapLimit(found, 3, async f => ({
      ...f,
      ...(await segmentConditions(f.segmentId, fresh)),
    }))
    const tags = waveTags(defs)
    if ('error' in tags) return tags
    return found.map((f, i) => ({
      wave: f.wave,
      waves: found.length,
      name: f.name,
      segmentId: f.segmentId,
      tagId: tags.tags[i],
    }))
  }
  return fresh ? read() : sharedRead(`waves:${prefix}`, 60_000, read)
}

/** A saved segment's conditions as (field, operator, value), and how its
 *  groups are joined. A condition on anything but a tag, or one that counts
 *  (field_aggregate), comes back under another field name, so it can never
 *  pass for a wave's. */
async function segmentConditions(
  id: string,
  fresh: boolean
): Promise<{
  conditions: Array<{ field: string; op: string; value: string }>
  groupOps: string[]
}> {
  const read = async () => {
    const r = await v3<{ data?: unknown }>(`segmentsV2/${segmentId(id)}`)
    const d = (Array.isArray(r.data) ? r.data[0] : r.data) as
      | {
          attributes?: {
            segment_conditions?: Array<{
              object_type?: string
              field_aggregate?: unknown
              fields?: Array<{
                name?: string
                operator?: string
                value?: unknown
              }>
            }>
            segment_condition_groups?: Array<{ operator?: string }>
            segment_condition_group_operator?: string
          }
        }
      | undefined
    const at = d?.attributes ?? {}
    const conditions = (at.segment_conditions ?? []).flatMap(c =>
      (c.fields ?? []).map(f => ({
        field:
          c.object_type === 'tag' && c.field_aggregate == null
            ? String(f.name ?? '')
            : `${String(c.object_type)}.${String(f.name ?? '')}${c.field_aggregate == null ? '' : '(aggregate)'}`,
        op: String(f.operator ?? ''),
        value: String(f.value ?? ''),
      }))
    )
    const groupOps = [
      ...(at.segment_condition_groups ?? []).map(g => String(g.operator ?? '')),
      String(at.segment_condition_group_operator ?? 'and'),
    ]
    return { conditions, groupOps }
  }
  // A segment's conditions can be edited in ActiveCampaign's app, so even
  // the page's copy is only kept for ten minutes.
  return fresh ? read() : sharedRead(`segment:${id}`, 10 * 60_000, read)
}

/** Each wave's active contacts on the list, by the wave contract: a tagged
 *  wave is contacts?listid&status=1&tagid (the segmentid filter ignores
 *  listid), the last wave the rest of the list's active contacts. */
async function waveCounts(
  listId: string,
  segments: WaveSegment[],
  active: number | null,
  { fresh = false } = {}
): Promise<Array<number | null>> {
  const count = (tagId: string) => {
    const query = `contacts?listid=${encodeURIComponent(listId)}&status=1&tagid=${encodeURIComponent(tagId)}&limit=1`
    // The page rereads every 30 seconds; the approval counts afresh.
    return fresh
      ? contactCount(query)
      : sharedRead(`count:${query}`, 30_000, () => contactCount(query))
  }
  const tagged = await mapLimit(
    segments.filter(s => s.tagId != null),
    3,
    s => count(s.tagId!)
  )
  const known = tagged.every(n => n != null)
  const rest =
    active != null && known
      ? active - tagged.reduce<number>((a, n) => a + (n ?? 0), 0)
      : null
  return [...tagged, rest != null && rest >= 0 ? rest : null]
}

/** Where the send watcher keeps its 18-hour verdict on each wave. */
const HEALTH_PREFIX = 'aisafety:newsletter:health:'

/** The watcher's verdicts on these campaigns (none on a laptop without
 *  Upstash, or before the watcher has judged them). */
async function readHealth(ids: string[]): Promise<Map<string, WaveHealth>> {
  const redis = kv()
  const out = new Map<string, WaveHealth>()
  if (!redis || ids.length === 0) return out
  const got = await Promise.all(
    ids.map(id => redis.get<WaveHealth>(HEALTH_PREFIX + id))
  )
  ids.forEach((id, i) => {
    const h = got[i]
    if (h && typeof h === 'object') out.set(id, h)
  })
  return out
}

/** A wave's numbers: the campaign read on its own (the list read can lag),
 *  and its complaints from the v1 report, shared for a minute. */
async function waveSentInfo(
  c: RawCampaign,
  health: WaveHealth | undefined,
  offset: string
): Promise<WaveSent> {
  const [full, totals] = await Promise.all([
    sharedRead(`campaign:${c.id}`, 60_000, () =>
      v3<{ campaign?: RawCampaign }>(`campaigns/${acId(c.id)}`).then(
        d => d.campaign ?? c
      )
    ).catch(err => {
      console.warn(
        `[newsletter] reading campaign ${c.id}'s numbers failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return c
    }),
    sharedRead(`unsubtotals:${c.id}`, 60_000, () =>
      v1report('campaign_report_unsubscription_totals', { campaignid: c.id })
    ),
  ])
  const num = (v: unknown) =>
    v == null || String(v).trim() === '' || Number.isNaN(Number(v))
      ? null
      : Number(v)
  const hard = num(full.hardbounces)
  const soft = num(full.softbounces)
  const finished =
    full.status === '5' ? instantMs(full.ldate ?? null, offset) : NaN
  const verdict = health?.verdict
  return {
    campaignId: c.id,
    status: statusLabel(full.status),
    finishedAt: Number.isNaN(finished)
      ? null
      : new Date(finished).toISOString(),
    sent: num(full.send_amt) ?? 0,
    bounces: hard == null && soft == null ? null : (hard ?? 0) + (soft ?? 0),
    unsubscribes: num(full.unsubscribes),
    verifiedOpens: num(full.verified_unique_opens),
    spamComplaints: totals ? num(totals.spam_complaints) : null,
    health:
      verdict === 'green' || verdict === 'amber' || verdict === 'red'
        ? verdict
        : null,
  }
}

/** Pure: why card edits must wait, or null: a send of this issue that shares
 *  the draft's email (every wave is made from the draft's message) is still
 *  scheduled, sending, paused or held, and an edit would change what it
 *  sends after the checks were ticked. */
export function editLockFor(live: IssueSend[]): string | null {
  const going = live.find(
    c => isLiveCampaign(c) && !['4', '5', '6'].includes(c.status)
  )
  if (!going) return null
  const w = waveOf(going.name)
  return `${w ? `Wave ${w.wave} of this issue` : 'This issue'} (campaign ${going.id}) is ${statusLabel(going.status)} and uses this draft’s email, so card edits are off until it has finished sending`
}

/** The list's waves and where this issue stands in them, for the page:
 *  null when the list has no waves. `live` = this issue's live campaigns on
 *  the list; `active` = the list's active contacts; `offset` = the
 *  account's UTC offset (accountUtcOffset). */
async function wavePlanFor(
  listId: string,
  live: RawCampaign[],
  active: number | null,
  offset: string
): Promise<{ plan: WavePlan; progress: WaveProgress | null } | null> {
  const wholeList = warmupRefusal(listId, active, null) == null && !live.length
  const empty = (error: string): { plan: WavePlan; progress: null } => ({
    plan: {
      error,
      waves: [],
      active,
      reached: 0,
      next: null,
      notBefore: null,
      holds: [],
      wait: null,
      blocked: null,
      wholeList,
    },
    progress: null,
  })
  let segs: WaveSegment[] | { error: string } | null
  try {
    segs = await readWaveSegments(listId)
  } catch (err) {
    console.warn(
      `[newsletter] reading the wave segments failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return empty(
      'the wave segments couldn’t be read just now – try again in a minute'
    )
  }
  if (segs == null) return null
  if ('error' in segs) return empty(segs.error)
  const waves = segs
  const waveIds = live.filter(c => waveOf(c.name)).map(c => c.id)
  const [counts, health] = await Promise.all([
    waveCounts(listId, waves, active),
    readHealth(waveIds).catch(err => {
      console.warn(
        `[newsletter] reading the watcher's verdicts failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return new Map<string, WaveHealth>()
    }),
  ])
  const progress = waveProgress(waves.length, live, health, offset)
  const sent = await mapLimit(progress.byWave, 3, c =>
    c
      ? waveSentInfo(c as RawCampaign, health.get(c.id), offset)
      : Promise.resolve(null)
  )
  return {
    plan: {
      error: null,
      waves: waves.map((s, i) => ({
        wave: s.wave,
        waves: s.waves,
        label: s.name,
        segmentId: s.segmentId,
        count: counts[i],
        sent: sent[i],
      })),
      active,
      reached: sent.reduce((n, s) => n + (s?.sent ?? 0), 0),
      next: progress.next,
      notBefore:
        progress.notBefore == null
          ? null
          : new Date(progress.notBefore).toISOString(),
      holds: progress.holds,
      wait: progress.wait,
      blocked: progress.blocked,
      wholeList,
    },
    progress,
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
  kind: 'words' | 'date'
  text: string
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

  // Card text changed by hand on this page isn't flagged: an edit is the
  // approver's own choice (Bryce, 7 Oct 2026). A typo or a "test" left in
  // it is still caught by the leftover-word check below.

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
  for (const g of cardGroups(html) ?? []) {
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
  const offset = await accountUtcOffset(campaigns)
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
    const waved = listId
      ? await wavePlanFor(listId, sent, activeContacts, offset)
      : null
    const plan = waved?.plan ?? null
    // With usable waves the warm-up only rules out the whole list (the page
    // offers the waves instead); without, it blocks the send.
    const usableWaves = plan != null && plan.error == null
    const warmup =
      listId && !usableWaves
        ? warmupRefusal(listId, activeContacts, null)
        : null
    // "Already sent": the whole list got it, or every wave did. With waves
    // still to go, Approve stays on for the next one.
    const done =
      waved?.progress?.done === true
        ? (sent.find(s => waveOf(s.name) == null) ?? sent[0] ?? null)
        : null
    const alreadySent = usableWaves ? done : (sent[0] ?? null)
    const editLock = editLockFor(sent)
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
        ...(warmup
          ? [
              warmup,
              plan?.error ??
                'no wave segments were found in ActiveCampaign (~/Newsletter/waves.py makes them after the import)',
            ]
          : []),
      ],
      warnings: checks.warnings,
      alreadySent: alreadySent
        ? {
            campaignId: alreadySent.id,
            status: statusLabel(alreadySent.status),
          }
        : null,
      waves: plan,
      sendDelayMinutes: listId ? sendDelayMinutes(listId) : 0,
      editable:
        problems.length === 0 &&
        listId != null &&
        (!isRealList(listId) || canWriteRealListsHere()) &&
        editLock == null,
      deletable: deleteRefusal(listIds) == null,
      editLock,
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
  // Strip tags until none are left, so a tag split around another one
  // ("<scr<b>ipt>") can't survive a single pass.
  let text = fragment
  for (let prev = ''; prev !== text; ) {
    prev = text
    text = text.replace(/<[^>]*>/g, '')
  }
  return text
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
  // A send that can still be canceled, paused, stopped or resumed stays on
  // the page however old it is: one held for ActiveCampaign's review for
  // days must keep its Cancel button.
  const recent = campaigns
    .filter(c => c.status in STATUS_NAMES)
    .sort((a, b) =>
      String(b.ldate ?? b.sdate ?? '').localeCompare(
        String(a.ldate ?? a.sdate ?? '')
      )
    )
    .filter((c, i) => i < limit || STILL_GOING.has(c.status))
  // Clicks are counted per issue: every wave of one shares its base name.
  const [lists, clicks, offset] = await Promise.all([
    mapLimit(recent, 3, knownListIds),
    readClicks([...new Set(recent.map(c => baseIssueName(c.name)))]),
    accountUtcOffset(campaigns),
  ])
  const rows = recent.map((c, i): SentSummary => {
    const listIds = lists[i]
    const baseName = baseIssueName(c.name)
    return {
      id: c.id,
      name: c.name,
      status: STATUS_NAMES[c.status],
      scheduledFor: c.sdate,
      scheduledAt: sdateInstant(c.sdate, offset),
      sentAt: c.ldate,
      sentTo: Number(c.send_amt ?? 0),
      uniqueOpens: c.uniqueopens == null ? null : Number(c.uniqueopens),
      unsubscribes: c.unsubscribes == null ? null : Number(c.unsubscribes),
      listNames: listIds.map(id => names.get(id) ?? `list ${id}`),
      baseName,
      wave: waveOf(c.name),
      // Only a segment id that is there and 0 counts: a list read without
      // the field says nothing either way.
      segmentLost:
        waveOf(c.name) != null &&
        c.segmentid != null &&
        String(c.segmentid).trim() === '0',
      group: `${listIds.join(',')}|${baseName}`,
      clicks: clicks.get(baseName) ?? { total: 0, links: [] },
      actions: stopActionsFor(c.status, listIds),
    }
  })
  return groupSends(rows)
}

/** Pure: rows of one issue on one list next to each other, where the
 *  newest of them stands, waves highest first; otherwise the order stays. */
export function groupSends<
  T extends { group: string; wave: { wave: number } | null },
>(rows: T[]): T[] {
  const order: string[] = []
  const by = new Map<string, T[]>()
  for (const r of rows) {
    const g = by.get(r.group)
    if (g) g.push(r)
    else {
      by.set(r.group, [r])
      order.push(r.group)
    }
  }
  return order.flatMap(g =>
    by.get(g)!.sort((a, b) => (b.wave?.wave ?? 0) - (a.wave?.wave ?? 0))
  )
}

/** Pure: AC's sdate as an ISO instant. The v3 API writes it with the
 *  account's offset; the v1 form (`YYYY-MM-DD HH:MM:SS`) is read in
 *  `offset`. Null when it's neither. */
export function sdateInstant(
  sdate: string | null,
  offset: string
): string | null {
  if (!sdate) return null
  const s = sdate.trim()
  const withZone = /[+-]\d{2}:\d{2}$|Z$/.test(s)
    ? s
    : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)
      ? `${s.replace(' ', 'T')}${offset}`
      : null
  const at = withZone ? Date.parse(withZone) : NaN
  return Number.isNaN(at) ? null : new Date(at).toISOString()
}

/** Pure: any AC timestamp (sdate, ldate…) as epoch ms, read the way
 *  sdateInstant reads it; NaN when it's missing or unreadable. */
function instantMs(stamp: string | null, offset: string): number {
  const iso = sdateInstant(stamp, offset)
  return iso == null ? NaN : Date.parse(iso)
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
  // A timer line under an event's title is its time of day ("18:00 – 20:30",
  // events/card.ts); a training program's timer rows sit at the bottom (b…).
  if (name.startsWith('m') && (icon === 'timer' || icon === 'timer-half'))
    return 'Time'
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
 *  whole line first (after its "* " or "  " lead), then one whole
 *  " · "-separated part of a detail line, else the first occurrence inside
 *  a line; unchanged when `old` isn't there. Only the title itself may
 *  change the "* " title line: a location edit used to rewrite "Hong Kong"
 *  inside "ML4Good Governance: Hong Kong October 2026" (3 October 2026).
 *  Mirrors render.py `_replace_plain()`. */
function replacePlain(
  segment: string,
  old: string,
  next: string,
  isTitle = false
): string {
  if (!old || old === next) return segment
  const lines = segment.split('\n')
  const lockedTitle = (l: string) => !isTitle && l.startsWith('* ')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const lead = l.startsWith('* ') || l.startsWith('  ') ? l.slice(0, 2) : ''
    if (l.slice(lead.length) === old && !lockedTitle(l)) {
      lines[i] = lead + next
      return lines.join('\n')
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.startsWith('  ')) continue
    const parts = l.slice(2).split(' · ')
    const at = parts.indexOf(old)
    if (at >= 0) {
      parts[at] = next
      lines[i] = '  ' + parts.join(' · ')
      return lines.join('\n')
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (lockedTitle(lines[i])) continue
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
      if (seg)
        seg.t = replacePlain(
          seg.t,
          stripHtml(old),
          stripHtml(next),
          name === 'title'
        )
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
  // The campaigns are read alongside the draft (uncached: an approval may
  // have scheduled a wave a moment ago).
  const [{ campaign, problems, messageId, msg, listIds }, campaigns] =
    await Promise.all([
      readDraft(draftId, null, knownMessageId),
      allCampaigns({ fresh: true }),
    ])
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
  // A wave of this issue still going out is made from this same message:
  // an edit now would change it after its checks were ticked.
  const lock = editLockFor(
    await sentOnList(campaigns, draftId, campaign.name, listIds[0], null)
  )
  if (lock) throw new DraftProblemError([lock])
  // …and so is an approval of the issue that is running now, or scheduled a
  // send minutes ago (its campaign may not show in the read above yet).
  const approving = await approvalEditLock(
    listIds[0],
    baseIssueName(campaign.name)
  )
  if (approving) throw new DraftProblemError([approving])
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
  /** How many waves the numbers add up (0 = one whole-list send). */
  waves: number
}

/** The sent issues of the real newsletter lists (test lists left out) whose
 *  send finished inside [startMs, endMs], newest first, with the clicks
 *  counted on aisafety.com. An issue sent in waves is one row: its waves'
 *  numbers added up, its clicks (counted per issue) once. For
 *  /admin/analytics' Newsletters tab. */
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
    .map((c, i) => ({
      c,
      listId: lists[i][0] ?? '',
      list: names.get(lists[i][0] ?? '') ?? '',
    }))
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
  return sumIssues(real).map(({ rows, list }) => {
    const newest = rows[0].c
    const name = baseIssueName(newest.name)
    const sum = (pick: (c: RawCampaign) => string | null | undefined) => {
      const vals = rows.map(r => pick(r.c)).filter(v => v != null)
      return vals.length === 0 ? null : vals.reduce((n, v) => n + Number(v), 0)
    }
    return {
      id: newest.id,
      name,
      newsletter: list.replace(/^AISafety\.com\s+/i, ''),
      sentAt: newest.ldate ?? newest.sdate,
      delivered: sum(c => c.send_amt ?? '0') ?? 0,
      opens: sum(c => c.uniqueopens),
      unsubscribes: sum(c => c.unsubscribes),
      clicks: clicks.get(name) ?? { total: 0, links: [] },
      waves: rows.filter(r => waveOf(r.c.name) != null).length,
    }
  })
}

/** Pure: sends grouped per list + issue (base name), each group newest
 *  first, the groups newest first. */
export function sumIssues<
  R extends {
    c: { name: string; ldate?: string | null; sdate?: string | null }
    listId: string
    list: string
  },
>(sends: R[]): Array<{ rows: R[]; list: string }> {
  const at = (r: R) => String(r.c.ldate ?? r.c.sdate ?? '')
  const groups = new Map<string, { rows: R[]; list: string }>()
  for (const r of sends) {
    const key = `${r.listId}|${baseIssueName(r.c.name)}`
    const g = groups.get(key)
    if (g) g.rows.push(r)
    else groups.set(key, { rows: [r], list: r.list })
  }
  const out = [...groups.values()]
  for (const g of out) g.rows.sort((a, b) => at(b).localeCompare(at(a)))
  return out.sort((a, b) => at(b.rows[0]).localeCompare(at(a.rows[0])))
}

/* ─── Web version (30 Sept 2026) ──────────────────────────────────────────
   aisafety.com/newsletter/<key>/<issue> shows a sent issue on its own page
   (src/lib/newsletter-web.ts), in place of ActiveCampaign's web copy. Only
   an issue that has reached readers on its real list is shown there: never
   a draft, a test-list send, or a send still waiting (it can be cancelled). */

/** Pure: whether a campaign has reached anyone – sending, sent, or paused
 *  or stopped part-way. */
export function reachedReaders(c: {
  status: string
  send_amt?: string | null
}): boolean {
  if (c.status === '2' || c.status === '5') return true
  if (c.status === '3' || c.status === '4') return Number(c.send_amt ?? 0) > 0
  return false
}

/** The email of the issue named `name` as it went out on the real list
 *  `listId` (any wave: they all send the one message), or null when none of
 *  its campaigns there has reached anyone yet. Public pages call this, so
 *  the campaign list is shared for half a minute, not the approval page's
 *  few seconds: a burst of views, or of made-up issue addresses, costs one
 *  ActiveCampaign read. */
export async function sentIssueHtml(
  name: string,
  listId: string
): Promise<string | null> {
  if (!isRealList(listId) || !isNewsletterConfigured()) return null
  const campaigns = await sharedRead('web-campaigns', 30_000, () =>
    allCampaigns({ fresh: true })
  )
  const candidates = campaigns
    .filter(c => baseIssueName(c.name) === name && reachedReaders(c))
    .sort((a, b) => Number(b.id) - Number(a.id))
  for (const c of candidates) {
    const [lists, messages] = await Promise.all([
      campaignListIds(c.id),
      campaignMessageIds(c.id),
    ])
    if (!lists.includes(listId) || messages.length !== 1) continue
    const html = (await message(messages[0])).html ?? ''
    if (MARKER_RE.test(html)) return html
  }
  return null
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
  const { campaign, problems, messageId } = await readDraft(
    draftId,
    null,
    knownMessageId
  )
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
  // Its clicks are set aside until the issue goes out (newsletter-clicks.ts).
  // The copy has gone either way, so a failed note is only logged.
  try {
    await noteTestCopy(baseIssueName(campaign.name))
  } catch (err) {
    console.error(
      `[newsletter] noting the test copy of draft ${draftId} failed, so its clicks will count: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  return { to }
}

/** ActiveCampaign answered a draft delete with a refusal; `detail` carries
 *  its reason. */
export class DraftDeleteError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

/** Why a draft on these lists can't be deleted from this copy of the site,
 *  or null: the rule for editing it (a real list's drafts from production
 *  only, and only newsletter lists). */
function deleteRefusal(listIds: string[]): string | null {
  for (const l of listIds) {
    const r = listRefusal(l)
    if (r) return r
  }
  return null
}

/** Delete a draft waiting for approval, with ~/Newsletter/ac.py
 *  `delete_draft()`'s refusals: the campaign must still be a draft and every
 *  message on it must carry the pipeline's marker, so a wrong id can never
 *  take out a scheduled or sent campaign, or one built by hand. Refused
 *  while an approval of the issue is running or has just scheduled it. Only
 *  the campaign goes: a wave already sent was made from this same message.
 *  The pipeline's next build of the issue finds the draft gone and makes a
 *  new one. `deleted: false` = it was already gone. */
export async function deleteDraft(
  draftId: string,
  by: string
): Promise<{ deleted: boolean }> {
  const id = acId(draftId)
  const gone = (err: Error) => {
    if (/: 404 /.test(err.message)) return null
    throw err
  }
  const [campaign, listIds, messageIds] = await Promise.all([
    v3<{ campaign?: RawCampaign }>(`campaigns/${id}`)
      .then(d => d.campaign ?? null)
      .catch(gone),
    campaignListIds(id).catch(gone),
    campaignMessageIds(id).catch(gone),
  ])
  if (!campaign || !listIds || !messageIds) {
    forgetSharedCampaigns([id])
    return { deleted: false }
  }
  if (campaign.status !== '0') {
    throw new DraftProblemError([
      `campaign ${id} is ${statusLabel(campaign.status)}, not a draft – only drafts are deleted from here`,
    ])
  }
  const refusal = deleteRefusal(listIds)
  if (refusal) throw new DraftProblemError([refusal])
  const msgs = await Promise.all(messageIds.map(m => message(m)))
  if (msgs.length === 0 || msgs.some(m => !MARKER_RE.test(m.html ?? ''))) {
    throw new DraftProblemError([
      'this draft wasn’t built by the pipeline (no content marker), so it isn’t deleted from here',
    ])
  }
  for (const l of new Set(listIds)) {
    const approving = await approvalEditLock(
      l,
      baseIssueName(campaign.name),
      'delete'
    )
    if (approving) throw new DraftProblemError([approving])
  }
  const out = await v1answer('campaign_delete', { id })
  forgetSharedCampaigns([id])
  if (Number(out.result_code) !== 1) {
    throw new DraftDeleteError(
      `ActiveCampaign didn’t delete it: ${String(out.result_message ?? 'no reason given').slice(0, 300)}`
    )
  }
  console.info(`[newsletter] draft ${id} (“${campaign.name}”) deleted by ${by}`)
  return { deleted: true }
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
  /** The wave it approves; null for the whole list. */
  wave?: number | null
}

/** One key per list + issue, whatever the approval sends: a whole-list send
 *  and a wave (or two waves) of one issue are never approved side by side,
 *  or both could pass the "already sent" read before either create lands. */
function approveLockKey(listId: string, baseName: string): string {
  return `${LOCK_PREFIX}${listId}:${baseName}`
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

/** Why card edits (or deleting the draft) must wait for an approval of this
 *  issue on this list, or null: while one runs, or for the minutes after it
 *  scheduled a send, the draft it checked (and may already be sending) is
 *  not to change under it. Refuses when the lock can't be read. */
async function approvalEditLock(
  listId: string,
  baseName: string,
  what: 'edit' | 'delete' = 'edit'
): Promise<string | null> {
  const key = approveLockKey(listId, baseName)
  const redis = kv()
  let holder: LockHolder | null
  if (redis) {
    try {
      holder = await redis.get<LockHolder>(key)
    } catch (err) {
      console.warn(
        `[newsletter] reading the approval lock before an edit failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return `couldn’t check whether an approval of this issue is running, so the ${what === 'delete' ? 'draft wasn’t deleted' : 'edit wasn’t saved'} – try again in a minute`
    }
  } else {
    const hit = localLocks.get(key)
    holder = hit && hit.until > Date.now() ? hit.holder : null
  }
  if (!holder) return null
  return `an approval of this issue (${holder.approver || 'someone'}) is running or has just scheduled it, so ${what === 'delete' ? 'deleting the draft waits' : 'card edits wait'} – for up to 15 minutes, or until its send is canceled`
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
  /** How many contacts it should reach, as counted at approval: the wave's
   *  count, or the list's active contacts. */
  expected: number | null
  /** ISO timestamp. */
  approvedAt: string
  approver: string
  /** The reason typed to send a held wave anyway; absent otherwise. Not part
   *  of the wave contract, so readers may ignore it. */
  override?: string
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

/** Another approval of this issue for this list (the whole list or any
 *  wave) holds the lock: still running, or finished less than 15 minutes
 *  ago. The message names the holder's wave when it's known, else the
 *  refused one's. */
export class ApprovalLockedError extends Error {
  readonly detail: string
  readonly holder: LockHolder | null
  constructor(
    issue: string,
    holder: LockHolder | null,
    wave: number | null = null
  ) {
    const theirs = holder && holder.wave !== undefined ? holder.wave : wave
    const what = theirs == null ? `“${issue}”` : `wave ${theirs} of “${issue}”`
    const detail = `Another approval of ${what} for this list ${
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

/** The wave is held — the gap after the previous wave hasn't passed, or the
 *  send watcher flagged that wave red — and no reason (or too short a one)
 *  was typed to send it anyway. Nothing was sent. */
export class NeedsOverrideError extends Error {
  readonly holds: string[]
  constructor(holds: string[]) {
    super(`this wave is held: ${holds.join('; ')}`)
    this.holds = holds
  }
}

/** What the owner's notice says about an approval. */
export interface ApprovalFacts {
  /** The sending campaign's name ("… · wave 2/4" for a wave). */
  name: string
  listId: string
  listName: string | null
  wave: number | null
  waves: number | null
  /** Who it goes to: the wave's count, or the list's active contacts. */
  expected: number | null
  approver: string
  /** When it was asked to go out (ISO). */
  sendAt: string
  /** The reason typed to send a held wave anyway. */
  override: string | null
}

/** Something went wrong at or after `campaign_create`: ActiveCampaign may
 *  have scheduled the send even though the answer said otherwise (or never
 *  came). The lock stays, and the page says not to press again. */
export class MaybeScheduledError extends Error {
  readonly detail: string
  readonly campaignId: string | null
  /** For the owner's notice (null when it failed before the facts). */
  readonly facts: ApprovalFacts | null
  constructor(
    detail: string,
    campaignId: string | null,
    facts: ApprovalFacts | null = null
  ) {
    super(detail)
    this.detail = detail
    this.campaignId = campaignId
    this.facts = facts
  }
}

/** ActiveCampaign made the send wrongly, and the new campaign was deleted
 *  at once: nothing goes out. */
export class SendDeletedError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

/** …because its link tracker came back on. */
export class LinkTrackingError extends SendDeletedError {}

/** …because it didn't keep the wave: it would have gone to the whole list. */
export class WaveDroppedError extends SendDeletedError {}

/** …because the new wave couldn't be read back to check it (ActiveCampaign
 *  failing to answer, not misbehaving): it's gone, so the approval's lock
 *  goes too and the wave can be approved again at once. */
export class ReadBackDeletedError extends SendDeletedError {}

export interface ScheduledSend extends ApprovalFacts {
  /** The new, sending campaign. */
  campaignId: string
  /** ActiveCampaign is holding the send for its compliance review ("Pending
   *  Approval"); it goes out once they approve it. */
  held: boolean
  draftId: string
  sdate: string | null
  activeContacts: number | null
  segmentId: string | null
  /** The draft stays for the next wave (it goes after the last one). */
  draftKept: boolean
  /** ActiveCampaign started sending at once instead of at `sdate` (it read
   *  the time as past): too late to cancel, only pause or stop. */
  sendingNow: boolean
  /** Things that went wrong after the send was safely scheduled. */
  notes: string[]
}

/** One wave of the list, as the page listed it. */
export interface WaveChoice {
  /** The wave's saved segment (segmentsV2 id). */
  segmentId: string
  wave: number
  waves: number
}

export interface ApproveOptions {
  /** The signed-in approver's name: logged, returned and recorded. */
  approver: string
  /** Ids of the warnings ticked in the confirm dialog. */
  confirmed?: string[]
  /** Send one wave instead of the whole list. */
  wave?: WaveChoice | null
  /** Typed in the dialog to send a held wave anyway; logged and recorded. */
  override?: string | null
}

function isWaveChoice(w: WaveChoice): boolean {
  return (
    Number.isInteger(w.wave) &&
    Number.isInteger(w.waves) &&
    w.waves >= 2 &&
    w.waves <= 9 &&
    w.wave >= 1 &&
    w.wave <= w.waves &&
    typeof w.segmentId === 'string' &&
    SEGMENT_ID_RE.test(w.segmentId)
  )
}

/** The chosen wave as ActiveCampaign has it now, with all the list's waves;
 *  refuses when they changed since the page showed them. */
function chosenWave(
  segments: WaveSegment[] | { error: string } | null,
  wave: WaveChoice
): WaveSegment[] {
  if (segments == null)
    throw new DraftProblemError([
      'this list has no wave segments in ActiveCampaign any more – reload the page',
    ])
  if ('error' in segments) throw new DraftProblemError([segments.error])
  const s = segments.find(x => x.wave === wave.wave)
  if (
    !s ||
    segments.length !== wave.waves ||
    s.segmentId.toLowerCase() !== wave.segmentId.toLowerCase()
  )
    throw new DraftProblemError([
      'the waves in ActiveCampaign changed since the page loaded – reload it and choose the wave again',
    ])
  return segments
}

/** Pure: two reads of one message carry the same email: everything the
 *  checks look at and a reader gets. */
function sameEmail(a: RawMessage, b: RawMessage): boolean {
  return (
    (a.html ?? '') === (b.html ?? '') &&
    (a.text ?? '') === (b.text ?? '') &&
    a.subject === b.subject &&
    a.fromemail === b.fromemail &&
    a.fromname === b.fromname &&
    (a.reply2 ?? '') === (b.reply2 ?? '')
  )
}

/** Verify the draft one last time, then schedule it — to the whole list, or
 *  to one wave (`opts.wave`) — to send a few minutes later
 *  (sendDelayMinutes). Refuses (DraftProblemError) on any verification
 *  problem or block, a wave out of order or already sent,
 *  NeedsConfirmationError for unticked warnings, NeedsOverrideError for a
 *  held wave without a typed reason, ApprovalLockedError while another
 *  approval of the issue (whole list or any wave) holds the lock. Any error
 *  once the create has been asked for is a MaybeScheduledError (or a
 *  SendDeletedError, when the new campaign was deleted again). The draft is
 *  kept after every wave but the last. */
export async function approveAndSend(
  draftId: string,
  listId: string,
  opts: ApproveOptions
): Promise<ScheduledSend> {
  const approver = opts.approver.trim() || 'an unnamed approver'
  const refusal = listRefusal(listId)
  if (refusal) throw new DraftProblemError([refusal])
  const wave = opts.wave ?? null
  if (wave && !isWaveChoice(wave))
    throw new DraftProblemError([
      'that isn’t one of the list’s waves – reload the page',
    ])
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
  const sendName = wave
    ? waveCampaignName(baseName, wave.wave, wave.waves)
    : campaign.name
  const lockKey = approveLockKey(listId, baseName)
  const claim = await claimApproveLock(
    lockKey,
    {
      draftId,
      approver,
      at: new Date().toISOString(),
      wave: wave?.wave ?? null,
    },
    listId
  )
  if (!claim.ok)
    throw new ApprovalLockedError(baseName, claim.holder, wave?.wave ?? null)

  let createAsked = false
  try {
    // The email itself, how many it would reach, and the wave as
    // ActiveCampaign has it now (not as the page showed it).
    const [checks, active, segments, names] = await Promise.all([
      sendChecks({ name: campaign.name, listId }, msg, [], new Date()),
      activeContactCount(listId),
      wave ? readWaveSegments(listId, { fresh: true }) : null,
      listNames().catch(() => new Map<string, string>()),
    ])
    if (checks.blocks.length > 0) throw new DraftProblemError(checks.blocks)
    const warmup = warmupRefusal(listId, active, wave?.wave ?? null)
    if (warmup) throw new DraftProblemError([warmup])
    let expected = active
    if (wave) {
      const waves = chosenWave(segments, wave)
      expected = (await waveCounts(listId, waves, active, { fresh: true }))[
        wave.wave - 1
      ]
      if (expected == null)
        throw new DraftProblemError([
          `wave ${wave.wave} couldn’t be counted just now – try again in a minute`,
        ])
    }
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
    const offset = await accountUtcOffset(campaigns)
    const otherDrafts = campaigns.filter(
      c => c.status === '0' && c.id !== draftId && issueOrder(c.name) != null
    )
    const [live, otherLists] = await Promise.all([
      sentOnList(campaigns, draftId, campaign.name, listId, null),
      mapLimit(otherDrafts, 3, c => campaignListIds(c.id)),
    ])
    // Already sent: to the whole list, or (for a wave) this same wave. A
    // whole-list send is refused once any wave of the issue went, and every
    // wave once the whole list got it.
    const sent = live.filter(c => {
      const w = waveOf(c.name)
      return wave == null || w == null || w.wave === wave.wave
    })
    if (sent.length > 0) {
      throw new DraftProblemError(
        sent.map(c => {
          const w = waveOf(c.name)
          return `${w ? `wave ${w.wave} of this issue` : 'this issue'} already went to this list as campaign ${c.id} (${statusLabel(c.status)}) – approving it again would send it twice`
        })
      )
    }
    // Waves go in order, each once the one before has finished and the gap
    // has passed (or with a typed reason).
    let override: string | null = null
    if (wave) {
      const health = await readHealth(
        live.filter(c => waveOf(c.name)).map(c => c.id)
      )
      const p = waveProgress(wave.waves, live, health, offset)
      if (p.blocked) throw new DraftProblemError([p.blocked])
      if (p.wait) throw new DraftProblemError([p.wait])
      if (p.next !== wave.wave)
        throw new DraftProblemError([
          p.next == null
            ? 'every wave of this issue has gone out'
            : `waves go in order: wave ${p.next} is next, not wave ${wave.wave}`,
        ])
      const holds = holdsAt(p, new Date())
      if (holds.length > 0) {
        const reason = (opts.override ?? '').replace(/\s+/g, ' ').trim()
        if (reason.length < OVERRIDE_MIN_CHARS)
          throw new NeedsOverrideError(holds)
        override = reason.slice(0, 500)
        console.warn(
          `[newsletter] ${approver} is sending wave ${wave.wave}/${wave.waves} of “${baseName}” on list ${listId} although ${holds.join('; ')}. Reason given: ${override}`
        )
      }
    }
    const older = olderIssueBlocks(
      campaign.name,
      otherDrafts.filter((_, i) => otherLists[i].includes(listId))
    )
    if (older.length > 0) throw new DraftProblemError(older)

    // The email as it stands now, last of all: the send is made from the
    // message as it is at the create, and a card edit from another tab (or a
    // rebuild) may have landed since the checks and ticks above were made on
    // it. (Edits also wait while this approval holds the lock; this catches
    // one that was already on its way.)
    if (!sameEmail(await message(messageId), msg))
      throw new DraftProblemError([
        'the email changed while it was being approved (a card edit in another tab, or a rebuild) – look at it again, then approve',
      ])

    const sendAt = new Date(Date.now() + sendDelayMinutes(listId) * 60_000)
    // From here on the send may exist even when an answer says it doesn't:
    // the lock stays, and every error tells the approver not to press again.
    createAsked = true
    return await createAndConfirm({
      draftId,
      listId,
      messageId,
      baseName,
      sdate: formatLocal(sendAt, offset),
      active,
      wave,
      facts: {
        name: sendName,
        listId,
        listName: names.get(listId) ?? null,
        wave: wave?.wave ?? null,
        waves: wave?.waves ?? null,
        expected,
        approver,
        sendAt: sendAt.toISOString(),
        override,
      },
    })
  } catch (err) {
    // Nothing exists: refused before the create, or the new campaign is
    // known to be deleted again after a read back that failed.
    if (!createAsked || err instanceof ReadBackDeletedError) {
      await releaseApproveLock(lockKey).catch(e =>
        console.error(
          `[newsletter] releasing the approval lock for draft ${draftId} failed: ${e instanceof Error ? e.message : String(e)}`
        )
      )
    }
    throw err
  } finally {
    if (createAsked) forgetSharedCampaigns([draftId])
  }
}

/** The create and everything after it. Every failure here is a
 *  MaybeScheduledError unless the new campaign is known to be gone. */
async function createAndConfirm(a: {
  draftId: string
  listId: string
  messageId: string
  baseName: string
  sdate: string
  active: number | null
  wave: WaveChoice | null
  facts: ApprovalFacts
}): Promise<ScheduledSend> {
  const { facts } = a
  let newId: string | null = null
  try {
    const created = await v1answer('campaign_create', {
      type: 'single',
      name: facts.name,
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
      // A wave: the saved segment's id. AC keeps it as a hidden numeric
      // segment row that points at it (test sweep, 29 Sept 2026); read back
      // below, since without it the send would reach the whole list.
      ...(a.wave ? { segmentid: a.wave.segmentId } : {}),
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
    let live: RawCampaign
    try {
      const read = (await v3<{ campaign?: RawCampaign }>(`campaigns/${newId}`))
        .campaign
      if (!read) throw new Error('no campaign in the answer')
      live = read
    } catch (err) {
      // Unread, nobody knows whether ActiveCampaign kept the wave: a wave is
      // never left to go out, maybe to the whole list, unchecked.
      if (a.wave) {
        console.error(
          `[newsletter] reading back campaign ${newId} failed: ${err instanceof Error ? err.message : String(err)}`
        )
        await deleteBadSend(newId, 'unread', 'it couldn’t be read back', facts)
      }
      throw err
    }

    // Read back what AC stored, inside the minutes before it goes out: its
    // click tracker must be off (readers' clicks would go through the one
    // that dropped half the connections), and a wave must still be one.
    if (
      live.tracklinks !== 'none' ||
      String(live.tracklinksanalytics ?? '') !== '0'
    ) {
      await deleteBadSend(
        newId,
        'tracking',
        `link tracking came back as ${String(live.tracklinks)}/${String(live.tracklinksanalytics)}`,
        facts
      )
    }
    if (a.wave) {
      const wrong = await segmentProblem(live.segmentid, a.wave.segmentId)
      if (wrong) await deleteBadSend(newId, 'wave', wrong, facts)
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
    // The message now belongs to the sending campaign. After a whole-list
    // send or the last wave the draft shell is noise (and harmless if it
    // stays: the page shows it as already sent); before the last wave it is
    // what the next wave is approved from.
    const lastWave = a.wave == null || a.wave.wave === a.wave.waves
    if (lastWave) {
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
    }
    // Clicks on a test copy of this issue count from its first send on
    // (newsletter-clicks.ts); a later wave doesn't move that time.
    try {
      await noteSendTime(a.baseName, Date.parse(facts.sendAt))
    } catch (err) {
      console.error(
        `[newsletter] recording the send time of campaign ${newId} failed: ${err instanceof Error ? err.message : String(err)}`
      )
      notes.push(
        'The send time couldn’t be recorded, so if a test copy of this issue was sent, readers’ clicks may not be counted for up to 30 days.'
      )
    }
    if (isRealList(a.listId)) {
      try {
        await recordApproval({
          campaignId: newId,
          listId: a.listId,
          name: facts.name,
          baseName: a.baseName,
          wave: facts.wave,
          waves: facts.waves,
          segmentId: a.wave?.segmentId ?? null,
          expected: facts.expected,
          approvedAt: new Date().toISOString(),
          approver: facts.approver,
          ...(facts.override ? { override: facts.override } : {}),
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
    console.info(
      `[newsletter] draft ${a.draftId} approved by ${facts.approver} → campaign ${newId} “${facts.name}” (${facts.expected ?? '?'} contacts) ${held ? 'held for ActiveCampaign review' : 'scheduled'} for ${live.sdate ?? a.sdate} on list ${a.listId}${lastWave ? '' : '; draft kept for the next wave'}`
    )
    return {
      ...facts,
      campaignId: newId,
      held,
      draftId: a.draftId,
      sdate: live.sdate ?? a.sdate,
      activeContacts: a.active,
      segmentId: a.wave?.segmentId ?? null,
      draftKept: !lastWave,
      sendingNow: live.status === '2',
      notes,
    }
  } catch (err) {
    if (err instanceof MaybeScheduledError || err instanceof SendDeletedError)
      throw err
    const reason = err instanceof Error ? err.message : String(err)
    console.error(
      `[newsletter] approval of draft ${a.draftId} by ${facts.approver} failed after campaign_create${newId ? ` (campaign ${newId})` : ''}: ${reason}`
    )
    throw new MaybeScheduledError(
      `It may have been scheduled anyway${newId ? ` (campaign ${newId})` : ''}: something went wrong after ActiveCampaign was asked to schedule it. Don’t press Approve again – check Recent sends, which updates by itself.`,
      newId,
      facts
    )
  }
}

/** Why the campaign AC stored isn't the wave that was asked for, or null.
 *  AC answers with the id of the hidden segment row it made for the saved
 *  segment; that row names the saved segment in `segmentid_v2`. A missing
 *  or zero segmentid means the whole list. */
async function segmentProblem(
  stored: string | null | undefined,
  wanted: string
): Promise<string | null> {
  const s = String(stored ?? '').trim()
  if (s === '' || s === '0') return 'it came back with no segment'
  if (s.toLowerCase() === wanted.toLowerCase()) return null
  if (!/^\d{1,12}$/.test(s))
    return `it came back with segment ${s.slice(0, 40)}`
  try {
    const row = await v3<{ segment?: { segmentid_v2?: string | null } }>(
      `segments/${acId(s)}`
    )
    const v2 = String(row.segment?.segmentid_v2 ?? '')
    return v2.toLowerCase() === wanted.toLowerCase()
      ? null
      : `its segment ${s} points at ${v2 || 'nothing'}, not the wave`
  } catch (err) {
    return `its segment ${s} couldn’t be checked (${err instanceof Error ? err.message.slice(0, 120) : String(err)})`
  }
}

/** Delete a send that came back wrong (or, for a wave, couldn't be read
 *  back at all: 'unread'), inside the minutes before it goes out. Throws a
 *  SendDeletedError when it is gone, and a MaybeScheduledError when it
 *  couldn't be deleted. */
async function deleteBadSend(
  campaignId: string,
  kind: 'tracking' | 'wave' | 'unread',
  why: string,
  facts: ApprovalFacts
): Promise<never> {
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
      kind === 'unread'
        ? `ActiveCampaign created campaign ${campaignId} for wave ${facts.wave}, but ${why}, so nobody knows whether it kept the wave, and it couldn’t be deleted either. Cancel it under Recent sends (or delete it in ActiveCampaign: Campaigns → ${campaignId}) before it sends, then approve the wave again.`
        : `ActiveCampaign created campaign ${campaignId} wrongly (${kind === 'wave' ? `the wave: ${why}, so it would go to the whole list` : why}), and it couldn’t be deleted. Delete it in ActiveCampaign now (Campaigns → ${campaignId}), before it sends.`,
      campaignId,
      facts
    )
  }
  if (kind === 'unread')
    throw new ReadBackDeletedError(
      `ActiveCampaign created campaign ${campaignId} for wave ${facts.wave}, but it couldn’t be read back to check it kept the wave, so it was deleted at once. Nothing was sent, and the draft is still here: approve the wave again in a minute.`
    )
  if (kind === 'tracking')
    throw new LinkTrackingError(
      `ActiveCampaign turned its link tracking on for the new campaign ${campaignId}, so it was deleted at once. Nothing was sent. Tell Claude before trying again.`
    )
  throw new WaveDroppedError(
    `ActiveCampaign didn’t keep the wave on the new campaign ${campaignId} (${why}), so it would have gone to the whole list. It was deleted at once: nothing was sent, and the draft is still here. Tell Claude before trying again.`
  )
}

/* ─── The owner hears when a real-list approval may have gone out ─────── */

/** Where the notice sends the owner (real lists are only ever approved on
 *  the production site). */
const ADMIN_PAGE_URL = 'https://aisafety.com/admin/newsletter'

/** Email the owner about a real-list approval, or one that may have gone
 *  out despite an error (`maybe`). The route sends only the `maybe` kind
 *  since 2 Oct 2026 (Bryce: no email for an ordinary approval). The admin
 *  mail script only ever delivers "digest" mail to the owner's own address.
 *  Best effort and never throws: the route runs it after answering, so the
 *  approval never waits on it. */
export async function notifyApproval(
  f: ApprovalFacts & { campaignId: string | null; held?: boolean },
  maybe = false
): Promise<boolean> {
  if (!isRealList(f.listId)) return false
  const mail = newsletterApprovalMail({
    ...f,
    held: f.held ?? false,
    maybe,
    adminUrl: ADMIN_PAGE_URL,
  })
  let sent = false
  for (const owner of ROOT_ADMINS) {
    if (await sendAdminMail('digest', owner.email, mail)) sent = true
  }
  return sent
}

/* ─── Stop: cancel, pause, stop, resume ───────────────────────────────────
   From Recent sends, by an approver with a fresh session (the route checks
   both). ActiveCampaign allows: a scheduled (1) or held (7) campaign can
   only be deleted; pause only while sending (2); stop from sending or
   paused (2/3), for good; resume only from paused (3). Its answers are 200
   with `succeeded` 0/1, so every action is read back. */

const STOP_LOCK_PREFIX = 'aisafety:newsletter:stop-lock:'
/** One action per campaign at a time: a double press gets a clear "wait". */
const STOP_LOCK_SECONDS = 60
const localStopLocks = new Map<string, number>()

/** The action doesn't fit the campaign as it is now (it already finished,
 *  was canceled, isn't a newsletter send…). Nothing was changed. */
export class StopRefusedError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

/** Another press on the same campaign is still being carried out. */
export class StopLockedError extends Error {
  readonly detail: string
  constructor(campaignId: string) {
    const detail = `Another stop or pause of campaign ${campaignId} is being carried out right now. Wait for Recent sends to update (it does by itself) before pressing again.`
    super(detail)
    this.detail = detail
  }
}

/** ActiveCampaign was asked, and either refused or the result can't be
 *  confirmed. `uncertain` = no clear answer came back: it may have worked. */
export class StopFailedError extends Error {
  readonly detail: string
  readonly uncertain: boolean
  constructor(detail: string, uncertain: boolean) {
    super(detail)
    this.detail = detail
    this.uncertain = uncertain
  }
}

export interface StopResult {
  campaignId: string
  name: string
  action: StopAction
  /** Its status now ('deleted' once canceled). */
  status: string
  by: string
  /** After a cancel: whether the draft is still there to approve it (or its
   *  wave) again; null if that couldn't be read. */
  draftWaiting: boolean | null
}

const ACTION_WORDS: Record<StopAction, { done: string; want: string[] }> = {
  cancel: { done: 'canceled', want: [] },
  pause: { done: 'paused', want: ['3'] },
  stop: { done: 'stopped', want: ['4'] },
  resume: { done: 'resumed', want: ['2', '1', '5'] },
}

/** SET NX on Upstash when it's there; this process otherwise. A stop never
 *  waits on Upstash: if it fails, the in-process lock is used instead. */
async function claimStopLock(key: string): Promise<boolean> {
  const redis = kv()
  if (redis) {
    try {
      return (
        (await redis.set(key, new Date().toISOString(), {
          nx: true,
          ex: STOP_LOCK_SECONDS,
        })) === 'OK'
      )
    } catch (err) {
      console.warn(
        `[newsletter] the stop lock couldn’t use Upstash (${err instanceof Error ? err.message : String(err)}); locking in this process only`
      )
    }
  }
  const now = Date.now()
  const until = localStopLocks.get(key)
  if (until != null && until > now) return false
  localStopLocks.set(key, now + STOP_LOCK_SECONDS * 1000)
  return true
}

async function releaseStopLock(key: string): Promise<void> {
  localStopLocks.delete(key)
  const redis = kv()
  if (redis)
    await redis
      .del(key)
      .catch(err =>
        console.warn(
          `[newsletter] releasing the stop lock failed: ${err instanceof Error ? err.message : String(err)}`
        )
      )
}

/** Cancel, pause, stop or resume one send, after checking it is a
 *  newsletter send in a state that allows it (stopActionsFor). Resuming a
 *  real list's send is for production only, like approving; the others work
 *  from any copy, since they only ever send less. */
export async function stopSend(
  campaignId: string,
  action: StopAction,
  opts: { by: string }
): Promise<StopResult> {
  const id = acId(campaignId)
  const by = opts.by.trim() || 'an unnamed approver'
  const lockKey = `${STOP_LOCK_PREFIX}${id}`
  if (!(await claimStopLock(lockKey))) throw new StopLockedError(id)
  try {
    const gone = (err: Error) => {
      if (/: 404 /.test(err.message)) return null
      throw err
    }
    const readCampaign = () =>
      v3<{ campaign?: RawCampaign }>(`campaigns/${id}`)
        .then(d => d.campaign ?? null)
        .catch(gone)
    const [before, listIds] = await Promise.all([
      readCampaign(),
      campaignListIds(id).catch(gone),
    ])
    if (!before || !listIds)
      throw new StopRefusedError(
        `Campaign ${id} isn’t in ActiveCampaign any more – it may have been canceled already.`
      )
    const allowed = stopActionsFor(before.status, listIds)
    if (!allowed.includes(action)) {
      throw new StopRefusedError(
        allowed.length === 0
          ? `Campaign ${id} can’t be ${ACTION_WORDS[action].done} from here: it is ${statusLabel(before.status)}${listIds.length === 1 && STOPPABLE_LISTS.has(listIds[0]) ? '' : ' and not a newsletter send'}.`
          : `Campaign ${id} is ${statusLabel(before.status)} now, so it can only be ${allowed.map(a => ACTION_WORDS[a].done).join(' or ')} – Recent sends will show the change in a moment.`
      )
    }
    if (action === 'resume') {
      const refusal = listRefusal(listIds[0])
      if (refusal) throw new StopRefusedError(refusal)
    }

    // The call. No answer means it may or may not have happened.
    let ok: boolean
    try {
      if (action === 'cancel') {
        ok = Number((await v3delete(`campaigns/${id}/delete`)).succeeded) === 1
        if (!ok) {
          // v1's delete is the other route to the same thing — but only for
          // a send that still hasn't started: AC may have refused because
          // its scheduler got there first, and then Pause is the way.
          const now = await readCampaign()
          if (now && (now.status === '1' || now.status === '7'))
            ok =
              Number(
                (await v1answer('campaign_delete', { id })).result_code
              ) === 1
        }
      } else {
        const answer = await v3put<Record<string, unknown>>(
          `campaigns/${id}/${action}`,
          {}
        )
        ok = Number(answer.succeeded) === 1
      }
    } catch (err) {
      console.error(
        `[newsletter] ${action} of campaign ${id} by ${by}: no clear answer: ${err instanceof Error ? err.message : String(err)}`
      )
      throw new StopFailedError(
        `No clear answer from ActiveCampaign, so campaign ${id} may or may not have been ${ACTION_WORDS[action].done}. Recent sends updates by itself; if it is still going, press again or do it in ActiveCampaign (Campaigns → ${id}).`,
        true
      )
    }

    // What ActiveCampaign has now.
    let after: RawCampaign | null
    try {
      after = await readCampaign()
    } catch (err) {
      console.error(
        `[newsletter] reading campaign ${id} after ${action} failed: ${err instanceof Error ? err.message : String(err)}`
      )
      throw new StopFailedError(
        `ActiveCampaign ${ok ? 'accepted' : 'refused'} the ${action}, but campaign ${id} couldn’t be read back. Recent sends updates by itself: check it there.`,
        true
      )
    }
    const done =
      action === 'cancel'
        ? after == null
        : after != null && ACTION_WORDS[action].want.includes(after.status)
    console.info(
      `[newsletter] campaign ${id} “${before.name}” ${action} by ${by}: ${statusLabel(before.status)} → ${after ? statusLabel(after.status) : 'deleted'}${done ? '' : ' (NOT done)'}`
    )
    if (!done) {
      throw new StopFailedError(
        after == null
          ? `Campaign ${id} is gone from ActiveCampaign, so it can’t be ${ACTION_WORDS[action].done}.`
          : `ActiveCampaign didn’t ${action} campaign ${id}: it is ${statusLabel(after.status)} now.${
              action === 'cancel' && after.status === '2'
                ? ' It started sending first – press Pause, then Stop.'
                : ' Try the button Recent sends shows now, or do it in ActiveCampaign.'
            }`,
        false
      )
    }

    // A canceled send reached nobody: its approval may be pressed again
    // straight away (the issue's lock would otherwise hold for 15 minutes).
    let draftWaiting: boolean | null = null
    if (action === 'cancel') {
      const baseName = baseIssueName(before.name)
      await releaseApproveLock(approveLockKey(listIds[0], baseName)).catch(
        err =>
          console.warn(
            `[newsletter] releasing the approval lock after canceling ${id} failed: ${err instanceof Error ? err.message : String(err)}`
          )
      )
      draftWaiting = await draftStillWaiting(baseName, listIds[0])
    }
    return {
      campaignId: id,
      name: before.name,
      action,
      status: after ? statusLabel(after.status) : 'deleted',
      by,
      draftWaiting,
    }
  } finally {
    forgetSharedCampaigns([id])
    await releaseStopLock(lockKey)
  }
}

/** Is a draft of this issue still waiting on the list? Null if unreadable. */
async function draftStillWaiting(
  baseName: string,
  listId: string
): Promise<boolean | null> {
  try {
    const drafts = (await allCampaigns({ fresh: true })).filter(
      c => c.status === '0' && baseIssueName(c.name) === baseName
    )
    const lists = await mapLimit(drafts, 3, c => campaignListIds(c.id))
    return lists.some(l => l.length === 1 && l[0] === listId)
  } catch (err) {
    console.warn(
      `[newsletter] checking for the draft after a cancel failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}
