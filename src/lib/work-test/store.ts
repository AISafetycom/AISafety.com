/*
  The work test's Airtable tables (see flow.ts for what the work test is).

  Three private tables in the main base, none of them a listing table and
  none read by any public page or by the Data API:

    Work test: items       the items, with our own decision on each
    Work test: candidates  one row per person, with their private link
    Work test: answers     one row per answer, by candidate code

  This file can only ever touch those three tables: every request names one
  of the ids below. That is the wall between the sandbox and the real Queue.

  Volume is a handful of people, so reads are not cached beyond the items
  (which change only when the owner edits the key).
*/

import { airtableRequest, listAll } from '@/lib/admin/airtable'
import type { Answer, Candidate, ItemRow, Part } from './flow'

const ITEMS_TABLE = 'tblJgUZB3KDcHN9tH'
const CANDIDATES_TABLE = 'tblfxDG8OTPbOps3v'
const ANSWERS_TABLE = 'tblEIeCOw1BxUBiCG'

const ITEM = {
  key: 'fldqiHhVEe3VcATbB', // Key
  part: 'fldQGwceVqVOdtRI2', // Part
  order: 'fldDkFHGznMmSDDsV', // Order
  name: 'fldPrbozQvkQEGBmt', // Name
  page: 'fldKfniJqO311HwT5', // Page
  link: 'fldzOycqm7Xm0sD9u', // Link
  decidedOn: 'fld6GBerF7uYQpDsY', // Decided on
  description: 'fldWTr18Hm7vq7iFx', // Description
  fields: 'fldT5tQoqwcSWxNtZ', // Fields (JSON object of label to value)
  source: 'fldx4IpXQHpFThVwf', // Source
  related: 'fldJC5Tf7qrHqgwux', // Related
  fableVerdict: 'fldPFxAcH2ws1OLGG', // Fable verdict
  fableReasons: 'fldnq1Vz8pzuuxrBW', // Fable reasons (one per line)
  prompt: 'fldmGCTKw9F5X6NLY', // Prompt
  answerKey: 'fldUAsJmX3IDmhSDX', // Answer key
  ourReason: 'fldibSwqGBs9TNAhC', // Our reason
} as const

const CANDIDATE = {
  code: 'fldtbfAX2cm7mDsmJ', // Code
  token: 'fldkQE3UQglw7JEO7', // Token
  startedAt: 'fldtZPAjclrltRoI2', // Started at
  roundOneAt: 'fld8aP7mCSsH7LaVZ', // Round one submitted at
  roundTwoStartedAt: 'fld6vzxsFFeiha9jO', // Round two started at
  roundTwoAt: 'fldNKdqTw85YHmEDN', // Round two submitted at
  finishedAt: 'fld8gCt0xF2LE4R1p', // Finished at
} as const

const ANSWER = {
  id: 'fldCBJBC2fV8OS9m0', // Id ("<code>:<item key>")
  candidate: 'fldamnb8NWers49pP', // Candidate
  item: 'fldvX5Pd2mOjVE0UF', // Item
  answer: 'fldNheUhSBInrl6Nj', // Answer
  text: 'fldYhaFp8kgWw6Zya', // Text
  savedAt: 'fld0Pri4TpVkNoeV4', // Saved at
} as const

type Fields = Record<string, unknown>

const PARTS: Part[] = [
  'Briefing',
  'Round one',
  'Round two',
  'Change check',
  'Description',
  'Reply',
  'Push back',
]

/** A private link's last part: letters and digits only, so it can go
 *  nowhere but a comparison. */
const TOKEN_RE = /^[A-Za-z0-9]{24,40}$/
export function isToken(token: string): boolean {
  return TOKEN_RE.test(token)
}

/** A candidate code is written into an Airtable formula, so it is checked
 *  the same way. */
const CODE_RE = /^[A-Z0-9]{1,12}$/

function text(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function byId(): URLSearchParams {
  return new URLSearchParams({ returnFieldsByFieldId: 'true' })
}

function toItem(f: Fields): ItemRow {
  const key = text(f[ITEM.key])
  const part = text(f[ITEM.part]) as Part
  if (!key || !PARTS.includes(part)) {
    throw new Error(`Work test item "${key}" has no valid Part`)
  }
  let fields: Record<string, string> = {}
  const raw = text(f[ITEM.fields]).trim()
  if (raw) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`Work test item ${key}: Fields is not valid JSON`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Work test item ${key}: Fields must be a JSON object`)
    }
    fields = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, String(v)])
    )
  }
  return {
    key,
    part,
    order: typeof f[ITEM.order] === 'number' ? (f[ITEM.order] as number) : 0,
    name: text(f[ITEM.name]),
    page: text(f[ITEM.page]),
    link: text(f[ITEM.link]),
    decidedOn: text(f[ITEM.decidedOn]),
    description: text(f[ITEM.description]),
    fields,
    source: text(f[ITEM.source]),
    related: text(f[ITEM.related]),
    fableVerdict: text(f[ITEM.fableVerdict]),
    fableReasons: text(f[ITEM.fableReasons])
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean),
    prompt: text(f[ITEM.prompt]),
    answerKey: text(f[ITEM.answerKey]),
    ourReason: text(f[ITEM.ourReason]),
  }
}

/** The items change only when the owner edits them, so one read serves a
 *  minute of requests. */
const ITEMS_TTL_MS = 60_000
let itemsCache: { at: number; rows: ItemRow[] } | null = null

export async function listItems(): Promise<ItemRow[]> {
  if (itemsCache && Date.now() - itemsCache.at < ITEMS_TTL_MS) {
    return itemsCache.rows
  }
  const rows = (await listAll<Fields>(ITEMS_TABLE, byId())).map(r =>
    toItem(r.fields)
  )
  itemsCache = { at: Date.now(), rows }
  return rows
}

export interface FoundCandidate {
  recordId: string
  candidate: Candidate
}

/** The candidate a private link belongs to, or null. The table is a few
 *  rows, so it is read whole and matched here rather than by a formula. */
export async function findCandidate(
  token: string
): Promise<FoundCandidate | null> {
  if (!isToken(token)) return null
  const rows = await listAll<Fields>(CANDIDATES_TABLE, byId())
  const row = rows.find(r => text(r.fields[CANDIDATE.token]) === token)
  if (!row) return null
  const code = text(row.fields[CANDIDATE.code])
  if (!CODE_RE.test(code)) {
    throw new Error('A work test candidate has no valid Code')
  }
  const stamp = (id: string) => text(row.fields[id]) || null
  return {
    recordId: row.id,
    candidate: {
      code,
      startedAt: stamp(CANDIDATE.startedAt),
      roundOneAt: stamp(CANDIDATE.roundOneAt),
      roundTwoStartedAt: stamp(CANDIDATE.roundTwoStartedAt),
      roundTwoAt: stamp(CANDIDATE.roundTwoAt),
      finishedAt: stamp(CANDIDATE.finishedAt),
    },
  }
}

/** Everything one candidate has saved, by item key. */
export async function listAnswers(
  code: string
): Promise<Record<string, Answer>> {
  if (!CODE_RE.test(code)) throw new Error('Invalid work test candidate code')
  const params = byId()
  // Formulas take field names, not ids: this is the "Candidate" column.
  params.set('filterByFormula', `{Candidate}='${code}'`)
  const rows = await listAll<Fields>(ANSWERS_TABLE, params)
  const out: Record<string, Answer> = {}
  for (const r of rows) {
    const key = text(r.fields[ANSWER.item])
    if (!key) continue
    out[key] = {
      answer: text(r.fields[ANSWER.answer]),
      text: text(r.fields[ANSWER.text]),
    }
  }
  return out
}

async function mustBeOk(res: Response, what: string): Promise<void> {
  if (res.ok) return
  throw new Error(
    `Airtable refused ${what}: ${res.status} ${(await res.text()).slice(0, 300)}`
  )
}

/** Writes one answer, replacing the candidate's earlier one for that item. */
export async function saveAnswer(
  code: string,
  key: string,
  answer: Answer
): Promise<void> {
  if (!CODE_RE.test(code)) throw new Error('Invalid work test candidate code')
  const res = await airtableRequest(ANSWERS_TABLE, {
    method: 'PATCH',
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn: [ANSWER.id] },
      records: [
        {
          fields: {
            [ANSWER.id]: `${code}:${key}`,
            [ANSWER.candidate]: code,
            [ANSWER.item]: key,
            [ANSWER.answer]: answer.answer,
            [ANSWER.text]: answer.text,
            [ANSWER.savedAt]: new Date().toISOString(),
          },
        },
      ],
    }),
  })
  await mustBeOk(res, 'the answer')
}

/** Sets one of a candidate's timestamps to now. */
export async function stampCandidate(
  recordId: string,
  field: Exclude<keyof Candidate, 'code'>
): Promise<void> {
  const res = await airtableRequest(`${CANDIDATES_TABLE}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: { [CANDIDATE[field]]: new Date().toISOString() },
    }),
  })
  await mustBeOk(res, 'the stage change')
}
