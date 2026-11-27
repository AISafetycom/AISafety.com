// A stand-in for the team chat's server agent, for the local Queue demo
// (README.md in this folder). The real agent runs the Fable chat on a
// server that takes no inbound connections: it asks the site for the
// requests people's pages have left, and posts each answer back in pieces
// (src/lib/admin/queue-team-chat.ts). This one does the same against the
// demo server on this computer, with canned replies in the real agent's
// own formats, so the whole flow can be tried and recorded with no server
// and no model:
//
//   node scripts/queue-demo/fake-team-agent.mjs [port] [--mac <port>] [--no-team]
//
// start.sh starts it. It talks only to http://localhost:<port>, seals its
// tokens with the demo's placeholder secret, and stops by itself: when
// .admin-dev/fake-team-agent.pid no longer names it (delete that file to
// stop it, or start another), or when the demo server has been gone for
// three minutes.
//
// What it answers, as the real one does:
//   /chat            a reply streamed as server-sent events; a message sent
//                    while one is being written answers 202 and waits
//   /chat/history    the thread, whether a reply is on its way, the
//                    messages waiting
//   /chat/interrupt  with stop: stops the reply being written
//   /chat/unqueue    takes a waiting message off the list
//   /chat/clear      Start over
//   /chat/file       a file sent earlier, as {ok, type, data: base64}
//
// Replies: a message about the description or the reply (and the first
// message of a thread) gets new wording as an `edits` block and, on an item
// with a reply draft, a `reply` block; "slow" gets a long reply to try Stop
// and waiting messages on; "verdict" gets a new verdict for the item, which
// the page writes onto the row; anything else a short plain answer.
//
// --mac <port> (start.sh --mac-chat) also stands in for the agent on the
// owner's Mac, which the owner's page calls directly on 127.0.0.1: the same
// canned chat over plain HTTP, with threads of its own, so the demo can
// show that the owner's chat is the Mac's and everyone else's the team's.
// It saves no drafts and writes nothing anywhere. --no-team leaves the
// team's side off (the page then says the chat's server is offline).

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { F } from './seed.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const dev = path.join(root, '.admin-dev')
const args = process.argv.slice(2)
const port = Number(args[0]) || 3471
const macPort = args.includes('--mac')
  ? Number(args[args.indexOf('--mac') + 1]) || 8795
  : null
const teamOn = !args.includes('--no-team')
const SITE = `http://localhost:${port}`
const SECRET =
  process.env.QUEUE_TEAM_AGENT_SECRET ||
  'queue-demo-team-agent-placeholder-not-a-secret'
const MAC_SECRET =
  process.env.QUEUE_AGENT_SECRET ||
  'queue-demo-mac-agent-placeholder-not-a-secret'

function refuse(why) {
  console.error(`[fake-team-agent] refusing to start: ${why}`)
  process.exit(1)
}
if (
  !SECRET.startsWith('queue-demo-') ||
  !MAC_SECRET.startsWith('queue-demo-')
) {
  refuse(
    'the agent secrets must be the demo placeholders (start.sh sets them), so this can never answer for a real site'
  )
}
// Any of them: .env, .env.local, .env.development, .env.development.local …
if (
  readdirSync(root).some(name => name === '.env' || name.startsWith('.env.'))
) {
  refuse(
    'this checkout has a .env file: the demo runs only where there is none'
  )
}

const PID_FILE = path.join(dev, 'fake-team-agent.pid')
const THREADS = path.join(dev, 'queue-demo-chat.json')
const ROWS = process.env.QUEUE_DEMO_STATE || path.join(dev, 'queue-demo.json')

const log = msg =>
  console.log(`${new Date().toISOString()} [fake-team-agent] ${msg}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const now = () => new Date().toISOString()
const seal = (body, secret) =>
  createHmac('sha256', secret).update(body).digest('base64url')

// ─── Talking to the site (the team's side) ──────────────────────────────────

/** A fresh token for every call, sealed as the site's own are: base64url
 *  JSON, a dot, and its HMAC-SHA256 under the shared secret. */
function token() {
  const iat = Math.floor(Date.now() / 1000)
  const body = Buffer.from(
    JSON.stringify({ v: 1, kind: 'queue-team-agent', iat, exp: iat + 60 })
  ).toString('base64url')
  return `${body}.${seal(body, SECRET)}`
}

/** One call to the site: {ok, status, body}. Throws only when the site
 *  cannot be reached at all. */
async function ask(body) {
  const res = await fetch(`${SITE}/api/admin/queue/chat/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
    },
    body: JSON.stringify(body),
  })
  return {
    ok: res.ok,
    status: res.status,
    body: await res.json().catch(() => ({})),
  }
}

async function call(body) {
  const res = await ask(body)
  if (!res.ok) {
    const said = res.body.error ? `: ${res.body.error}` : ''
    throw new Error(`HTTP ${res.status}${said}`)
  }
  return res.body
}

/** Whether the site made this request: its signature over the id, the
 *  path, who asked, when, and the body's text (signRequest in
 *  src/lib/admin/queue-team-relay.ts). Whoever can write to the site's
 *  store but does not hold the secret can forge neither. */
function signedBySite(r) {
  if (typeof r.sig !== 'string' || typeof r.bodyText !== 'string') return false
  const bodySha = createHash('sha256').update(r.bodyText, 'utf8').digest('hex')
  const name = Buffer.from(String(r.who?.name ?? ''), 'utf8').toString(
    'base64url'
  )
  const want = Buffer.from(
    seal(
      [r.id, r.path, r.who?.email, name, r.who?.mode, r.at, bodySha].join('\n'),
      SECRET
    )
  )
  const got = Buffer.from(r.sig)
  return got.length === want.length && timingSafeEqual(got, want)
}

/** The pieces of one answer for the site, sent in order: the status with
 *  the first. */
function relayOut(id) {
  let first = true
  let dead = false
  let chain = Promise.resolve()
  // Every piece so far, by seq: the site says where to send again from
  // when one went missing.
  const sent = []
  const post = async (chunks, more) => {
    if (dead) return
    const res = await ask({ op: 'chunks', id, chunks, ...more })
    if (res.ok) return
    if (res.body.code === 'seq_gap') {
      // A piece was lost on the way: all of them after the last one kept.
      const from = (res.body.last ?? -1) + 1
      await post(
        sent.slice(from).map((text, i) => ({ seq: from + i, text })),
        more
      )
      return
    }
    // Finished, gone, or left quiet too long: nothing more is wanted.
    dead = true
    log(`${id}: the site wants no more of it – ${res.body.code ?? res.status}`)
  }
  const send = (text, { status = 200, done = false } = {}) => {
    const head = first ? { status } : {}
    first = false
    const chunks = []
    if (text) {
      chunks.push({ seq: sent.length, text })
      sent.push(text)
    }
    chain = chain
      .then(() => post(chunks, { ...head, ...(done ? { done } : {}) }))
      .catch(e => log(`a piece of ${id} was not taken – ${e.message}`))
    return chain
  }
  return {
    /** A whole JSON answer; a big one in pieces of 256 KB. */
    json(status, body) {
      const text = JSON.stringify(body)
      const size = 256 * 1024
      if (text.length <= size) return send(text, { status, done: true })
      for (let i = 0; i < text.length; i += size) {
        send(text.slice(i, i + size), { status, done: i + size >= text.length })
      }
      return chain
    },
    /** A file: the pieces carry text, so as {ok, type, data: base64}. */
    file(type, data) {
      return this.json(200, { ok: true, type, data })
    },
    /** One server-sent event, as the real agent writes them. */
    event: ev => send(`data: ${JSON.stringify(ev)}\n\n`),
    end: () => send('', { done: true }),
  }
}

// ─── The threads (kept in a file, so a restart keeps them) ──────────────────

function load() {
  try {
    const st = JSON.parse(readFileSync(THREADS, 'utf8'))
    if (st && typeof st === 'object' && st.team && st.mac) return st
  } catch {
    // none yet
  }
  return { team: {}, mac: {} }
}
const state = load()
function save() {
  mkdirSync(dev, { recursive: true })
  const tmp = `${THREADS}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 1))
  renameSync(tmp, THREADS)
}

// ─── The canned replies ─────────────────────────────────────────────────────

const DESCRIPTIONS = {
  recDEMOEVENT00001:
    'A one-day unconference in Harbor City for people working on AI safety. Sessions are proposed and picked on the day.',
  recDEMOEVENT00002:
    'A weekly reading group that works through recent papers on evaluating AI models.',
  recDEMOEVENT00003:
    'An evening of short talks on careers in AI safety, with time for questions.',
  recDEMOCOMMUNITY1: 'An online chat for people building trading bots with AI.',
}

/** The demo's row and its listing, as the fake Airtable has them now. */
function itemOf(row) {
  try {
    const demo = JSON.parse(readFileSync(ROWS, 'utf8'))
    const fields = demo.queue?.[row]?.fields ?? {}
    return {
      title: fields[F.title] ?? 'this item',
      type: fields[F.type] ?? 'Add',
      recordId: fields[F.targetRecord] ?? '',
      record:
        demo.records?.[fields[F.targetTable]]?.[fields[F.targetRecord]] ?? null,
      replyDraft: fields[F.replyDraft] ?? '',
    }
  } catch {
    return {
      title: 'this item',
      type: 'Add',
      recordId: '',
      record: null,
      replyDraft: '',
    }
  }
}

function replyFor(row, message, who, asked) {
  const first = asked === 0
  const item = itemOf(row)
  const name = String(item.title).replace(/^Demo: /, '')
  const checked =
    who.mode === 'suggest'
      ? ` You are signed in as ${who.name} and Bryce checks your decisions first, so they go with your suggestion.`
      : ''
  if (/\b(slow|long)\b/i.test(message)) {
    const lines = Array.from(
      { length: 40 },
      (_, i) =>
        `${i + 1}. A made-up line about ${name}, written slowly so there is time to press Stop or send another message.`
    )
    return {
      tools: ['Reading the listing', 'Reading its page'],
      text: `Here is a long answer, one line at a time.\n\n${lines.join('\n')}`,
      pace: 140,
    }
  }
  if (/\b(verdict|flag)\b/i.test(message) && item.type !== 'Rule') {
    // As the real agent does: the new verdict rides on the message, not in
    // its text, and the page writes it onto the row when the reply lands.
    const add = item.type === 'Add'
    return {
      tools: ['Reading the listing', 'Checking its page'],
      text: add
        ? `I would not publish **${name}** yet: its page does not say who runs it. I have changed the verdict to Unsure.${checked}`
        : `The change to **${name}** no longer applies: its page already shows the new value. I have changed the flag to Dismiss.${checked}`,
      flag: add
        ? {
            verdict: 'Unsure',
            reasons: [
              'The page does not say who runs it',
              'A canned reason from the demo, not a real check',
            ],
            chips: ['Not about AI safety', 'Nobody to ask'],
          }
        : {
            verdict: 'Dismiss',
            reasons: ['The page already shows the new value'],
            chips: ['Already fixed'],
          },
      pace: 50,
    }
  }
  const wantsWording =
    first ||
    /\b(description|shorten|shorter|tighten|rewrite|reword|tidy|edit|fix|change|draft|reply|wording)\b/i.test(
      message
    )
  if (wantsWording && item.record && 'Description' in item.record) {
    const full =
      DESCRIPTIONS[item.recordId] ??
      `${String(item.record.Description).replace(/\.$/, '')}, described a little more plainly.`
    // Asked again, the wording differs: its first sentence only, then the
    // whole of it, turn about.
    const next =
      asked % 2 ? (/^.*?[.!?](?=\s|$)/.exec(full)?.[0] ?? full) : full
    const parts = [
      `Here is tighter wording for **${name}**${item.replyDraft ? ', and a reply to match' : ''}.`,
      '```edits\n' + JSON.stringify({ Description: next }, null, 1) + '\n```',
    ]
    if (item.replyDraft) {
      const hello = /^(Hi [^,\n]+,)/.exec(item.replyDraft)?.[1] ?? 'Hi,'
      parts.push(
        '```reply\n' +
          `${hello}\n\nThanks for sending this in. ${name} is now listed at aisafety.com/events, with a short description of the day.\n\nBest,\nBryce` +
          '\n```'
      )
    }
    parts.push(
      `${item.replyDraft ? 'Both are' : 'It is a'} draft${item.replyDraft ? 's' : ''} on this page: nothing reaches the site until the item is published.${checked}`
    )
    return {
      tools: ['Reading the listing', 'Checking the description rules'],
      text: parts.join('\n\n'),
      pace: 50,
    }
  }
  return {
    tools: ['Reading the listing'],
    text:
      `This is the demo's stand-in for Fable, so the answer is canned. About **${name}**:\n\n` +
      '- Ask for a shorter description and the reply carries new wording for the page.\n' +
      '- Say "slow" for a long reply, to try Stop or to send a second message while it is being written.\n\n' +
      `The real chat reads the listing, the web and the rulebooks before it answers.${checked}`,
    pace: 50,
  }
}

// ─── The chat itself: one per side, each with its own threads ───────────────

function chatFor(side) {
  const threads = state[side]
  /** row id → the reply being written there. */
  const running = new Map()
  const threadOf = row => {
    threads[row] ??= { messages: [], waiting: [], files: {} }
    return threads[row]
  }

  /** Write one reply: streamed to `out` when a page is listening, and kept
   *  in the thread either way. Then the next waiting message, if any. */
  async function run(row, mine, who, out) {
    const thread = threadOf(row)
    const job = { stopped: false }
    running.set(row, job)
    // How many replies the thread has had: the first gets new wording
    // whatever it asks, and wording asked for again comes out differently.
    const asked = thread.messages.filter(m => m.role === 'fable').length
    thread.messages.push(mine)
    save()
    const reply = replyFor(row, mine.text, who, asked)
    const parts = []
    let written = ''
    try {
      await out?.event({ type: 'start', account: 'demo', model: 'demo' })
      for (const label of reply.tools) {
        if (job.stopped) break
        parts.push({ t: 'tool', label })
        await out?.event({ type: 'tool', label })
        await sleep(500)
      }
      // A few words at a time, as a model writes.
      for (const piece of reply.text.match(/[\s\S]{1,24}/g) ?? []) {
        if (job.stopped) break
        written += piece
        await out?.event({ type: 'text', text: piece })
        await sleep(reply.pace)
      }
    } finally {
      running.delete(row)
    }
    if (written) parts.push({ t: 'text', text: written })
    const msg = {
      role: 'fable',
      parts,
      at: now(),
      account: 'demo',
      model: 'demo',
      ...(job.stopped
        ? {
            note:
              'You stopped this reply' + (written ? '' : ' before it answered'),
          }
        : reply.flag
          ? { flag: reply.flag }
          : {}),
    }
    thread.messages.push(msg)
    save()
    await out?.event({ type: 'done', message: msg })
    await out?.end()
    log(
      `${side} ${row}: ${job.stopped ? 'stopped' : 'answered'} for ${who.email}`
    )
    const next = thread.waiting.shift()
    if (next) {
      save()
      const { who: asker, ...held } = next
      void run(row, { role: 'you', ...held }, asker ?? who, null)
    }
  }

  /** Every thread's newest reply and the rows being answered: the Mac
   *  agent's /chat/status, for the list's teal bars. */
  function status() {
    const rows = {}
    for (const [row, t] of Object.entries(threads)) {
      const last = t.messages.findLast(m => m.role === 'fable')?.at
      if (last || running.has(row)) {
        rows[row] = {
          ...(last ? { last } : {}),
          ...(running.has(row) ? { answering: true } : {}),
        }
      }
    }
    return rows
  }

  /** One request: {path, body, who}, answered through `out`. */
  async function answer(r, out) {
    const body = r.body ?? {}
    const row = String(body.id ?? '')
    if (!/^rec[A-Za-z0-9]{14}$/.test(row)) {
      return out.json(400, { ok: false, error: 'unknown item' })
    }
    const thread = threadOf(row)
    switch (r.path) {
      case '/chat/history':
        return out.json(200, {
          ok: true,
          messages: thread.messages,
          pending: running.has(row) || thread.waiting.length > 0,
          waiting: thread.waiting.map(({ text, at, attachments }) => ({
            text,
            at,
            ...(attachments ? { attachments } : {}),
          })),
        })
      case '/chat/file': {
        const file = thread.files?.[String(body.file ?? '')]
        if (!file) return out.json(404, { ok: false, error: 'No such file.' })
        return out.file(file.type, file.data)
      }
      case '/chat/interrupt': {
        const job = running.get(row)
        const stopped = body.stop === true && Boolean(job)
        if (stopped) job.stopped = true
        return out.json(200, { ok: true, stopped })
      }
      case '/chat/unqueue': {
        const before = thread.waiting.length
        thread.waiting = thread.waiting.filter(m => m.at !== body.at)
        save()
        return out.json(200, {
          ok: true,
          removed: thread.waiting.length < before,
        })
      }
      case '/chat/clear':
        if (running.has(row)) {
          return out.json(409, {
            ok: false,
            error: 'Fable is still answering.',
          })
        }
        delete threads[row]
        save()
        log(`${side} ${row}: conversation cleared by ${r.who.email}`)
        return out.json(200, { ok: true })
      case '/chat': {
        const text = String(body.message ?? '').trim()
        const atts = Array.isArray(body.attachments) ? body.attachments : []
        if ((!text && !atts.length) || text.length > 4000) {
          return out.json(400, {
            ok: false,
            error: 'Say something (up to 4000 characters).',
          })
        }
        // The files, kept beside the thread for /chat/file.
        thread.files ??= {}
        const saved = atts
          .filter(a => a && typeof a.data === 'string')
          .map((a, i) => {
            const file = `${Date.now()}-${i}-${String(a.name || 'file').replace(/[^\w.-]/g, '_')}`
            const type = String(a.type || 'application/octet-stream')
            thread.files[file] = { type, data: a.data }
            return {
              name: String(a.name || 'file'),
              type,
              size: Math.floor((a.data.length * 3) / 4),
              file,
            }
          })
        const mine = {
          text,
          at: now(),
          ...(saved.length ? { attachments: saved } : {}),
        }
        if (running.has(row) || thread.waiting.length > 0) {
          // A reply is being written: this one waits its turn. No stream.
          thread.waiting.push({ ...mine, who: r.who })
          save()
          return out.json(202, { ok: true, waiting: true, at: mine.at })
        }
        return run(row, { role: 'you', ...mine }, r.who, out)
      }
      default:
        return out.json(404, { ok: false, error: 'not found' })
    }
  }

  return { answer, status }
}

// ─── The Mac's side: the same chat, called directly by the owner's page ─────

/** The site's token for the Mac agent ({v, kind: 'queue-agent', email,
 *  name, iat, exp}, sealed with QUEUE_AGENT_SECRET), or null. */
function macToken(sent) {
  if (typeof sent !== 'string') return null
  const dot = sent.lastIndexOf('.')
  if (dot <= 0) return null
  const body = sent.slice(0, dot)
  const got = Buffer.from(sent.slice(dot + 1))
  const want = Buffer.from(seal(body, MAC_SECRET))
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return t?.v === 1 && t.kind === 'queue-agent' && t.exp > Date.now() / 1000
      ? t
      : null
  } catch {
    return null
  }
}

function startMac() {
  const chat = chatFor('mac')
  const origins = new Set([SITE, `http://127.0.0.1:${port}`])
  createServer(async (req, res) => {
    const origin = (req.headers.origin ?? '').replace(/\/$/, '')
    const cors = {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Private-Network': 'true',
    }
    const json = (status, body) => {
      const data = JSON.stringify(body)
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...cors,
      })
      res.end(data)
    }
    if (!origins.has(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: false, error: 'origin not allowed' }))
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      })
      return res.end()
    }
    const at = (req.url ?? '').split('?')[0]
    if (req.method === 'GET') {
      if (at !== '/ping') return json(404, { ok: false, error: 'not found' })
      return json(200, {
        ok: true,
        version: 'demo',
        actions: [],
        secret: true,
        chat: true,
        waits: true,
        dictate: false,
      })
    }
    let raw = ''
    for await (const piece of req) raw += piece
    let body = {}
    try {
      body = JSON.parse(raw)
    } catch {
      // answered below: no token
    }
    const t = macToken(body?.token)
    if (!t) {
      return json(401, {
        ok: false,
        error: "The page's token was not accepted.",
      })
    }
    const who = { email: t.email, name: t.name ?? t.email, mode: 'edit' }
    switch (at) {
      case '/act':
        // The demo saves no draft and writes nothing.
        return json(200, { ok: true, detail: 'Demo: nothing is saved' })
      case '/chat/status':
        return json(200, { ok: true, rows: chat.status() })
      case '/rule/draft':
        return json(200, { ok: true, lesson: false })
      case '/rule/status':
        return json(200, { ok: true, rows: {} })
      default:
    }
    // The answer goes straight down the connection, as the Mac's does: a
    // stream of events for a reply, plain JSON or a file's bytes otherwise.
    let streaming = false
    await chat.answer(
      { path: at, body, who },
      {
        json,
        file(type, data) {
          res.writeHead(200, { 'Content-Type': type, ...cors })
          res.end(Buffer.from(data, 'base64'))
        },
        event(ev) {
          if (!streaming) {
            streaming = true
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-store',
              Connection: 'close',
              ...cors,
            })
          }
          res.write(`data: ${JSON.stringify(ev)}\n\n`)
        },
        end: () => res.end(),
      }
    )
  })
    // The port may still be held by the stand-in this one replaces, for
    // the moment it takes that one to notice and stop.
    .on('error', function (e) {
      if (e.code !== 'EADDRINUSE') throw e
      setTimeout(() => this.listen(macPort, '127.0.0.1'), 1000)
    })
    .on('listening', () =>
      log(`standing in for the Mac agent on http://127.0.0.1:${macPort}`)
    )
    .listen(macPort, '127.0.0.1')
}

// ─── The loop ───────────────────────────────────────────────────────────────

mkdirSync(dev, { recursive: true })
writeFileSync(PID_FILE, String(process.pid))
const mine = () => {
  try {
    return readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)
  } catch {
    return false
  }
}

// Checked every two seconds as well as between calls, so deleting the file
// stops this at once.
setInterval(() => {
  if (!mine()) {
    log('the pid file names another agent, or is gone: stopping')
    process.exit(0)
  }
}, 2000).unref()

if (macPort) startMac()
const team = chatFor('team')

// The ids already taken up: the site offers a request again until it hears
// that an agent has it, and one must never be run twice.
const have = new Map()

/** One request from the site: checked, said to be here, then answered. */
async function take(r) {
  for (const [id, at] of have) if (Date.now() - at > 3_600_000) have.delete(id)
  if (have.has(r.id)) return
  have.set(r.id, Date.now())
  if (!signedBySite(r)) {
    log(`${r.id}: not signed by the site – left alone`)
    return
  }
  // "I have it", before any work: an empty call. Refused (the page was
  // already told nobody answered), and the request is not run at all.
  const here = await ask({ op: 'chunks', id: r.id, chunks: [] })
  if (!here.ok) {
    log(`${r.id}: not wanted any more – ${here.body.code ?? here.status}`)
    return
  }
  // The body as the site signed it, never a copy somebody else parsed.
  const body = JSON.parse(r.bodyText)
  await team.answer({ path: r.path, body, who: r.who }, relayOut(r.id))
}
log(
  teamOn
    ? `asking ${SITE} for chat requests (stop: delete ${PID_FILE})`
    : `the team's side is off (stop: delete ${PID_FILE})`
)
let downSince = null
let said = ''
for (;;) {
  if (!mine()) {
    log('the pid file names another agent, or is gone: stopping')
    break
  }
  try {
    if (teamOn) {
      const { requests } = await call({ op: 'next', wait: 20 })
      for (const r of requests ?? []) {
        void take(r).catch(e => log(`${r.path} failed – ${e.message}`))
      }
    } else {
      // Only watching for the demo server to go: any answer will do.
      await fetch(`${SITE}/api/admin/queue`)
      await sleep(10_000)
    }
    if (downSince !== null) log('the demo server is answering again')
    downSince = null
    said = ''
  } catch (e) {
    downSince ??= Date.now()
    if (e.message !== said) {
      said = e.message
      log(`the demo server did not answer – ${e.message}`)
    }
    if (Date.now() - downSince > 180_000) {
      log('the demo server has been gone for three minutes: stopping')
      break
    }
    await sleep(2000)
  }
}
process.exit(0)
