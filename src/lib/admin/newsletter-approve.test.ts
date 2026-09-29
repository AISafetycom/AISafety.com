/*
  Approve & send against a pretend ActiveCampaign and a pretend Upstash.

  Scenarios A–I are the ones the 29 Sept 2026 test sweep ran against the
  code as it was (scratch approve.race.test.ts): back then two approvals at
  once sent twice, a 502 after the create left the draft approvable, a stop
  that had reached 1,200 people allowed a resend, and a 2,889-contact list
  went out in one press. Here each is the expectation the fix must meet.
  Nothing in this file touches the network.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

/* ─── Pretend Upstash ─────────────────────────────────────────────────── */

// Every client shares one store, as every instance shares one database.
const kvData = new Map<string, unknown>()
const kvExpiry = new Map<string, number>()
const zsets = new Map<string, Map<string, number>>()
const kvState = { down: false }

function kvHas(key: string): boolean {
  const until = kvExpiry.get(key)
  if (until != null && until <= Date.now()) {
    kvData.delete(key)
    kvExpiry.delete(key)
  }
  return kvData.has(key)
}

vi.mock('@upstash/redis', () => {
  class Redis {
    async set(
      key: string,
      value: unknown,
      opts?: { nx?: boolean; ex?: number }
    ) {
      if (kvState.down) throw new Error('Upstash is down')
      if (opts?.nx && kvHas(key)) return null
      kvData.set(key, value)
      if (opts?.ex) kvExpiry.set(key, Date.now() + opts.ex * 1000)
      else kvExpiry.delete(key)
      return 'OK'
    }
    async get(key: string) {
      if (kvState.down) throw new Error('Upstash is down')
      return kvHas(key) ? kvData.get(key) : null
    }
    async del(key: string) {
      kvData.delete(key)
      kvExpiry.delete(key)
      return 1
    }
    pipeline() {
      const ops: Array<() => unknown> = []
      const p = {
        set: (key: string, value: unknown) => {
          ops.push(() => {
            kvData.set(key, value)
            return 'OK'
          })
          return p
        },
        zadd: (key: string, e: { score: number; member: string }) => {
          ops.push(() => {
            const z = zsets.get(key) ?? new Map<string, number>()
            z.set(e.member, e.score)
            zsets.set(key, z)
            return 1
          })
          return p
        },
        hgetall: () => {
          ops.push(() => null)
          return p
        },
        exec: async () => {
          if (kvState.down) throw new Error('Upstash is down')
          return ops.map(op => op())
        },
      }
      return p
    }
  }
  return { Redis }
})

/* ─── A pipeline email ─────────────────────────────────────────────────── */

function digest(html: string): string {
  let s = html.replace(/<!--aisafety-issue:([0-9a-f]{16})-->/, '')
  while (s.includes('&amp;')) s = s.replace(/&amp;/g, '&')
  s = s.replace(/\s+$/, '')
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)
}

interface CardSpec {
  key: string
  title: string
  /** [marker name, icon or '', text] */
  fields: Array<[string, string, string]>
  /** Text as built, for fields edited since (the manifest's `o`). */
  o?: Record<string, string>
}

const LINK_LIST = '0123456789abcdef'

/** The shape render.py writes: preheader, cards with field markers, a
 *  counted link, the footer tags, the card manifest; the marker in front. */
function buildEmail(
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

/* ─── Pretend ActiveCampaign ───────────────────────────────────────────── */

interface Camp {
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
}

interface Msg {
  id: string
  subject: string
  fromemail: string
  fromname: string
  reply2: string
  html: string
  text: string
}

interface AcOptions {
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
}

function camp(p: Partial<Camp> & { id: string; name: string }): Camp {
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
    ...p,
  }
}

interface Call {
  method: string
  path: string
  action?: string
  form?: URLSearchParams
  signal: boolean
}

function makeAC(opts: AcOptions = {}) {
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
  let nextId = 201
  const creates: string[] = []
  const calls: Call[] = []
  const lat = opts.latencyMs ?? 5
  const errSeq = [...(opts.createGatewayError ?? [])]
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const j = (b: unknown, status = 200) => Response.json(b, { status })

  const fetchMock = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    await sleep(lat)
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
        return j({ result_code: 1 })
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
      const i = camps.findIndex(c => c.id === m![1])
      if (i >= 0) camps.splice(i, 1)
      return j({ succeeded: i >= 0 ? 1 : 0 })
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
      return j({
        contacts: [],
        meta: { total: String(opts.active?.[list] ?? 3) },
      })
    }
    return j({ message: 'unhandled ' + p }, 500)
  }
  return { fetchMock, creates, camps, calls, msgs }
}

type NL = typeof import('./newsletter')

const ENV = { ...process.env }

async function freshModule(env: Record<string, string | undefined> = {}) {
  vi.resetModules()
  process.env.ACTIVECAMPAIGN_URL = 'https://fake-ac.example'
  process.env.ACTIVECAMPAIGN_KEY = 'fake'
  process.env.VERCEL_ENV = 'production'
  process.env.KV_REST_API_URL = 'https://fake-kv.example'
  process.env.KV_REST_API_TOKEN = 'fake'
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return (await import('./newsletter')) as NL
}

const WHO = { approver: 'Bryce Robertson' }

function outcome(p: Promise<unknown>): Promise<{ ok: boolean; err: unknown }> {
  return p.then(
    () => ({ ok: true, err: null }),
    err => ({ ok: false, err })
  )
}

/** As if the 15-minute lock had run out. */
function expireLocks() {
  for (const k of [...kvData.keys()])
    if (k.startsWith('aisafety:newsletter:approve-lock:')) kvData.delete(k)
}

beforeEach(() => {
  kvData.clear()
  kvExpiry.clear()
  zsets.clear()
  kvState.down = false
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  process.env = { ...ENV }
})

/* ─── The sweep's scenarios, now expected to be safe ───────────────────── */

describe('approveAndSend against a pretend ActiveCampaign (sweep scenarios A–I)', () => {
  it('A. two approvals at the same moment: one sends, the other is refused', async () => {
    const ac = makeAC({ latencyMs: 20 })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await Promise.allSettled([
      nl.approveAndSend('200', '6', WHO),
      nl.approveAndSend('200', '6', { approver: 'plex' }),
    ])
    expect(ac.creates).toHaveLength(1)
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    const refused = r.find(
      x => x.status === 'rejected'
    ) as PromiseRejectedResult
    expect(refused.reason).toBeInstanceOf(nl.ApprovalLockedError)
  })

  it('B. a 502 after campaign_create says "may have been scheduled", and pressing again at once is refused', async () => {
    const ac = makeAC({ createGatewayError: [true] })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const first = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(first.err).toBeInstanceOf(nl.MaybeScheduledError)
    expect((first.err as Error).message).toMatch(/Don’t press Approve again/)
    const second = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(second.err).toBeInstanceOf(nl.ApprovalLockedError)
    expect(ac.creates).toHaveLength(1)
  })

  it('C. after the lock has run out, the fresh read still finds the send and refuses', async () => {
    const ac = makeAC({ createGatewayError: [true] })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await outcome(nl.approveAndSend('200', '6', WHO))
    expireLocks()
    const second = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(second.err).toBeInstanceOf(nl.DraftProblemError)
    expect(
      (second.err as InstanceType<NL['DraftProblemError']>).problems[0]
    ).toMatch(/already went to this list as campaign 201/)
    expect(ac.creates).toHaveLength(1)
  })

  it('D. the draft shell can’t be deleted after scheduling: success with a note, and the draft shows as already sent', async () => {
    const ac = makeAC({ deleteFails: true })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await nl.approveAndSend('200', '6', WHO)
    expect(r.campaignId).toBe('201')
    expect(r.notes.join(' ')).toMatch(/couldn’t be deleted/)
    const drafts = await nl.listDrafts()
    expect(drafts[0].alreadySent).toEqual({
      campaignId: '201',
      status: 'scheduled',
    })
    expireLocks()
    const again = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(again.err).toBeInstanceOf(nl.DraftProblemError)
    expect(ac.creates).toHaveLength(1)
  })

  it('E. a 2,889-contact list is refused without a wave while the warm-up is on', async () => {
    const ac = makeAC({ active: { '6': 2889 } })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    expect(nl.NEWSLETTER_WARMUP).toBe(true)
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(r.err).toBeInstanceOf(nl.DraftProblemError)
    expect((r.err as Error).message).toMatch(/2889 active contacts.*waves/)
    expect(ac.creates).toHaveLength(0)
    // Refused before the create, so the lock was released: the same answer
    // again, not "another approval is running".
    const again = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(again.err).toBeInstanceOf(nl.DraftProblemError)
  })

  it('E2. up to 50 active contacts still sends as one (the rehearsal lists)', async () => {
    const ac = makeAC({ active: { '6': 50 } })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await expect(nl.approveAndSend('200', '6', WHO)).resolves.toMatchObject({
      campaignId: '201',
      activeContacts: 50,
    })
  })

  it('F. a draft edited in the AC designer (marker gone) is refused', async () => {
    const e = buildEmail()
    const ac = makeAC({
      email: {
        html: e.html.replace(/<!--aisafety-issue:[0-9a-f]+-->/, ''),
        text: e.text,
      },
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(r.err).toBeInstanceOf(nl.DraftProblemError)
    expect((r.err as Error).message).toMatch(/content marker missing/)
    expect(ac.creates).toHaveLength(0)
  })

  it('F2. content changed but marker kept (checksum mismatch) is refused', async () => {
    const e = buildEmail()
    const ac = makeAC({
      email: {
        html: e.html.replace('The Big Tent', 'The Big Tent CHANGED'),
        text: e.text,
      },
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((r.err as Error).message).toMatch(/checksum mismatch/)
    expect(ac.creates).toHaveLength(0)
  })

  it('G. a test-list draft (list 5) posted as list 6 is refused', async () => {
    const ac = makeAC({ draftList: '5' })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((r.err as Error).message).toMatch(/wired to list 5, expected 6/)
    expect(ac.creates).toHaveLength(0)
  })

  it('H. the issue was STOPPED after reaching 1,200 people: a rebuilt draft is refused', async () => {
    const ac = makeAC({
      extra: [
        camp({
          id: '150',
          name: 'Events · Week 41, 2026',
          status: '4',
          send_amt: '1200',
        }),
      ],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((r.err as Error).message).toMatch(/campaign 150 \(stopped\)/)
    expect(ac.creates).toHaveLength(0)
  })

  it('H2. a send stopped before anyone got it (send_amt 0) doesn’t block a new approval', async () => {
    const ac = makeAC({
      extra: [
        camp({
          id: '150',
          name: 'Events · Week 41, 2026',
          status: '4',
          send_amt: '0',
        }),
      ],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await expect(nl.approveAndSend('200', '6', WHO)).resolves.toMatchObject({
      campaignId: '201',
    })
  })

  it('I. the issue already went to the list as a wave: the whole-list draft is refused', async () => {
    const ac = makeAC({
      extra: [
        camp({
          id: '151',
          name: 'Events · Week 41, 2026 · wave 1/4',
          status: '5',
          send_amt: '500',
        }),
      ],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((r.err as Error).message).toMatch(/campaign 151/)
    expect(ac.creates).toHaveLength(0)
  })
})

/* ─── More of the lock, the create and the record ──────────────────────── */

describe('approveAndSend: fail closed', () => {
  it('an unknown ActiveCampaign status on the same issue counts as sent', async () => {
    const ac = makeAC({
      extra: [camp({ id: '152', name: 'Events · Week 41, 2026', status: '9' })],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((r.err as Error).message).toMatch(/campaign 152 \(status 9\)/)
    expect(ac.creates).toHaveLength(0)
  })

  it('the same issue sent to a TEST list doesn’t block the real one', async () => {
    const ac = makeAC({
      extra: [camp({ id: '153', name: 'Events · Week 41, 2026', list: '5' })],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await expect(nl.approveAndSend('200', '6', WHO)).resolves.toMatchObject({
      campaignId: '201',
    })
  })

  it('records a real-list approval for the watcher, and names the approver', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await nl.approveAndSend('200', '6', WHO)
    expect(r).toMatchObject({
      campaignId: '201',
      approver: 'Bryce Robertson',
      held: false,
      listName: 'AISafety.com Events',
      activeContacts: 3,
      notes: [],
    })
    const record = kvData.get('aisafety:newsletter:approved:201') as Record<
      string,
      unknown
    >
    expect(record).toMatchObject({
      campaignId: '201',
      listId: '6',
      name: 'Events · Week 41, 2026',
      baseName: 'Events · Week 41, 2026',
      wave: null,
      waves: null,
      segmentId: null,
      expected: 3,
      approver: 'Bryce Robertson',
    })
    expect(Number.isNaN(Date.parse(String(record.approvedAt)))).toBe(false)
    expect(kvExpiry.has('aisafety:newsletter:approved:201')).toBe(false)
    expect(zsets.get('aisafety:newsletter:approved')?.get('201')).toBe(
      Date.parse(String(record.approvedAt))
    )
    expect(vi.mocked(console.info).mock.calls.flat().join(' ')).toMatch(
      /approved by Bryce Robertson → campaign 201/
    )
    // The draft shell is gone; the send stays locked for 15 minutes.
    expect(ac.camps.some(c => c.id === '200')).toBe(false)
    expect(
      [...kvData.keys()].some(k =>
        k.startsWith('aisafety:newsletter:approve-lock:6:')
      )
    ).toBe(true)
  })

  it('a test-list approval isn’t recorded for the watcher', async () => {
    const ac = makeAC({ draftList: '5' })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await nl.approveAndSend('200', '5', WHO)
    expect(zsets.size).toBe(0)
  })

  it('a send held for ActiveCampaign’s review counts as scheduled', async () => {
    const ac = makeAC({ createdStatus: '7' })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await nl.approveAndSend('200', '6', WHO)
    expect(r.held).toBe(true)
    expect(ac.camps.some(c => c.id === '200')).toBe(false)
  })

  it('writes carry a timeout and are never retried; reads carry one too', async () => {
    const ac = makeAC({ createGatewayError: [true, true, true] })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await outcome(nl.approveAndSend('200', '6', WHO))
    const creates = ac.calls.filter(c => c.action === 'campaign_create')
    expect(creates).toHaveLength(1)
    expect(ac.calls.every(c => c.signal)).toBe(true)
  })

  it('link tracking switched on by AC: the new campaign is deleted at once and nothing is sent', async () => {
    const ac = makeAC({ createdTracking: 'all' })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(r.err).toBeInstanceOf(nl.LinkTrackingError)
    expect(ac.creates).toEqual(['201'])
    expect(ac.camps.some(c => c.id === '201')).toBe(false)
    expect(
      ac.calls.some(
        c => c.method === 'DELETE' && c.path === 'campaigns/201/delete'
      )
    ).toBe(true)
    // The draft is left as it was.
    expect(ac.camps.some(c => c.id === '200' && c.status === '0')).toBe(true)
  })

  it('link tracking on and the delete fails: "may have been scheduled – delete it now"', async () => {
    const ac = makeAC({ createdTracking: 'all', v3DeleteFails: true })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(r.err).toBeInstanceOf(nl.MaybeScheduledError)
    expect((r.err as Error).message).toMatch(/Delete it in ActiveCampaign now/)
  })

  it('Upstash down: refused before anything is created', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    kvState.down = true
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(r.ok).toBe(false)
    expect(r.err).not.toBeInstanceOf(nl.MaybeScheduledError)
    expect(ac.creates).toHaveLength(0)
  })

  it('a real list can’t be approved without Upstash (no lock), a test list can', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule({
      KV_REST_API_URL: undefined,
      KV_REST_API_TOKEN: undefined,
    })
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((r.err as Error).message).toMatch(/needs Upstash/)
    expect(ac.creates).toHaveLength(0)

    // A test list goes through, on an in-process lock that still stops two
    // presses at once.
    const test = makeAC({ draftList: '5', latencyMs: 20 })
    vi.stubGlobal('fetch', test.fetchMock)
    const both = await Promise.allSettled([
      nl.approveAndSend('200', '5', WHO),
      nl.approveAndSend('200', '5', WHO),
    ])
    expect(test.creates).toEqual(['201'])
    expect(
      both.map(x =>
        x.status === 'fulfilled' ? 'sent' : x.reason.constructor.name
      )
    ).toEqual(expect.arrayContaining(['sent', 'ApprovalLockedError']))
  })

  it('reads the campaigns newest first (AC ignores orders[cdate]) and warns past the window', async () => {
    const ac = makeAC({ totalCampaigns: 140 })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await nl.listDrafts()
    const read = ac.calls.find(c => c.path.startsWith('campaigns?'))!
    expect(decodeURIComponent(read.path)).toContain('orders[id]=DESC')
    expect(decodeURIComponent(read.path)).not.toContain('orders[cdate]')
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toMatch(
      /140 campaigns; only the newest 100/
    )
  })

  it('reads the campaigns again, uncached, right before the create', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await nl.listDrafts() // fills the few-seconds cache
    const before = ac.calls.filter(c => c.path.startsWith('campaigns?')).length
    await nl.approveAndSend('200', '6', WHO)
    const reads = ac.calls.filter(c => c.path.startsWith('campaigns?'))
    expect(reads.length).toBe(before + 1)
    const lastRead = ac.calls.lastIndexOf(reads[reads.length - 1])
    const create = ac.calls.findIndex(c => c.action === 'campaign_create')
    expect(lastRead).toBeLessThan(create)
  })
})

/* ─── Only production sends to the real lists (S5) ─────────────────────── */

describe('only production can send to, or edit drafts on, lists 6/7/8', () => {
  it('refuses a real list on a local or preview copy, before asking ActiveCampaign anything', async () => {
    for (const env of ['development', 'preview', undefined]) {
      const ac = makeAC()
      vi.stubGlobal('fetch', ac.fetchMock)
      const nl = await freshModule({ VERCEL_ENV: env })
      const r = await outcome(nl.approveAndSend('200', '6', WHO))
      expect((r.err as Error).message).toMatch(/only aisafety\.com itself/)
      expect(ac.calls).toHaveLength(0)
    }
  })

  it('still sends to the test lists locally', async () => {
    const ac = makeAC({ draftList: '5' })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule({ VERCEL_ENV: undefined })
    await expect(nl.approveAndSend('200', '5', WHO)).resolves.toMatchObject({
      campaignId: '201',
    })
  })

  it('refuses any list that isn’t a newsletter list', async () => {
    const ac = makeAC({ draftList: '9' })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '9', WHO))
    expect((r.err as Error).message).toMatch(/isn’t a newsletter list/)
    expect(ac.calls).toHaveLength(0)
  })

  it('refuses card edits and reorders on a real list outside production; test lists stay editable', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule({ VERCEL_ENV: 'preview' })
    const r = await outcome(
      nl.reorderDraft('200', { g0: ['recAAAAAAAAAAAAAA'] })
    )
    expect((r.err as Error).message).toMatch(/only aisafety\.com itself/)
    const e = await outcome(
      nl.editDraftCard('200', 'g0', 'recAAAAAAAAAAAAAA', { desc: 'New text.' })
    )
    expect(e.err).toBeInstanceOf(nl.DraftProblemError)
    expect(ac.calls.some(c => c.method === 'PUT')).toBe(false)

    const test = makeAC({ draftList: '5' })
    vi.stubGlobal('fetch', test.fetchMock)
    await expect(
      nl.editDraftCard('200', 'g0', 'recAAAAAAAAAAAAAA', { desc: 'New text.' })
    ).resolves.toHaveProperty('cards')
    expect(test.calls.some(c => c.method === 'PUT')).toBe(true)
  })

  it('the page is told: real-list drafts show a block and aren’t editable outside production', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule({ VERCEL_ENV: 'development' })
    const [d] = await nl.listDrafts()
    expect(d.editable).toBe(false)
    expect(d.blocks.join(' ')).toMatch(/only aisafety\.com itself/)
    expect(d.problems).toEqual([])
  })
})

/* ─── Pre-send checks inside the approval (S4) ─────────────────────────── */

describe('approveAndSend: pre-send checks', () => {
  it('blocks an email without the unsubscribe link, and releases the lock', async () => {
    const e = buildEmail({ footer: '<p>%SENDER-INFO-SINGLELINE%</p>' })
    const ac = makeAC({ email: e })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((r.err as InstanceType<NL['DraftProblemError']>).problems).toEqual([
      'the HTML has no unsubscribe link (%UNSUBSCRIBELINK%) – rebuild the issue',
    ])
    expect(
      [...kvData.keys()].some(k =>
        k.startsWith('aisafety:newsletter:approve-lock:')
      )
    ).toBe(false)
    expect(ac.creates).toHaveLength(0)
  })

  it('blocks a counted link whose list is missing from the Blob store', async () => {
    const ac = makeAC({ blob: { [LINK_LIST]: 404 } })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((r.err as Error).message).toMatch(
      /link list 0123456789abcdef isn’t on the Blob store/
    )
    expect(ac.creates).toHaveLength(0)
  })

  it('blocks while an older issue waits on the same list', async () => {
    const old = buildEmail()
    const ac = makeAC({
      extra: [
        camp({
          id: '190',
          name: 'Events · Week 40, 2026',
          status: '0',
          msg: '290',
        }),
      ],
      extraMsgs: [
        {
          id: '290',
          subject: 'Week 40, 2026',
          fromemail: 'events@news.aisafety.com',
          fromname: 'AI Safety Events',
          reply2: 'events@news.aisafety.com',
          ...old,
        },
      ],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((r.err as Error).message).toMatch(
      /older issue, “Events · Week 40, 2026” \(campaign 190\)/
    )
    // The page shows the same block on the newer draft only.
    const drafts = await nl.listDrafts()
    const newer = drafts.find(d => d.id === '200')!
    const older = drafts.find(d => d.id === '190')!
    expect(newer.blocks.join(' ')).toMatch(/campaign 190/)
    expect(older.blocks).toEqual([])
  })

  it('asks for a tick on edited card text, and sends once it has the ticks', async () => {
    const e = buildEmail({
      cards: [
        {
          key: 'recAAAAAAAAAAAAAA',
          title: 'The Big Tent',
          fields: [
            ['title', '', 'The Big Tent'],
            ['desc', '', 'A rewritten description.'],
          ],
          o: { desc: 'AI safety convention for the whole community.' },
        },
      ],
    })
    const ac = makeAC({ email: e })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const first = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(first.err).toBeInstanceOf(nl.NeedsConfirmationError)
    const warnings = (first.err as InstanceType<NL['NeedsConfirmationError']>)
      .warnings
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      kind: 'edited',
      from: 'AI safety convention for the whole community.',
      to: 'A rewritten description.',
    })
    // A stale tick (an id from before a later edit) doesn't count.
    const stale = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, confirmed: ['edited:g0:old'] })
    )
    expect(stale.err).toBeInstanceOf(nl.NeedsConfirmationError)
    expect(ac.creates).toHaveLength(0)
    await expect(
      nl.approveAndSend('200', '6', {
        ...WHO,
        confirmed: warnings.map(w => w.id),
      })
    ).resolves.toMatchObject({ campaignId: '201' })
  })

  it('asks for a tick on a deadline that has passed by the send day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'))
    const e = buildEmail({
      cards: [
        {
          key: 'recBBBBBBBBBBBBBB',
          title: 'Mercial Research Fellowship',
          fields: [
            ['title', '', 'Mercial Research Fellowship'],
            ['m1', 'calendar', '1 month &middot; Starts 1 November'],
            ['b0', 'paper', 'Apply by 25 September'],
          ],
        },
      ],
    })
    const ac = makeAC({ email: e })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    const w = (r.err as InstanceType<NL['NeedsConfirmationError']>).warnings
    expect(w.map(x => x.kind)).toEqual(['date'])
    expect(w[0].text).toMatch(
      /Apply by 25 September.*25 September 2026 has passed/
    )
  })
})

/* ─── The checks themselves ────────────────────────────────────────────── */

describe('contentChecks', () => {
  const NOW = new Date('2026-10-08T15:00:00Z')
  async function nl() {
    return freshModule()
  }
  function input(over: Partial<Parameters<NL['contentChecks']>[0]> = {}) {
    const e = buildEmail()
    return {
      name: 'Events · Week 41, 2026',
      listId: '6',
      subject: 'Week 41, 2026',
      html: e.html,
      text: e.text,
      fromEmail: 'events@news.aisafety.com',
      replyTo: 'events@news.aisafety.com',
      now: NOW,
      ...over,
    }
  }

  it('passes a clean pipeline email', async () => {
    const { contentChecks } = await nl()
    expect(contentChecks(input())).toEqual({ blocks: [], warnings: [] })
  })

  it('blocks missing footer tags in the HTML or the text', async () => {
    const { contentChecks } = await nl()
    const r = contentChecks(
      input({
        html: buildEmail({ footer: '<p>nothing</p>' }).html,
        text: 'no footer',
      })
    )
    expect(r.blocks).toEqual([
      'the HTML has no unsubscribe link (%UNSUBSCRIBELINK%) – rebuild the issue',
      'the plain-text version has no unsubscribe link (%UNSUBSCRIBELINK%) – rebuild the issue',
      'the HTML has no postal address (%SENDER-INFO-SINGLELINE%) – rebuild the issue',
      'the plain-text version has no postal address (%SENDER-INFO-SINGLELINE%) – rebuild the issue',
    ])
  })

  it('blocks a sender or reply-to off the sending domain', async () => {
    const { contentChecks } = await nl()
    const r = contentChecks(
      input({
        listId: '5',
        fromEmail: 'alignmentdev@alignment.dev',
        replyTo: 'someone@gmail.com',
      })
    )
    expect(r.blocks).toEqual([
      'it comes from alignmentdev@alignment.dev, not an address on news.aisafety.com',
      'replies go to someone@gmail.com, not an address on news.aisafety.com',
    ])
    // No reply-to at all is fine: replies then go to the sender.
    expect(contentChecks(input({ replyTo: null })).blocks).toEqual([])
  })

  it('pairs each real list with its own issues and sender', async () => {
    const { contentChecks } = await nl()
    expect(
      contentChecks(input({ name: 'Training · Week 41, 2026' })).blocks
    ).toEqual([
      '“Training · Week 41, 2026” isn’t a Events issue, but list 6 is the Events list',
    ])
    expect(
      contentChecks(input({ fromEmail: 'training@news.aisafety.com' })).blocks
    ).toEqual([
      'list 6 sends from events@news.aisafety.com, but this draft comes from training@news.aisafety.com',
    ])
    expect(
      contentChecks(
        input({
          listId: '7',
          name: 'Training · Week 41, 2026',
          fromEmail: 'training@news.aisafety.com',
        })
      ).blocks
    ).toEqual([])
    expect(
      contentChecks(
        input({
          listId: '8',
          name: 'Funding · Issue #21, 2026',
          fromEmail: 'funding@news.aisafety.com',
        })
      ).blocks
    ).toEqual([])
    // The old combined issue doesn't pass for Events.
    expect(
      contentChecks(input({ name: 'Events & Training · Week 41, 2026' })).blocks
    ).toHaveLength(1)
  })

  it('lets test lists 4/5 carry any issue, and refuses other lists', async () => {
    const { contentChecks } = await nl()
    for (const listId of ['4', '5'])
      expect(
        contentChecks(
          input({
            listId,
            name: 'Funding · Issue #21, 2026',
            fromEmail: 'funding@news.aisafety.com',
          })
        ).blocks
      ).toEqual([])
    expect(contentChecks(input({ listId: '9' })).blocks).toEqual([
      'list 9 isn’t a newsletter list',
    ])
  })

  it('blocks HTML over 90 KB', async () => {
    const { contentChecks } = await nl()
    const big = buildEmail({ body: `<p>${'x'.repeat(95 * 1024)}</p>` })
    expect(contentChecks(input({ html: big.html })).blocks[0]).toMatch(
      /the email is 9\d KB, over the 90 KB limit/
    )
  })

  it('asks about leftover words, braces and stray merge tags – once each', async () => {
    const { contentChecks } = await nl()
    const e = buildEmail({
      body: '<p>Deadline TBD. See {{link}} or %FIRSTNAME%.</p><p>test</p><p>TEST</p>',
    })
    const r = contentChecks(
      input({
        html: e.html,
        text: `${e.text}\ntest\nTEST\n`,
        subject: 'TODO Week 41',
      })
    )
    expect(r.blocks).toEqual([])
    const texts = r.warnings.map(w => w.text)
    expect(texts.some(t => t.startsWith('“TODO” in the subject'))).toBe(true)
    for (const word of ['TBD', '{{', '}}', 'test', 'TEST'])
      expect(
        texts.filter(t => t.startsWith(`“${word}” in the email`))
      ).toHaveLength(1)
    expect(texts).toContain(
      '%FIRSTNAME% in the email (a merge tag the pipeline never writes)'
    )
    // The plain text repeats the same words: not asked twice.
    expect(texts.some(t => t.includes('plain-text version'))).toBe(false)
    expect(r.warnings.every(w => w.kind === 'words')).toBe(true)
  })

  it('leaves ordinary words, links and the footer tags alone', async () => {
    const { contentChecks } = await nl()
    const e = buildEmail({
      body: '<p>Testing test-time compute. Contest. <a href="https://x.example/test?TODO=1">Lorem-free</a></p>',
    })
    const r = contentChecks(
      input({
        html: e.html,
        text: `${e.text}See https://x.example/test/TODO\n`,
      })
    )
    expect(r.warnings).toEqual([])
  })

  it('asks about card text edited since Pen wrote it, with old → new', async () => {
    const { contentChecks } = await nl()
    const e = buildEmail({
      cards: [
        {
          key: 'recAAAAAAAAAAAAAA',
          title: 'Renamed Tent',
          fields: [
            ['title', '', 'Renamed Tent'],
            ['desc', '', 'Same description.'],
          ],
          o: { title: 'The Big Tent', desc: 'Same description.' },
        },
      ],
    })
    const r = contentChecks(input({ html: e.html }))
    expect(r.warnings).toEqual([
      {
        id: expect.stringMatching(/^edited:g0:recAAAAAAAAAAAAAA:title:/),
        kind: 'edited',
        text: '“Renamed Tent” – Title',
        from: 'The Big Tent',
        to: 'Renamed Tent',
      },
    ])
  })

  it('asks about dates and deadlines already past everywhere (UTC−12)', async () => {
    const { contentChecks } = await nl()
    const e = buildEmail({
      cards: [
        {
          key: 'recCCCCCCCCCCCCCC',
          title: 'Past event',
          fields: [
            ['title', '', 'Past event'],
            ['m1', 'calendar', '24 September'],
          ],
        },
        {
          key: 'recDDDDDDDDDDDDDD',
          title: 'Two deadlines',
          fields: [
            ['title', '', 'Two deadlines'],
            [
              'b0',
              'paper',
              'Apply by 5 October for priority, 25 October at the latest',
            ],
          ],
        },
        {
          key: 'recEEEEEEEEEEEEEE',
          title: 'Next year',
          fields: [
            ['title', '', 'Next year'],
            ['m1', 'calendar', '3 months &middot; Starts 9 January'],
          ],
        },
        {
          key: 'recFFFFFFFFFFFFFF',
          title: 'Today somewhere',
          fields: [
            ['title', '', 'Today somewhere'],
            ['b0', 'paper', 'Apply by 7 October'],
          ],
        },
      ],
    })
    // 8 Oct 06:00 UTC is still 7 October at UTC−12: "Apply by 7 October"
    // hasn't passed everywhere yet.
    const r = contentChecks(
      input({ html: e.html, now: new Date('2026-10-08T06:00:00Z') })
    )
    expect(r.warnings.map(w => w.text)).toEqual([
      '“Past event” – Dates: “24 September” (24 September 2026 has passed)',
    ])
    // Later that day it has.
    const later = contentChecks(
      input({ html: e.html, now: new Date('2026-10-08T13:00:00Z') })
    )
    expect(later.warnings.map(w => w.text)).toEqual([
      '“Past event” – Dates: “24 September” (24 September 2026 has passed)',
      '“Today somewhere” – Applications: “Apply by 7 October” (7 October 2026 has passed)',
    ])
  })

  it('reads deadlines from the plain text on drafts built before field markers', async () => {
    const { contentChecks } = await nl()
    const manifest = {
      v: 1,
      groups: [
        { id: 'g0', label: 'x', cards: [{ key: 'k1', title: 'Old card' }] },
      ],
      text: [
        { c: 'g0:k1', t: '* Old card\n  Online\n  Apply by 25 September\n\n' },
      ],
    }
    const body = `<p><a href="%UNSUBSCRIBELINK%">u</a> %SENDER-INFO-SINGLELINE%</p><!--card:g0:k1--><div>Old card</div><!--/card--><!--aisafety-cards:${Buffer.from(JSON.stringify(manifest)).toString('base64')}-->`
    const r = contentChecks(input({ html: body }))
    expect(r.warnings.map(w => w.text)).toEqual([
      '“Old card” – Deadline: “Apply by 25 September” (25 September 2026 has passed)',
    ])
  })
})

describe('dates', () => {
  it('todayAnywhere is the date at UTC−12', async () => {
    const { todayAnywhere } = await freshModule()
    expect(todayAnywhere(new Date('2026-10-08T11:59:00Z')).toISOString()).toBe(
      '2026-10-07T00:00:00.000Z'
    )
    expect(todayAnywhere(new Date('2026-10-08T12:00:00Z')).toISOString()).toBe(
      '2026-10-08T00:00:00.000Z'
    )
  })

  it('latestDateIn takes the latest date and the nearest year', async () => {
    const { latestDateIn } = await freshModule()
    const today = new Date(Date.UTC(2026, 9, 8))
    const iso = (s: string) =>
      latestDateIn(s, today)?.toISOString().slice(0, 10)
    expect(iso('20–21 November')).toBe('2026-11-21')
    expect(iso('30 September – 2 October')).toBe('2026-10-02')
    expect(iso('9 January – 26 April 2027')).toBe('2027-04-26')
    expect(iso('Starts 9 January')).toBe('2027-01-09')
    expect(iso('Apply by 25 September')).toBe('2026-09-25')
    expect(iso('Closes 3 Oct.')).toBe('2026-10-03')
    expect(iso('week of 16 November')).toBe('2026-11-16')
    expect(iso('Applications on a rolling basis')).toBeUndefined()
    expect(iso('31 September')).toBeUndefined()
  })
})

describe('click-counter link lists', () => {
  it('finds the counted links by list, and the malformed ones', async () => {
    const { nlLinkRefs } = await freshModule()
    const r = nlLinkRefs(
      `<a href="https://aisafety.com/api/nl/${LINK_LIST}/0">a</a><a href="https://aisafety.com/api/nl/${LINK_LIST}/3?x=1">b</a><a href="https://aisafety.com/api/nl/${LINK_LIST}/0">c</a><a href="https://aisafety.com/api/nl/0123/1">d</a>`,
      `https://aisafety.com/api/nl/${LINK_LIST}/`
    )
    expect([...r.lists]).toEqual([[LINK_LIST, [0, 3]]])
    expect(r.bad).toEqual([
      'https://aisafety.com/api/nl/0123/1',
      `https://aisafety.com/api/nl/${LINK_LIST}/`,
    ])
  })

  it('checks each used link against its list', async () => {
    const { linkListProblems } = await freshModule()
    const list = {
      v: 1,
      c: 'x',
      links: [
        { u: 'https://ok.example/', k: 'page', t: 'a' },
        { u: 'javascript:alert(1)', k: 'page', t: 'b' },
        { u: 'not a url', k: 'page', t: 'c' },
      ],
    }
    expect(linkListProblems(LINK_LIST, [0], list)).toEqual([])
    expect(linkListProblems(LINK_LIST, [1, 2, 5], list)).toEqual([
      `link 1 of list ${LINK_LIST} isn’t a web address (javascript:alert(1)) – fix it and rebuild`,
      `link 2 of list ${LINK_LIST} isn’t a web address (not a url) – fix it and rebuild`,
      `link 5 of list ${LINK_LIST} doesn’t exist (the list has 3) – rebuild the issue`,
    ])
    expect(linkListProblems(LINK_LIST, [0], 'missing')[0]).toMatch(
      /isn’t on the Blob store/
    )
    expect(linkListProblems(LINK_LIST, [0], 'malformed')[0]).toMatch(
      /malformed/
    )
    expect(linkListProblems(LINK_LIST, [0], { v: 2, links: [] })[0]).toMatch(
      /malformed/
    )
    expect(linkListProblems(LINK_LIST, [0], 'unreadable')[0]).toMatch(
      /try again/
    )
  })

  it('an unparseable or out-of-range list blocks on the page too', async () => {
    const ac = makeAC({ blob: { [LINK_LIST]: 'not json' } })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const [d] = await nl.listDrafts()
    expect(d.blocks).toEqual([
      `link list ${LINK_LIST} is malformed – rebuild the issue`,
    ])
  })
})

describe('older issues on the same list', () => {
  it('orders issues by year and number', async () => {
    const { issueOrder } = await freshModule()
    expect(issueOrder('Events · Week 41, 2026')).toBe(2026041)
    expect(issueOrder('Events · Week 41, 2026 · wave 2/4')).toBe(2026041)
    expect(issueOrder('Funding · Issue #21, 2026')).toBe(2026021)
    expect(issueOrder('Opt In Email')).toBeNull()
  })

  it('blocks only on an older issue of the same newsletter', async () => {
    const { olderIssueBlocks } = await freshModule()
    const name = 'Events · Week 41, 2026'
    expect(
      olderIssueBlocks(name, [
        { id: '1', name: 'Events · Week 42, 2026' },
        { id: '2', name: 'Training · Week 40, 2026' },
        { id: '3', name: 'Opt In Email' },
        { id: '4', name: 'Events · Week 52, 2025' },
      ])
    ).toEqual([
      'an older issue, “Events · Week 52, 2025” (campaign 4), is still waiting on this list – have it deleted first (ac.py delete-draft 4), so it can’t be sent later by mistake',
    ])
  })
})
