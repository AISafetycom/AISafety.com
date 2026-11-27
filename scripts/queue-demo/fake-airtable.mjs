// A stand-in for Airtable for the local Queue demo (README.md in this
// folder). Loaded into the dev server with
//   NODE_OPTIONS="--import <absolute path to this file>"
// it answers every request the server makes to api.airtable.com from a JSON
// file of made-up rows (seed.mjs), and lets every other request through.
// Nothing reaches the real base: the server also runs with a placeholder
// token and base id, which Airtable itself would refuse.
//
// The state lives in a file, not in memory, so every process `next dev`
// starts sees the same rows, and a restart keeps them. Delete the file (or
// run start.sh with --reset) to start again from the seed.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { F, QUEUE, SCHEMA, seed } from './seed.mjs'

const TOKEN = process.env.AIRTABLE_TOKEN ?? ''
if (!TOKEN.startsWith('demo-')) {
  throw new Error(
    '[queue-demo] refusing to start: AIRTABLE_TOKEN must be the demo placeholder (start.sh sets it), so no request can reach the real base'
  )
}

const STATE =
  process.env.QUEUE_DEMO_STATE ||
  path.join(process.cwd(), '.admin-dev', 'queue-demo.json')

function load() {
  if (!existsSync(STATE)) save(seed())
  return JSON.parse(readFileSync(STATE, 'utf8'))
}

function save(state) {
  mkdirSync(path.dirname(STATE), { recursive: true })
  const tmp = `${STATE}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 1))
  renameSync(tmp, STATE)
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const notFound = () =>
  json({ error: { type: 'NOT_FOUND', message: 'Not in the demo' } }, 404)

function newId() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let id = 'recDEMONEW'
  while (id.length < 17) id += abc[Math.floor(Math.random() * abc.length)]
  return id
}

/** Applies a patch the way Airtable does: a null (or empty) value clears
 *  the field. */
function merge(fields, patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null || v === undefined || v === '') delete fields[k]
    else fields[k] = v
  }
  return fields
}

const DAY_MS = 86_400_000

/** The rows a Queue list asks for, from the few formulas the site uses
 *  (src/lib/admin/queue.ts): one listing's rows, every decided row, or the
 *  page's list (open rows, today's decisions, and anything For Bryce). */
function queueRows(state, formula) {
  const rows = Object.entries(state.queue).map(([id, r]) => ({ id, ...r }))
  const target = /\{fldszXtLdUijgFG4l\}='(rec[A-Za-z0-9]{14})'/.exec(formula)
  if (target) return rows.filter(r => r.fields[F.targetRecord] === target[1])
  if (formula.startsWith('NOT({Decided at}')) {
    return rows
      .filter(r => r.fields[F.decidedAt])
      .sort((a, b) => (a.fields[F.decidedAt] < b.fields[F.decidedAt] ? 1 : -1))
  }
  const now = Date.now()
  return rows.filter(r => {
    const f = r.fields
    if (['Pending', 'Revising', 'Accepted', 'Failed'].includes(f[F.status]))
      return true
    if (
      ['Applied', 'Rejected'].includes(f[F.status]) &&
      f[F.decidedAt] &&
      now - Date.parse(f[F.decidedAt]) < DAY_MS
    )
      return true
    return Boolean(f[F.forBryce])
  })
}

function answer(url, method, body) {
  const parts = url.pathname.split('/').filter(Boolean)
  // /v0/meta/bases/{base}/tables
  if (parts[1] === 'meta') return json({ tables: SCHEMA })
  const [, , table, record, sub] = parts
  const state = load()
  const isQueue = table === QUEUE
  const store = isQueue ? state.queue : (state.records[table] ??= {})
  const read = id => {
    if (isQueue) return state.queue[id] && { id, ...state.queue[id] }
    return (
      store[id] && {
        id,
        createdTime: '2026-11-01T00:00:00.000Z',
        fields: store[id],
      }
    )
  }
  if (sub === 'comments') return json({ comments: [] })
  if (!record) {
    if (method === 'GET') {
      const formula = url.searchParams.get('filterByFormula') ?? ''
      const records = isQueue
        ? queueRows(state, formula)
        : Object.keys(store)
            .map(read)
            .filter(
              r =>
                !formula.includes('Publish?') ||
                (r.fields['Publish?'] && !r.fields['Hide?'])
            )
      return json({ records })
    }
    // A batch: PATCH or POST { records: [{ id?, fields }] }.
    const out = []
    for (const r of body?.records ?? [{ fields: body?.fields }]) {
      const id = r.id ?? newId()
      if (isQueue) {
        state.queue[id] ??= {
          createdTime: new Date().toISOString(),
          fields: {},
        }
        merge(state.queue[id].fields, r.fields)
      } else {
        store[id] = merge(store[id] ?? {}, r.fields)
      }
      out.push(read(id))
    }
    save(state)
    console.log(`[queue-demo] ${method} ${table} ×${out.length}`)
    return json({ records: out })
  }
  if (method === 'GET') return read(record) ? json(read(record)) : notFound()
  if (method === 'DELETE') {
    if (!read(record)) return notFound()
    if (isQueue) delete state.queue[record]
    else delete store[record]
    save(state)
    console.log(`[queue-demo] DELETE ${table}/${record}`)
    return json({ id: record, deleted: true })
  }
  if (method === 'PATCH' || method === 'PUT') {
    if (!read(record)) return notFound()
    if (isQueue) merge(state.queue[record].fields, body?.fields)
    else merge(store[record], body?.fields)
    save(state)
    console.log(
      `[queue-demo] PATCH ${isQueue ? 'Queue' : table}/${record}: ${Object.keys(body?.fields ?? {}).join(', ')}`
    )
    return json(read(record))
  }
  return json({ error: { type: 'UNSUPPORTED' } }, 422)
}

const realFetch = globalThis.fetch
globalThis.fetch = async function demoFetch(input, init = {}) {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  if (!url.startsWith('https://api.airtable.com/'))
    return realFetch(input, init)
  const req =
    typeof input === 'object' && !(input instanceof URL) ? input : null
  const method = String(init.method ?? req?.method ?? 'GET').toUpperCase()
  const raw = init.body ?? (req && method !== 'GET' ? await req.text() : null)
  let body = null
  if (typeof raw === 'string' && raw) body = JSON.parse(raw)
  return answer(new URL(url), method, body)
}

console.log(`[queue-demo] Airtable is the demo file ${STATE}`)
