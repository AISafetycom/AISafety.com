/*
  The send path, tried the way it could still go wrong (review of 29 Sept
  2026, before ~2,900 readers join lists 6/7): two kinds of approval at once,
  a card edit landing mid-approval, a wave that can't be read back, a
  zone-less finish time, a pulled production env on a laptop, and a POST
  from another page on the same site. Each case failed before its fix.
  Against the pretend ActiveCampaign (./__fixtures__/fake-ac.ts); nothing
  here touches the network.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildEmail,
  camp,
  freshModule,
  kv,
  makeAC,
  outcome,
  resetKv,
  WAVE_IDS,
  WAVE_COUNTS,
  waveSegments,
  type AcOptions,
} from './__fixtures__/fake-ac'

vi.mock('@upstash/redis', async () => ({
  Redis: (await import('./__fixtures__/fake-ac')).FakeRedis,
}))

// The routes' sign-in checks, and next/server's after() (outside a real
// request it would throw).
vi.mock('@/lib/admin/auth', () => ({
  canSendNewsletter: async () => true,
  canViewNewsletter: async () => true,
  hasFreshSession: async () => true,
  currentAdmin: async () => ({ name: 'Bryce', email: 'bryce@example.com' }),
  NEWSLETTER_FRESH_SECONDS: 1800,
}))
vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))

type NL = typeof import('./newsletter')

const ENV = { ...process.env }
const WHO = { approver: 'Bryce Robertson' }
const ISSUE = 'Events · Week 41, 2026'

function wave(k: number, n = 4) {
  return { segmentId: WAVE_IDS[k - 1], wave: k, waves: n }
}

/** List 6 with 2,889 active and the four waves. */
function waved(more: AcOptions = {}): AcOptions {
  return {
    segments: waveSegments(),
    tagCounts: WAVE_COUNTS,
    active: { '6': 2889 },
    ...more,
  }
}

beforeEach(() => {
  resetKv()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
  process.env = { ...ENV }
})

describe('one approval of an issue at a time, whatever it sends', () => {
  it('the whole list and wave 1 pressed at once (a small list offers both): only one goes', async () => {
    const ac = makeAC({
      segments: waveSegments(),
      tagCounts: { '6': { '101': 10, '102': 10, '103': 10 } },
      active: { '6': 40 },
    })
    // The unlucky timing: each approval reads the campaigns before either
    // create lands. A create waits for the other approval's read (or half a
    // second, when the other one never gets that far).
    let listReads = 0
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (/\/api\/3\/campaigns\?/.test(url)) listReads++
      if (url.includes('api_action=campaign_create'))
        for (let i = 0; i < 50 && listReads < 2; i++)
          await new Promise(r => setTimeout(r, 10))
      return ac.fetchMock(input, init)
    })
    const nl = await freshModule()
    const r = await Promise.allSettled([
      nl.approveAndSend('200', '6', WHO),
      nl.approveAndSend('200', '6', { approver: 'plex', wave: wave(1) }),
    ])
    expect(ac.creates).toHaveLength(1)
    const refused = r.find(
      x => x.status === 'rejected'
    ) as PromiseRejectedResult
    expect(refused.reason).toBeInstanceOf(nl.ApprovalLockedError)
  })
})

describe('the email the checks passed is the email that goes', () => {
  /** The Big Tent's card with "TEST" typed into its description. */
  function editedEmail() {
    return buildEmail({
      cards: [
        {
          key: 'recAAAAAAAAAAAAAA',
          title: 'The Big Tent',
          fields: [
            ['title', '', 'The Big Tent'],
            ['m0', 'pin', 'San Francisco, USA'],
            ['m1', 'calendar', '20–21 November'],
            ['desc', '', 'TEST TEST'],
          ],
        },
      ],
    })
  }

  it('a card edit (another tab) landing while the approval runs: refused, nothing created, and the next try checks the new text', async () => {
    const ac = makeAC()
    const edited = editedEmail()
    let listReads = 0
    // The edit lands just as the approval reads the campaigns before the
    // create, after the email's own checks have passed.
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
      if (/\/api\/3\/campaigns\?/.test(String(input)) && ++listReads === 1) {
        const m = ac.msgs.get('300')!
        m.html = edited.html
        m.text = edited.text
      }
      return ac.fetchMock(input, init)
    })
    const nl = await freshModule()
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(r.err).toBeInstanceOf(nl.DraftProblemError)
    expect((r.err as Error).message).toMatch(
      /the email changed while it was being approved/
    )
    expect(ac.creates).toEqual([])

    // The lock went with the refusal; the next press is asked about "TEST".
    const again = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(again.err).toBeInstanceOf(nl.NeedsConfirmationError)
    expect(
      (again.err as InstanceType<NL['NeedsConfirmationError']>).warnings.map(
        w => w.kind
      )
    ).toContain('words')
    expect(ac.creates).toEqual([])
  })

  it('card edits wait while an approval of the issue holds the lock', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const key = `aisafety:newsletter:approve-lock:6:${ISSUE}`
    kv.data.set(key, {
      draftId: '200',
      approver: 'plex',
      at: new Date().toISOString(),
      wave: null,
    })
    kv.expiry.set(key, Date.now() + 15 * 60_000)
    const e = await outcome(
      nl.editDraftCard('200', 'g0', 'recAAAAAAAAAAAAAA', { desc: 'New text.' })
    )
    expect(e.err).toBeInstanceOf(nl.DraftProblemError)
    expect((e.err as Error).message).toMatch(
      /an approval of this issue \(plex\) is running or has just scheduled it/
    )
    expect(ac.calls.some(c => c.method === 'PUT')).toBe(false)

    // Once it has gone (released, or run out) edits work again.
    kv.data.delete(key)
    await expect(
      nl.editDraftCard('200', 'g0', 'recAAAAAAAAAAAAAA', { desc: 'New text.' })
    ).resolves.toHaveProperty('cards')
  })
})

describe('a wave that can’t be read back is never left to go out unchecked', () => {
  it('the read back fails: the new campaign is deleted at once, nothing goes out', async () => {
    const ac = makeAC(waved({ readbackStatus: 500 }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, wave: wave(1) })
    )
    expect(r.err).toBeInstanceOf(nl.SendDeletedError)
    expect(r.err).not.toBeInstanceOf(nl.MaybeScheduledError)
    expect((r.err as Error).message).toMatch(
      /couldn’t be read back to check it kept the wave/
    )
    expect(ac.creates).toEqual(['201'])
    expect(ac.camps.some(c => c.id === '201')).toBe(false)
    // The draft is still there for another try.
    expect(ac.camps.some(c => c.id === '200')).toBe(true)
  })

  it('…and when it can’t be deleted either: “may have been scheduled – cancel it”', async () => {
    const ac = makeAC(waved({ readbackStatus: 500, v3DeleteFails: true }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, wave: wave(1) })
    )
    expect(r.err).toBeInstanceOf(nl.MaybeScheduledError)
    expect((r.err as InstanceType<NL['MaybeScheduledError']>).campaignId).toBe(
      '201'
    )
    expect((r.err as Error).message).toMatch(
      /Cancel it under Recent sends .* before it sends/
    )
  })
})

describe('the 18-hour gap is measured in ActiveCampaign’s own time', () => {
  it('a finish time without a zone is read in the account’s zone, not the server’s', async () => {
    const nl = await freshModule()
    const p = nl.waveProgress(
      4,
      [
        {
          id: '180',
          name: `${ISSUE} · wave 1/4`,
          status: '5',
          send_amt: '494',
          ldate: '2026-10-08 09:30:00',
        },
      ],
      new Map(),
      '-05:00'
    )
    // 09:30 in Colombia is 14:30 UTC; 18 hours on.
    expect(p.notBefore).toBe(Date.parse('2026-10-09T08:30:00Z'))
  })

  it('so wave 2 fifteen hours after a zone-less finish is still held', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T05:30:00Z'))
    const ac = makeAC(
      waved({
        extra: [
          camp({
            id: '180',
            name: `${ISSUE} · wave 1/4`,
            status: '5',
            send_amt: '494',
            ldate: '2026-10-08 09:30:00',
            segmentid: '9',
          }),
        ],
      })
    )
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, wave: wave(2) })
    )
    expect(r.err).toBeInstanceOf(nl.NeedsOverrideError)
    expect(ac.creates).toEqual([])
  })
})

describe('only the deployed production site sends to the real lists', () => {
  it('a local dev server with VERCEL_ENV=production pulled into .env.local is still refused', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    vi.stubEnv('NODE_ENV', 'development')
    expect(nl.canWriteRealListsHere()).toBe(false)
    const r = await outcome(nl.approveAndSend('200', '6', WHO))
    expect(r.err).toBeInstanceOf(nl.DraftProblemError)
    expect((r.err as Error).message).toMatch(/only aisafety.com itself/)
    expect(ac.creates).toEqual([])
  })
})

describe('the page after an approval or a stop', () => {
  it('its next read sees the send, not the few seconds’ copy from before (which still listed the deleted draft)', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    // A timed reread lands while the approval runs…
    expect((await nl.listDrafts()).map(d => d.id)).toEqual(['200'])
    await nl.approveAndSend('200', '6', WHO)
    // …and the page reads again the moment the answer comes.
    expect(await nl.listDrafts()).toEqual([])
    expect((await nl.listRecent()).map(r => [r.id, r.status])).toEqual([
      ['201', 'scheduled'],
    ])
  })

  it('…and after a cancel', async () => {
    const ac = makeAC({
      extra: [camp({ id: '181', name: ISSUE, status: '1' })],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    expect((await nl.listRecent()).map(r => r.id)).toEqual(['181'])
    await nl.stopSend('181', 'cancel', { by: 'Bryce' })
    expect(await nl.listRecent()).toEqual([])
  })

  it('Recent sends flags a wave that has no segment: it goes to the whole list', async () => {
    const ac = makeAC({
      extra: [
        camp({
          id: '181',
          name: `${ISSUE} · wave 2/4`,
          status: '1',
          sdate: '2026-10-09 09:00:00',
          segmentid: '0',
        }),
        camp({ id: '180', name: `${ISSUE} · wave 1/4`, segmentid: '9' }),
        camp({ id: '170', name: 'Training · Week 41, 2026', list: '7' }),
      ],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const rows = await nl.listRecent()
    expect(Object.fromEntries(rows.map(r => [r.id, r.segmentLost]))).toEqual({
      '181': true,
      '180': false,
      '170': false,
    })
  })
})

/* ─── Requests from other pages ────────────────────────────────────────── */

function post(url: string, body: unknown, headers: Record<string, string>) {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest
}

/** A page on another subdomain of aisafety.com: same site (the Lax session
 *  cookie goes along), another origin. */
const SUBDOMAIN = {
  'sec-fetch-site': 'same-site',
  origin: 'https://news.aisafety.com',
}

describe('the newsletter’s POST routes answer only the admin page itself', () => {
  it('Approve: 403 from another subdomain or site, nothing sent; the page itself goes through', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    await freshModule()
    const { POST } = await import('../../app/api/admin/newsletter/route')
    const body = { campaign: '200', list: '6' }
    for (const headers of [
      SUBDOMAIN,
      { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      // An older browser without Sec-Fetch-Site still sends Origin.
      { origin: 'https://news.aisafety.com' },
      { origin: 'null' },
    ]) {
      const res = await POST(post('/api/admin/newsletter', body, headers))
      expect(res.status).toBe(403)
    }
    expect(ac.creates).toEqual([])

    const ok = await POST(
      post('/api/admin/newsletter', body, {
        'sec-fetch-site': 'same-origin',
        origin: 'http://localhost',
      })
    )
    expect(ok.status).toBe(200)
    expect(ac.creates).toEqual(['201'])
  })

  it('Stop, card text, Consider applying if, reorder and Send test: 403 from another subdomain', async () => {
    const ac = makeAC({
      extra: [camp({ id: '181', name: ISSUE, status: '1' })],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    await freshModule()
    const routes: Array<[string, unknown]> = [
      ['stop', { campaign: '181', action: 'cancel' }],
      [
        'card',
        {
          campaign: '200',
          group: 'g0',
          key: 'recAAAAAAAAAAAAAA',
          fields: { desc: 'x' },
        },
      ],
      [
        'fit',
        { campaign: '200', group: 'g0', key: 'recAAAAAAAAAAAAAA', fit: 'x' },
      ],
      ['reorder', { campaign: '200', order: { g0: ['recAAAAAAAAAAAAAA'] } }],
      ['test', { campaign: '200' }],
    ]
    for (const [name, body] of routes) {
      const { POST } = (await import(
        `../../app/api/admin/newsletter/${name}/route`
      )) as { POST: (req: Request) => Promise<Response> }
      const res = await POST(
        post(`/api/admin/newsletter/${name}`, body, SUBDOMAIN)
      )
      expect(res.status, name).toBe(403)
    }
    // Nothing reached ActiveCampaign's write side.
    expect(ac.calls.filter(c => c.method !== 'GET')).toEqual([])
    expect(ac.camps.some(c => c.id === '181')).toBe(true)
  })
})
