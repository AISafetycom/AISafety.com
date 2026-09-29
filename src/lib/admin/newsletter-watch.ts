/*
  Send watcher for the newsletters (29 September 2026, build item S8 in
  ~/Newsletter/TEST_SWEEP_2026-09-29.md). A Vercel cron
  (GET /api/admin/newsletter/watch, every 10 minutes, see vercel.json) reads
  ActiveCampaign and emails the owner once per problem it finds, so a held,
  stuck or unexpected send is noticed while the Mac is asleep. The same
  problems show as a red banner on /admin/newsletter (NewsletterAlerts.tsx,
  via GET /api/admin/newsletter/alerts).

  Read-only on ActiveCampaign: v3 GETs and two v1 read actions, nothing else
  (`V1_READS`). It never pauses, stops or deletes a campaign — automatic
  stopping was rejected until the stop call is proven; the alert says what to
  do and the page's Stop button does it.

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
  green/amber/red verdict, emailed and stored for the page.

  Upstash keys (the site's analytics database; no expiry on any of them):
    aisafety:newsletter:watch:state    { lastRunAt, campaigns, api, account }
    aisafety:newsletter:watch:alerts   { updatedAt, alerts: { <id>: WatchAlert } }
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

import { Redis } from '@upstash/redis'
import { longDate, type Mail, sendAdminMail } from '@/lib/admin/mail'
import { ROOT_ADMINS } from '@/lib/admin/users'

// ─── The rules' numbers ─────────────────────────────────────────────────────

/** Warm-up switch (wave contract): while on, a send to 6, 7 or 8 whose list
 *  has more than MAX_UNSEGMENTED_SEND active subscribers must name a wave.
 *  The approval step has the same pair; keep them in step. */
export const NEWSLETTER_WARMUP = true
export const MAX_UNSEGMENTED_SEND = 50

/** Lists real subscribers are on. */
const REAL_LISTS = ['6', '7', '8']
/** Lists whose sends get the 18-hour health check and whose drafts must not
 *  sit around (the lists the ~2,889 imported readers are on). */
const ISSUE_LISTS = ['6', '7']
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

const LOCK_SECONDS = 300
/** Time a run may spend reading ActiveCampaign before it stops, saves what
 *  it has and records the rest as a failure. The function allows 60 s; the
 *  rest is for the saves and the emails. */
const RUN_BUDGET_MS = 35_000
const REQUEST_TIMEOUT_MS = 15_000

/** Where the emails link to. Cron requests arrive on whatever host Vercel
 *  uses; sign-in only works on the real one. */
const PRODUCTION_ORIGIN = 'https://aisafety.com'

// ─── Upstash keys (shared with the approval step and the page) ─────────────

export const APPROVED_PREFIX = 'aisafety:newsletter:approved:'
export const HEALTH_PREFIX = 'aisafety:newsletter:health:'
export const STATE_KEY = 'aisafety:newsletter:watch:state'
export const ALERTS_KEY = 'aisafety:newsletter:watch:alerts'
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

/** In-memory store: tests, and a laptop without the Redis variables. */
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

const TRANSIENT_STATUSES = new Set([429, 502, 503, 504])

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

/** No wave: ActiveCampaign sends to everyone active on the list. */
function wholeList(c: RawCampaign): boolean {
  return c.segmentid == null || ['', '0'].includes(String(c.segmentid))
}

function count(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** ActiveCampaign's v3 dates carry the account's offset
 *  ("2026-09-28T09:35:42-05:00"); empty and zero dates read as unknown. */
function timeOf(v: string | null | undefined): number | null {
  if (!v || v.startsWith('0000')) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
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
        : `Hold the next wave of ${r.baseName.replace(/, \d{4}$/, '')}: ${r.reasons.join('; ')}.`
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
  /** Subjects of the emails sent (or, dry, that would have been). */
  emails: string[]
  health: Array<{ campaignId: string; verdict: HealthVerdict }>
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
  const summary: WatchSummary = {
    ran: false,
    dry,
    alerts: [],
    emails: [],
    health: [],
    errors: [],
  }
  if (!isWatchConfigured()) {
    summary.skipped = 'ACTIVECAMPAIGN_URL / ACTIVECAMPAIGN_KEY not set'
    return summary
  }
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
    const previous = (await store.get<AlertsDoc>(ALERTS_KEY))?.alerts ?? {}
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
    try {
      const listing = await ac.v3<{ campaigns?: RawCampaign[] }>(
        // AC ignores orders[cdate] (oldest first); newest by id instead.
        'campaigns?limit=100&orders[id]=DESC'
      )
      // Ids and statuses compared as the strings the v3 API sends.
      const campaigns = (listing.campaigns ?? []).map(c => ({
        ...c,
        id: String(c.id),
        status: String(c.status),
      }))
      const next: Record<string, CampaignState> = {}
      for (const c of campaigns) {
        const prev = state.campaigns[c.id]
        let since: string
        if (prev && prev.s === c.status) since = prev.since
        else if (prev) since = nowIso
        else {
          // First sight: the status has held at least since it was created.
          const created = timeOf(c.cdate)
          since =
            created != null && created < nowMs
              ? new Date(created).toISOString()
              : nowIso
        }
        next[c.id] = {
          s: c.status,
          since,
          ...(prev?.lists ? { lists: prev.lists } : {}),
          ...(prev?.pipeline !== undefined ? { pipeline: prev.pipeline } : {}),
        }
      }

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
              age <= RECENT || (finished != null && nowMs - finished <= RECENT)
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
        if (!NEWSLETTER_WARMUP || !wholeList(c)) return false
        const created = timeOf(c.cdate)
        return (
          ['1', '2', '3', '7'].includes(c.status) ||
          (c.status === '5' &&
            created != null &&
            nowMs - created <= UNAPPROVED_WINDOW)
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
    for (const { preEmailed, ...r } of raised) {
      const old = previous[r.id]
      current[r.id] =
        old && old.sig === r.sig
          ? {
              ...r,
              since: old.since,
              emailedSig: old.emailedSig,
              emailedAt: old.emailedAt,
            }
          : {
              ...r,
              since: nowIso,
              emailedSig: preEmailed ? r.sig : null,
              emailedAt: preEmailed ? nowIso : null,
            }
    }
    summary.alerts = sortAlerts(Object.values(current)).map(toPublic)
    const saveAlerts = () =>
      store.set(ALERTS_KEY, {
        updatedAt: nowIso,
        alerts: current,
      } satisfies AlertsDoc)

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
    }

    const toEmail = sortAlerts(
      Object.values(current).filter(a => a.emailedSig !== a.sig)
    )
    const batches =
      toEmail.length <= MAX_SEPARATE_EMAILS ? toEmail.map(a => [a]) : [toEmail]
    for (const batch of batches) {
      const m = alertMail(batch, origin)
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
      summary.emails.push(m.subject)
      if (dry || !(await mail(m))) continue
      await store.set(HEALTH_PREFIX + r.campaignId, { ...r, emailedAt: nowIso })
    }
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
        if (due != null && nowMs - due > LATE_AFTER) {
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
        if (nowMs - started > SENDING_TOO_LONG) {
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

    // Not approved through the page.
    if (
      ['1', '2', '5', '7'].includes(c.status) &&
      !record &&
      age >= UNAPPROVED_GRACE &&
      age <= UNAPPROVED_WINDOW
    ) {
      out.push({
        ...base,
        id: `unapproved:${c.id}`,
        sig: 'unapproved',
        severity: 'red',
        title: `${label} was not sent through the approval page`,
        detail: [
          `Campaign ${c.id} on ${on} was created ${longDate(new Date(created!).toISOString())} and is ${STATUS_WORDS[c.status]}, but the approval page has no record of approving it. Only the Approve button on the newsletter page should send to the real lists.`,
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
      wholeList(c) &&
      (['1', '2', '3', '7'].includes(c.status) ||
        (c.status === '5' && age <= UNAPPROVED_WINDOW))
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
    const expected = record?.expected
    const reachedMost = Math.max(sent, total)
    if (
      typeof expected === 'number' &&
      expected >= 0 &&
      ['1', '2', '3', '4', '5', '7'].includes(c.status) &&
      age <= RECENT &&
      reachedMost > expected * OVERSEND_FACTOR + OVERSEND_SLACK
    ) {
      out.push({
        ...base,
        id: `oversend:${c.id}`,
        sig: 'oversend',
        severity: 'red',
        title: `${label} is reaching more people than its wave`,
        detail: [
          `The approval expected about ${num(expected)} people, but ActiveCampaign reports ${num(reachedMost)} for campaign ${c.id} (${on}). It may not have kept to the wave.`,
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
      const lastWaveOut = waves.some(o => {
        const w = waveOf(o.c.name)
        return w.wave != null && w.wave === w.waves
      })
      if (draftLists.length && (!recentWave || lastWaveOut)) {
        out.push({
          ...base,
          id: `draft:${c.id}`,
          sig: 'stale',
          severity: 'red',
          title: `An unapproved ${label} draft has been waiting over 30 hours`,
          detail: [
            `Draft campaign ${c.id} on ${listLabel(draftLists)} was built ${longDate(new Date(created!).toISOString())}${lastWaveOut ? ', and every wave of it has already gone out' : ''}. A draft left on a real list can be approved by mistake later and would reach everyone on it.`,
            'Approve it if it’s due; if it isn’t going out, ask Claude to delete the draft.',
          ],
        })
      }
    }
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
