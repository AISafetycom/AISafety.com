/*
  Send watcher for the newsletters (29 September 2026, build item S8 in
  ~/Newsletter/TEST_SWEEP_2026-09-29.md). A Vercel cron
  (GET /api/admin/newsletter/watch, every 10 minutes, see vercel.json) reads
  ActiveCampaign and emails the owner once per problem it finds, so a held,
  stuck or unexpected send is noticed while the Mac is asleep. The same
  problems show as a red banner on /admin/newsletter (NewsletterAlerts.tsx,
  via GET /api/admin/newsletter/alerts).

  It reads ActiveCampaign (v3 GETs and two v1 read actions, `V1_READS`) and,
  since approve once (8 October 2026), makes two kinds of write, both
  through newsletter.ts and nothing else:
  - it cancels (deletes) a wave that is still scheduled (status 1) when it
    must not go out: a wave before it came back red after it was approved,
    or it starts within FAIL_CLOSED_MINUTES and the wave before it has no
    verdict (none yet, it hasn't finished, or ActiveCampaign doesn't say when
    it did) — unless its approval carries a typed reason to send it anyway.
    Every later wave of the issue still scheduled goes with it. Same delete
    and stop lock as the page's Cancel (cancelScheduledWave). A wave that has
    started (status 2 or later) or is held for review (7) is never touched:
    the alert says to pause or cancel it on the page;
  - it deletes an issue's pipeline draft once every wave of it has been sent
    (deleteFinishedIssueDraft): the waves kept it for re-approval.
  It never pauses or stops a send. Outside production a run is dry: it
  reports what it would cancel and changes nothing.

  Each run looks at campaigns on the real lists (6 Events, 7 Training,
  8 Funding) and raises an alert when one:
  - is held for ActiveCampaign's review (status 7) for more than 20 minutes;
  - is paused (3), stopped (4) or disabled (6);
  - is still scheduled (1) 20 minutes after its send time;
  - has been sending (2) for more than 3 hours;
  - has a status this code doesn't know;
  - is scheduled, sending, sent or held, was created in the last 24 hours and
    has no approval record — it didn't come through the approval page;
  - has no wave (segmentid 0) during the warm-up while its list has more than
    MAX_UNSEGMENTED_SEND active subscribers;
  - reached clearly more people than the approval expected (the wave wasn't
    kept to — nobody has yet proven ActiveCampaign honours a segment set
    through the v1 API at send time);
  - is a pipeline draft on 6 or 7 older than 30 hours that isn't part of a
    wave sequence still going out.
  And for the account: ActiveCampaign's API failing for more than an hour,
  account_view's subscriber_limit or status changing, and the contact count
  within 50 of the limit (at 5,000 ActiveCampaign stops EVERY campaign).

  Once per sent issue or wave on 6/7, 18 hours after it finished: a health
  check (bounces, unsubscribes, spam complaints, verified opens) with a
  green/amber/red verdict, emailed and stored for the page. A red one cancels
  the waves of that issue still scheduled (above); amber cancels nothing.

  Upstash keys (the site's analytics database; no expiry on any of them):
    aisafety:newsletter:watch:state    { lastRunAt, campaigns, api, account }
    aisafety:newsletter:watch:alerts   { updatedAt, alerts: { <id>: WatchAlert } }
    aisafety:newsletter:watch:canceled { events: { <id>: CancelEvent } }, the
                                       waves it canceled or tried to (3 days)
    aisafety:newsletter:watch:lock     one run at a time (expires by itself)
    aisafety:newsletter:health:<id>    HealthRecord, written once per campaign
  and it reads what the approval step writes on every real-list approval:
    aisafety:newsletter:approved:<id>  ApprovedRecord (see the wave contract)

  "Once per problem": every alert has an id (what it is about) and a
  signature (its state). An email goes out when an id first appears or its
  signature changes; a problem that clears is dropped, so it alerts again if
  it comes back. When a part of the ActiveCampaign read fails, that part's
  open alerts are carried over unchanged rather than cleared.
*/

import { timingSafeEqual } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { longDate, type Mail, sendAdminMail } from '@/lib/admin/mail'
import {
  type CallLimits,
  cancelScheduledWave,
  deleteFinishedIssueDraft,
  type WatcherCancel,
} from '@/lib/admin/newsletter'
import { ROOT_ADMINS } from '@/lib/admin/users'
import {
  FAIL_CLOSED_MINUTES,
  HEALTH_CHECK_LISTS,
  MAX_UNSEGMENTED_SEND,
  NEWSLETTER_WARMUP,
} from '@/lib/admin/newsletter-warmup'

// ─── The rules' numbers ─────────────────────────────────────────────────────

/** Warm-up switch (wave contract), shared with the approval step. */
export { MAX_UNSEGMENTED_SEND, NEWSLETTER_WARMUP }

/** Lists real subscribers are on. */
const REAL_LISTS = ['6', '7', '8']
/** Lists whose sends get the 18-hour health check and whose drafts must not
 *  sit around (the lists the ~2,889 imported readers are on). Their waves
 *  are the ones canceled after a red or missing verdict. */
const ISSUE_LISTS: readonly string[] = HEALTH_CHECK_LISTS
const LIST_LABELS: Record<string, string> = {
  '6': 'Events',
  '7': 'Training',
  '8': 'Funding',
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const HELD_AFTER = 20 * MINUTE
const LATE_AFTER = 20 * MINUTE
const SENDING_TOO_LONG = 3 * HOUR
/** Campaigns created this long ago or less must have an approval record. */
const UNAPPROVED_WINDOW = DAY
/** The approval writes its record right after campaign_create; a run that
 *  lands in between must not call that campaign unapproved. */
const UNAPPROVED_GRACE = 3 * MINUTE
const DRAFT_STALE_AFTER = 30 * HOUR
/** All waves of an issue go out within about five days; a draft kept for
 *  the next wave isn't "left over" until then. */
const WAVE_SEQUENCE_WINDOW = 5 * DAY
const API_DOWN_AFTER = HOUR
/** Alerts about something that has already happened (stopped, disabled, an
 *  account change, an amber or red health check) stay up this long. */
const EVENT_ALERT_FOR = 3 * DAY
/** Sent campaigns older than this are no longer looked at. */
const RECENT = 7 * DAY
/** Contacts short of the plan's limit at which the cap alert fires. */
const CAP_MARGIN = 50
const DEFAULT_CONTACT_LIMIT = 5000
/** "More people than expected": over expected × 1.2 + 10. */
const OVERSEND_FACTOR = 1.2
const OVERSEND_SLACK = 10

const HEALTH_AFTER = 18 * HOUR
/** Below this many recipients (the rehearsals to three test addresses) the
 *  verdict is stored but not emailed: one bounce would read as 33%. */
const HEALTH_MIN_SAMPLE = 50
const HEALTH_EMAIL_RETRY_FOR = DAY

/** The banner calls the watcher itself stale after this long without a run
 *  (it runs every 10 minutes). */
const STALE_AFTER = 30 * MINUTE

/** At most this many separate emails per run; more become one summary. */
const MAX_SEPARATE_EMAILS = 3
/** Hard ceilings on emails tried (sent or not), whatever state things are
 *  in: a flapping problem, or a mail script that times out after sending,
 *  can't fill the inbox, and the script's ~100-a-day Gmail quota stays free
 *  for the other admin mail. What's held back goes on a later run; the
 *  banner shows everything meanwhile. */
const MAX_EMAILS_PER_HOUR = 4
const MAX_EMAILS_PER_DAY = 20
/** A problem that clears and comes back in the same state within this long
 *  of last being open isn't emailed again (the banner still shows it). */
const REALERT_AFTER = 6 * HOUR
/** No new email is started this far into a run: each can take up to 20 s
 *  and the function stops at 120 s. The rest go on the next run. */
const MAIL_START_BY_MS = 95_000

const LOCK_SECONDS = 300
/** Time a run may spend reading ActiveCampaign before it stops, saves what
 *  it has and records the rest as a failure. The function allows 120 s;
 *  the rest is for canceling waves, the saves and the emails. */
const RUN_BUDGET_MS = 35_000
const REQUEST_TIMEOUT_MS = 15_000
/** No cancel (or draft delete) is started this far into a run; one takes at
 *  most five calls of WRITE_LIMITS. What's left goes on the next run, ten
 *  minutes later, still inside the hour before the wave. */
const CANCEL_START_BY_MS = 50_000
/** Limits on the calls of a cancel or draft delete. */
const WRITE_LIMITS: CallLimits = {
  readMs: 10_000,
  writeMs: 10_000,
  retry: false,
}
/** Who the logs and alerts say canceled a wave. */
const WATCHER = 'the send watcher'

/** Where the emails link to. Cron requests arrive on whatever host Vercel
 *  uses; sign-in only works on the real one. */
const PRODUCTION_ORIGIN = 'https://aisafety.com'

// ─── Upstash keys (shared with the approval step and the page) ─────────────

export const APPROVED_PREFIX = 'aisafety:newsletter:approved:'
export const HEALTH_PREFIX = 'aisafety:newsletter:health:'
export const STATE_KEY = 'aisafety:newsletter:watch:state'
export const ALERTS_KEY = 'aisafety:newsletter:watch:alerts'
export const CANCELED_KEY = 'aisafety:newsletter:watch:canceled'
export const LOCK_KEY = 'aisafety:newsletter:watch:lock'

// ─── Types ──────────────────────────────────────────────────────────────────

/** What the approval step stores for every real-list approval (wave
 *  contract). Read here, never written. */
export interface ApprovedRecord {
  campaignId: string
  listId: string
  name: string
  baseName: string
  wave: number | null
  waves: number | null
  segmentId: string | null
  /** Recipients the confirm dialog showed. */
  expected: number | null
  approvedAt: string
  approver: string
  /** The reason typed to send a held wave anyway (the first wave of an
   *  approval only): such a wave isn't canceled for a missing verdict. */
  override?: string
}

/** A wave the watcher must cancel, and why (wavesToCancel). */
export interface CancelNeed {
  campaignId: string
  /** Its name ("Events · Week 41, 2026 · wave 3/4"). */
  name: string
  /** '1' scheduled, '7' held for review (alerted, never deleted). */
  status: string
  listId: string
  baseName: string
  wave: number
  waves: number
  /** red: a wave before it came back red after it was approved; verdict: it
   *  starts within FAIL_CLOSED_MINUTES and the wave before it has no
   *  verdict. */
  cause: 'red' | 'verdict'
  /** The wave whose verdict (or lack of one) it is canceled over. */
  after: number
  /** Plain words: why ("hard bounces 3.1% (red at 2%)", "wave 2 has no
   *  18-hour check yet"). */
  why: string
  /** When it was due to start (epoch ms), if known. */
  startsAt: number | null
}

/** A wave the watcher canceled, or tried to: kept for EVENT_ALERT_FOR so
 *  the alert stays up, and so a try with no clear answer is resolved on the
 *  next run. */
export interface CancelEvent {
  campaignId: string
  name: string
  listId: string
  baseName: string
  wave: number
  waves: number
  cause: CancelNeed['cause']
  after: number
  why: string
  /** ISO, if known. */
  startsAt: string | null
  /** canceled: gone (nobody gets it); started: it started sending before the
   *  cancel; pending: not done yet (no clear answer, or refused). */
  outcome: 'canceled' | 'started' | 'pending'
  /** For a pending one: what went wrong. */
  detail?: string
  /** When the outcome was set (ISO). */
  at: string
}

interface CancelDoc {
  events: Record<string, CancelEvent>
}

export type AlertSeverity = 'red' | 'amber'

export interface WatchAlert {
  id: string
  /** The alert's state; a change sends a new email. */
  sig: string
  severity: AlertSeverity
  /** Headline, without the "Newsletter: " the email subject adds. */
  title: string
  /** Plain-English lines: what happened, then what to do. */
  detail: string[]
  campaignId: string | null
  source: 'campaigns' | 'account' | 'api' | 'health'
  /** When this signature was first raised. */
  since: string
  /** The signature last emailed (null until an email went out). */
  emailedSig: string | null
  emailedAt: string | null
}

/** What the page's banner gets. */
export interface PublicAlert {
  id: string
  severity: AlertSeverity
  title: string
  detail: string[]
  since: string
  campaignId: string | null
}

export type HealthVerdict = 'green' | 'amber' | 'red'

export interface HealthNumbers {
  sendAmt: number
  hardBounces: number
  softBounces: number
  unsubscribes: number
  spamComplaints: number
  verifiedOpens: number
}

export interface HealthRecord {
  campaignId: string
  listId: string
  name: string
  baseName: string
  wave: number | null
  waves: number | null
  verdict: HealthVerdict
  reasons: string[]
  numbers: HealthNumbers
  /** From the approval record, when there is one. */
  expected: number | null
  finishedAt: string
  checkedAt: string
  /** Too few recipients to judge: stored, not emailed. */
  smallSample: boolean
  emailedAt: string | null
}

interface CampaignState {
  /** Status when last seen, and since when (as far as the watcher knows). */
  s: string
  since: string
  /** The campaign's lists, read once. */
  lists?: string[]
  /** Carries the pipeline's content marker (drafts only). */
  pipeline?: boolean
}

interface WatchState {
  lastRunAt: string | null
  campaigns: Record<string, CampaignState>
  api: {
    failingSince: string | null
    failures: number
    lastError: string | null
  }
  account: {
    baseline: { limit: string; status: string } | null
    change: {
      at: string
      from: { limit: string; status: string }
      to: { limit: string; status: string }
    } | null
  }
}

interface AlertsDoc {
  updatedAt: string
  alerts: Record<string, WatchAlert>
  /** When each email was tried, for the hourly and daily ceilings (the
   *  last day's only). Written before the try, so a run cut off mid-send
   *  still counts it. */
  mailLog?: string[]
  /** `${id}|${sig}` → the last time that problem was open and already
   *  emailed, for REALERT_AFTER (the last REALERT_AFTER's only). */
  recent?: Record<string, string>
}

/** A raised alert before it meets the stored ones. */
type Raised = Omit<WatchAlert, 'since' | 'emailedSig' | 'emailedAt'> & {
  /** Already covered by its own email (the health check). */
  preEmailed?: boolean
}

interface RawCampaign {
  id: string
  name: string
  status: string
  segmentid?: string | null
  cdate?: string | null
  sdate?: string | null
  ldate?: string | null
  send_amt?: string | null
  total_amt?: string | null
  hardbounces?: string | null
  softbounces?: string | null
  unsubscribes?: string | null
  verified_unique_opens?: string | null
  message_id?: string | null
  type?: string | null
}

// ─── Store ──────────────────────────────────────────────────────────────────

export interface WatchStore {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  mget<T>(keys: string[]): Promise<Array<T | null>>
  /** Take the run lock (SET NX with an expiry); false when it's held. */
  lock(key: string, ttlSeconds: number): Promise<boolean>
  unlock(key: string): Promise<void>
}

/** Values written as JSON strings come back as strings from some writers;
 *  objects written directly come back parsed. Accept both. */
function parsed<T>(v: unknown): T | null {
  if (v == null) return null
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return null
    }
  }
  return v as T
}

function redisStore(db: Redis): WatchStore {
  return {
    async get<T>(key: string) {
      return parsed<T>(await db.get(key))
    },
    async set(key, value) {
      await db.set(key, value)
    },
    async mget<T>(keys: string[]) {
      if (keys.length === 0) return []
      const out = await db.mget<unknown[]>(...keys)
      return out.map(v => parsed<T>(v))
    },
    async lock(key, ttlSeconds) {
      const ok = await db.set(key, new Date().toISOString(), {
        nx: true,
        ex: ttlSeconds,
      })
      return ok === 'OK'
    },
    async unlock(key) {
      await db.del(key)
    },
  }
}

/** In-memory store: tests, and dry runs on a laptop without the Redis
 *  variables (a real run refuses it). */
export function memoryWatchStore(): WatchStore & {
  dump(): Record<string, unknown>
} {
  const m = new Map<string, string>()
  return {
    async get<T>(key: string) {
      const v = m.get(key)
      return v === undefined ? null : (JSON.parse(v) as T)
    },
    async set(key, value) {
      m.set(key, JSON.stringify(value))
    },
    async mget<T>(keys: string[]) {
      return keys.map(k => {
        const v = m.get(k)
        return v === undefined ? null : (JSON.parse(v) as T)
      })
    },
    async lock(key) {
      if (m.has(key)) return false
      m.set(key, JSON.stringify(new Date().toISOString()))
      return true
    },
    async unlock(key) {
      m.delete(key)
    },
    dump() {
      return Object.fromEntries([...m].map(([k, v]) => [k, JSON.parse(v)]))
    },
  }
}

// Same env fallback chain as the analytics store and the click counter, so
// this lands in the same database.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
let defaultStore: WatchStore | null = null

function sharedStore(): WatchStore {
  defaultStore ??=
    restUrl && restToken
      ? redisStore(new Redis({ url: restUrl, token: restToken }))
      : memoryWatchStore()
  return defaultStore
}

// ─── ActiveCampaign, read-only ──────────────────────────────────────────────
// Small copies of the helpers in newsletter.ts, kept apart so the watcher
// can only ever read: v3 GETs, and the v1 actions listed here.

const V1_READS = [
  'account_view',
  'campaign_report_unsubscription_totals',
] as const
type V1Read = (typeof V1_READS)[number]

// Same set as newsletter.ts: 511 is Cloudflare's empty reply to a burst.
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504, 511])

function acBase(): string {
  return (process.env.ACTIVECAMPAIGN_URL ?? '').replace(/\/+$/, '')
}

function acKey(): string {
  return process.env.ACTIVECAMPAIGN_KEY ?? ''
}

export function isWatchConfigured(): boolean {
  return Boolean(acBase() && acKey())
}

/** Never let the key reach a log line, an email or a response. */
function scrub(message: string): string {
  const key = acKey()
  return (key ? message.split(key).join('***') : message).slice(0, 300)
}

function errorText(err: unknown): string {
  return scrub(err instanceof Error ? err.message : String(err))
}

interface AcReader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  v3<T = any>(path: string): Promise<T>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  v1<T = any>(action: V1Read, params?: Record<string, string>): Promise<T>
}

function acReader(deadline: number, retryDelayMs: number): AcReader {
  const root = `${acBase()}/api/3/`

  function timeLeft(what: string): number {
    const left = deadline - Date.now()
    if (left <= 0)
      throw new Error(`ran out of time before reading ActiveCampaign ${what}`)
    return Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, left))
  }

  return {
    async v3(path) {
      const url = new URL(path, root)
      if (url.origin !== new URL(root).origin || !url.href.startsWith(root))
        throw new Error('ActiveCampaign request path escapes the API')
      const what = path.split('?')[0]
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {
          headers: { 'Api-Token': acKey() },
          cache: 'no-store',
          signal: AbortSignal.timeout(timeLeft(what)),
        })
        if (res.ok) return res.json()
        if (TRANSIENT_STATUSES.has(res.status) && attempt === 0) {
          await new Promise(r => setTimeout(r, retryDelayMs))
          continue
        }
        throw new Error(
          `ActiveCampaign ${what}: ${res.status}${TRANSIENT_STATUSES.has(res.status) ? ' (gateway or rate limit)' : ''}`
        )
      }
    },
    async v1(action, params = {}) {
      if (!V1_READS.includes(action))
        throw new Error(`not a read action: ${action}`)
      const qs = new URLSearchParams({
        api_action: action,
        api_output: 'json',
        api_key: acKey(),
        ...params,
      })
      const res = await fetch(`${acBase()}/admin/api.php?${qs}`, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeLeft(action)),
      })
      if (!res.ok) throw new Error(`ActiveCampaign ${action}: ${res.status}`)
      const out = (await res.json()) as Record<string, unknown>
      if (Number(out.result_code) !== 1)
        throw new Error(
          `ActiveCampaign ${action} failed: ${String(out.result_message ?? '').slice(0, 200)}`
        )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return out as any
    },
  }
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

// ─── Pure helpers ───────────────────────────────────────────────────────────

const WAVE_SUFFIX_RE = / · wave (\d+)\/(\d+)$/
const MARKER_RE = /<!--aisafety-issue:[0-9a-f]{16}-->/

/** "Events · Week 41, 2026 · wave 2/4" → base name + wave 2 of 4 (wave
 *  contract: waves carry this suffix; everything groups by the base). */
export function waveOf(name: string): {
  baseName: string
  wave: number | null
  waves: number | null
} {
  const m = WAVE_SUFFIX_RE.exec(name)
  if (!m) return { baseName: name, wave: null, waves: null }
  return {
    baseName: name.slice(0, m.index),
    wave: Number(m[1]),
    waves: Number(m[2]),
  }
}

/** Short name for subjects: "Events · Week 41 wave 2/4". */
export function shortLabel(name: string, id: string): string {
  if (!name.trim()) return `campaign ${id}`
  const { baseName, wave, waves } = waveOf(name)
  const short = baseName.replace(/, \d{4}$/, '')
  return wave ? `${short} wave ${wave}/${waves}` : short
}

/** One-off sends, what the approval page makes. An automatic email (an
 *  auto-responder, a reminder, a recurring or RSS campaign) sits at
 *  "scheduled" or "sending" for as long as it's switched on, so the timing,
 *  wave and "more than expected" rules would flag it for ever; it still gets
 *  the status and "not through the page" alerts. */
const ONE_OFF_TYPES = new Set(['', 'single', 'split', 'text'])

function oneOff(c: RawCampaign): boolean {
  return ONE_OFF_TYPES.has(String(c.type ?? '').toLowerCase())
}

/** No wave: ActiveCampaign sends to everyone active on the list. */
function wholeList(c: RawCampaign): boolean {
  return c.segmentid == null || ['', '0'].includes(String(c.segmentid))
}

function count(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** ActiveCampaign's v3 dates carry the account's offset
 *  ("2026-09-28T09:35:42-05:00", -06:00 in US winter time); empty and zero
 *  dates read as unknown. A date without an offset would be read in the
 *  server's time zone, so it reads as unknown too rather than hours off. */
function timeOf(v: string | null | undefined): number | null {
  if (!v || v.startsWith('0000')) return null
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(v)) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** When a campaign was last set going: its creation, or its send time when
 *  that is later (a draft built days ago and sent later from
 *  ActiveCampaign's own screens, or a send scheduled ahead). */
function lastActivity(c: RawCampaign): number | null {
  const times = [timeOf(c.cdate), timeOf(c.sdate)].filter(
    (t): t is number => t != null
  )
  return times.length ? Math.max(...times) : null
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '–'
  const p = (part / whole) * 100
  return `${p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)}%`
}

function num(n: number): string {
  return n.toLocaleString('en-US')
}

function duration(ms: number): string {
  const mins = Math.max(1, Math.round(ms / MINUTE))
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const hours = `${h} hour${h === 1 ? '' : 's'}`
  return m ? `${hours} ${m} minute${m === 1 ? '' : 's'}` : hours
}

function listLabel(lists: string[]): string {
  const real = lists.filter(l => REAL_LISTS.includes(l))
  return real.map(l => LIST_LABELS[l] ?? `list ${l}`).join(' and ')
}

const STATUS_WORDS: Record<string, string> = {
  '0': 'draft',
  '1': 'scheduled',
  '2': 'sending',
  '3': 'paused',
  '4': 'stopped',
  '5': 'sent',
  '6': 'disabled',
  '7': 'held for review',
}

/** The 18-hour verdict. Red means "hold the next wave"; amber "look first".
 *  Unsubscribes stay amber at worst: the first issue after the move invites
 *  readers to leave the list they don't want. Complaints only come from
 *  non-Gmail readers (Gmail tells senders nothing individually). */
export function healthVerdict(n: HealthNumbers): {
  verdict: HealthVerdict
  reasons: string[]
} {
  const red: string[] = []
  const amber: string[] = []
  const s = n.sendAmt
  if (s <= 0) {
    return {
      verdict: 'amber',
      reasons: ['ActiveCampaign reports it went to nobody'],
    }
  }
  if (n.hardBounces / s >= 0.02)
    red.push(`hard bounces ${pct(n.hardBounces, s)} (red at 2%)`)
  if (n.spamComplaints / s > 0.001)
    red.push(`spam complaints ${pct(n.spamComplaints, s)} (red above 0.1%)`)
  if (n.verifiedOpens / s < 0.15)
    red.push(`verified opens ${pct(n.verifiedOpens, s)} (red under 15%)`)
  const bounces = n.hardBounces + n.softBounces
  if (bounces / s >= 0.01 && n.hardBounces / s < 0.02)
    amber.push(`bounces ${pct(bounces, s)} (amber at 1%)`)
  if (n.unsubscribes / s > 0.05)
    amber.push(`unsubscribes ${pct(n.unsubscribes, s)} (amber above 5%)`)
  if (n.verifiedOpens / s < 0.25 && n.verifiedOpens / s >= 0.15)
    amber.push(`verified opens ${pct(n.verifiedOpens, s)} (amber under 25%)`)
  if (red.length) return { verdict: 'red', reasons: [...red, ...amber] }
  if (amber.length) return { verdict: 'amber', reasons: amber }
  return { verdict: 'green', reasons: [] }
}

// ─── Mail ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrap(bodyHtml: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${bodyHtml}</div>`
}

/** ActiveCampaign's own login, from the API address
 *  (alignment23684.api-us1.com → alignment23684.activehosted.com). */
function acLoginUrl(): string | null {
  try {
    const account = new URL(acBase()).hostname.split('.')[0]
    return account ? `https://${account}.activehosted.com` : null
  } catch {
    return null
  }
}

const FOOTER =
  'Sent by the site’s send watcher, which checks ActiveCampaign every 10 minutes. It writes once per problem and again only if the problem changes. Times are UK time.'

function linksBlock(origin: string): { text: string[]; html: string } {
  const page = `${origin}/admin/newsletter`
  const login = acLoginUrl()
  const text = [
    `Newsletter page: ${page}`,
    ...(login
      ? [
          `ActiveCampaign: ${login} (the login code arrives in Gmail) → Campaigns`,
        ]
      : []),
  ]
  const html =
    `<p><strong>Newsletter page:</strong> <a href="${esc(page)}">${esc(page)}</a>` +
    (login
      ? `<br><strong>ActiveCampaign:</strong> <a href="${esc(login)}">${esc(login)}</a> (the login code arrives in Gmail) → Campaigns`
      : '') +
    '</p>'
  return { text, html }
}

export function alertMail(alerts: WatchAlert[], origin: string): Mail {
  const links = linksBlock(origin)
  if (alerts.length === 1) {
    const a = alerts[0]
    return {
      subject: `Newsletter: ${a.title}`,
      text: [...a.detail, '', ...links.text, '', FOOTER].join('\n'),
      html: wrap(
        a.detail.map(l => `<p>${esc(l)}</p>`).join('') +
          links.html +
          `<p style="color:#666;font-size:13px">${esc(FOOTER)}</p>`
      ),
    }
  }
  const red = alerts.filter(a => a.severity === 'red').length
  return {
    subject: `Newsletter: ${alerts.length} problems need a look${red ? ` (${red} red)` : ''}`,
    text: [
      ...alerts.flatMap(a => [
        `${a.severity === 'red' ? 'RED' : 'AMBER'}: ${a.title}`,
        ...a.detail.map(l => `  ${l}`),
        '',
      ]),
      ...links.text,
      '',
      FOOTER,
    ].join('\n'),
    html: wrap(
      alerts
        .map(
          a =>
            `<p><strong>${a.severity === 'red' ? 'Red' : 'Amber'}: ${esc(a.title)}</strong></p>` +
            `<ul>${a.detail.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
        )
        .join('') +
        links.html +
        `<p style="color:#666;font-size:13px">${esc(FOOTER)}</p>`
    ),
  }
}

const VERDICT_WORDS: Record<HealthVerdict, string> = {
  green: 'green',
  amber: 'amber – look before the next wave',
  red: 'red – hold the next wave',
}

export function healthMail(r: HealthRecord, origin: string): Mail {
  const label = shortLabel(r.name, r.campaignId)
  const n = r.numbers
  const s = n.sendAmt
  const rows: Array<[string, string]> = [
    [
      'Sent to',
      `${num(s)}${r.expected != null ? ` (the approval expected ${num(r.expected)})` : ''}`,
    ],
    ['Verified opens', `${num(n.verifiedOpens)} (${pct(n.verifiedOpens, s)})`],
    ['Hard bounces', `${num(n.hardBounces)} (${pct(n.hardBounces, s)})`],
    ['Soft bounces', `${num(n.softBounces)} (${pct(n.softBounces, s)})`],
    ['Unsubscribes', `${num(n.unsubscribes)} (${pct(n.unsubscribes, s)})`],
    [
      'Spam complaints',
      `${num(n.spamComplaints)} (${pct(n.spamComplaints, s)}, non-Gmail readers only)`,
    ],
  ]
  const lead =
    r.verdict === 'green'
      ? `${label} looks healthy 18 hours after it finished sending. Fine to go ahead with the next wave.`
      : r.verdict === 'amber'
        ? `${label} needs a look before the next wave: ${r.reasons.join('; ')}.`
        : `Hold the next wave of ${r.baseName.replace(/, \d{4}$/, '')}: ${r.reasons.join('; ')}.${r.wave != null && r.waves != null && r.wave < r.waves ? ' The send watcher cancels the waves of it still scheduled.' : ''}`
  const note =
    'Verified opens leave out Apple’s automatic opens. Red: hard bounces at 2%, complaints above 0.1% or verified opens under 15%. Amber: bounces at 1%, unsubscribes above 5% or verified opens under 25%.'
  const links = linksBlock(origin)
  return {
    subject: `Newsletter: ${label} health check: ${VERDICT_WORDS[r.verdict]}`,
    text: [
      lead,
      '',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      `Finished sending: ${longDate(r.finishedAt)}`,
      '',
      note,
      '',
      ...links.text,
      '',
      FOOTER,
    ].join('\n'),
    html: wrap(
      `<p>${esc(lead)}</p><ul>` +
        rows
          .map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(v)}</li>`)
          .join('') +
        `<li><strong>Finished sending:</strong> ${esc(longDate(r.finishedAt))}</li></ul>` +
        `<p style="color:#666;font-size:13px">${esc(note)}</p>` +
        links.html +
        `<p style="color:#666;font-size:13px">${esc(FOOTER)}</p>`
    ),
  }
}

/** The owner-only admin mail ("digest" mail can only ever reach the owner's
 *  own address; the script enforces it). */
async function mailOwner(mail: Mail): Promise<boolean> {
  let sent = false
  for (const owner of ROOT_ADMINS) {
    if (await sendAdminMail('digest', owner.email, mail)) sent = true
  }
  return sent
}

// ─── The run ────────────────────────────────────────────────────────────────

/** The cron route's check: Vercel sends `Authorization: Bearer <CRON_SECRET>`.
 *  Unlike the other cron routes this one refuses outright when CRON_SECRET
 *  isn't set (Preview has none): a run reads the account with the full key,
 *  can email and answers with what it found. */
export function cronAuthorized(
  header: string | null,
  secret: string | undefined
): boolean {
  if (!secret) return false
  const got = Buffer.from(header ?? '')
  const want = Buffer.from(`Bearer ${secret}`)
  return got.length === want.length && timingSafeEqual(got, want)
}

export interface WatchOptions {
  now?: Date
  store?: WatchStore
  /** Read and evaluate, but write nothing and email nobody. */
  dry?: boolean
  /** Origin for the emails' links; production uses aisafety.com. */
  origin?: string
  mail?: (mail: Mail) => Promise<boolean>
  budgetMs?: number
  /** Pause before retrying a gateway error (tests use 0). */
  retryDelayMs?: number
}

export interface WatchSummary {
  ran: boolean
  skipped?: string
  dry: boolean
  alerts: PublicAlert[]
  /** Subjects of the emails tried (or, dry, that would have been). */
  emails: string[]
  /** Held back by the email ceilings or the time limit; a later run sends
   *  them. */
  deferred: string[]
  health: Array<{ campaignId: string; verdict: HealthVerdict }>
  /** Waves it canceled or tried to (a dry run: would have, `dry`). */
  canceled: Array<{
    campaignId: string
    name: string
    outcome: WatcherCancel['outcome'] | 'dry' | 'later'
  }>
  /** Drafts of finished issues it deleted or tried to. */
  draftsDeleted: Array<{ campaignId: string; name: string; outcome: string }>
  errors: string[]
}

function emptyState(): WatchState {
  return {
    lastRunAt: null,
    campaigns: {},
    api: { failingSince: null, failures: 0, lastError: null },
    account: { baseline: null, change: null },
  }
}

function toPublic(a: WatchAlert): PublicAlert {
  return {
    id: a.id,
    severity: a.severity,
    title: a.title,
    detail: a.detail,
    since: a.since,
    campaignId: a.campaignId,
  }
}

function sortAlerts(list: WatchAlert[]): WatchAlert[] {
  return [...list].sort(
    (a, b) =>
      (a.severity === 'red' ? 0 : 1) - (b.severity === 'red' ? 0 : 1) ||
      b.since.localeCompare(a.since)
  )
}

export async function runWatch(opts: WatchOptions = {}): Promise<WatchSummary> {
  const now = opts.now ?? new Date()
  const nowMs = now.getTime()
  const nowIso = now.toISOString()
  const dry = opts.dry ?? false
  const store = opts.store ?? sharedStore()
  const origin = opts.origin ?? PRODUCTION_ORIGIN
  const mail = opts.mail ?? mailOwner
  const startedMs = Date.now()
  const summary: WatchSummary = {
    ran: false,
    dry,
    alerts: [],
    emails: [],
    deferred: [],
    health: [],
    canceled: [],
    draftsDeleted: [],
    errors: [],
  }
  if (!isWatchConfigured()) {
    summary.skipped = 'ACTIVECAMPAIGN_URL / ACTIVECAMPAIGN_KEY not set'
    return summary
  }
  // The in-memory stand-in forgets everything between runs, so a real run
  // on it would email every open problem every ten minutes.
  if (!dry && !opts.store && !(restUrl && restToken))
    throw new Error(
      'KV_REST_API_URL / KV_REST_API_TOKEN not set: the watcher needs Upstash to email each problem only once'
    )
  if (!dry && !(await store.lock(LOCK_KEY, LOCK_SECONDS))) {
    summary.skipped = 'another run is still going'
    return summary
  }
  try {
    await watchOnce()
    summary.ran = true
    for (const e of summary.errors)
      console.warn(`[newsletter-watch] ActiveCampaign read failed: ${e}`)
    return summary
  } finally {
    // The lock expires by itself after LOCK_SECONDS; a failed release only
    // delays the next run.
    if (!dry)
      await store
        .unlock(LOCK_KEY)
        .catch(err =>
          console.warn(
            `[newsletter-watch] could not release the run lock: ${errorText(err)}`
          )
        )
  }

  async function watchOnce(): Promise<void> {
    // Without the stored state nothing can be deduplicated: better no run
    // (and no email) than an email every ten minutes.
    const state = {
      ...emptyState(),
      ...((await store.get<WatchState>(STATE_KEY)) ?? {}),
    }
    const prevDoc = await store.get<AlertsDoc>(ALERTS_KEY)
    const previous = prevDoc?.alerts ?? {}
    const prevCancels = await store.get<CancelDoc>(CANCELED_KEY)
    const ac = acReader(
      Date.now() + (opts.budgetMs ?? RUN_BUDGET_MS),
      opts.retryDelayMs ?? 1000
    )
    const raised: Raised[] = []
    const healthToEmail: HealthRecord[] = []
    let campaignsOk = false
    let accountOk = false
    let healthOk = true
    let nextCampaigns: Record<string, CampaignState> = state.campaigns

    // ── Campaigns ──
    const relevant: Array<{ c: RawCampaign; lists: string[] }> = []
    const approved = new Map<string, ApprovedRecord>()
    /** Every campaign the listing returned (for the cancels). */
    let campaigns: RawCampaign[] = []
    /** The verdicts known this run, by campaign. */
    const healthById = new Map<string, HealthRecord>()
    try {
      const listing = await ac.v3<{ campaigns?: RawCampaign[] }>(
        // AC ignores orders[cdate] (oldest first); newest by id instead.
        'campaigns?limit=100&orders[id]=DESC'
      )
      // Ids and statuses compared as the strings the v3 API sends.
      campaigns = (listing.campaigns ?? []).map(c => ({
        ...c,
        id: String(c.id),
        status: String(c.status),
      }))
      const next: Record<string, CampaignState> = {}
      for (const c of campaigns) {
        const prev = state.campaigns[c.id]
        const same = prev?.s === c.status
        let since: string
        if (prev && same) since = prev.since
        else if (prev) since = nowIso
        else {
          // First sight: the status has held at least since the campaign
          // was created or, when that's later and past, since its send time
          // (a hold starts at the send time, not at the approval).
          const started = [timeOf(c.cdate), timeOf(c.sdate)].filter(
            (t): t is number => t != null && t < nowMs
          )
          since = started.length
            ? new Date(Math.max(...started)).toISOString()
            : nowIso
        }
        // Lists and the pipeline marker are read once per status: a draft's
        // lists can still change in ActiveCampaign's editor before it's sent.
        next[c.id] = {
          s: c.status,
          since,
          ...(same && prev?.lists ? { lists: prev.lists } : {}),
          ...(same && prev?.pipeline !== undefined
            ? { pipeline: prev.pipeline }
            : {}),
        }
      }

      // Issues with a wave still to go: their sent waves stay in view
      // however old, for the verdict a later wave needs.
      const stillToGo = new Set(
        campaigns
          .filter(
            c =>
              (c.status === '1' || c.status === '7') &&
              waveOf(c.name).wave != null
          )
          .map(c => waveOf(c.name).baseName)
      )
      // Only what a rule could fire on needs its lists read.
      const matters = (c: RawCampaign): boolean => {
        const created = timeOf(c.cdate)
        const age = created == null ? Infinity : nowMs - created
        const finished = timeOf(c.ldate)
        switch (c.status) {
          case '0':
            return age > DRAFT_STALE_AFTER
          case '5':
            return (
              age <= RECENT ||
              (finished != null && nowMs - finished <= RECENT) ||
              (waveOf(c.name).wave != null &&
                stillToGo.has(waveOf(c.name).baseName))
            )
          case '4':
          case '6':
            return (
              age <= RECENT ||
              nowMs - Date.parse(next[c.id].since) <= EVENT_ALERT_FOR
            )
          default:
            return true
        }
      }
      const toCheck = campaigns.filter(matters)
      await mapLimit(
        toCheck.filter(c => !next[c.id].lists),
        3,
        async c => {
          const data = await ac.v3<{ campaignLists?: Array<{ list: string }> }>(
            `campaigns/${encodeURIComponent(c.id)}/campaignLists`
          )
          next[c.id].lists = (data.campaignLists ?? []).map(l => String(l.list))
        }
      )
      for (const c of toCheck) {
        const lists = next[c.id].lists ?? []
        if (lists.some(l => REAL_LISTS.includes(l))) relevant.push({ c, lists })
      }

      // Approval records for everything that has been or will be sent.
      const sendLike = relevant.filter(({ c }) => c.status !== '0')
      const records = await store.mget<ApprovedRecord>(
        sendLike.map(({ c }) => APPROVED_PREFIX + c.id)
      )
      sendLike.forEach(({ c }, i) => {
        const r = records[i]
        if (r) approved.set(c.id, r)
      })

      // Pipeline marker, for drafts old enough to matter.
      await mapLimit(
        relevant.filter(
          ({ c, lists }) =>
            c.status === '0' &&
            lists.some(l => ISSUE_LISTS.includes(l)) &&
            next[c.id].pipeline === undefined
        ),
        3,
        async ({ c }) => {
          let messageId = c.message_id ? String(c.message_id) : ''
          if (!/^\d+$/.test(messageId)) {
            const data = await ac.v3<{
              campaignMessages?: Array<{ messageid: string }>
            }>(`campaigns/${encodeURIComponent(c.id)}/campaignMessages`)
            messageId = String(data.campaignMessages?.[0]?.messageid ?? '')
          }
          if (!/^\d+$/.test(messageId)) {
            next[c.id].pipeline = false
            return
          }
          const msg = await ac.v3<{ message?: { html?: string | null } }>(
            `messages/${messageId}`
          )
          next[c.id].pipeline = MARKER_RE.test(msg.message?.html ?? '')
        }
      )

      // Active subscribers, for the whole-list rule (read only when needed).
      const activeCounts = new Map<string, number>()
      const wholeListCandidates = relevant.filter(({ c }) => {
        if (!NEWSLETTER_WARMUP || !oneOff(c) || !wholeList(c)) return false
        const active = lastActivity(c)
        return (
          ['1', '2', '3', '7'].includes(c.status) ||
          (c.status === '5' &&
            active != null &&
            nowMs - active <= UNAPPROVED_WINDOW)
        )
      })
      const neededLists = [
        ...new Set(
          wholeListCandidates.flatMap(({ lists }) =>
            lists.filter(l => REAL_LISTS.includes(l))
          )
        ),
      ]
      await mapLimit(neededLists, 3, async l => {
        const data = await ac.v3<{ meta?: { total?: string | number } }>(
          `contacts?listid=${encodeURIComponent(l)}&status=1&limit=1`
        )
        activeCounts.set(l, count(data.meta?.total))
      })

      nextCampaigns = next
      raised.push(
        ...campaignAlerts({
          nowMs,
          relevant,
          approved,
          states: next,
          activeCounts,
        })
      )
      campaignsOk = true
    } catch (err) {
      summary.errors.push(`campaigns: ${errorText(err)}`)
    }

    // ── Account ──
    try {
      const [acct, contacts] = await Promise.all([
        ac.v1<Record<string, unknown>>('account_view'),
        ac.v3<{ meta?: { total?: string | number } }>('contacts?limit=1'),
      ])
      const current = {
        limit: String(acct.subscriber_limit ?? ''),
        status: String(acct.status ?? ''),
      }
      const base = state.account.baseline
      if (!base) state.account.baseline = current
      else if (base.limit !== current.limit || base.status !== current.status) {
        state.account.change = { at: nowIso, from: base, to: current }
        state.account.baseline = current
      }
      const change = state.account.change
      if (change && nowMs - Date.parse(change.at) <= EVENT_ALERT_FOR) {
        raised.push({
          id: 'account-change',
          sig: `${change.to.limit}|${change.to.status}`,
          severity: 'red',
          title: 'ActiveCampaign’s account limit or status changed',
          detail: [
            `Contact limit: ${change.from.limit || 'unknown'} → ${change.to.limit || 'unknown'}. Account status: “${change.from.status}” → “${change.to.status}” (seen ${longDate(change.at)}).`,
            'This can mean a plan change, a failed payment or an account review. Check the account’s billing page, and Gmail for mail from ActiveCampaign to admin@alignment.dev.',
          ],
          campaignId: null,
          source: 'account',
        })
      }
      const limit =
        Number(current.limit) > 0
          ? Number(current.limit)
          : DEFAULT_CONTACT_LIMIT
      const total = Math.max(
        count(acct.subscriber_total),
        count(contacts.meta?.total)
      )
      if (total >= limit - CAP_MARGIN) {
        const atCap = total >= limit
        raised.push({
          id: 'contacts-cap',
          sig: atCap ? `at:${limit}` : `near:${limit}`,
          severity: 'red',
          title: atCap
            ? `ActiveCampaign is at its ${num(limit)}-contact limit – sends have stopped`
            : `ActiveCampaign is at ${num(total)} of ${num(limit)} contacts – sends stop at ${num(limit)}`,
          detail: [
            `The account holds ${num(total)} contacts. At ${num(limit)}, ActiveCampaign stops every campaign, while signup forms and imports keep adding people. Unsubscribed contacts count too.`,
            'Decide now: upgrade the plan, or remove test contacts. Never delete real unsubscribed readers – their record is what stops a later import from subscribing them again.',
          ],
          campaignId: null,
          source: 'account',
        })
      }
      accountOk = true
    } catch (err) {
      summary.errors.push(`account: ${errorText(err)}`)
    }

    // ── Health, 18 hours after a send on 6/7 finished ──
    if (campaignsOk) {
      const due = relevant.filter(({ c, lists }) => {
        const finished = timeOf(c.ldate)
        return (
          c.status === '5' &&
          lists.some(l => ISSUE_LISTS.includes(l)) &&
          finished != null &&
          nowMs - finished >= HEALTH_AFTER &&
          nowMs - finished <= RECENT
        )
      })
      const stored = await store.mget<HealthRecord>(
        due.map(({ c }) => HEALTH_PREFIX + c.id)
      )
      const records: HealthRecord[] = []
      for (let i = 0; i < due.length; i++) {
        const { c, lists } = due[i]
        let record = stored[i]
        if (!record) {
          try {
            const totals = await ac.v1<Record<string, unknown>>(
              'campaign_report_unsubscription_totals',
              { campaignid: c.id }
            )
            const numbers: HealthNumbers = {
              sendAmt: count(c.send_amt),
              hardBounces: count(c.hardbounces),
              softBounces: count(c.softbounces),
              unsubscribes: Math.max(
                count(c.unsubscribes),
                count(totals.unsubscribes)
              ),
              spamComplaints: count(totals.spam_complaints),
              verifiedOpens: count(c.verified_unique_opens),
            }
            const { verdict, reasons } = healthVerdict(numbers)
            const w = waveOf(c.name)
            const a = approved.get(c.id)
            record = {
              campaignId: c.id,
              listId: lists.find(l => ISSUE_LISTS.includes(l)) ?? lists[0],
              name: c.name,
              baseName: w.baseName,
              wave: w.wave,
              waves: w.waves,
              verdict,
              reasons,
              numbers,
              expected: a?.expected ?? null,
              finishedAt: new Date(timeOf(c.ldate)!).toISOString(),
              checkedAt: nowIso,
              smallSample: numbers.sendAmt < HEALTH_MIN_SAMPLE,
              emailedAt: null,
            }
            summary.health.push({ campaignId: c.id, verdict })
          } catch (err) {
            healthOk = false
            summary.errors.push(`health ${c.id}: ${errorText(err)}`)
            continue
          }
        }
        healthById.set(c.id, record)
        // Stored before its email, so it's worked out and read only once.
        if (!dry && stored[i] == null)
          await store.set(HEALTH_PREFIX + c.id, record)
        if (
          !record.smallSample &&
          !record.emailedAt &&
          nowMs - Date.parse(record.checkedAt) <= HEALTH_EMAIL_RETRY_FOR
        )
          healthToEmail.push(record)
        records.push(record)
      }
      for (const r of records) {
        if (r.smallSample || r.verdict === 'green') continue
        if (nowMs - Date.parse(r.checkedAt) > EVENT_ALERT_FOR) continue
        raised.push({
          id: `health:${r.campaignId}`,
          sig: r.verdict,
          severity: r.verdict === 'red' ? 'red' : 'amber',
          title: `${shortLabel(r.name, r.campaignId)} health check: ${VERDICT_WORDS[r.verdict]}`,
          detail: [
            `${r.reasons.join('; ')}. Sent to ${num(r.numbers.sendAmt)}.`,
          ],
          campaignId: r.campaignId,
          source: 'health',
          preEmailed: true,
        })
      }
    }

    // ── Waves still to go that must not go out (approve once) ──
    // Canceled through the page's own delete (cancelScheduledWave), the
    // soonest first. Each try is written down before it's made, so a run cut
    // short knows on the next one what it was doing.
    const cancelDoc: CancelDoc = { events: { ...(prevCancels?.events ?? {}) } }
    const held: CancelNeed[] = []
    if (campaignsOk) {
      try {
        // The verdicts on every sent wave on 6/7 (one read; most are known).
        const sentWaves = relevant
          .filter(
            ({ c, lists }) =>
              c.status === '5' &&
              waveOf(c.name).wave != null &&
              lists.some(l => ISSUE_LISTS.includes(l)) &&
              !healthById.has(c.id)
          )
          .map(({ c }) => c.id)
        const got = await store.mget<HealthRecord>(
          sentWaves.map(id => HEALTH_PREFIX + id)
        )
        sentWaves.forEach((id, i) => {
          const h = got[i]
          if (h) healthById.set(id, h)
        })
        const needs = wavesToCancel({
          nowMs,
          relevant,
          approved,
          health: healthById,
        })
        const listed = new Map(campaigns.map(c => [c.id, c]))
        const needed = new Set(needs.map(n => n.campaignId))
        // Earlier tries without a clear answer: gone now is canceled; started
        // is said; still scheduled is tried again below while it's needed.
        for (const e of Object.values(cancelDoc.events)) {
          if (e.outcome !== 'pending') continue
          const c = listed.get(e.campaignId)
          if (!c)
            cancelDoc.events[e.campaignId] = {
              ...e,
              outcome: 'canceled',
              detail: undefined,
              at: nowIso,
            }
          else if (c.status !== '1' && c.status !== '7')
            cancelDoc.events[e.campaignId] = {
              ...e,
              outcome: 'started',
              at: nowIso,
            }
          else if (!needed.has(e.campaignId))
            delete cancelDoc.events[e.campaignId]
        }
        for (const n of needs) {
          if (n.status !== '1') {
            held.push(n)
            continue
          }
          if (dry) {
            summary.canceled.push({
              campaignId: n.campaignId,
              name: n.name,
              outcome: 'dry',
            })
            continue
          }
          if (Date.now() - startedMs > CANCEL_START_BY_MS) {
            summary.canceled.push({
              campaignId: n.campaignId,
              name: n.name,
              outcome: 'later',
            })
            continue
          }
          const event: Omit<CancelEvent, 'outcome' | 'at'> = {
            campaignId: n.campaignId,
            name: n.name,
            listId: n.listId,
            baseName: n.baseName,
            wave: n.wave,
            waves: n.waves,
            cause: n.cause,
            after: n.after,
            why: n.why,
            startsAt:
              n.startsAt == null ? null : new Date(n.startsAt).toISOString(),
          }
          cancelDoc.events[n.campaignId] = {
            ...event,
            outcome: 'pending',
            detail: 'a cancel was started, but no answer had come back',
            at: nowIso,
          }
          await store.set(CANCELED_KEY, cancelDoc)
          const r = await cancelScheduledWave(
            n.campaignId,
            { listId: n.listId, name: n.name },
            { by: WATCHER, limits: WRITE_LIMITS }
          )
          console.warn(
            `[newsletter-watch] canceling “${n.name}” (campaign ${n.campaignId}): ${n.cause === 'red' ? `wave ${n.after} came back red (${n.why})` : n.why}: ${r.outcome}`
          )
          summary.canceled.push({
            campaignId: n.campaignId,
            name: n.name,
            outcome: r.outcome,
          })
          cancelDoc.events[n.campaignId] =
            r.outcome === 'canceled' || r.outcome === 'gone'
              ? { ...event, outcome: 'canceled', at: nowIso }
              : r.outcome === 'started'
                ? { ...event, outcome: 'started', at: nowIso }
                : {
                    ...event,
                    outcome: 'pending',
                    detail:
                      r.outcome === 'busy'
                        ? 'a cancel or pause of it from the page was running at the same moment'
                        : r.detail,
                    at: nowIso,
                  }
          await store.set(CANCELED_KEY, cancelDoc)
        }
      } catch (err) {
        summary.errors.push(`cancels: ${errorText(err)}`)
      }
    }
    // Three days on, a cancel is history.
    for (const [id, e] of Object.entries(cancelDoc.events))
      if (nowMs - Date.parse(e.at) > EVENT_ALERT_FOR)
        delete cancelDoc.events[id]
    raised.push(...cancelAlerts(cancelDoc, held, nowMs))

    // ── Drafts of issues whose every wave has gone ──
    // The waves kept the draft for re-approval; nothing can be approved from
    // it now, and an older draft left on the list blocks the next issue.
    const draftsGone = new Set<string>()
    if (campaignsOk) {
      try {
        for (const { c, lists } of relevant) {
          if (
            c.status !== '0' ||
            lists.length !== 1 ||
            !ISSUE_LISTS.includes(lists[0]) ||
            nextCampaigns[c.id]?.pipeline !== true ||
            waveOf(c.name).wave != null ||
            !everyWaveSent(c.name, lists[0], relevant)
          )
            continue
          if (dry) {
            summary.draftsDeleted.push({
              campaignId: c.id,
              name: c.name,
              outcome: 'dry',
            })
            continue
          }
          if (Date.now() - startedMs > CANCEL_START_BY_MS) continue
          const r = await deleteFinishedIssueDraft(
            c.id,
            { listId: lists[0], issue: c.name },
            WRITE_LIMITS
          )
          summary.draftsDeleted.push({
            campaignId: c.id,
            name: c.name,
            outcome:
              r.outcome === 'refused' ? `refused: ${r.detail}` : r.outcome,
          })
          if (r.outcome !== 'refused') draftsGone.add(c.id)
        }
      } catch (err) {
        summary.errors.push(`drafts: ${errorText(err)}`)
      }
    }
    // A draft deleted just now isn't left waiting.
    for (let i = raised.length - 1; i >= 0; i--)
      if (
        raised[i].id.startsWith('draft:') &&
        draftsGone.has(raised[i].campaignId ?? '')
      )
        raised.splice(i, 1)

    // ── ActiveCampaign unreachable ──
    const acFailed = !campaignsOk || !accountOk || !healthOk
    if (acFailed) {
      state.api = {
        failingSince: state.api.failingSince ?? nowIso,
        failures: state.api.failures + 1,
        lastError: summary.errors[0] ?? null,
      }
    } else {
      state.api = { failingSince: null, failures: 0, lastError: null }
    }
    const downSince = state.api.failingSince
    if (downSince && nowMs - Date.parse(downSince) >= API_DOWN_AFTER) {
      raised.push({
        id: 'ac-unreachable',
        sig: 'down',
        severity: 'red',
        title: 'The site can’t read ActiveCampaign',
        detail: [
          `Every check since ${longDate(downSince)} has failed (${state.api.failures} in a row), so nothing about the newsletters is being watched. Last error: ${state.api.lastError ?? 'unknown'}.`,
          'Sends that were already scheduled still go out. Check that you can log in to ActiveCampaign and that the account is active.',
        ],
        campaignId: null,
        source: 'api',
      })
    }

    // ── Merge with what's open, email what's new ──
    // A part that couldn't be read keeps its open alerts as they were.
    const current: Record<string, WatchAlert> = {}
    for (const old of Object.values(previous)) {
      if (
        ((old.source === 'campaigns' || old.source === 'health') &&
          !campaignsOk) ||
        (old.source === 'account' && !accountOk)
      )
        current[old.id] = old
    }
    const recent: Record<string, string> = {}
    for (const [key, at] of Object.entries(prevDoc?.recent ?? {}))
      if (nowMs - Date.parse(at) < REALERT_AFTER) recent[key] = at
    const mailLog = (prevDoc?.mailLog ?? []).filter(
      at => nowMs - Date.parse(at) < DAY
    )
    for (const { preEmailed, ...r } of raised) {
      const old = previous[r.id]
      if (old && old.sig === r.sig) {
        current[r.id] = {
          ...r,
          since: old.since,
          emailedSig: old.emailedSig,
          emailedAt: old.emailedAt,
        }
        continue
      }
      // New, or changed. The same problem in the same state that was open
      // and emailed within REALERT_AFTER is flapping (a read that comes
      // and goes): it shows on the banner but isn't emailed again.
      const covered = preEmailed ? nowIso : (recent[`${r.id}|${r.sig}`] ?? null)
      current[r.id] = {
        ...r,
        since: nowIso,
        emailedSig: covered ? r.sig : null,
        emailedAt: covered,
      }
    }
    summary.alerts = sortAlerts(Object.values(current)).map(toPublic)
    const saveAlerts = () => {
      for (const a of Object.values(current))
        if (a.emailedSig === a.sig) recent[`${a.id}|${a.sig}`] = nowIso
      return store.set(ALERTS_KEY, {
        updatedAt: nowIso,
        alerts: current,
        mailLog,
        recent,
      } satisfies AlertsDoc)
    }

    // Saved before any email goes out, so a run cut short by the time limit
    // still knows what it found; each email is recorded as it succeeds and
    // the rest go on the next run.
    if (!dry) {
      await store.set(STATE_KEY, {
        ...state,
        campaigns: nextCampaigns,
        lastRunAt: nowIso,
      } satisfies WatchState)
      await saveAlerts()
      if (
        JSON.stringify(cancelDoc.events) !==
        JSON.stringify(prevCancels?.events ?? {})
      )
        await store.set(CANCELED_KEY, cancelDoc)
    }

    const room = () =>
      Math.min(
        MAX_EMAILS_PER_HOUR -
          mailLog.filter(at => nowMs - Date.parse(at) < HOUR).length,
        MAX_EMAILS_PER_DAY - mailLog.length
      )
    // Each try is logged (and saved) before it's made, so one cut off by
    // the time limit still counts against the ceilings.
    const mayTry = async (): Promise<boolean> => {
      if (room() <= 0 || Date.now() - startedMs > MAIL_START_BY_MS) return false
      mailLog.push(nowIso)
      if (!dry) await saveAlerts()
      return true
    }

    const toEmail = sortAlerts(
      Object.values(current).filter(a => a.emailedSig !== a.sig)
    )
    // Separate emails only while they fit under the ceiling; otherwise one
    // summary with everything in it.
    const batches =
      toEmail.length === 0
        ? []
        : toEmail.length <= Math.min(MAX_SEPARATE_EMAILS, room())
          ? toEmail.map(a => [a])
          : [toEmail]
    for (const batch of batches) {
      const m = alertMail(batch, origin)
      if (!(await mayTry())) {
        summary.deferred.push(m.subject)
        continue
      }
      summary.emails.push(m.subject)
      if (dry || !(await mail(m))) continue
      for (const a of batch) {
        current[a.id] = {
          ...current[a.id],
          emailedSig: a.sig,
          emailedAt: nowIso,
        }
      }
      await saveAlerts()
    }
    for (const r of healthToEmail) {
      const m = healthMail(r, origin)
      if (!(await mayTry())) {
        summary.deferred.push(m.subject)
        continue
      }
      summary.emails.push(m.subject)
      if (dry || !(await mail(m))) continue
      await store.set(HEALTH_PREFIX + r.campaignId, { ...r, emailedAt: nowIso })
    }
    if (summary.deferred.length)
      console.warn(
        `[newsletter-watch] ${summary.deferred.length} email(s) held back by the ceilings or the time limit; a later run sends them`
      )
  }
}

/** The rules for campaigns on the real lists, over what has been read. */
function campaignAlerts(p: {
  nowMs: number
  relevant: Array<{ c: RawCampaign; lists: string[] }>
  approved: Map<string, ApprovedRecord>
  states: Record<string, CampaignState>
  activeCounts: Map<string, number>
}): Raised[] {
  const { nowMs, relevant, approved, states, activeCounts } = p
  const out: Raised[] = []
  for (const { c, lists } of relevant) {
    const label = shortLabel(c.name, c.id)
    const on = listLabel(lists)
    const since = Date.parse(states[c.id].since)
    const created = timeOf(c.cdate)
    const age = created == null ? Infinity : nowMs - created
    // An automatic email's send time moves on with every send; its window
    // runs from its creation only.
    const active = oneOff(c) ? lastActivity(c) : created
    const activeAgo = active == null ? Infinity : nowMs - active
    const sent = count(c.send_amt)
    const total = count(c.total_amt)
    const base = {
      campaignId: c.id,
      source: 'campaigns' as const,
    }
    const reached = `${num(sent)}${total > sent ? ` of ${num(total)}` : ''} people`

    switch (c.status) {
      case '0':
      case '5':
        break
      case '7':
        if (nowMs - since > HELD_AFTER) {
          out.push({
            ...base,
            id: `held:${c.id}`,
            sig: 'held',
            severity: 'red',
            title: `${label} is held for review by ActiveCampaign`,
            detail: [
              `ActiveCampaign has held campaign ${c.id} (${on}) as “Pending Approval” for ${duration(nowMs - since)}. Their compliance team reviews some sends, often a new account’s first big one, and it goes out once they approve it.`,
              'Don’t approve the next wave until this one clears. Look in Gmail for mail from ActiveCampaign to admin@alignment.dev; if it’s still held tomorrow, contact their support.',
            ],
          })
        }
        break
      case '3':
        out.push({
          ...base,
          id: `status:${c.id}`,
          sig: '3',
          severity: 'red',
          title: `${label} is paused`,
          detail: [
            `Campaign ${c.id} (${on}) is paused after reaching ${reached}. Nobody else gets it while it’s paused.`,
            'Resume it or stop it in ActiveCampaign (Campaigns → the campaign). A stop is final.',
          ],
        })
        break
      case '4':
        if (nowMs - since <= EVENT_ALERT_FOR) {
          out.push({
            ...base,
            id: `status:${c.id}`,
            sig: '4',
            severity: 'amber',
            title: `${label} was stopped`,
            detail: [
              `Campaign ${c.id} (${on}) was stopped after reaching ${num(sent)} people. A stopped campaign can’t be restarted.`,
              sent > 0
                ? `Those ${num(sent)} people already have it, so approving this issue again would send it to them twice.`
                : 'It reached nobody, so the issue can be approved again.',
            ],
          })
        }
        break
      case '6':
        if (nowMs - since <= EVENT_ALERT_FOR) {
          out.push({
            ...base,
            id: `status:${c.id}`,
            sig: '6',
            severity: 'red',
            title: `ActiveCampaign disabled ${label}`,
            detail: [
              `Campaign ${c.id} (${on}) has the status “disabled” after reaching ${num(sent)} people. ActiveCampaign does this when it stops a send itself, for example over a compliance or account problem.`,
              'Look in Gmail for mail from ActiveCampaign to admin@alignment.dev, and don’t approve anything else until it’s clear why.',
            ],
          })
        }
        break
      case '1': {
        const due = timeOf(c.sdate)
        if (oneOff(c) && due != null && nowMs - due > LATE_AFTER) {
          out.push({
            ...base,
            id: `late:${c.id}`,
            sig: c.sdate ?? '',
            severity: 'red',
            title: `${label} was due to send at ${longDate(new Date(due).toISOString())} but hasn’t started`,
            detail: [
              `Campaign ${c.id} (${on}) is still “scheduled” ${duration(nowMs - due)} after its send time. ActiveCampaign’s scheduler normally starts within a minute or two.`,
              'Check it in ActiveCampaign before anything else. Don’t approve the same wave again while this campaign exists; deleting a scheduled campaign sends nothing.',
            ],
          })
        }
        break
      }
      case '2': {
        const started = timeOf(c.sdate) ?? since
        if (oneOff(c) && nowMs - started > SENDING_TOO_LONG) {
          out.push({
            ...base,
            id: `slow:${c.id}`,
            sig: 'sending',
            severity: 'red',
            title: `${label} has been sending for over 3 hours`,
            detail: [
              `Campaign ${c.id} (${on}) started ${longDate(new Date(started).toISOString())} and has reached ${reached} so far.`,
              'Sends this size don’t usually take this long. Check it in ActiveCampaign; you can pause it there if something looks wrong.',
            ],
          })
        }
        break
      }
      default:
        out.push({
          ...base,
          id: `unknown:${c.id}`,
          sig: c.status,
          severity: 'red',
          title: `${label} has a status the site doesn’t know (${c.status})`,
          detail: [
            `ActiveCampaign reports status ${c.status} for campaign ${c.id} (${on}). The approval page treats a status it doesn’t know as “may be sending”.`,
            'Check the campaign in ActiveCampaign, and ask Claude to teach the site the new status.',
          ],
        })
    }

    const record = approved.get(c.id)

    // Not approved through the page. The window runs from the later of its
    // creation and its send time, so a draft built days ago and then sent
    // from ActiveCampaign's own screens is caught too; the grace counts from
    // the creation, since the approval step writes its record right after.
    if (
      ['1', '2', '5', '7'].includes(c.status) &&
      !record &&
      age >= UNAPPROVED_GRACE &&
      activeAgo <= UNAPPROVED_WINDOW
    ) {
      out.push({
        ...base,
        id: `unapproved:${c.id}`,
        sig: 'unapproved',
        severity: 'red',
        title: `${label} was not sent through the approval page`,
        detail: [
          `Campaign ${c.id} on ${on}${created != null ? ` was created ${longDate(new Date(created).toISOString())} and` : ''} is ${STATUS_WORDS[c.status]}, but the approval page has no record of approving it. Only the Approve button on the newsletter page should send to the real lists.`,
          c.status === '5'
            ? `It has already gone out to ${num(sent)} people.`
            : c.status === '2'
              ? 'It is sending now: pause it in ActiveCampaign if you didn’t expect it.'
              : 'If you didn’t expect it, delete it in ActiveCampaign before it sends. Deleting a scheduled or held campaign sends nothing.',
        ],
      })
    }

    // A whole-list send during the warm-up.
    if (
      NEWSLETTER_WARMUP &&
      oneOff(c) &&
      wholeList(c) &&
      (['1', '2', '3', '7'].includes(c.status) ||
        (c.status === '5' && activeAgo <= UNAPPROVED_WINDOW))
    ) {
      const big = lists.filter(
        l => (activeCounts.get(l) ?? 0) > MAX_UNSEGMENTED_SEND
      )
      if (big.length) {
        const active = Math.max(...big.map(l => activeCounts.get(l) ?? 0))
        out.push({
          ...base,
          id: `whole-list:${c.id}`,
          sig: 'whole-list',
          severity: 'red',
          title: `${label} is going to the whole ${listLabel(big)} list, not a wave`,
          detail: [
            `Campaign ${c.id} has no wave (segment), and ${listLabel(big)} has ${num(active)} active subscribers. During the warm-up, every send to more than ${MAX_UNSEGMENTED_SEND} people should go out in waves.`,
            c.status === '5'
              ? `It has already gone out to ${num(sent)} people.`
              : c.status === '2'
                ? 'It is sending now: pause it in ActiveCampaign unless this was meant.'
                : 'Delete it in ActiveCampaign before it sends unless this was meant; deleting a scheduled campaign sends nothing.',
          ],
        })
      }
    }

    // More people than the approval expected: the wave wasn't kept to.
    // Counted from send_amt, the emails actually sent: nobody has checked
    // yet what total_amt holds for a segmented send before or while it goes
    // out, and a false "pause it" on a good wave is its own harm.
    const expected = record?.expected
    if (
      typeof expected === 'number' &&
      expected >= 0 &&
      oneOff(c) &&
      ['2', '3', '4', '5'].includes(c.status) &&
      age <= RECENT &&
      sent > expected * OVERSEND_FACTOR + OVERSEND_SLACK
    ) {
      out.push({
        ...base,
        id: `oversend:${c.id}`,
        sig: 'oversend',
        severity: 'red',
        title: `${label} is reaching more people than its wave`,
        detail: [
          `The approval expected about ${num(expected)} people, but ActiveCampaign has sent it to ${num(sent)} so far (campaign ${c.id}, ${on}). It may not have kept to the wave.`,
          'Pause it in ActiveCampaign if it’s still sending, and don’t approve the next wave until this is understood.',
        ],
      })
    }

    // A pipeline draft left waiting on 6/7.
    if (
      c.status === '0' &&
      states[c.id].pipeline === true &&
      age > DRAFT_STALE_AFTER
    ) {
      const draftLists = lists.filter(l => ISSUE_LISTS.includes(l))
      const waves = relevant.filter(
        o =>
          o.c.id !== c.id &&
          ['1', '2', '3', '5', '7'].includes(o.c.status) &&
          o.lists.some(l => draftLists.includes(l)) &&
          waveOf(o.c.name).baseName === c.name &&
          waveOf(o.c.name).wave != null
      )
      const recentWave = waves.some(o => {
        const t = timeOf(o.c.cdate)
        return t != null && nowMs - t <= WAVE_SEQUENCE_WINDOW
      })
      // A wave still to go keeps the draft: a canceled one is approved
      // again from it (approve once schedules them all at once).
      const going = waves.some(o => o.c.status !== '5')
      const lastWaveOut = waves.some(o => {
        const w = waveOf(o.c.name)
        return w.wave != null && w.wave === w.waves && o.c.status === '5'
      })
      if (draftLists.length && !going && (!recentWave || lastWaveOut)) {
        out.push({
          ...base,
          id: `draft:${c.id}`,
          sig: 'stale',
          severity: 'red',
          title: `An unapproved ${label} draft has been waiting over 30 hours`,
          detail: [
            `Draft campaign ${c.id} on ${listLabel(draftLists)} was built ${longDate(new Date(created!).toISOString())}${lastWaveOut ? ', and every wave of it has already gone out' : ''}. A draft left on a real list can be approved by mistake later and would reach everyone on it.`,
            'Approve it if it’s due; if it isn’t going out, press Delete on it at /admin/newsletter.',
          ],
        })
      }
    }
  }
  return out
}

// ─── Waves still to go (approve once, 8 October 2026) ─────────────────────

/** Has gone, is going, or could still go out to anyone: everything but a
 *  draft, and a stop or disable that provably reached nobody (newsletter.ts
 *  isLiveCampaign). */
function isLive(c: RawCampaign): boolean {
  if (c.status === '0') return false
  if (c.status === '4' || c.status === '6') {
    const sent = String(c.send_amt ?? '').trim()
    return !(sent !== '' && Number(sent) === 0)
  }
  return true
}

/** "waves 3–4", "wave 4", or "waves 2, 4". */
function waveList(numbers: number[]): string {
  const n = [...numbers].sort((a, b) => a - b)
  if (n.length === 1) return `wave ${n[0]}`
  const run = n.every((x, i) => i === 0 || x === n[i - 1] + 1)
  return run ? `waves ${n[0]}–${n[n.length - 1]}` : `waves ${n.join(', ')}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Pure: the waves on the lists the watcher judges (6/7) that must not go
 *  out, soonest first:
 *  - every wave still to go (scheduled or held) after a wave whose 18-hour
 *    verdict came back red (not on a small sample) since it was approved.
 *    One approved after the verdict was given took a typed reason for it,
 *    and stays;
 *  - a wave that starts within FAIL_CLOSED_MINUTES (or whose start time
 *    can't be read) while the wave before it has no verdict — none yet, not
 *    finished, a finish time ActiveCampaign doesn't give, or never sent —
 *    and every wave still to go after it, unless its approval carries a
 *    typed reason to send it anyway.
 *  A wave made less than UNAPPROVED_GRACE ago with no record yet is left
 *  for the next run: its approval may still be writing it. */
function wavesToCancel(p: {
  nowMs: number
  relevant: Array<{ c: RawCampaign; lists: string[] }>
  approved: Map<string, ApprovedRecord>
  health: Map<string, HealthRecord>
}): CancelNeed[] {
  const { nowMs, approved, health } = p
  type W = {
    c: RawCampaign
    listId: string
    baseName: string
    wave: number
    waves: number
  }
  const issues = new Map<string, W[]>()
  for (const { c, lists } of p.relevant) {
    const w = waveOf(c.name)
    if (w.wave == null || w.waves == null || !oneOff(c) || !isLive(c)) continue
    if (lists.length !== 1 || !ISSUE_LISTS.includes(lists[0])) continue
    const key = `${lists[0]}|${w.waves}|${w.baseName}`
    const one: W = {
      c,
      listId: lists[0],
      baseName: w.baseName,
      wave: w.wave,
      waves: w.waves,
    }
    const had = issues.get(key)
    if (had) had.push(one)
    else issues.set(key, [one])
  }
  const out = new Map<string, CancelNeed>()
  const add = (
    x: W,
    cause: CancelNeed['cause'],
    after: number,
    why: string
  ) => {
    if (out.get(x.c.id)?.cause === 'red') return
    out.set(x.c.id, {
      campaignId: x.c.id,
      name: x.c.name,
      status: x.c.status,
      listId: x.listId,
      baseName: x.baseName,
      wave: x.wave,
      waves: x.waves,
      cause,
      after,
      why,
      startsAt: timeOf(x.c.sdate),
    })
  }
  const recordPending = (c: RawCampaign) => {
    const made = timeOf(c.cdate)
    return (
      !approved.has(c.id) && made != null && nowMs - made < UNAPPROVED_GRACE
    )
  }
  for (const run of issues.values()) {
    const toGo = run
      .filter(x => x.c.status === '1' || x.c.status === '7')
      .sort((a, b) => a.wave - b.wave)
    if (toGo.length === 0) continue
    // A red verdict: every later wave approved before it.
    for (const x of run) {
      const h = health.get(x.c.id)
      if (!h || h.verdict !== 'red' || h.smallSample) continue
      for (const y of toGo) {
        if (y.wave <= x.wave || recordPending(y.c)) continue
        const r = approved.get(y.c.id)
        if (r && Date.parse(r.approvedAt) >= Date.parse(h.checkedAt)) continue
        add(
          y,
          'red',
          x.wave,
          h.reasons.join('; ') || 'its health check came back red'
        )
      }
    }
    // No verdict on the wave before one that is about to start.
    for (const y of toGo) {
      if (y.wave < 2 || recordPending(y.c)) continue
      const start = timeOf(y.c.sdate)
      if (start != null && start - nowMs > FAIL_CLOSED_MINUTES * MINUTE)
        continue
      if (approved.get(y.c.id)?.override) continue
      const n = y.wave - 1
      const before = run.filter(x => x.wave === n)
      const prev = before.length === 1 ? before[0] : null
      const why =
        before.length > 1
          ? `wave ${n} went out twice`
          : !prev
            ? `wave ${n} never went out`
            : prev.c.status !== '5'
              ? `wave ${n} is ${STATUS_WORDS[prev.c.status] ?? `in status ${prev.c.status}`}, not finished`
              : timeOf(prev.c.ldate) == null
                ? `ActiveCampaign doesn’t say when wave ${n} finished`
                : !health.has(prev.c.id)
                  ? `wave ${n} has no 18-hour check yet`
                  : null
      if (!why) continue
      for (const z of toGo) if (z.wave >= y.wave) add(z, 'verdict', n, why)
      break
    }
  }
  return [...out.values()].sort(
    (a, b) => (a.startsAt ?? -Infinity) - (b.startsAt ?? -Infinity)
  )
}

/** Pure: every wave of `issue` on `listId` has been sent (status 5), once
 *  each, numbered 1…N. */
function everyWaveSent(
  issue: string,
  listId: string,
  relevant: Array<{ c: RawCampaign; lists: string[] }>
): boolean {
  const waves = relevant.filter(({ c, lists }) => {
    const w = waveOf(c.name)
    return (
      w.wave != null &&
      w.baseName === issue &&
      lists.length === 1 &&
      lists[0] === listId &&
      isLive(c)
    )
  })
  if (waves.length === 0) return false
  const n = waveOf(waves[0].c.name).waves
  const seen = new Set(waves.map(({ c }) => waveOf(c.name).wave))
  return (
    n != null &&
    waves.length === n &&
    seen.size === n &&
    waves.every(
      ({ c }) =>
        c.status === '5' &&
        waveOf(c.name).waves === n &&
        (waveOf(c.name).wave ?? 0) >= 1 &&
        (waveOf(c.name).wave ?? 0) <= n
    )
  )
}

/** Pure: the alerts about canceling waves: one per issue, list and cause
 *  for the waves canceled in the last EVENT_ALERT_FOR, one per wave that
 *  started before it could be canceled, couldn't be canceled yet, or is
 *  held for review when it shouldn't go out. */
function cancelAlerts(
  doc: CancelDoc,
  held: CancelNeed[],
  nowMs: number
): Raised[] {
  const out: Raised[] = []
  const recent = Object.values(doc.events).filter(
    e => nowMs - Date.parse(e.at) <= EVENT_ALERT_FOR
  )
  const short = (baseName: string, id: string) =>
    shortLabel(baseName, id).replace(/ wave \d+\/\d+$/, '')
  const because = (e: Pick<CancelEvent, 'cause' | 'after' | 'why'>) =>
    e.cause === 'red'
      ? `wave ${e.after}’s 18-hour check came back red: ${e.why}`
      : e.why
  const groups = new Map<string, CancelEvent[]>()
  for (const e of recent) {
    if (e.outcome !== 'canceled') continue
    const key = `${e.listId}|${e.baseName}|${e.cause}|${e.after}`
    const g = groups.get(key)
    if (g) g.push(e)
    else groups.set(key, [e])
  }
  for (const g of groups.values()) {
    g.sort((a, b) => a.wave - b.wave)
    const e = g[0]
    const label = waveList(g.map(x => x.wave))
    const them = g.length === 1 ? 'it' : 'them'
    const ids = `campaign${g.length === 1 ? '' : 's'} ${g.map(x => x.campaignId).join(', ')}`
    const name = short(e.baseName, e.campaignId)
    out.push({
      id: `canceled:${e.listId}:${e.baseName}:${e.after}`,
      sig: `${e.cause}:${g.map(x => x.wave).join(',')}`,
      severity: 'red',
      title:
        e.cause === 'red'
          ? `${name}: ${label} canceled – wave ${e.after} came back red`
          : `${name}: ${label} canceled – wave ${e.after} has no health check`,
      detail:
        e.cause === 'red'
          ? [
              `The send watcher canceled ${label} (${ids}) before ${g.length === 1 ? 'it' : 'they'} went out, because ${because(e)}. Nobody got ${them}.`,
              `Look at wave ${e.after}’s numbers on the newsletter page. To send the rest anyway, approve ${them} again there and say why; otherwise leave ${them}.`,
            ]
          : [
              `Wave ${e.wave} was due to start ${e.startsAt ? longDate(e.startsAt) : 'within the hour'}, but ${e.why}, so the send watcher canceled ${label} (${ids}) rather than send ${them} unchecked. Nobody got ${them}.`,
              `This only happens when something is wrong, such as a wave still sending or a check that couldn’t run. Look at the newsletter page; once wave ${e.after} has its check, approve the rest again.`,
            ],
      campaignId: e.campaignId,
      source: 'campaigns',
    })
  }
  for (const e of recent) {
    const name = short(e.baseName, e.campaignId)
    if (e.outcome === 'started')
      out.push({
        id: `cancel-started:${e.campaignId}`,
        sig: 'started',
        severity: 'red',
        title: `${name} wave ${e.wave} started before it could be canceled`,
        detail: [
          `It should have been canceled (${because(e)}), but ActiveCampaign had already started sending it (campaign ${e.campaignId}).`,
          'Pause it under Recent sends on the newsletter page if it shouldn’t go on; stopping it after that is final.',
        ],
        campaignId: e.campaignId,
        source: 'campaigns',
      })
    else if (e.outcome === 'pending')
      out.push({
        id: `cancel-failed:${e.campaignId}`,
        sig: 'pending',
        severity: 'red',
        title: `The send watcher couldn’t cancel ${name} wave ${e.wave}`,
        detail: [
          `It should be canceled (${because(e)}), but ${e.detail ?? 'ActiveCampaign gave no clear answer'}.${e.startsAt ? ` It starts ${longDate(e.startsAt)}.` : ''}`,
          `Cancel it under Recent sends on the newsletter page now, or in ActiveCampaign (Campaigns → ${e.campaignId}). The watcher tries again every 10 minutes.`,
        ],
        campaignId: e.campaignId,
        source: 'campaigns',
      })
  }
  for (const n of held) {
    out.push({
      id: `cancel-held:${n.campaignId}`,
      sig: 'held',
      severity: 'red',
      title: `${short(n.baseName, n.campaignId)} wave ${n.wave} is held for review and shouldn’t go out`,
      detail: [
        `${capitalize(because(n))}, so wave ${n.wave} shouldn’t go out, but it is held for ActiveCampaign’s review (campaign ${n.campaignId}) and the watcher only cancels scheduled waves.`,
        'Cancel it under Recent sends on the newsletter page.',
      ],
      campaignId: n.campaignId,
      source: 'campaigns',
    })
  }
  return out
}

// ─── For the page ───────────────────────────────────────────────────────────

export interface AlertsView {
  fetchedAt: string
  /** When the watcher last finished a run (null: never). */
  lastRunAt: string | null
  /** The watcher hasn't run for a while: nothing is being watched. */
  stale: boolean
  alerts: PublicAlert[]
}

/** Open alerts for the banner. Reads Upstash only. */
export async function readAlerts(
  opts: { store?: WatchStore; now?: Date } = {}
): Promise<AlertsView> {
  const store = opts.store ?? sharedStore()
  const now = opts.now ?? new Date()
  const [doc, state] = await Promise.all([
    store.get<AlertsDoc>(ALERTS_KEY),
    store.get<WatchState>(STATE_KEY),
  ])
  const lastRunAt = state?.lastRunAt ?? null
  const stale =
    lastRunAt == null
      ? process.env.VERCEL_ENV === 'production'
      : now.getTime() - Date.parse(lastRunAt) > STALE_AFTER
  return {
    fetchedAt: now.toISOString(),
    lastRunAt,
    stale,
    alerts: sortAlerts(Object.values(doc?.alerts ?? {})).map(toPublic),
  }
}
