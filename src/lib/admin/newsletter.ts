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
*/

import { createHash } from 'node:crypto'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function v3<T = any>(path: string): Promise<T> {
  const res = await fetch(`${base()}/api/3/${path}`, {
    headers: { 'Api-Token': apiKey() },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(
      `ActiveCampaign ${path.split('?')[0]}: ${res.status} ${await res.text()}`
    )
  }
  return res.json() as Promise<T>
}

async function v3put(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${base()}/api/3/${path}`, {
    method: 'PUT',
    headers: { 'Api-Token': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(
      `ActiveCampaign PUT ${path.split('?')[0]}: ${res.status} ${await res.text()}`
    )
  }
}

async function v1(
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
  })
  const out = (await res.json()) as Record<string, unknown>
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
}

interface RawMessage {
  id: string
  subject: string
  fromemail: string
  fromname: string
  html: string | null
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
  /** Empty when the draft passes every check and may be sent. */
  problems: string[]
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
  status: 'scheduled' | 'sending' | 'sent' | 'stopped' | 'paused'
  scheduledFor: string | null
  sentAt: string | null
  sentTo: number
  uniqueOpens: number | null
  unsubscribes: number | null
  listNames: string[]
}

const STATUS_NAMES: Record<string, SentSummary['status']> = {
  '1': 'scheduled',
  '2': 'sending',
  '3': 'paused',
  '4': 'stopped',
  '5': 'sent',
}

async function campaignListIds(campaignId: string): Promise<string[]> {
  const data = await v3<{ campaignLists: Array<{ list: string }> }>(
    `campaigns/${campaignId}/campaignLists`
  )
  return (data.campaignLists ?? []).map(l => String(l.list))
}

async function campaignMessageIds(campaignId: string): Promise<string[]> {
  const data = await v3<{ campaignMessages: Array<{ messageid: string }> }>(
    `campaigns/${campaignId}/campaignMessages`
  )
  return (data.campaignMessages ?? []).map(m => String(m.messageid))
}

async function message(messageId: string): Promise<RawMessage> {
  const data = await v3<{ message: RawMessage }>(`messages/${messageId}`)
  return data.message
}

async function listNames(): Promise<Map<string, string>> {
  const data = await v3<{ lists: Array<{ id: string; name: string }> }>(
    'lists?limit=100'
  )
  return new Map((data.lists ?? []).map(l => [String(l.id), l.name]))
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

async function allCampaigns(): Promise<RawCampaign[]> {
  const data = await v3<{ campaigns: RawCampaign[] }>(
    'campaigns?limit=100&orders[cdate]=DESC'
  )
  return data.campaigns ?? []
}

/** The checks `ac.py verify` runs, as a list of problems (empty = OK). */
async function checkDraft(
  campaign: RawCampaign,
  expectedListId: string | null
): Promise<{
  problems: string[]
  listIds: string[]
  messageId: string | null
  msg: RawMessage | null
}> {
  const problems: string[] = []
  if (campaign.status !== '0') {
    problems.push(
      `campaign status is ${STATUS_NAMES[campaign.status] ?? campaign.status}, expected draft`
    )
  }
  const listIds = await campaignListIds(campaign.id)
  if (listIds.length !== 1) {
    problems.push(
      `campaign is wired to ${listIds.length} lists, expected exactly one`
    )
  } else if (expectedListId != null && listIds[0] !== expectedListId) {
    problems.push(
      `campaign is wired to list ${listIds[0]}, expected ${expectedListId}`
    )
  }
  const messageIds = await campaignMessageIds(campaign.id)
  let msg: RawMessage | null = null
  if (messageIds.length !== 1) {
    problems.push(
      `campaign has ${messageIds.length} messages, expected exactly one`
    )
  } else {
    msg = await message(messageIds[0])
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
  return { problems, listIds, messageId: messageIds[0] ?? null, msg }
}

/** Pipeline drafts waiting for approval: draft campaigns whose message carries
 *  the content marker. Hand-made drafts in AC never show here. */
export async function listDrafts(): Promise<DraftSummary[]> {
  const campaigns = await allCampaigns()
  const names = await listNames()
  const out: DraftSummary[] = []
  for (const c of campaigns) {
    if (c.status !== '0') continue
    const messageIds = await campaignMessageIds(c.id)
    if (messageIds.length === 0) continue
    const msg = await message(messageIds[0])
    if (!MARKER_RE.test(msg.html ?? '')) continue
    const { problems, listIds } = await checkDraft(c, null)
    const listId = listIds.length === 1 ? listIds[0] : null
    out.push({
      id: c.id,
      name: c.name,
      subject: msg.subject,
      fromEmail: msg.fromemail,
      fromName: msg.fromname,
      createdAt: c.cdate,
      messageId: msg.id,
      listId,
      listName: listId ? (names.get(listId) ?? null) : null,
      activeContacts: listId ? await activeContactCount(listId) : null,
      problems,
      preview: previewText(msg.html ?? ''),
      cards: cardGroups(msg.html ?? ''),
    })
  }
  return out
}

const PREHEADER_RE = /<div style="display:none[^"]*"[^>]*>([\s\S]*?)<\/div>/

/** The preheader the renderer hides at the top of the email: the text mail
 *  apps show after the subject in the inbox. Tags stripped, the invisible
 *  padding (nbsp + zero-width non-joiner, as entities or characters) and
 *  common entities resolved. */
export function previewText(html: string): string | null {
  const m = PREHEADER_RE.exec(html)
  if (!m) return null
  const text = m[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&zwnj;|&#8204;|\u00a0|\u200c/g, ' ')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

/** The most recent sends (and anything scheduled or stuck), newest first. */
export async function listRecent(limit = 12): Promise<SentSummary[]> {
  const campaigns = await allCampaigns()
  const names = await listNames()
  const recent = campaigns
    .filter(c => c.status in STATUS_NAMES)
    .sort((a, b) =>
      String(b.ldate ?? b.sdate ?? '').localeCompare(
        String(a.ldate ?? a.sdate ?? '')
      )
    )
    .slice(0, limit)
  const out: SentSummary[] = []
  for (const c of recent) {
    const listIds = await campaignListIds(c.id)
    out.push({
      id: c.id,
      name: c.name,
      status: STATUS_NAMES[c.status],
      scheduledFor: c.sdate,
      sentAt: c.ldate,
      sentTo: Number(c.send_amt ?? 0),
      uniqueOpens: c.uniqueopens == null ? null : Number(c.uniqueopens),
      unsubscribes: c.unsubscribes == null ? null : Number(c.unsubscribes),
      listNames: listIds.map(id => names.get(id) ?? `list ${id}`),
    })
  }
  return out
}

/* ─── Reorderable cards ─────────────────────────────────────────────── */

const CARD_RE = /<!--card:(g\d+):([^>]+?)-->([\s\S]*?)<!--\/card-->/g
const MANIFEST_RE = /<!--aisafety-cards:([A-Za-z0-9+/=]+)-->/

export interface CardInfo {
  key: string
  title: string
  /** Hosted logo PNG (the same one the email shows), when the listing has one. */
  logo: string | null
}

export interface CardGroup {
  /** `g0`, `g1`… — the section's id in the card markers. */
  id: string
  /** The section heading ("New events", "Closing in the next two weeks"…). */
  label: string
  /** In document order. */
  cards: CardInfo[]
}

interface Manifest {
  v: number
  groups: CardGroup[]
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
  const info = new Map<string, { title: string; logo: string | null }>()
  for (const g of manifest.groups)
    for (const c of g.cards)
      info.set(`${g.id}:${c.key}`, {
        title: c.title,
        logo: typeof c.logo === 'string' && c.logo ? c.logo : null,
      })
  const groups = new Map<string, CardGroup>(
    manifest.groups.map(g => [g.id, { id: g.id, label: g.label, cards: [] }])
  )
  for (const b of cardBlocks(html)) {
    const g = groups.get(b.gid)
    if (!g) continue
    const meta = info.get(`${b.gid}:${b.key}`)
    g.cards.push({
      key: b.key,
      title: meta?.title ?? b.key,
      logo: meta?.logo ?? null,
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
  const textByKey = new Map<string, string>()
  for (const seg of manifest.text) if (seg.c) textByKey.set(seg.c, seg.t)
  const slots = new Map<string, string[]>(
    Object.entries(order).map(([gid, keys]) => [gid, [...keys]])
  )
  const text = manifest.text
    .map(seg => {
      if (!seg.c) return seg.t
      const gid = seg.c.split(':', 1)[0]
      const queue = slots.get(gid)
      if (!queue || queue.length === 0) return seg.t
      return textByKey.get(`${gid}:${queue.shift()}`) ?? seg.t
    })
    .join('')
  return { html, text }
}

/** Move the cards of a draft into `order` ({ groupId: keys }) inside
 *  ActiveCampaign: verify the draft first (same checks as approval), rewrite
 *  the message HTML + text, re-stamp the content marker, write it back, and
 *  re-check the live message. Returns the new card order. */
export async function reorderDraft(
  draftId: string,
  order: Record<string, string[]>
): Promise<{ cards: CardGroup[] }> {
  const campaigns = await allCampaigns()
  const draft = campaigns.find(c => c.id === draftId)
  if (!draft) throw new DraftProblemError(['draft campaign not found'])
  const { problems, messageId, msg } = await checkDraft(draft, null)
  if (problems.length > 0 || !messageId || !msg) {
    throw new DraftProblemError(
      problems.length > 0 ? problems : ['no message on the draft']
    )
  }
  const body = (msg.html ?? '').replace(MARKER_RE, '')
  const { html, text } = reorderHtml(body, order)
  const stamped = `<!--aisafety-issue:${contentDigest(html)}-->` + html
  await v3put(`messages/${messageId}`, { message: { html: stamped, text } })
  const live = await message(messageId)
  const liveHtml = live.html ?? ''
  const m = MARKER_RE.exec(liveHtml)
  if (!m || m[1] !== contentDigest(liveHtml)) {
    throw new Error(
      `message ${messageId} failed verification after the reorder — check the ActiveCampaign dashboard`
    )
  }
  const cards = cardGroups(liveHtml)
  if (!cards) throw new Error('card markers missing after the reorder')
  console.info(
    `[newsletter] draft ${draftId} reordered: ${Object.entries(order)
      .map(([g, k]) => `${g}=${k.join(',')}`)
      .join(' ')}`
  )
  return { cards }
}

/** The message HTML as a subscriber will see it, with AC's personalisation
 *  tags neutralised so the preview renders cleanly. */
export async function previewHtml(campaignId: string): Promise<string | null> {
  const messageIds = await campaignMessageIds(campaignId)
  if (messageIds.length !== 1) return null
  const msg = await message(messageIds[0])
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
async function accountUtcOffset(): Promise<string> {
  const campaigns = await allCampaigns()
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

export interface ScheduledSend {
  /** The new, sending campaign (the draft shell is deleted). */
  campaignId: string
  draftId: string
  sdate: string | null
  listName: string | null
  activeContacts: number | null
}

/** Verify the draft one last time, then schedule it to send in a couple of
 *  minutes. Refuses (DraftProblemError) on any verification problem. */
export async function approveAndSend(
  draftId: string,
  listId: string
): Promise<ScheduledSend> {
  const campaigns = await allCampaigns()
  const draft = campaigns.find(c => c.id === draftId)
  if (!draft) throw new DraftProblemError(['draft campaign not found'])
  const { problems, messageId } = await checkDraft(draft, listId)
  if (problems.length > 0 || !messageId) {
    throw new DraftProblemError(
      problems.length > 0 ? problems : ['no message on the draft']
    )
  }
  const offset = await accountUtcOffset()
  const sdate = formatLocal(
    new Date(Date.now() + SEND_DELAY_MINUTES * 60_000),
    offset
  )
  const created = await v1('campaign_create', {
    type: 'single',
    name: draft.name,
    status: 1,
    public: 0,
    tracklinks: 'all',
    sdate,
    [`p[${listId}]`]: listId,
    [`m[${messageId}]`]: 100,
  })
  const newId = String(created.id)
  const live = (await v3<{ campaign: RawCampaign }>(`campaigns/${newId}`))
    .campaign
  if (live.status !== '1' && live.status !== '2') {
    throw new Error(
      `scheduled campaign ${newId} has status ${STATUS_NAMES[live.status] ?? live.status} — check the ActiveCampaign dashboard`
    )
  }
  // The message now belongs to the sending campaign; the draft shell is noise.
  await v1('campaign_delete', { id: draftId })
  const names = await listNames()
  console.info(
    `[newsletter] draft ${draftId} approved → campaign ${newId} scheduled for ${live.sdate ?? sdate} on list ${listId}`
  )
  return {
    campaignId: newId,
    draftId,
    sdate: live.sdate ?? sdate,
    listName: names.get(listId) ?? null,
    activeContacts: await activeContactCount(listId),
  }
}
