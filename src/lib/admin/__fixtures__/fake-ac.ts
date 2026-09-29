/*
  A pretend ActiveCampaign, a pretend Upstash and a pretend admin mail
  script, for the newsletter tests (newsletter-approve.test.ts,
  newsletter-waves.test.ts). Nothing here touches the network.

  The Upstash state lives on globalThis: the tests reload the newsletter
  module (vi.resetModules) for every case, and the mocked Redis class must
  keep talking to the one store the test reads.

  In a test file:
    vi.mock('@upstash/redis', async () => ({
      Redis: (await import('./__fixtures__/fake-ac')).FakeRedis,
    }))
*/

import { createHash } from 'node:crypto'
import { vi } from 'vitest'

/* ─── Pretend Upstash ─────────────────────────────────────────────────── */

interface KvState {
  data: Map<string, unknown>
  expiry: Map<string, number>
  zsets: Map<string, Map<string, number>>
  down: boolean
}

const g = globalThis as { __fakeNewsletterKv?: KvState }
// Every client shares one store, as every instance shares one database.
export const kv: KvState = (g.__fakeNewsletterKv ??= {
  data: new Map(),
  expiry: new Map(),
  zsets: new Map(),
  down: false,
})

export function resetKv() {
  kv.data.clear()
  kv.expiry.clear()
  kv.zsets.clear()
  kv.down = false
}

function kvHas(key: string): boolean {
  const until = kv.expiry.get(key)
  if (until != null && until <= Date.now()) {
    kv.data.delete(key)
    kv.expiry.delete(key)
  }
  return kv.data.has(key)
}

export class FakeRedis {
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
    if (kv.down) throw new Error('Upstash is down')
    if (opts?.nx && kvHas(key)) return null
    kv.data.set(key, value)
    if (opts?.ex) kv.expiry.set(key, Date.now() + opts.ex * 1000)
    else kv.expiry.delete(key)
    return 'OK'
  }
  async get(key: string) {
    if (kv.down) throw new Error('Upstash is down')
    return kvHas(key) ? kv.data.get(key) : null
  }
  async del(key: string) {
    kv.data.delete(key)
    kv.expiry.delete(key)
    return 1
  }
  pipeline() {
    const ops: Array<() => unknown> = []
    const p = {
      set: (key: string, value: unknown) => {
        ops.push(() => {
          kv.data.set(key, value)
          return 'OK'
        })
        return p
      },
      zadd: (key: string, e: { score: number; member: string }) => {
        ops.push(() => {
          const z = kv.zsets.get(key) ?? new Map<string, number>()
          z.set(e.member, e.score)
          kv.zsets.set(key, z)
          return 1
        })
        return p
      },
      hgetall: () => {
        ops.push(() => null)
        return p
      },
      exec: async () => {
        if (kv.down) throw new Error('Upstash is down')
        return ops.map(op => op())
      },
    }
    return p
  }
}

/** As if the 15-minute approval locks had run out. */
export function expireLocks() {
  for (const k of [...kv.data.keys()])
    if (k.startsWith('aisafety:newsletter:approve-lock:')) kv.data.delete(k)
}

/* ─── A pipeline email ─────────────────────────────────────────────────── */

export function digest(html: string): string {
  let s = html.replace(/<!--aisafety-issue:([0-9a-f]{16})-->/, '')
  while (s.includes('&amp;')) s = s.replace(/&amp;/g, '&')
  s = s.replace(/\s+$/, '')
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)
}

export interface CardSpec {
  key: string
  title: string
  /** [marker name, icon or '', text] */
  fields: Array<[string, string, string]>
  /** Text as built, for fields edited since (the manifest's `o`). */
  o?: Record<string, string>
}

export const LINK_LIST = '0123456789abcdef'

/** The shape render.py writes: preheader, cards with field markers, a
 *  counted link, the footer tags, the card manifest; the marker in front. */
export function buildEmail(
  opts: {
    cards?: CardSpec[]
    body?: string
    text?: string
    footer?: string
    links?: string[]
  } = {}
): { html: string; text: string } {
  const cards = opts.cards ?? [
    {
      key: 'recAAAAAAAAAAAAAA',
      title: 'The Big Tent',
      fields: [
        ['title', '', 'The Big Tent'],
        ['m0', 'pin', 'San Francisco, USA'],
        ['m1', 'calendar', '20–21 November'],
        ['desc', '', 'AI safety convention for the whole community.'],
      ],
    },
  ]
  const cardHtml = cards
    .map(
      c =>
        `<!--card:g0:${c.key}--><table><tr><td>${c.fields
          .map(
            ([n, icon, v]) =>
              `<div><!--f:${n}${icon ? `:${icon}` : ''}-->${v}<!--/f--></div>`
          )
          .join('')}</td></tr></table><!--/card-->`
    )
    .join('')
  const manifest = {
    v: 1,
    groups: [
      {
        id: 'g0',
        label: 'New events',
        cards: cards.map(c => ({
          key: c.key,
          title: c.title,
          ...(c.o ? { o: c.o } : {}),
        })),
      },
    ],
    text: [
      { t: 'WEEK 41, 2026\n\n' },
      ...cards.map(c => ({
        c: `g0:${c.key}`,
        t: `* ${c.title}\n  ${c.fields.map(f => f[2]).join('\n  ')}\n\n`,
      })),
      { t: 'Unsubscribe: %UNSUBSCRIBELINK%\n%SENDER-INFO-SINGLELINE%\n' },
    ],
  }
  const b64 = Buffer.from(JSON.stringify(manifest)).toString('base64')
  const links = (opts.links ?? [`https://aisafety.com/api/nl/${LINK_LIST}/0`])
    .map(u => `<a href="${u}">Read more</a>`)
    .join(' ')
  const footer =
    opts.footer ??
    '<p><a href="%UNSUBSCRIBELINK%">Unsubscribe</a> · %SENDER-INFO-SINGLELINE%</p>'
  const body =
    '<!DOCTYPE html><html><head><title>Week 41, 2026</title><style>a{color:inherit}</style></head><body>' +
    '<div style="display:none;max-height:0;">This is a weekly newsletter.&nbsp;&zwnj;</div>' +
    `<h1>Events</h1>${cardHtml}${opts.body ?? ''}${links}${footer}` +
    `<!--aisafety-cards:${b64}-->\n</body></html>`
  return {
    html: `<!--aisafety-issue:${digest(body)}-->${body}`,
    text:
      opts.text ??
      manifest.text.map(s => s.t).join('') +
        `https://aisafety.com/api/nl/${LINK_LIST}/0\n`,
  }
}

/* ─── Waves (the saved segments ~/Newsletter/waves.py makes) ──────────── */

export const WAVE_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
]
export const WAVE_TAGS = ['101', '102', '103']

export interface SegmentSpec {
  id: string
  name: string
  /** [field, operator, value] per condition, all in one AND group. */
  conditions: Array<[string, string, string]>
  objectType?: string
}

/** The wave contract's segments for N waves: tag k for waves 1…N−1, none
 *  of those tags for the last ("everyone else"). */
export function waveSegments(
  waves = 4,
  prefix = 'Newsletter wave '
): SegmentSpec[] {
  const tags = WAVE_TAGS.slice(0, waves - 1)
  return [
    ...tags.map((t, i) => ({
      id: WAVE_IDS[i],
      name: `${prefix}${i + 1}`,
      conditions: [['tagid', '=', t]] as Array<[string, string, string]>,
    })),
    {
      id: WAVE_IDS[waves - 1],
      name: `${prefix}${waves} (everyone else)`,
      conditions: tags.map(t => ['tagid', '!=', t]) as Array<
        [string, string, string]
      >,
    },
  ]
}

/** The test sweep's practice numbers: 2,889 on list 6, waves of 494, 986
 *  and 710 tagged, 699 everyone else. */
export const WAVE_COUNTS: Record<string, Record<string, number>> = {
  '6': { '101': 494, '102': 986, '103': 710 },
}

/* ─── Pretend ActiveCampaign ───────────────────────────────────────────── */

export interface Camp {
  id: string
  name: string
  status: string
  cdate: string
  sdate: string | null
  ldate: string | null
  send_amt: string
  list: string
  msg: string
  tracklinks: string
  tracklinksanalytics: string
  segmentid: string
  hardbounces: string
  softbounces: string
  unsubscribes: string
  uniqueopens: string
  verified_unique_opens: string
}

export interface Msg {
  id: string
  subject: string
  fromemail: string
  fromname: string
  reply2: string
  html: string
  text: string
}

export interface AcOptions {
  latencyMs?: number
  /** Answer campaign_create with a 502 after creating it (one per call). */
  createGatewayError?: boolean[]
  /** v1 campaign_delete refuses. */
  deleteFails?: boolean
  /** v3 DELETE campaigns/:id/delete refuses. */
  v3DeleteFails?: boolean
  /** How AC stores the new campaign's link tracking. */
  createdTracking?: string
  /** Status of a newly created campaign ('7' = held for review). */
  createdStatus?: string
  /** What AC keeps as a new campaign's segment: a hidden row pointing at
   *  the saved segment asked for ('row', the default), none ('0'), or a row
   *  pointing at another one ('other'). */
  createdSegment?: 'row' | '0' | 'other'
  draftList?: string
  draftName?: string
  email?: { html: string; text: string }
  msg?: Partial<Msg>
  extra?: Camp[]
  extraMsgs?: Msg[]
  /** Active contacts per list (default 3). */
  active?: Record<string, number>
  totalCampaigns?: number
  /** Link lists on the Blob store: id → JSON, or a status code. */
  blob?: Record<string, unknown>
  /** Saved segments (GET audiences); none = 404. */
  segments?: SegmentSpec[]
  /** Active contacts per list per tag id. */
  tagCounts?: Record<string, Record<string, number>>
  /** v3 pause/stop/resume answer succeeded 0 and change nothing. */
  stopRefuses?: boolean
  /** v3 pause/stop/resume/delete answer with a 502 (after doing it). */
  stopGatewayError?: boolean
  /** A scheduled campaign has started sending by the time a delete comes. */
  startsBeforeDelete?: boolean
  /** v1 campaign_report_unsubscription_totals per campaign. */
  spamComplaints?: Record<string, string>
}

export function camp(p: Partial<Camp> & { id: string; name: string }): Camp {
  return {
    status: '5',
    cdate: '2026-10-08T08:00:00-05:00',
    sdate: '2026-10-08 08:02:00',
    ldate: null,
    send_amt: '0',
    list: '6',
    msg: '299',
    tracklinks: 'none',
    tracklinksanalytics: '0',
    segmentid: '0',
    hardbounces: '0',
    softbounces: '0',
    unsubscribes: '0',
    uniqueopens: '0',
    verified_unique_opens: '0',
    ...p,
  }
}

export interface Call {
  method: string
  path: string
  action?: string
  form?: URLSearchParams
  signal: boolean
}

export const MAIL_SCRIPT_URL = 'https://fake-mail.example/exec'

export function makeAC(opts: AcOptions = {}) {
  const email = opts.email ?? buildEmail()
  const camps: Camp[] = [
    camp({
      id: '200',
      name: opts.draftName ?? 'Events · Week 41, 2026',
      status: '0',
      cdate: '2026-10-07T10:00:00-05:00',
      sdate: null,
      list: opts.draftList ?? '6',
      msg: '300',
    }),
    ...(opts.extra ?? []),
  ]
  const msgs = new Map<string, Msg>([
    [
      '300',
      {
        id: '300',
        subject: 'Week 41, 2026',
        fromemail: 'events@news.aisafety.com',
        fromname: 'AI Safety Events',
        reply2: 'events@news.aisafety.com',
        html: email.html,
        text: email.text,
        ...opts.msg,
      },
    ],
    ...(opts.extraMsgs ?? []).map(m => [m.id, m] as [string, Msg]),
  ])
  const blob: Record<string, unknown> = {
    [LINK_LIST]: {
      v: 1,
      c: 'Events · Week 41, 2026',
      links: [{ u: 'https://thebigtent.example/', k: 'page', t: 'Read more' }],
    },
    ...opts.blob,
  }
  /** Hidden segment rows AC makes for saved segments: id → segmentid_v2. */
  const segmentRows = new Map<string, string>()
  let nextId = 201
  let nextRow = 9
  const creates: string[] = []
  const calls: Call[] = []
  /** What the admin mail script was asked to send. */
  const mails: Array<Record<string, unknown>> = []
  const lat = opts.latencyMs ?? 5
  const errSeq = [...(opts.createGatewayError ?? [])]
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const j = (b: unknown, status = 200) => Response.json(b, { status })

  const fetchMock = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    await sleep(lat)
    if (url.href === MAIL_SCRIPT_URL) {
      mails.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return j({ ok: true, emailed: true })
    }
    if (url.hostname.endsWith('blob.vercel-storage.com')) {
      const id = url.pathname
        .split('/')
        .pop()!
        .replace(/\.json$/, '')
      const b = blob[id]
      if (b === undefined) return new Response('not found', { status: 404 })
      if (typeof b === 'number') return new Response('x', { status: b })
      if (typeof b === 'string') return new Response(b)
      return j(b)
    }
    if (url.pathname.endsWith('/admin/api.php')) {
      const action = url.searchParams.get('api_action') ?? ''
      const form = new URLSearchParams(String(init?.body ?? ''))
      calls.push({
        method,
        path: 'api.php',
        action,
        form,
        signal: init?.signal != null,
      })
      if (action === 'campaign_create') {
        const id = String(nextId++)
        const list = [...form.keys()]
          .find(k => k.startsWith('p['))!
          .slice(2, -1)
        const msg = [...form.keys()].find(k => k.startsWith('m['))!.slice(2, -1)
        let segmentid = '0'
        const asked = form.get('segmentid')
        if (asked && (opts.createdSegment ?? 'row') !== '0') {
          const row = String(nextRow++)
          segmentRows.set(
            row,
            opts.createdSegment === 'other'
              ? '99999999-9999-4999-8999-999999999999'
              : asked
          )
          segmentid = row
        }
        camps.push(
          camp({
            id,
            name: form.get('name')!,
            status: opts.createdStatus ?? String(form.get('status')),
            cdate: '2026-10-08T09:00:00-05:00',
            sdate: form.get('sdate'),
            list,
            msg,
            tracklinks: opts.createdTracking ?? form.get('tracklinks')!,
            tracklinksanalytics: String(form.get('tracklinksanalytics')),
            segmentid,
          })
        )
        creates.push(id)
        if (errSeq.shift())
          return new Response('<html>502 Bad Gateway</html>', { status: 502 })
        return j({ result_code: 1, id })
      }
      if (action === 'campaign_delete') {
        if (opts.deleteFails)
          return j({ result_code: 0, result_message: 'temporary failure' })
        const i = camps.findIndex(c => c.id === form.get('id'))
        if (i >= 0) camps.splice(i, 1)
        return j({ result_code: i >= 0 ? 1 : 0 })
      }
      if (action === 'campaign_report_unsubscription_totals') {
        const id = url.searchParams.get('campaignid') ?? ''
        const c = camps.find(x => x.id === id)
        if (!c) return j({ result_code: 0, result_message: 'Failed' })
        return j({
          result_code: 1,
          total_amt: c.send_amt,
          unsubscribes: c.unsubscribes,
          spam_complaints: opts.spamComplaints?.[id] ?? '0',
        })
      }
      return j({ result_code: 0, result_message: 'unknown action' })
    }
    const p = url.pathname.replace(/^.*\/api\/3\//, '')
    calls.push({
      method,
      path: p + url.search,
      signal: init?.signal != null,
    })
    let m = /^campaigns\/(\d+)\/delete$/.exec(p)
    if (m && method === 'DELETE') {
      if (opts.v3DeleteFails)
        return j({ succeeded: 0, message: 'Campaign not found.' })
      const c = camps.find(x => x.id === m![1])
      if (c && opts.startsBeforeDelete && c.status === '1') {
        // AC's scheduler got there first: a sending campaign isn't deleted.
        c.status = '2'
        return j({ succeeded: 0, message: 'Campaign is sending.' })
      }
      const i = camps.findIndex(c => c.id === m![1])
      if (i >= 0) camps.splice(i, 1)
      if (opts.stopGatewayError)
        return new Response('<html>502</html>', { status: 502 })
      return j({ succeeded: i >= 0 ? 1 : 0 })
    }
    m = /^campaigns\/(\d+)\/(pause|stop|resume)$/.exec(p)
    if (m && method === 'PUT') {
      const c = camps.find(x => x.id === m![1])
      const allowed: Record<string, string[]> = {
        pause: ['2'],
        stop: ['2', '3'],
        resume: ['3'],
      }
      const to: Record<string, string> = { pause: '3', stop: '4', resume: '2' }
      if (!c || opts.stopRefuses || !allowed[m[2]].includes(c.status))
        return j({ succeeded: 0, message: 'Not allowed.' })
      c.status = to[m[2]]
      if (opts.stopGatewayError)
        return new Response('<html>502</html>', { status: 502 })
      return j({ succeeded: 1, message: 'Campaign updated.' })
    }
    m = /^messages\/(\d+)$/.exec(p)
    if (m && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as {
        message: { html: string; text: string }
      }
      const msg = msgs.get(m[1])!
      msg.html = body.message.html
      msg.text = body.message.text
      return j({ message: msg })
    }
    if (p === 'campaigns') {
      const sorted = [...camps].sort((a, b) => Number(b.id) - Number(a.id))
      return j({
        campaigns: sorted.map(c => ({ ...c })),
        meta: { total: String(opts.totalCampaigns ?? camps.length) },
      })
    }
    m = /^campaigns\/(\d+)$/.exec(p)
    if (m) {
      const c = camps.find(x => x.id === m![1])
      return c ? j({ campaign: { ...c } }) : j({ message: 'nf' }, 404)
    }
    m = /^campaigns\/(\d+)\/campaignLists$/.exec(p)
    if (m) {
      const c = camps.find(x => x.id === m![1])
      return c
        ? j({ campaignLists: [{ list: c.list }] })
        : j({ message: 'nf' }, 404)
    }
    m = /^campaigns\/(\d+)\/campaignMessages$/.exec(p)
    if (m) {
      const c = camps.find(x => x.id === m![1])
      return c
        ? j({ campaignMessages: [{ messageid: c.msg }] })
        : j({ message: 'nf' }, 404)
    }
    m = /^messages\/(\d+)$/.exec(p)
    if (m) {
      const msg = msgs.get(m[1])
      return msg ? j({ message: { ...msg } }) : j({ message: 'nf' }, 404)
    }
    if (p === 'lists')
      return j({
        lists: [
          { id: '4', name: 'Events (test)' },
          { id: '5', name: 'Funding (test)' },
          { id: '6', name: 'AISafety.com Events' },
          { id: '7', name: 'AISafety.com Training' },
          { id: '8', name: 'AISafety.com Funding' },
        ],
      })
    if (p === 'contacts') {
      const list = url.searchParams.get('listid') ?? ''
      const tag = url.searchParams.get('tagid')
      const total = tag
        ? (opts.tagCounts?.[list]?.[tag] ?? 0)
        : (opts.active?.[list] ?? 3)
      return j({ contacts: [], meta: { total: String(total) } })
    }
    if (p === 'audiences') {
      const q = (url.searchParams.get('search') ?? '').toLowerCase()
      const found = (opts.segments ?? []).filter(s =>
        s.name.toLowerCase().includes(q)
      )
      if (found.length === 0)
        return j({ errors: [{ title: 'No Saved Segments found' }] }, 404)
      return j({
        data: found.map(s => ({
          id: s.id,
          type: 'audience',
          attributes: { segment_id: s.id, name: s.name, category: 'audience' },
        })),
      })
    }
    m = /^segmentsV2\/([0-9a-f-]+)$/.exec(p)
    if (m) {
      const s = (opts.segments ?? []).find(x => x.id === m![1])
      if (!s) return j({ errors: [{ title: 'not found' }] }, 404)
      return j({
        data: [
          {
            id: s.id,
            type: 'Segment.v2',
            attributes: {
              segment_id: s.id,
              name: s.name,
              segment_conditions: s.conditions.map(([f, op, v], i) => ({
                id: String(i + 1),
                source_system: 'activecampaign',
                object_type: s.objectType ?? 'tag',
                fields: [
                  { name: f, data_type: 'number', operator: op, value: v },
                ],
              })),
              segment_condition_group_operator: 'AND',
              segment_condition_groups: [
                {
                  id: '1',
                  operator: 'and',
                  values: s.conditions.map((_, i) => ({
                    id: String(i + 1),
                    type: 'condition',
                  })),
                },
              ],
            },
          },
        ],
      })
    }
    m = /^segments\/(\d+)$/.exec(p)
    if (m) {
      const v2 = segmentRows.get(m[1])
      return v2 == null
        ? j({ message: 'nf' }, 404)
        : j({
            segment: {
              id: m[1],
              name: '',
              hidden: '1',
              segmentid_v2: v2,
            },
          })
    }
    return j({ message: 'unhandled ' + p }, 500)
  }
  return { fetchMock, creates, camps, calls, msgs, mails, segmentRows }
}

/* ─── The module under test, fresh each time ───────────────────────────── */

type NL = typeof import('../newsletter')

export async function freshModule(
  env: Record<string, string | undefined> = {}
): Promise<NL> {
  vi.resetModules()
  process.env.ACTIVECAMPAIGN_URL = 'https://fake-ac.example'
  process.env.ACTIVECAMPAIGN_KEY = 'fake'
  process.env.VERCEL_ENV = 'production'
  process.env.KV_REST_API_URL = 'https://fake-kv.example'
  process.env.KV_REST_API_TOKEN = 'fake'
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  delete process.env.ADMIN_MAIL_SCRIPT_URL
  delete process.env.ADMIN_MAIL_SECRET
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return (await import('../newsletter')) as NL
}

export function outcome(
  p: Promise<unknown>
): Promise<{ ok: boolean; err: unknown }> {
  return p.then(
    () => ({ ok: true, err: null }),
    err => ({ ok: false, err })
  )
}
