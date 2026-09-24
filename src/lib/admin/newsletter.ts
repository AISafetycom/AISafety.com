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

/** Statuses meaning an issue has gone, is going, or will go out: scheduled,
 *  sending, paused, sent, held for review. Stopped and disabled campaigns
 *  send nothing more, so approving the issue again is allowed after those. */
const LIVE_STATUSES = new Set(['1', '2', '3', '5', '7'])

/** Other campaigns carrying this issue's name that are live — candidates for
 *  "this issue already went out" (the caller checks they were on the same
 *  list; a test-list send of the same issue doesn't count). */
export function liveCampaignsNamed<
  C extends { id: string; name: string; status: string },
>(campaigns: C[], draftId: string, name: string): C[] {
  return campaigns.filter(
    c => c.id !== draftId && c.name === name && LIVE_STATUSES.has(c.status)
  )
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
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
  /** The card's "Consider applying if" line as plain text ('' when the card
   *  has none yet). Null when the card cannot carry one (events, training,
   *  or a funding draft built before the manifest recorded it). */
  fit: string | null
  /** Pen's original line as plain text, from the manifest, so an edit can
   *  be recognised and undone. Null for drafts built before 16 Sept 2026. */
  pipelineFit: string | null
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
    { title: string; logo: string | null; fit: string | null }
  >()
  for (const g of manifest.groups)
    for (const c of g.cards)
      info.set(`${g.id}:${c.key}`, {
        title: c.title,
        logo: typeof c.logo === 'string' && c.logo ? c.logo : null,
        fit: typeof c.fit === 'string' ? c.fit : null,
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

export class FitError extends Error {}

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

/** Move the cards of a draft into `order` ({ groupId: keys }) inside
 *  ActiveCampaign: verify the draft first (same checks as approval), rewrite
 *  the message HTML + text, re-stamp the content marker, write it back, and
 *  re-check the live message. Returns the new card order. */
export async function reorderDraft(
  draftId: string,
  order: Record<string, string[]>
): Promise<{ cards: CardGroup[] }> {
  return rewriteDraft(
    draftId,
    body => reorderHtml(body, order),
    `reordered: ${Object.entries(order)
      .map(([g, k]) => `${g}=${k.join(',')}`)
      .join(' ')}`
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
 *  marker, write it back through the v3 API and re-check the live message. */
async function rewriteDraft(
  draftId: string,
  change: (body: string) => { html: string; text: string },
  logLine: string
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
  const { html, text } = change(body)
  const stamped = `<!--aisafety-issue:${contentDigest(html)}-->` + html
  await v3put(`messages/${messageId}`, { message: { html: stamped, text } })
  const live = await message(messageId)
  const liveHtml = live.html ?? ''
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
  /** ActiveCampaign is holding the send for its compliance review ("Pending
   *  Approval"); it goes out once they approve it. */
  held: boolean
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
  // Never schedule the same issue to the same list twice: an earlier approval
  // may have gone through even though the page showed an error (or two tabs
  // were open), and a second one would reach every subscriber again.
  for (const c of liveCampaignsNamed(campaigns, draftId, draft.name)) {
    if ((await campaignListIds(c.id)).includes(listId)) {
      throw new DraftProblemError([
        `this issue already went to this list as campaign ${c.id} (${c.status === '7' ? 'held for review' : STATUS_NAMES[c.status]}) – approving it again would send it twice`,
      ])
    }
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
    // Off: ActiveCampaign's Google Analytics link tracking would append its
    // own utm_source/medium/content/campaign after the ones the renderer has
    // already put on every aisafety.com link (issue #20, 16 Sept 2026: two
    // utm_source values on one URL). Same flag in ac.py.
    tracklinksanalytics: 0,
    sdate,
    [`p[${listId}]`]: listId,
    [`m[${messageId}]`]: 100,
  })
  const newId = String(created.id)
  const live = (await v3<{ campaign: RawCampaign }>(`campaigns/${newId}`))
    .campaign
  // '7' = ActiveCampaign holds the send for its compliance review. The
  // campaign exists and will go out once they approve it, so this counts as
  // scheduled: the draft shell must go, or it could be approved a second time.
  const held = live.status === '7'
  if (live.status !== '1' && live.status !== '2' && !held) {
    throw new Error(
      `scheduled campaign ${newId} has status ${STATUS_NAMES[live.status] ?? live.status} — check the ActiveCampaign dashboard`
    )
  }
  // The message now belongs to the sending campaign; the draft shell is noise.
  await v1('campaign_delete', { id: draftId })
  const names = await listNames()
  console.info(
    `[newsletter] draft ${draftId} approved → campaign ${newId} ${held ? 'held for ActiveCampaign review' : 'scheduled'} for ${live.sdate ?? sdate} on list ${listId}`
  )
  return {
    campaignId: newId,
    held,
    draftId,
    sdate: live.sdate ?? sdate,
    listName: names.get(listId) ?? null,
    activeContacts: await activeContactCount(listId),
  }
}
