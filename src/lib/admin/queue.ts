/*
  The Queue: one Airtable table ("Queue", tblonlKwIFJ7Aa8QN) holding every
  proposed change or addition to the directory that is waiting for the owner.
  Rows are written by the bots on Bryce's Mac (Comb's Fable Review, Broom's
  Fable Review, the Secretary, the Discord intake); this file is the site's
  side — list the rows, and carry out a decision:

    accept  Add     → tick Publish? on the target record (plus any edits)
            Change  → write the proposed field values, drop the Broom flag row
            Rule    → mark Accepted; the Mac worker patches the rulebook
    reject          → mark Rejected with the reason (the worker deletes a
                      rejected suggestion 24 hours later, so there is an undo)
    revise          → mark Revising with a note; the worker asks Claude to
                      rewrite the proposal and puts it back as Pending
    undo            → reverse an accept or reject made in the last day

  Writes to the resource tables go through the raw admin client (no cache);
  after a publish or a field change the public cache tag is revalidated so
  the live pages pick it up within a few minutes. Field ids for the Queue
  table are permanent; target-record fields are addressed by NAME because
  the proposals name them and "Publish?"/"Hide?" are the same on every
  resource table.
*/

import { revalidateTag } from 'next/cache'
import {
  airtableRequest,
  isRecordId,
  listAll,
  type AirtableRow,
} from './airtable'
import { sealToken } from './session'

export const QUEUE_TABLE_ID = 'tblonlKwIFJ7Aa8QN'
const BROOM_ISSUES_TABLE_ID = 'tblntD3WITPEgjHRK'

const F = {
  title: 'fldeRsOE3DM3R2vbX',
  type: 'fldBc9YIDhjmu58f3',
  source: 'flddKkVy62MAZ8M0J',
  status: 'fldTXGYOoXcUApaI2',
  page: 'fldAMyLjM8CnXSRPX',
  targetTable: 'fld45SUjstUZROuXl',
  targetRecord: 'fldszXtLdUijgFG4l',
  issueRow: 'fld5zaEwhergaWYbF',
  sourceLink: 'fld4jnmGibDfKUwNx',
  sourceExcerpt: 'fld9VtbNjLpodrtA7',
  proposal: 'fldgl9Ny2jnu8T0Da',
  verdict: 'fld835yJytaSRAuvB',
  reasons: 'fldvEp4bscGNzBcSJ',
  rejectChips: 'fldw42wRz08vO5Xzq',
  replyDraft: 'fld8lCAVyjDEVZ8VV',
  replyStatus: 'fldQuPHr742txLFCo',
  rejectReason: 'fldYa0cnc5rQxAfAa',
  note: 'fldaV8eBHNEuNPIjp',
  edits: 'fldzCgKQbopgcbrwq',
  decidedAt: 'fldtt7z4lYvAR5t94',
  appliedAt: 'fldML8YnyaDYaAmTb',
  error: 'fldrJcvFN3FCcyQPn',
  dedupKey: 'fldHuxapq09JkiohE',
} as const

export type QueueType = 'Add' | 'Change' | 'Rule'
export type QueueSource =
  | 'Email'
  | 'Discord'
  | 'Broom'
  | 'Comb'
  | 'Form'
  | 'Teach'
export type QueueStatus =
  | 'Pending'
  | 'Revising'
  | 'Accepted'
  | 'Applied'
  | 'Rejected'
  | 'Failed'
  | 'Closed'
export type Verdict = 'Publish' | "Don't publish" | 'Unsure' | 'Fix' | 'Dismiss'

export interface ProposedChange {
  field: string
  from: unknown
  to: unknown
}

export interface QueueItem {
  id: string
  createdAt: string
  title: string
  type: QueueType
  source: QueueSource
  status: QueueStatus
  page: string | null
  targetTable: string | null
  targetRecord: string | null
  issueRow: string | null
  sourceLink: string | null
  sourceExcerpt: string | null
  /** The record's logo as the site shows it (from the site's own listing
   *  catalog for published records, else the Add snapshot), for the list. */
  logo: string | null
  /** Add: the proposed record, field name → value. */
  fields: Record<string, unknown> | null
  name: string | null
  url: string | null
  /** Change: the proposed field edits. */
  changes: ProposedChange[]
  /** Rule: the proposed rulebook diff (applied by the worker, never shown). */
  diff: string | null
  /** Rule: what changes, in plain words, and which rulebook it touches. */
  summary: string | null
  appliesTo: string | null
  verdict: Verdict | null
  reasons: string[]
  rejectChips: string[]
  replyDraft: string | null
  replyStatus: string | null
  /** The person's Discord profile picture (Discord's CDN only), shown
   *  beside what they wrote. */
  replyAvatar: string | null
  /** Email/Discord: who the reply draft goes to (from the proposal's
   *  `reply` block, written at intake by the Secretary). */
  replyTo: string | null
  rejectReason: string | null
  note: string | null
  edits: Record<string, unknown> | null
  decidedAt: string | null
  appliedAt: string | null
  error: string | null
}

type RawFields = Record<string, unknown>

/** Thrown for a problem the page should show as-is (bad input, already
 *  decided, Airtable refused). `status` is the HTTP status to answer with;
 *  `detail` is the text for the page, written here for the admin's eyes
 *  (the routes never echo a raw exception message). */
export class QueueError extends Error {
  status: number
  detail: string
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
    this.detail = message
  }
}

const TABLE_ID_RE = /^tbl[A-Za-z0-9]{14}$/
const PROTECTED_FIELDS = new Set(['Publish?', 'Hide?'])

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function lines(v: unknown): string[] {
  return typeof v === 'string'
    ? v
        .split('\n')
        .map(l => l.replace(/^[-–•*]\s*/, '').trim())
        .filter(Boolean)
    : []
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string' || v.trim() === '') return null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function toChanges(v: unknown): ProposedChange[] {
  if (!Array.isArray(v)) return []
  const out: ProposedChange[] = []
  for (const c of v) {
    if (!isRecord(c)) continue
    const field = str(c.field)
    if (!field) continue
    out.push({ field, from: c.from ?? null, to: c.to ?? null })
  }
  return out
}

/** Record id → logo URL for every published listing, from the chatbot's
 *  catalog (cached five minutes; its ids are "<type>:<record id>"). Empty
 *  when the catalog cannot be built: the list is not worth an error. */
async function catalogLogos(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    for (const l of (await getCatalog()).listings) {
      const rec = l.id.slice(l.id.indexOf(':') + 1)
      if (l.logo && isRecordId(rec) && !isExpiredAttachment(l.logo)) {
        out.set(rec, l.logo)
      }
    }
  } catch (e) {
    console.error(
      '[admin-queue] catalog logos',
      e instanceof Error ? e.message : e
    )
  }
  return out
}

/** Airtable attachment links carry their expiry (ms since the epoch) as a
 *  path segment and answer 410 after it. The site's cached data can hold
 *  such links for hours, so anything expiring within ten minutes is
 *  treated as gone and read afresh. */
function isExpiredAttachment(url: string): boolean {
  const m = /airtableusercontent\.com\/.*?\/(\d{13})\//.exec(url)
  return m ? Number(m[1]) < Date.now() + 10 * 60 * 1000 : false
}

const logoCache = new Map<string, { url: string | null; at: number }>()
const LOGO_TTL_MS = 5 * 60 * 1000

/** Logos for records the catalog does not cover (unpublished Add targets):
 *  one list read per table, attachment fields only, in chunks of 40 ids,
 *  cached five minutes. Never throws: a missing logo is not worth an error. */
async function targetLogos(
  rows: { table: string; record: string }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const byTable = new Map<string, string[]>()
  const now = Date.now()
  for (const { table, record } of rows) {
    if (!TABLE_ID_RE.test(table) || !isRecordId(record)) continue
    const hit = logoCache.get(record)
    if (hit && now - hit.at < LOGO_TTL_MS) {
      if (hit.url) out.set(record, hit.url)
      continue
    }
    const list = byTable.get(table) ?? []
    list.push(record)
    byTable.set(table, list)
  }
  await Promise.all(
    [...byTable].map(async ([table, records]) => {
      try {
        const fields = (await getTableSchema(table)).filter(
          f => f.type === 'multipleAttachments' && /logo|image/i.test(f.name)
        )
        if (!fields.length) return
        for (let i = 0; i < records.length; i += 40) {
          const chunk = records.slice(i, i + 40)
          const params = new URLSearchParams()
          params.set(
            'filterByFormula',
            `OR(${chunk.map(r => `RECORD_ID()='${r}'`).join(',')})`
          )
          for (const f of fields) params.append('fields[]', f.name)
          const seen = new Set<string>()
          for (const r of await listAll<RawFields>(table, params)) {
            let url: string | null = null
            for (const f of fields) {
              const v = r.fields[f.name]
              const first: unknown = Array.isArray(v) ? v[0] : null
              if (!isRecord(first)) continue
              const large =
                isRecord(first.thumbnails) && isRecord(first.thumbnails.large)
                  ? first.thumbnails.large.url
                  : first.url
              if (typeof large === 'string') {
                url = large
                break
              }
            }
            logoCache.set(r.id, { url, at: now })
            seen.add(r.id)
            if (url) out.set(r.id, url)
          }
          for (const r of chunk) {
            if (!seen.has(r)) logoCache.set(r, { url: null, at: now })
          }
        }
      } catch (e) {
        console.error(
          '[admin-queue] target logos',
          e instanceof Error ? e.message : e
        )
      }
    })
  )
  return out
}

/** The first picture in an Add snapshot's Logo/Image field. */
function snapshotLogo(fields: Record<string, unknown> | null): string | null {
  if (!fields) return null
  for (const [k, v] of Object.entries(fields)) {
    if (!/logo|image/i.test(k) || !Array.isArray(v) || !v.length) continue
    const first: unknown = v[0]
    const url =
      typeof first === 'string'
        ? first
        : isRecord(first) && typeof first.url === 'string'
          ? first.url
          : null
    // snapshots are days old; an expired link is read afresh instead
    if (url && !isExpiredAttachment(url)) return url
  }
  return null
}

/** Only a picture on Discord's own CDN is shown as someone's avatar: the
 *  proposal is written by the Mac-side bots, but the page must never be
 *  handed an arbitrary image URL. */
function discordCdnUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'cdn.discordapp.com'
      ? u.href
      : null
  } catch {
    return null
  }
}

function rowToItem(
  row: {
    id: string
    createdTime: string
    fields: RawFields
  },
  logos: Map<string, string> = new Map()
): QueueItem {
  const f = row.fields
  const proposal = parseJson(f[F.proposal])
  let fields: Record<string, unknown> | null = null
  let name: string | null = null
  let url: string | null = null
  let changes: ProposedChange[] = []
  let diff: string | null = null
  let summary: string | null = null
  let appliesTo: string | null = null
  let replyTo: string | null = null
  let replyAvatar: string | null = null
  if (isRecord(proposal)) {
    changes = toChanges(proposal.changes)
    diff = str(proposal.diff)
    summary = str(proposal.summary)
    appliesTo = str(proposal.applies_to) ?? str(proposal.appliesTo)
    name = str(proposal.name)
    url = str(proposal.url)
    if (isRecord(proposal.reply)) {
      const to = str(proposal.reply.to)
      const who = str(proposal.reply.name)
      replyTo = to ? (who ? `${who} <${to}>` : to) : null
      replyAvatar = discordCdnUrl(str(proposal.reply.avatar))
    }
    if (isRecord(proposal.fields)) {
      fields = proposal.fields
    } else if (changes.length === 0 && !diff) {
      const rest: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(proposal)) {
        if (k !== 'name' && k !== 'url') rest[k] = v
      }
      fields = rest
    }
  }
  const edits = parseJson(f[F.edits])
  return {
    id: row.id,
    createdAt: row.createdTime,
    title: str(f[F.title]) ?? name ?? '(untitled)',
    type: (str(f[F.type]) as QueueType | null) ?? 'Add',
    source: (str(f[F.source]) as QueueSource | null) ?? 'Comb',
    status: (str(f[F.status]) as QueueStatus | null) ?? 'Pending',
    page: str(f[F.page]),
    targetTable: str(f[F.targetTable]),
    targetRecord: str(f[F.targetRecord]),
    issueRow: str(f[F.issueRow]),
    sourceLink: str(f[F.sourceLink]),
    sourceExcerpt: str(f[F.sourceExcerpt]),
    logo:
      (str(f[F.targetRecord]) && logos.get(str(f[F.targetRecord]) ?? '')) ||
      snapshotLogo(fields),
    fields,
    name,
    url,
    changes,
    diff,
    summary,
    appliesTo,
    verdict: str(f[F.verdict]) as Verdict | null,
    reasons: lines(f[F.reasons]),
    rejectChips: lines(f[F.rejectChips]),
    replyDraft: str(f[F.replyDraft]),
    replyStatus: str(f[F.replyStatus]),
    replyTo,
    replyAvatar,
    rejectReason: str(f[F.rejectReason]),
    note: str(f[F.note]),
    edits: isRecord(edits) ? edits : null,
    decidedAt: str(f[F.decidedAt]),
    appliedAt: str(f[F.appliedAt]),
    error: str(f[F.error]),
  }
}

// Open rows, plus anything decided in the last day (the "Done today" strip
// with its Undo buttons).
const LIST_FORMULA =
  "OR({Status}='Pending',{Status}='Revising',{Status}='Accepted',{Status}='Failed'," +
  "AND(OR({Status}='Applied',{Status}='Rejected'),IS_AFTER({Decided at},DATEADD(NOW(),-1,'day'))))"

/** The rows, and nothing else: one paginated read of the Queue table, so
 *  the page has its list in about a second. A logo here comes only from
 *  the proposal snapshot; the rest arrive through queueLogos() once the
 *  list is on screen, because those need the site's catalog (every table,
 *  seconds when its cache is cold, which every accept makes it) and a read
 *  per table for unpublished targets. */
export async function listQueue(): Promise<QueueItem[]> {
  const params = new URLSearchParams()
  params.set('returnFieldsByFieldId', 'true')
  params.set('filterByFormula', LIST_FORMULA)
  const rows = await listAll<RawFields>(QUEUE_TABLE_ID, params)
  return rows.map(r => rowToItem(r))
}

/** Logo URL by target record for the rows that came without one: the
 *  site's catalog for published listings, then one batched read per table
 *  for the rest (Comb's unpublished Adds). Records without a picture are
 *  left out. Never throws: a missing logo is not worth an error. */
export async function queueLogos(
  targets: { table: string; record: string }[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  // record → table, deduplicated
  const wanted = new Map<string, string>()
  for (const t of targets) {
    if (TABLE_ID_RE.test(t.table) && isRecordId(t.record)) {
      wanted.set(t.record, t.table)
    }
  }
  if (!wanted.size) return out
  const catalog = await catalogLogos()
  const rest: { table: string; record: string }[] = []
  for (const [record, table] of wanted) {
    const url = catalog.get(record)
    if (url) out[record] = url
    else rest.push({ table, record })
  }
  if (rest.length) {
    for (const [record, url] of await targetLogos(rest)) out[record] = url
  }
  return out
}

export async function getQueueItem(id: string): Promise<QueueItem | null> {
  if (!isRecordId(id)) return null
  const res = await airtableRequest(
    `${QUEUE_TABLE_ID}/${id}?returnFieldsByFieldId=true`
  )
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) {
    throw new QueueError(
      `Airtable read failed: ${res.status} ${await res.text()}`,
      502
    )
  }
  // No logo lookup here (it can cost a catalog build): the page keeps the
  // picture it already shows when a decision comes back.
  return rowToItem(
    (await res.json()) as {
      id: string
      createdTime: string
      fields: RawFields
    }
  )
}

// ─── The target record, live ────────────────────────────────────────────────

export interface FieldInfo {
  id: string
  name: string
  /** Airtable field type: singleSelect, multipleSelects, checkbox, date,
   *  number, multilineText, url, multipleAttachments, … */
  type: string
  /** The options of a select field, in Airtable's order. */
  choices?: string[]
}

const schemaCache = new Map<string, { at: number; fields: FieldInfo[] }>()
const SCHEMA_TTL_MS = 10 * 60 * 1000

/** Every field of a resource table, in Airtable's column order, so the page
 *  can list what is EMPTY on a record (a missing logo, an empty location)
 *  and not only what is filled. Read from the base's metadata, cached. */
export async function getTableSchema(table: string): Promise<FieldInfo[]> {
  if (!TABLE_ID_RE.test(table)) return []
  const hit = schemaCache.get(table)
  if (hit && Date.now() - hit.at < SCHEMA_TTL_MS) return hit.fields
  const token = process.env.AIRTABLE_TOKEN
  const base = process.env.AIRTABLE_BASE_ID
  if (!token || !base) return []
  const res = await fetch(
    `https://api.airtable.com/v0/meta/bases/${base}/tables`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  )
  if (!res.ok) return []
  const data = (await res.json()) as {
    tables: {
      id: string
      fields: {
        id: string
        name: string
        type: string
        options?: { choices?: { name: string }[] }
      }[]
    }[]
  }
  for (const t of data.tables) {
    schemaCache.set(t.id, {
      at: Date.now(),
      fields: t.fields
        .filter(f => !PROTECTED_FIELDS.has(f.name))
        .map(f => {
          const choices = f.options?.choices?.map(c => c.name)
          return choices?.length
            ? { id: f.id, name: f.name, type: f.type, choices }
            : { id: f.id, name: f.name, type: f.type }
        }),
    })
  }
  return schemaCache.get(table)?.fields ?? []
}

/** The target record's fields as they are in Airtable right now, keyed by
 *  field NAME. Attachments become a list of URLs (the large thumbnail when
 *  Airtable made one, else the file); Publish?/Hide? are dropped. Used for
 *  the focused item, because the snapshot on the queue row was taken when
 *  the row was written and Airtable's attachment URLs expire within hours. */
export async function getTargetFields(
  table: string,
  record: string
): Promise<Record<string, unknown> | null> {
  if (!TABLE_ID_RE.test(table) || !isRecordId(record)) return null
  const res = await airtableRequest(`${table}/${record}`)
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) {
    throw new QueueError(
      `Airtable read failed: ${res.status} ${await res.text()}`,
      502
    )
  }
  const data = (await res.json()) as { fields: RawFields }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data.fields)) {
    if (PROTECTED_FIELDS.has(k)) continue
    if (
      Array.isArray(v) &&
      v.length &&
      v.every(isRecord) &&
      v.every(x => typeof x.url === 'string')
    ) {
      out[k] = v.map(x => {
        const large =
          isRecord(x.thumbnails) && isRecord(x.thumbnails.large)
            ? x.thumbnails.large.url
            : null
        return typeof large === 'string' ? large : (x.url as string)
      })
    } else if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      (Array.isArray(v) && v.every(x => typeof x === 'string'))
    ) {
      out[k] = v
    }
  }
  return out
}

// ─── Preview through the site's own code ────────────────────────────────────

import {
  communityFromRecord,
  TABLE_ID as COMMUNITIES_TABLE,
} from '@/lib/data/communities'
import { eventFromRecord, TABLE_ID as EVENTS_TABLE } from '@/lib/data/events'
import {
  recurringProgramFromRecord,
  trainingProgramFromRecord,
} from '@/lib/data/training'
import { funderFromRecord, TABLE_ID as FUNDING_TABLE } from '@/lib/data/funding'
import {
  courseFromRecord,
  TABLE_ID as SELF_STUDY_TABLE,
} from '@/lib/data/self-study'
import {
  mediaChannelFromRecord,
  TABLE_ID as MEDIA_TABLE,
} from '@/lib/data/media-channels'
import {
  advisorFromRecord,
  TABLE_ID as ADVISORS_TABLE,
} from '@/lib/data/advisors'
import {
  projectFromRecord,
  TABLE_ID as PROJECTS_TABLE,
} from '@/lib/data/projects'
import {
  founderResourceFromRecord,
  TABLE_ID as FOUNDERS_TABLE,
} from '@/lib/data/founders'
import { mapOrgFromRecord, TABLE_ID as MAP_TABLE } from '@/lib/data/map'
import { getCatalog } from '@/lib/assistant/catalog'
import type { AirtableRawRecord } from '@/lib/data/airtable'

const TRAINING_TABLE = 'tbli1YSCpIuNY2DvL'
const RECURRING_TABLE = 'tblEEIbj6dW5oS4cX'

export type PreviewKind =
  | 'community'
  | 'event'
  | 'training'
  | 'recurring'
  | 'funder'
  | 'course'
  | 'mediaChannel'
  | 'advisor'
  | 'project'
  | 'founder'
  | 'mapOrg'

export interface PreviewListing {
  kind: PreviewKind
  listing: unknown
}

/** The record as the site would show it: read with fields keyed by id (the
 *  shape the page mappers take), the admin's edits laid over it by field
 *  name, then mapped by that table's own record-to-listing function. Null
 *  when the mapper skips the record. */
export async function getPreviewListing(
  table: string,
  record: string,
  edits: Record<string, unknown>
): Promise<PreviewListing | null> {
  if (!TABLE_ID_RE.test(table) || !isRecordId(record)) return null
  const res = await airtableRequest(
    `${table}/${record}?returnFieldsByFieldId=true`
  )
  if (!res.ok) return null
  const raw = (await res.json()) as AirtableRow<Record<string, unknown>>
  const byName = Object.keys(edits).length
    ? new Map((await getTableSchema(table)).map(f => [f.name, f.id]))
    : new Map<string, string>()
  return mapPreview(table, raw, edits, byName)
}

export interface PreviewTarget {
  table: string
  record: string
  edits: Record<string, unknown>
}

/** Every open item's card in one go, so the page can hold them ready
 *  before an item is opened: one list read per 40 records of a table
 *  (Airtable allows five requests a second, so tables run one after
 *  another), keyed "table/record". Unknown or deleted records map to null. */
export async function getPreviewListings(
  targets: PreviewTarget[]
): Promise<Record<string, PreviewListing | null>> {
  const out: Record<string, PreviewListing | null> = {}
  const byTable = new Map<string, PreviewTarget[]>()
  for (const t of targets) {
    if (!TABLE_ID_RE.test(t.table) || !isRecordId(t.record)) continue
    const list = byTable.get(t.table) ?? []
    list.push(t)
    byTable.set(t.table, list)
  }
  for (const [table, list] of byTable) {
    const byName = new Map(
      (await getTableSchema(table)).map(f => [f.name, f.id])
    )
    for (let i = 0; i < list.length; i += 40) {
      const chunk = list.slice(i, i + 40)
      const params = new URLSearchParams()
      params.set('returnFieldsByFieldId', 'true')
      params.set(
        'filterByFormula',
        `OR(${chunk.map(t => `RECORD_ID()='${t.record}'`).join(',')})`
      )
      const rows = new Map(
        (await listAll<Record<string, unknown>>(table, params)).map(r => [
          r.id,
          r,
        ])
      )
      for (const t of chunk) {
        const r = rows.get(t.record)
        out[`${table}/${t.record}`] = r
          ? mapPreview(
              table,
              { ...r, fields: { ...r.fields } },
              t.edits,
              byName
            )
          : null
      }
    }
  }
  return out
}

/** The record with the edits laid over it (by field name → id), mapped by
 *  that table's own record-to-listing function. */
function mapPreview(
  table: string,
  raw: AirtableRow<Record<string, unknown>>,
  edits: Record<string, unknown>,
  byName: Map<string, string>
): PreviewListing | null {
  for (const [name, value] of Object.entries(edits)) {
    const id = byName.get(name)
    if (id) raw.fields[id] = value
  }
  const rec = raw as unknown as AirtableRawRecord
  const wrap = (kind: PreviewKind, listing: unknown): PreviewListing | null =>
    listing ? { kind, listing } : null
  switch (table) {
    case COMMUNITIES_TABLE:
      return wrap('community', communityFromRecord(rec))
    case EVENTS_TABLE:
      return wrap('event', eventFromRecord(rec))
    case TRAINING_TABLE:
      return wrap('training', trainingProgramFromRecord(rec))
    case RECURRING_TABLE:
      return wrap('recurring', recurringProgramFromRecord(rec))
    case FUNDING_TABLE:
      return wrap('funder', funderFromRecord(rec))
    case SELF_STUDY_TABLE:
      return wrap('course', courseFromRecord(rec))
    case MEDIA_TABLE:
      return wrap('mediaChannel', mediaChannelFromRecord(rec))
    case ADVISORS_TABLE:
      return wrap('advisor', advisorFromRecord(rec))
    case PROJECTS_TABLE:
      return wrap('project', projectFromRecord(rec))
    case FOUNDERS_TABLE:
      return wrap('founder', founderResourceFromRecord(rec))
    case MAP_TABLE:
      return wrap('mapOrg', mapOrgFromRecord(rec))
    default:
      return null
  }
}

// ─── Image upload ───────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Puts one image into an attachment field of the target record, replacing
 *  whatever was there (a logo slot holds one picture). Goes through
 *  Airtable's upload endpoint, so no public URL is needed. The record is
 *  unpublished, so nothing reaches the site until Accept. */
export async function uploadImage(
  table: string,
  record: string,
  field: string,
  file: { filename: string; contentType: string; base64: string }
): Promise<string[]> {
  if (!TABLE_ID_RE.test(table) || !isRecordId(record)) {
    throw new QueueError('This item has no valid target record.', 400)
  }
  const schema = await getTableSchema(table)
  const info = schema.find(f => f.name === field)
  if (!info || info.type !== 'multipleAttachments') {
    throw new QueueError(`"${field}" is not an image field.`, 400)
  }
  if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.contentType)) {
    throw new QueueError('Only PNG, JPEG, WebP, GIF or SVG images.', 400)
  }
  const bytes = Math.floor((file.base64.length * 3) / 4)
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new QueueError('That image is over 5 MB.', 400)
  }
  const token = process.env.AIRTABLE_TOKEN
  const base = process.env.AIRTABLE_BASE_ID
  if (!token || !base) throw new QueueError('Airtable is not configured.', 500)
  const res = await fetch(
    `https://content.airtable.com/v0/${base}/${record}/${encodeURIComponent(field)}/uploadAttachment`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contentType: file.contentType,
        filename: file.filename.slice(0, 120) || 'image',
        file: file.base64,
      }),
      cache: 'no-store',
    }
  )
  if (!res.ok) {
    throw new QueueError(
      `Airtable refused the upload: ${res.status} ${(await res.text()).slice(0, 300)}`,
      502
    )
  }
  // The upload reply keys fields by id, so re-read the record by name.
  const after = await airtableRequest(`${table}/${record}`)
  if (!after.ok) {
    throw new QueueError(
      `Airtable read failed after upload: ${after.status}`,
      502
    )
  }
  const stored = ((await after.json()) as { fields: RawFields }).fields[field]
  const list = Array.isArray(stored)
    ? stored.filter(
        (
          x
        ): x is {
          id: string
          url: string
          thumbnails?: { large?: { url?: string } }
        } =>
          isRecord(x) && typeof x.id === 'string' && typeof x.url === 'string'
      )
    : []
  const newest = list[list.length - 1]
  if (newest && list.length > 1) {
    // A logo slot holds one picture: keep only the one just dropped.
    await patchRecord(table, record, { [field]: [{ id: newest.id }] })
  }
  if (!newest) return []
  return [newest.thumbnails?.large?.url ?? newest.url]
}

// ─── Airtable helpers ───────────────────────────────────────────────────────

async function patchRecord(
  table: string,
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  const res = await airtableRequest(`${table}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new QueueError(
      res.status === 429
        ? 'Airtable is rate-limiting right now. Try again in a few seconds.'
        : `Airtable refused the change: ${res.status} ${text.slice(0, 300)}`,
      502
    )
  }
}

/** True when the record exists (in this base). */
async function recordExists(table: string, id: string): Promise<boolean> {
  // The single-record endpoint takes no fields[] filter; the row is small.
  const res = await airtableRequest(`${table}/${id}`)
  if (res.status === 404 || res.status === 403) return false
  if (!res.ok) {
    throw new QueueError(
      `Airtable read failed: ${res.status} ${await res.text()}`,
      502
    )
  }
  return true
}

/** Deletes a record; a record that is already gone is not an error. */
async function deleteRecord(table: string, id: string): Promise<void> {
  const res = await airtableRequest(`${table}/${id}`, { method: 'DELETE' })
  if (res.ok || res.status === 404 || res.status === 403) return
  throw new QueueError(
    `Airtable refused the delete: ${res.status} ${await res.text()}`,
    502
  )
}

async function patchQueueRow(
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  await patchRecord(QUEUE_TABLE_ID, id, fields)
}

function target(item: QueueItem): { table: string; record: string } {
  const table = item.targetTable ?? ''
  const record = item.targetRecord ?? ''
  if (!TABLE_ID_RE.test(table) || !isRecordId(record)) {
    throw new QueueError('This item has no valid target record.', 400)
  }
  return { table, record }
}

/** Field name → value pairs the admin typed, checked before they reach
 *  Airtable: names must be plain short strings and never the publish flags. */
/** A picture as a proposal carries it — `{url, filename}` or a list of
 *  those — in the one shape Airtable writes to an attachment field and the
 *  site's card reads from one: a list of `{url, filename}`. Null for
 *  anything else (a bare URL string is a text field's value, not a file). */
export function asAttachments(
  v: unknown
): { url: string; filename: string }[] | null {
  const list = Array.isArray(v) ? v : [v]
  if (!list.length) return null
  const out: { url: string; filename: string }[] = []
  for (const x of list) {
    if (!isRecord(x) || typeof x.url !== 'string') return null
    const url = x.url.trim()
    if (!/^https?:\/\//i.test(url) || url.length > 2000) return null
    let filename =
      typeof x.filename === 'string' ? x.filename.trim().slice(0, 120) : ''
    if (!filename) {
      try {
        filename = decodeURIComponent(
          new URL(url).pathname.split('/').pop() ?? ''
        )
      } catch {
        filename = ''
      }
    }
    out.push({ url, filename: filename || 'image' })
  }
  return out
}

export function sanitiseEdits(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    const name = k.trim()
    if (!name || name.length > 100 || PROTECTED_FIELDS.has(name)) continue
    const files = asAttachments(v)
    if (files) {
      out[name] = files
      continue
    }
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      (Array.isArray(v) && v.every(x => typeof x === 'string'))
    ) {
      out[name] = v === '' ? null : v
    }
  }
  return out
}

function now(): string {
  return new Date().toISOString()
}

function refreshCache(): void {
  revalidateTag('airtable-records', 'max')
}

function requireOpen(item: QueueItem): void {
  if (item.status !== 'Pending' && item.status !== 'Failed') {
    throw new QueueError(
      `This item is already ${item.status.toLowerCase()}. Reload the page.`,
      409
    )
  }
}

// ─── Decisions ──────────────────────────────────────────────────────────────

export async function acceptItem(
  item: QueueItem,
  edits: Record<string, unknown>,
  replyDraft: string | null = null
): Promise<void> {
  requireOpen(item)
  const stamp = now()
  const editsJson = Object.keys(edits).length ? JSON.stringify(edits) : null
  // The reply draft as it reads on the page goes on the row first, so the
  // Mac agent (or the worker) saves exactly what the admin approved.
  const draft =
    replyDraft !== null && item.replyDraft !== null
      ? replyDraft.trim().slice(0, 5000)
      : null
  const draftFields: Record<string, unknown> =
    draft !== null && draft !== item.replyDraft ? { [F.replyDraft]: draft } : {}
  try {
    if (item.type === 'Add') {
      const t = target(item)
      await patchRecord(t.table, t.record, { ...edits, 'Publish?': true })
    } else if (item.type === 'Change') {
      const t = target(item)
      const fields: Record<string, unknown> = {}
      for (const c of item.changes) {
        if (PROTECTED_FIELDS.has(c.field) || c.field.length > 100) continue
        // A proposed picture goes to Airtable as an attachment list.
        fields[c.field] =
          c.field in edits ? edits[c.field] : (asAttachments(c.to) ?? c.to)
      }
      if (Object.keys(fields).length === 0) {
        // Accepting a flag with no proposed change: the flag is real and
        // the admin handles it by hand, so the Broom issue row stays; the
        // Mac worker marks this row Applied once that issue is cleared.
        await patchQueueRow(item.id, {
          ...draftFields,
          [F.status]: 'Accepted',
          [F.decidedAt]: stamp,
          [F.error]: null,
        })
        return
      }
      await patchRecord(t.table, t.record, fields)
      if (item.issueRow && isRecordId(item.issueRow)) {
        await deleteRecord(BROOM_ISSUES_TABLE_ID, item.issueRow)
      }
    } else {
      // Rule: the file lives on the Mac; the worker applies it.
      await patchQueueRow(item.id, {
        ...draftFields,
        [F.status]: 'Accepted',
        [F.decidedAt]: stamp,
        [F.error]: null,
      })
      return
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await patchQueueRow(item.id, {
      [F.status]: 'Failed',
      [F.error]: msg.slice(0, 1000),
    }).catch(() => {})
    throw e
  }
  await patchQueueRow(item.id, {
    ...draftFields,
    [F.status]: 'Applied',
    [F.decidedAt]: stamp,
    [F.appliedAt]: stamp,
    [F.edits]: editsJson,
    [F.error]: null,
  })
  refreshCache()
}

// ─── The local agent on the owner's Mac ─────────────────────────────────────

/** A Gmail draft, a Discord send or a rulebook patch cannot run on Vercel;
 *  a small agent on the owner's Mac (~/Queue/agent.py, loopback only) does
 *  them the moment Accept is clicked. The page calls it directly and shows
 *  it this token, sealed with the secret both sides hold, so a stray page
 *  in the same browser cannot drive the agent. Null when the secret is not
 *  configured: the page then leaves those steps to the Mac worker. */
export interface AgentInfo {
  port: number
  token: string
}

const AGENT_TOKEN_LIFE_SECONDS = 12 * 60 * 60

export function agentInfo(email: string): AgentInfo | null {
  const secret = process.env.QUEUE_AGENT_SECRET
  if (!secret || !email) return null
  const port = Number(process.env.QUEUE_AGENT_PORT) || 8790
  const iat = Math.floor(Date.now() / 1000)
  const token = sealToken(
    {
      v: 1,
      kind: 'queue-agent',
      email,
      iat,
      exp: iat + AGENT_TOKEN_LIFE_SECONDS,
    },
    secret
  )
  return { port, token }
}

export async function rejectItem(
  item: QueueItem,
  reason: string
): Promise<void> {
  requireOpen(item)
  const why = reason.trim()
  if (!why && item.type !== 'Rule') {
    throw new QueueError('A reason is needed so the bots can learn from it.')
  }
  const stamp = now()
  const fields: Record<string, unknown> = {
    [F.status]: 'Rejected',
    [F.rejectReason]: why || null,
    [F.decidedAt]: stamp,
    [F.error]: null,
  }
  if (item.type === 'Change' && item.issueRow && isRecordId(item.issueRow)) {
    // A dismissed Broom flag is done with: clear the flag row now.
    await deleteRecord(BROOM_ISSUES_TABLE_ID, item.issueRow)
    fields[F.appliedAt] = stamp
  }
  await patchQueueRow(item.id, fields)
}

export async function reviseItem(item: QueueItem, note: string): Promise<void> {
  requireOpen(item)
  const text = note.trim()
  if (!text) throw new QueueError('Say what should change.')
  await patchQueueRow(item.id, {
    [F.status]: 'Revising',
    [F.note]: text.slice(0, 2000),
    [F.error]: null,
  })
}

export async function undoItem(item: QueueItem): Promise<void> {
  const reopen: Record<string, unknown> = {
    [F.status]: 'Pending',
    [F.decidedAt]: null,
    [F.appliedAt]: null,
    [F.rejectReason]: null,
    [F.error]: null,
  }
  if (item.status === 'Applied' && item.type === 'Add') {
    const t = target(item)
    await patchRecord(t.table, t.record, { 'Publish?': false })
    await patchQueueRow(item.id, reopen)
    refreshCache()
    return
  }
  if (item.status === 'Applied' && item.type === 'Change') {
    const t = target(item)
    const fields: Record<string, unknown> = {}
    for (const c of item.changes) {
      if (PROTECTED_FIELDS.has(c.field)) continue
      fields[c.field] = c.from ?? null
    }
    if (Object.keys(fields).length) await patchRecord(t.table, t.record, fields)
    await patchQueueRow(item.id, reopen)
    refreshCache()
    return
  }
  if (item.status === 'Rejected') {
    if (item.type === 'Add') {
      const t = target(item)
      if (!(await recordExists(t.table, t.record))) {
        throw new QueueError(
          'Too late: the record has already been deleted.',
          409
        )
      }
    }
    await patchQueueRow(item.id, reopen)
    return
  }
  if (
    item.status === 'Accepted' &&
    (item.type === 'Rule' || item.type === 'Change')
  ) {
    // A rule the worker has not applied yet, or a flag accepted without a
    // field change: nothing was written, so reopening is enough.
    await patchQueueRow(item.id, reopen)
    return
  }
  throw new QueueError(
    `Nothing to undo: the item is ${item.status.toLowerCase()}.`,
    409
  )
}
