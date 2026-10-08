import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mail } from './mail'
import {
  ALERTS_KEY,
  APPROVED_PREFIX,
  CANCELED_KEY,
  type ApprovedRecord,
  cronAuthorized,
  HEALTH_PREFIX,
  type HealthRecord,
  healthVerdict,
  LOCK_KEY,
  memoryWatchStore,
  readAlerts,
  runWatch,
  shortLabel,
  STATE_KEY,
  type WatchStore,
  waveOf,
} from './newsletter-watch'

/* ─── A pretend ActiveCampaign ────────────────────────────────────────────
   Campaigns as the v3 listing returns them, each campaign's lists, message
   HTML, active counts per list and the account. Every request is recorded so
   the tests can check the watcher only ever reads. */

const KEY = 'secret-ac-key-123'
const NOW = new Date('2026-10-08T15:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const MARKER = '<!--aisafety-issue:0123456789abcdef-->'

interface FakeCampaign {
  id: string
  name: string
  status: string
  segmentid?: string
  cdate?: string | null
  sdate?: string | null
  ldate?: string | null
  send_amt?: string
  total_amt?: string
  hardbounces?: string
  softbounces?: string
  unsubscribes?: string
  verified_unique_opens?: string
  message_id?: string
  type?: string
}

interface Fake {
  campaigns: FakeCampaign[]
  lists: Record<string, string[]>
  messages: Record<string, string>
  active: Record<string, number>
  contactsTotal: number
  account: Record<string, string>
  unsubTotals: Record<
    string,
    { spam_complaints?: string; unsubscribes?: string }
  >
  /** Answer every request with this status (ActiveCampaign down). */
  down: number | null
  /** Deletes ActiveCampaign refuses (v3 and v1), by campaign id. */
  deleteRefuses: Set<string>
  /** The next v3 DELETE of this campaign answers 502, having deleted it
   *  ('gone') or not ('kept'). */
  deleteNoAnswer: Map<string, 'gone' | 'kept'>
  /** These start sending just as the delete comes (it is refused). */
  startsOnDelete: Set<string>
}

let ac: Fake
let calls: Array<{ method: string; url: URL }>

/** An AC date `msAgo` before `at`, in the account's -05:00 offset, the way
 *  the v3 API writes them ("2026-09-28T09:35:42-05:00"). */
function acDate(msAgo: number, at: Date = NOW): string {
  const d = new Date(at.getTime() - msAgo - 5 * HOUR)
  return d.toISOString().replace(/\.\d{3}Z$/, '-05:00')
}

function campaign(over: Partial<FakeCampaign> & { id: string }): FakeCampaign {
  return {
    name: 'Events · Week 41, 2026',
    status: '5',
    segmentid: '12',
    cdate: acDate(2 * HOUR),
    sdate: acDate(2 * HOUR),
    ldate: null,
    send_amt: '0',
    total_amt: '0',
    hardbounces: '0',
    softbounces: '0',
    unsubscribes: '0',
    verified_unique_opens: '0',
    ...over,
  }
}

function approval(
  id: string,
  over: Partial<ApprovedRecord> = {}
): ApprovedRecord {
  return {
    campaignId: id,
    listId: '6',
    name: 'Events · Week 41, 2026 · wave 1/4',
    baseName: 'Events · Week 41, 2026',
    wave: 1,
    waves: 4,
    segmentId: 'uuid-1',
    expected: 494,
    approvedAt: NOW.toISOString(),
    approver: 'bryceerobertson@gmail.com',
    ...over,
  }
}

/** What the approval step writes for a page-approved send. */
async function approve(
  store: WatchStore,
  id: string,
  over: Partial<ApprovedRecord> = {}
) {
  await store.set(APPROVED_PREFIX + id, approval(id, over))
}

/** A verdict the watcher gave on an earlier run (already emailed). */
async function judged(
  store: WatchStore,
  id: string,
  verdict: HealthRecord['verdict'],
  over: Partial<HealthRecord> = {}
) {
  await store.set(HEALTH_PREFIX + id, {
    campaignId: id,
    listId: '6',
    name: 'Events · Week 41, 2026 · wave 1/4',
    baseName: 'Events · Week 41, 2026',
    wave: 1,
    waves: 4,
    verdict,
    reasons: verdict === 'red' ? ['hard bounces 2.5% (red at 2%)'] : [],
    numbers: {
      sendAmt: 1000,
      hardBounces: verdict === 'red' ? 25 : 0,
      softBounces: 0,
      unsubscribes: 0,
      spamComplaints: 0,
      verifiedOpens: 400,
    },
    expected: 1000,
    finishedAt: NOW.toISOString(),
    checkedAt: NOW.toISOString(),
    smallSample: false,
    emailedAt: NOW.toISOString(),
    ...over,
  } satisfies HealthRecord)
}

beforeEach(() => {
  process.env.ACTIVECAMPAIGN_URL = 'https://alignment23684.api-us1.com'
  process.env.ACTIVECAMPAIGN_KEY = KEY
  // No Upstash, as on a laptop: Vercel's build has it set, and the cancel's
  // approval lock (newsletter.ts) would then call the stubbed fetch too.
  for (const name of [
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ])
    vi.stubEnv(name, '')
  ac = {
    campaigns: [],
    lists: {},
    messages: {},
    active: { '6': 2889, '7': 2889, '8': 3 },
    contactsTotal: 2903,
    account: {
      subscriber_limit: '5000',
      subscriber_total: '2903',
      status: 'nobody',
    },
    unsubTotals: {},
    down: null,
    deleteRefuses: new Set(),
    deleteNoAnswer: new Map(),
    startsOnDelete: new Set(),
  }
  calls = []
  const find = (id: string) => ac.campaigns.find(c => String(c.id) === id)
  const remove = (id: string) =>
    ac.campaigns.splice(
      ac.campaigns.findIndex(c => String(c.id) === id),
      1
    )
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    calls.push({ method, url })
    if (ac.down) return new Response('<html>502</html>', { status: ac.down })
    if (url.pathname === '/admin/api.php') {
      const action = url.searchParams.get('api_action')
      if (action === 'account_view')
        return Response.json({ ...ac.account, result_code: 1 })
      if (action === 'campaign_report_unsubscription_totals') {
        const t = ac.unsubTotals[url.searchParams.get('campaignid') ?? '']
        return Response.json({
          spam_complaints: '0',
          unsubscribes: '0',
          ...t,
          result_code: 1,
        })
      }
      if (action === 'campaign_delete' && method === 'POST') {
        const id = new URLSearchParams(String(init?.body)).get('id') ?? ''
        const c = find(id)
        if (
          !c ||
          ac.deleteRefuses.has(id) ||
          !['0', '1', '7'].includes(c.status)
        )
          return Response.json({ result_code: 0, result_message: 'refused' })
        remove(id)
        return Response.json({ result_code: 1 })
      }
      return Response.json({ result_code: 0, result_message: 'unexpected' })
    }
    const path = url.pathname.replace('/api/3/', '')
    if (path === 'campaigns') return Response.json({ campaigns: ac.campaigns })
    let m = /^campaigns\/(\d+)\/delete$/.exec(path)
    if (m && method === 'DELETE') {
      const id = m[1]
      const c = find(id)
      const noAnswer = ac.deleteNoAnswer.get(id)
      if (noAnswer) {
        ac.deleteNoAnswer.delete(id)
        if (noAnswer === 'gone' && c) remove(id)
        return new Response('<html>502</html>', { status: 502 })
      }
      if (!c) return Response.json({ succeeded: 0, message: 'not found' })
      if (ac.startsOnDelete.has(id)) {
        c.status = '2'
        return Response.json({ succeeded: 0, message: 'Campaign is sending.' })
      }
      if (ac.deleteRefuses.has(id) || !['0', '1', '7'].includes(c.status))
        return Response.json({ succeeded: 0, message: 'Not allowed.' })
      remove(id)
      return Response.json({ succeeded: 1 })
    }
    m = /^campaigns\/(\d+)$/.exec(path)
    if (m) {
      const c = find(m[1])
      return c
        ? Response.json({ campaign: c })
        : new Response('not found', { status: 404 })
    }
    m = /^campaigns\/(\d+)\/campaignLists$/.exec(path)
    if (m)
      return Response.json({
        campaignLists: (ac.lists[m[1]] ?? []).map(list => ({ list })),
      })
    m = /^campaigns\/(\d+)\/campaignMessages$/.exec(path)
    if (m) {
      const msg = find(m[1])?.message_id
      return Response.json({
        campaignMessages: msg ? [{ messageid: msg }] : [],
      })
    }
    m = /^messages\/(\d+)$/.exec(path)
    if (m) return Response.json({ message: { html: ac.messages[m[1]] ?? '' } })
    if (path === 'contacts') {
      const list = url.searchParams.get('listid')
      const total = list ? (ac.active[list] ?? 0) : ac.contactsTotal
      return Response.json({ contacts: [], meta: { total: String(total) } })
    }
    return new Response('not found', { status: 404 })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  delete process.env.VERCEL_ENV
})

function setup() {
  const store = memoryWatchStore()
  const sent: Mail[] = []
  let mailWorks = true
  const mail = vi.fn(async (m: Mail) => {
    if (!mailWorks) return false
    sent.push(m)
    return true
  })
  const run = (at: Date = NOW, extra: { dry?: boolean } = {}) =>
    runWatch({ now: at, store, mail, retryDelayMs: 0, ...extra })
  return {
    store,
    sent,
    mail,
    run,
    breakMail: (broken: boolean) => {
      mailWorks = !broken
    },
  }
}

const later = (ms: number) => new Date(NOW.getTime() + ms)
const ids = (s: { alerts: Array<{ id: string }> }) =>
  s.alerts.map(a => a.id).sort()

/* ─── Pure helpers ───────────────────────────────────────────────────── */

describe('waveOf and shortLabel (wave contract names)', () => {
  it('splits a wave campaign into its base issue and wave', () => {
    expect(waveOf('Events · Week 41, 2026 · wave 2/4')).toEqual({
      baseName: 'Events · Week 41, 2026',
      wave: 2,
      waves: 4,
    })
    expect(waveOf('Events · Week 41, 2026')).toEqual({
      baseName: 'Events · Week 41, 2026',
      wave: null,
      waves: null,
    })
  })
  it('shortens for subject lines', () => {
    expect(shortLabel('Events · Week 41, 2026 · wave 2/4', '9')).toBe(
      'Events · Week 41 wave 2/4'
    )
    expect(shortLabel('Funding · Issue #21, 2026', '9')).toBe(
      'Funding · Issue #21'
    )
    expect(shortLabel('', '9')).toBe('campaign 9')
  })
})

describe('healthVerdict', () => {
  const ok = {
    sendAmt: 1000,
    hardBounces: 0,
    softBounces: 0,
    unsubscribes: 10,
    spamComplaints: 0,
    verifiedOpens: 400,
  }
  it('is green when every number is in range', () => {
    expect(healthVerdict(ok)).toEqual({ verdict: 'green', reasons: [] })
  })
  it('is red at 2% hard bounces', () => {
    const v = healthVerdict({ ...ok, hardBounces: 20 })
    expect(v.verdict).toBe('red')
    expect(v.reasons).toEqual(['hard bounces 2.0% (red at 2%)'])
  })
  it('is red above 0.1% complaints', () => {
    expect(healthVerdict({ ...ok, spamComplaints: 1 }).verdict).toBe('green')
    expect(healthVerdict({ ...ok, spamComplaints: 2 }).verdict).toBe('red')
  })
  it('is red under 15% verified opens, amber under 25%', () => {
    expect(healthVerdict({ ...ok, verifiedOpens: 149 }).verdict).toBe('red')
    expect(healthVerdict({ ...ok, verifiedOpens: 200 }).verdict).toBe('amber')
    expect(healthVerdict({ ...ok, verifiedOpens: 250 }).verdict).toBe('green')
  })
  it('is amber at 1% bounces (hard and soft together)', () => {
    expect(healthVerdict({ ...ok, hardBounces: 4, softBounces: 6 })).toEqual({
      verdict: 'amber',
      reasons: ['bounces 1.0% (amber at 1%)'],
    })
  })
  it('keeps unsubscribes amber however high (the move invites them)', () => {
    expect(healthVerdict({ ...ok, unsubscribes: 300 })).toEqual({
      verdict: 'amber',
      reasons: ['unsubscribes 30% (amber above 5%)'],
    })
  })
  it('lists amber reasons alongside red ones', () => {
    const v = healthVerdict({ ...ok, hardBounces: 30, unsubscribes: 60 })
    expect(v.verdict).toBe('red')
    expect(v.reasons).toHaveLength(2)
  })
  it('is amber when it went to nobody', () => {
    expect(healthVerdict({ ...ok, sendAmt: 0 }).verdict).toBe('amber')
  })
})

/* ─── Campaign rules ─────────────────────────────────────────────────── */

describe('runWatch: campaign status', () => {
  it('alerts once when a wave is held for review for over 20 minutes', async () => {
    const { store, sent, run } = setup()
    // Wave 1: a later wave held without a wave before it would also be one
    // to cancel (the approve-once tests below).
    ac.campaigns = [
      campaign({
        id: '201',
        name: 'Events · Week 41, 2026 · wave 1/4',
        status: '7',
        cdate: acDate(5 * MIN),
      }),
    ]
    ac.lists['201'] = ['6']
    await approve(store, '201', { wave: 1 })

    expect((await run()).alerts).toEqual([])

    let s = await run(later(20 * MIN))
    expect(ids(s)).toEqual(['held:201'])
    expect(sent.map(m => m.subject)).toEqual([
      'Newsletter: Events · Week 41 wave 1/4 is held for review by ActiveCampaign',
    ])
    expect(sent[0].text).toContain('https://aisafety.com/admin/newsletter')
    expect(sent[0].text).toContain('https://alignment23684.activehosted.com')

    // Still held ten minutes later: still open, not emailed again.
    s = await run(later(30 * MIN))
    expect(ids(s)).toEqual(['held:201'])
    expect(sent).toHaveLength(1)

    // ActiveCampaign approves it and it sends: the alert clears.
    ac.campaigns[0].status = '5'
    s = await run(later(40 * MIN))
    expect(s.alerts).toEqual([])
    expect((await readAlerts({ store, now: later(41 * MIN) })).alerts).toEqual(
      []
    )
  })

  it('counts a hold from the first time it saw it, not the creation', async () => {
    const { store, run } = setup()
    ac.campaigns = [
      campaign({
        id: '209',
        status: '1',
        cdate: acDate(HOUR),
        sdate: acDate(-5 * MIN),
      }),
    ]
    ac.lists['209'] = ['6']
    await approve(store, '209')
    expect((await run()).alerts).toEqual([])
    // Held at send time, 10 minutes later: not yet 20 minutes held.
    ac.campaigns[0].status = '7'
    expect((await run(later(10 * MIN))).alerts).toEqual([])
    expect(ids(await run(later(20 * MIN)))).toEqual([])
    expect(ids(await run(later(31 * MIN)))).toEqual(['held:209'])
  })

  it('alerts on paused, stopped and disabled, and again when it changes', async () => {
    const { sent, run } = setup()
    ac.campaigns = [
      campaign({ id: '202', status: '3', send_amt: '120', total_amt: '494' }),
      campaign({ id: '203', status: '6', send_amt: '40' }),
    ]
    ac.lists = { '202': ['6'], '203': ['7'] }
    let s = await run()
    expect(s.alerts.map(a => [a.id, a.severity]).sort()).toEqual([
      ['status:202', 'red'],
      ['status:203', 'red'],
    ])
    expect(sent.map(m => m.subject).sort()).toEqual([
      'Newsletter: ActiveCampaign disabled Events · Week 41',
      'Newsletter: Events · Week 41 is paused',
    ])
    expect(sent.find(m => m.subject.endsWith('paused'))?.text).toContain(
      '120 of 494 people'
    )

    ac.campaigns[0].status = '4'
    s = await run(later(10 * MIN))
    expect(s.alerts.find(a => a.id === 'status:202')?.severity).toBe('amber')
    expect(sent.at(-1)?.subject).toBe(
      'Newsletter: Events · Week 41 was stopped'
    )
    expect(sent.at(-1)?.text).toContain('would send it to them twice')
    expect(sent).toHaveLength(3)

    // A stop or a disable stays up for three days, then rests; a pause
    // stays up for as long as it lasts.
    ac.campaigns[1].status = '3'
    expect(ids(await run(later(3 * DAY + HOUR)))).toEqual(['status:203'])
    ac.campaigns[1].status = '6'
    expect(ids(await run(later(3 * DAY + 2 * HOUR)))).toEqual(['status:203'])
    expect(ids(await run(later(6 * DAY + 3 * HOUR)))).toEqual([])
  })

  it('lets old stopped campaigns rest and reads nothing more about them', async () => {
    const { sent, run } = setup()
    ac.campaigns = [
      campaign({
        id: '150',
        status: '4',
        cdate: acDate(10 * DAY),
        sdate: acDate(10 * DAY),
      }),
    ]
    ac.lists['150'] = ['6']
    expect((await run()).alerts).toEqual([])
    expect(sent).toEqual([])
    expect(calls.some(c => c.url.pathname.includes('/150/'))).toBe(false)
  })

  it('alerts when a scheduled send is 20 minutes past its time', async () => {
    const { store, run } = setup()
    ac.campaigns = [
      campaign({ id: '204', status: '1', sdate: acDate(10 * MIN) }),
    ]
    ac.lists['204'] = ['6']
    await approve(store, '204')
    expect((await run()).alerts).toEqual([])
    const s = await run(later(15 * MIN))
    expect(ids(s)).toEqual(['late:204'])
    expect(s.alerts[0].title).toMatch(/^Events · Week 41 was due to send at /)
  })

  it('alerts when a send has been going for over 3 hours', async () => {
    const { store, run } = setup()
    ac.campaigns = [
      campaign({ id: '205', status: '2', sdate: acDate(2 * HOUR) }),
    ]
    ac.lists['205'] = ['7']
    await approve(store, '205', { listId: '7' })
    expect((await run()).alerts).toEqual([])
    expect(ids(await run(later(61 * MIN)))).toEqual(['slow:205'])
  })

  it('alerts on a status it does not know', async () => {
    const { run } = setup()
    ac.campaigns = [campaign({ id: '206', status: '9' })]
    ac.lists['206'] = ['8']
    const s = await run()
    expect(ids(s)).toEqual(['unknown:206'])
    expect(s.alerts[0].title).toContain('(9)')
  })

  it('ignores campaigns on test lists', async () => {
    const { sent, run } = setup()
    ac.campaigns = [
      campaign({ id: '207', status: '3' }),
      campaign({ id: '208', status: '1', sdate: acDate(HOUR), segmentid: '0' }),
    ]
    ac.lists = { '207': ['5'], '208': ['4'] }
    expect((await run()).alerts).toEqual([])
    expect(sent).toEqual([])
  })

  it('asks ActiveCampaign for the newest campaigns by id', async () => {
    const { run } = setup()
    await run()
    const listing = calls.find(c => c.url.pathname === '/api/3/campaigns')
    expect(listing?.url.searchParams.get('orders[id]')).toBe('DESC')
    expect(listing?.url.searchParams.has('orders[cdate]')).toBe(false)
  })
})

describe('runWatch: sends that did not come through the page', () => {
  it('alerts on a new send with no approval record', async () => {
    const { sent, run } = setup()
    ac.campaigns = [
      campaign({
        id: '210',
        status: '1',
        cdate: acDate(10 * MIN),
        sdate: acDate(-5 * MIN),
      }),
    ]
    ac.lists['210'] = ['7']
    const s = await run()
    expect(ids(s)).toEqual(['unapproved:210'])
    expect(sent[0].subject).toBe(
      'Newsletter: Events · Week 41 was not sent through the approval page'
    )
    expect(sent[0].text).toContain(
      'delete it in ActiveCampaign before it sends'
    )
  })

  it('stays quiet with a record, inside the grace minutes, and for old sends', async () => {
    const { store, run } = setup()
    ac.campaigns = [
      campaign({
        id: '211',
        status: '2',
        cdate: acDate(10 * MIN),
        sdate: acDate(MIN),
      }),
      campaign({
        id: '212',
        status: '1',
        cdate: acDate(MIN),
        sdate: acDate(-2 * MIN),
      }),
      campaign({
        id: '213',
        status: '5',
        cdate: acDate(2 * DAY),
        sdate: acDate(2 * DAY),
        ldate: acDate(2 * DAY),
      }),
    ]
    ac.lists = { '211': ['6'], '212': ['6'], '213': ['6'] }
    await approve(store, '211')
    expect((await run()).alerts).toEqual([])
  })

  it('tells a finished unapproved send apart from a pending one', async () => {
    const { sent, run } = setup()
    ac.campaigns = [
      campaign({
        id: '214',
        status: '5',
        cdate: acDate(3 * HOUR),
        ldate: acDate(2 * HOUR),
        send_amt: '3',
      }),
    ]
    ac.lists['214'] = ['8']
    expect(ids(await run())).toEqual(['unapproved:214'])
    expect(sent[0].text).toContain('It has already gone out to 3 people.')
  })
})

describe('runWatch: warm-up waves', () => {
  it('alerts when a send has no wave and its list is over 50 active', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = [
      campaign({
        id: '220',
        status: '1',
        segmentid: '0',
        sdate: acDate(-8 * MIN),
      }),
    ]
    ac.lists['220'] = ['6']
    await approve(store, '220', { wave: null, waves: null, expected: 2889 })
    const s = await run()
    expect(ids(s)).toEqual(['whole-list:220'])
    expect(sent[0].subject).toBe(
      'Newsletter: Events · Week 41 is going to the whole Events list, not a wave'
    )
    const counted = calls.find(
      c =>
        c.url.pathname === '/api/3/contacts' &&
        c.url.searchParams.get('listid') === '6'
    )
    expect(counted?.url.searchParams.get('status')).toBe('1')
  })

  it('allows a whole-list send to a small list (rehearsals)', async () => {
    const { store, run } = setup()
    ac.active['6'] = 3
    ac.campaigns = [
      campaign({
        id: '221',
        status: '1',
        segmentid: '0',
        sdate: acDate(-8 * MIN),
      }),
    ]
    ac.lists['221'] = ['6']
    await approve(store, '221', { expected: 3 })
    expect((await run()).alerts).toEqual([])
  })

  it('stays quiet for a send with a wave', async () => {
    const { store, run } = setup()
    ac.campaigns = [
      campaign({ id: '222', status: '2', segmentid: '14', sdate: acDate(MIN) }),
    ]
    ac.lists['222'] = ['7']
    await approve(store, '222', { listId: '7' })
    expect((await run()).alerts).toEqual([])
    expect(calls.some(c => c.url.searchParams.get('listid') === '7')).toBe(
      false
    )
  })

  it('alerts when a wave reaches clearly more people than expected', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = [
      campaign({
        id: '223',
        name: 'Events · Week 41, 2026 · wave 1/4',
        status: '2',
        segmentid: '14',
        sdate: acDate(MIN),
        send_amt: '700',
        total_amt: '2889',
      }),
    ]
    ac.lists['223'] = ['6']
    await approve(store, '223', { expected: 494 })
    expect(ids(await run())).toEqual(['oversend:223'])
    expect(sent[0].subject).toBe(
      'Newsletter: Events · Week 41 wave 1/4 is reaching more people than its wave'
    )
    // Within the margin: fine.
    ac.campaigns[0].total_amt = '560'
    ac.campaigns[0].send_amt = '560'
    expect((await run(later(10 * MIN))).alerts).toEqual([])
  })
})

describe('runWatch: drafts left on the real lists', () => {
  const draft = (over: Partial<FakeCampaign> = {}) =>
    campaign({
      id: '230',
      status: '0',
      segmentid: '0',
      cdate: acDate(31 * HOUR),
      sdate: null,
      message_id: '900',
      ...over,
    })

  it('alerts on a pipeline draft older than 30 hours', async () => {
    const { sent, run } = setup()
    ac.campaigns = [draft()]
    ac.lists['230'] = ['6']
    ac.messages['900'] = `${MARKER}<p>Week 41</p>`
    expect(ids(await run())).toEqual(['draft:230'])
    expect(sent[0].subject).toBe(
      'Newsletter: An unapproved Events · Week 41 draft has been waiting over 30 hours'
    )
    // The marker is read once, then remembered.
    await run(later(10 * MIN))
    expect(
      calls.filter(c => c.url.pathname === '/api/3/messages/900')
    ).toHaveLength(1)
  })

  it('ignores young drafts, hand-made drafts and drafts on other lists', async () => {
    const { run } = setup()
    ac.campaigns = [
      draft({ id: '231', cdate: acDate(20 * HOUR) }),
      draft({ id: '232', message_id: '901' }),
      draft({ id: '233', message_id: '902' }),
    ]
    ac.lists = { '231': ['6'], '232': ['7'], '233': ['5'] }
    ac.messages = { '900': MARKER, '901': '<p>Opt in</p>', '902': MARKER }
    expect((await run()).alerts).toEqual([])
    // A young draft needs no reads at all.
    expect(calls.some(c => c.url.pathname.includes('/231/'))).toBe(false)
  })

  it('leaves a draft alone while its waves are going out, and deletes it once every wave has gone', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = [
      draft(),
      campaign({
        id: '240',
        name: 'Events · Week 41, 2026 · wave 1/2',
        status: '5',
        cdate: acDate(DAY),
        ldate: acDate(DAY),
      }),
      // Approve once: wave 2 was scheduled with wave 1.
      campaign({
        id: '241',
        name: 'Events · Week 41, 2026 · wave 2/2',
        status: '1',
        cdate: acDate(DAY),
        sdate: acDate(-HOUR),
      }),
    ]
    ac.lists = { '230': ['6'], '240': ['6'], '241': ['6'] }
    ac.messages['900'] = MARKER
    await approve(store, '240', { waves: 2, expected: null })
    await approve(store, '241', { wave: 2, waves: 2, expected: null })
    await judged(store, '240', 'green')
    let s = await run()
    expect(s.alerts).toEqual([])
    expect(s.draftsDeleted).toEqual([])
    expect(ac.campaigns.some(c => c.id === '230')).toBe(true)

    // The last wave goes out: the draft has done its job and is deleted
    // (only the campaign: the waves sent its message).
    const last = ac.campaigns.find(c => c.id === '241')!
    last.status = '5'
    last.ldate = acDate(MIN, later(2 * HOUR))
    s = await run(later(2 * HOUR))
    expect(s.draftsDeleted).toEqual([
      { campaignId: '230', name: 'Events · Week 41, 2026', outcome: 'deleted' },
    ])
    expect(s.alerts).toEqual([])
    expect(sent).toEqual([])
    expect(ac.campaigns.some(c => c.id === '230')).toBe(false)
    expect(
      calls.filter(
        c => c.url.searchParams.get('api_action') === 'campaign_delete'
      )
    ).toHaveLength(1)
  })

  it('a finished issue’s draft it can’t delete is still flagged, to delete by hand', async () => {
    const { store, run } = setup()
    ac.campaigns = [
      draft(),
      ...[1, 2].map(k =>
        campaign({
          id: String(239 + k),
          name: `Events · Week 41, 2026 · wave ${k}/2`,
          status: '5',
          cdate: acDate(DAY),
          ldate: acDate(k === 1 ? DAY : HOUR),
        })
      ),
    ]
    ac.lists = { '230': ['6'], '240': ['6'], '241': ['6'] }
    ac.messages['900'] = MARKER
    ac.deleteRefuses.add('230')
    await approve(store, '240', { waves: 2 })
    await approve(store, '241', { wave: 2, waves: 2 })
    await judged(store, '240', 'green')
    const s = await run()
    expect(s.draftsDeleted[0].outcome).toMatch(
      /^refused: ActiveCampaign didn’t delete it/
    )
    expect(ids(s)).toEqual(['draft:230'])
    expect(s.alerts[0].detail[0]).toContain(
      'every wave of it has already gone out'
    )
  })
})

/* ─── Approve once: waves still to go (8 Oct 2026) ─────────────────────── */

describe('runWatch: waves still to go (approve once)', () => {
  const ISSUE = 'Events · Week 41, 2026'
  /** Waves 1–4 of the issue on list 6, made by one approval 20 hours ago:
   *  wave 1 sent (finished 19 hours ago), 2–4 scheduled a day apart from
   *  its start (in 4, 28 and 52 hours). `over` changes a wave. */
  async function issue(
    store: WatchStore,
    over: Record<number, Partial<FakeCampaign>> = {},
    approvedAt = later(-20 * HOUR).toISOString()
  ) {
    ac.campaigns = [1, 2, 3, 4].map(k =>
      campaign({
        id: String(400 + k),
        name: `${ISSUE} · wave ${k}/4`,
        status: k === 1 ? '5' : '1',
        segmentid: String(10 + k),
        cdate: acDate(20 * HOUR),
        sdate: acDate(20 * HOUR - (k - 1) * DAY),
        ldate: k === 1 ? acDate(19 * HOUR) : null,
        send_amt: k === 1 ? '1000' : '0',
        total_amt: k === 1 ? '1000' : '0',
        verified_unique_opens: k === 1 ? '400' : '0',
        ...over[k],
      })
    )
    for (const c of ac.campaigns) {
      ac.lists[c.id] = ['6']
      const k = Number(c.id) - 400
      await approve(store, c.id, {
        name: c.name,
        wave: k,
        waves: 4,
        segmentId: `uuid-${k}`,
        expected: 1000,
        approvedAt,
      })
    }
  }
  const writes = () =>
    calls
      .filter(c => c.method !== 'GET')
      .map(c => `${c.method} ${c.url.pathname.replace('/api/3/', '')}`)
  const canceled = (ids: string[]) =>
    ids.map(id => ({
      campaignId: id,
      name: `${ISSUE} · wave ${Number(id) - 400}/4`,
      outcome: 'canceled',
    }))

  it('a red verdict cancels every later wave still scheduled, says so once, and touches nothing else', async () => {
    const { store, sent, run } = setup()
    await issue(store, { 1: { hardbounces: '25' } })
    const s = await run()
    expect(s.health).toEqual([{ campaignId: '401', verdict: 'red' }])
    expect(s.canceled).toEqual(canceled(['402', '403', '404']))
    expect(ac.campaigns.map(c => c.id)).toEqual(['401'])
    expect(writes()).toEqual([
      'DELETE campaigns/402/delete',
      'DELETE campaigns/403/delete',
      'DELETE campaigns/404/delete',
    ])
    expect(ids(s)).toEqual([`canceled:6:${ISSUE}:1`, 'health:401'])
    const alert = s.alerts.find(a => a.id.startsWith('canceled:'))!
    expect(alert.severity).toBe('red')
    expect(alert.title).toBe(
      'Events · Week 41: waves 2–4 canceled – wave 1 came back red'
    )
    expect(alert.detail).toEqual([
      'The send watcher canceled waves 2–4 (campaigns 402, 403, 404) before they went out, because wave 1’s 18-hour check came back red: hard bounces 2.5% (red at 2%). Nobody got them.',
      'Look at wave 1’s numbers on the newsletter page. To send the rest anyway, approve them again there and say why; otherwise leave them.',
    ])
    expect(sent.map(m => m.subject)).toEqual([
      'Newsletter: Events · Week 41: waves 2–4 canceled – wave 1 came back red',
      'Newsletter: Events · Week 41 wave 1/4 health check: red – hold the next wave',
    ])
    expect(sent[1].text).toContain(
      'The send watcher cancels the waves of it still scheduled.'
    )
    // Kept for the banner, and nothing more to do or say on the next run.
    expect(
      Object.keys(
        (await store.get<{ events: object }>(CANCELED_KEY))?.events ?? {}
      )
    ).toEqual(['402', '403', '404'])
    const again = await run(later(10 * MIN))
    expect(again.canceled).toEqual([])
    expect(ids(again)).toContain(`canceled:6:${ISSUE}:1`)
    expect(sent).toHaveLength(2)
    // Three days on, it rests.
    expect(ids(await run(later(3 * DAY + HOUR)))).not.toContain(
      `canceled:6:${ISSUE}:1`
    )
  })

  it('leaves waves approved after the red verdict alone: that approval took a typed reason', async () => {
    const { store, run } = setup()
    await judged(store, '401', 'red', {
      checkedAt: later(-2 * HOUR).toISOString(),
    })
    await issue(store, {}, later(-HOUR).toISOString())
    await approve(store, '402', {
      name: `${ISSUE} · wave 2/4`,
      wave: 2,
      approvedAt: later(-HOUR).toISOString(),
      override: 'One bad domain bounced; fixed on the list',
    })
    const s = await run()
    expect(s.canceled).toEqual([])
    expect(writes()).toEqual([])
  })

  it('cancels nothing on amber', async () => {
    const { store, run } = setup()
    await issue(store, { 1: { verified_unique_opens: '200' } })
    const s = await run()
    expect(s.health).toEqual([{ campaignId: '401', verdict: 'amber' }])
    expect(s.canceled).toEqual([])
    expect(writes()).toEqual([])
    expect(ac.campaigns).toHaveLength(4)
  })

  it('fail closed: a wave starting within the hour without a verdict on the one before is canceled, with every later one', async () => {
    const { store, sent, run } = setup()
    // Wave 1 was held for review for 13 hours and finished 10 hours ago:
    // its verdict isn't due, and wave 2 starts in 50 minutes.
    await issue(store, {
      1: { sdate: acDate(23 * HOUR + 10 * MIN), ldate: acDate(10 * HOUR) },
      2: { sdate: acDate(-50 * MIN) },
    })
    const s = await run()
    expect(s.health).toEqual([])
    expect(s.canceled).toEqual(canceled(['402', '403', '404']))
    const alert = s.alerts.find(a => a.id.startsWith('canceled:'))!
    expect(alert.title).toBe(
      'Events · Week 41: waves 2–4 canceled – wave 1 has no health check'
    )
    expect(alert.detail[0]).toMatch(
      /^Wave 2 was due to start 8 October 2026.*, but wave 1 has no 18-hour check yet, so the send watcher canceled waves 2–4 \(campaigns 402, 403, 404\) rather than send them unchecked\. Nobody got them\.$/
    )
    expect(sent.map(m => m.subject)).toEqual([
      'Newsletter: Events · Week 41: waves 2–4 canceled – wave 1 has no health check',
    ])
  })

  it('…not while the wave is more than an hour away', async () => {
    const { store, run } = setup()
    await issue(store, {
      1: { sdate: acDate(22 * HOUR), ldate: acDate(10 * HOUR) },
      2: { sdate: acDate(-2 * HOUR) },
    })
    const s = await run()
    expect(s.canceled).toEqual([])
    expect(writes()).toEqual([])
  })

  it('fail closed when ActiveCampaign doesn’t say when the wave before finished, or it is still going', async () => {
    const { store, run } = setup()
    await issue(store, {
      1: { ldate: null },
      2: { sdate: acDate(-30 * MIN) },
    })
    let s = await run()
    expect(s.canceled.map(c => c.campaignId)).toEqual(['402', '403', '404'])
    expect(
      s.alerts.find(a => a.id.startsWith('canceled:'))!.detail[0]
    ).toContain('ActiveCampaign doesn’t say when wave 1 finished')

    const next = setup()
    await issue(next.store, {
      1: { status: '2', ldate: null },
      2: { sdate: acDate(-30 * MIN) },
    })
    s = await next.run()
    expect(s.canceled.map(c => c.campaignId)).toEqual(['402', '403', '404'])
    expect(
      s.alerts.find(a => a.id.startsWith('canceled:'))!.detail[0]
    ).toContain('wave 1 is sending, not finished')
  })

  it('a wave sent anyway with a typed reason isn’t canceled for a missing verdict', async () => {
    const { store, run } = setup()
    await issue(store, {
      1: { ldate: acDate(10 * HOUR) },
      2: { sdate: acDate(-30 * MIN) },
    })
    await approve(store, '402', {
      name: `${ISSUE} · wave 2/4`,
      wave: 2,
      approvedAt: later(-20 * HOUR).toISOString(),
      override: 'The watcher was down; numbers checked by hand',
    })
    const s = await run()
    expect(s.canceled).toEqual([])
    expect(writes()).toEqual([])
  })

  it('never touches a wave that has started; one that starts as the cancel comes is said', async () => {
    const { store, sent, run } = setup()
    await issue(store, {
      1: { hardbounces: '25' },
      2: { status: '2', sdate: acDate(MIN), send_amt: '30' },
    })
    ac.startsOnDelete.add('403')
    const s = await run()
    expect(s.canceled).toEqual([
      { campaignId: '403', name: `${ISSUE} · wave 3/4`, outcome: 'started' },
      { campaignId: '404', name: `${ISSUE} · wave 4/4`, outcome: 'canceled' },
    ])
    expect(writes()).toEqual([
      'DELETE campaigns/403/delete',
      'DELETE campaigns/404/delete',
    ])
    expect(ac.campaigns.find(c => c.id === '402')?.status).toBe('2')
    expect(ids(s)).toEqual([
      'cancel-started:403',
      `canceled:6:${ISSUE}:1`,
      'health:401',
    ])
    expect(sent.map(m => m.subject)).toEqual(
      expect.arrayContaining([
        'Newsletter: Events · Week 41 wave 3 started before it could be canceled',
        'Newsletter: Events · Week 41: wave 4 canceled – wave 1 came back red',
      ])
    )
  })

  it('a held later wave is never deleted: the alert says to cancel it on the page', async () => {
    const { store, run } = setup()
    await issue(store, { 1: { hardbounces: '25' }, 3: { status: '7' } })
    const s = await run()
    expect(s.canceled.map(c => c.campaignId)).toEqual(['402', '404'])
    expect(writes()).not.toContain('DELETE campaigns/403/delete')
    const held = s.alerts.find(a => a.id === 'cancel-held:403')!
    expect(held.title).toBe(
      'Events · Week 41 wave 3 is held for review and shouldn’t go out'
    )
    expect(held.detail[0]).toMatch(
      /^Wave 1’s 18-hour check came back red: .*, so wave 3 shouldn’t go out, but it is held for ActiveCampaign’s review \(campaign 403\)/
    )
  })

  it('a dry run cancels nothing and says what it would', async () => {
    const { store, run } = setup()
    await issue(store, { 1: { hardbounces: '25' } })
    const before = JSON.stringify(store.dump())
    const s = await run(NOW, { dry: true })
    expect(s.canceled.map(c => [c.campaignId, c.outcome])).toEqual([
      ['402', 'dry'],
      ['403', 'dry'],
      ['404', 'dry'],
    ])
    expect(writes()).toEqual([])
    expect(JSON.stringify(store.dump())).toBe(before)
  })

  it('a cancel with no clear answer is tried again on the next run, and the alert says so meanwhile', async () => {
    const { store, run } = setup()
    await issue(store, { 1: { hardbounces: '25' } })
    ac.deleteNoAnswer.set('402', 'kept')
    let s = await run()
    expect(s.canceled.map(c => [c.campaignId, c.outcome])).toEqual([
      ['402', 'unclear'],
      ['403', 'canceled'],
      ['404', 'canceled'],
    ])
    expect(ids(s)).toEqual([
      'cancel-failed:402',
      `canceled:6:${ISSUE}:1`,
      'health:401',
    ])
    expect(s.alerts.find(a => a.id === 'cancel-failed:402')!.title).toBe(
      'The send watcher couldn’t cancel Events · Week 41 wave 2'
    )
    s = await run(later(10 * MIN))
    expect(s.canceled).toEqual(canceled(['402']))
    expect(ids(s)).toEqual([`canceled:6:${ISSUE}:1`, 'health:401'])
    expect(s.alerts[0].title).toBe(
      'Events · Week 41: waves 2–4 canceled – wave 1 came back red'
    )

    // When the unclear delete did land, the next run sees it gone.
    const other = setup()
    await issue(other.store, { 1: { hardbounces: '25' } })
    ac.deleteNoAnswer.set('402', 'gone')
    await other.run()
    s = await other.run(later(10 * MIN))
    expect(s.canceled).toEqual([])
    expect(ids(s)).toEqual([`canceled:6:${ISSUE}:1`, 'health:401'])
    expect(
      (
        await other.store.get<{ events: Record<string, { outcome: string }> }>(
          CANCELED_KEY
        )
      )?.events['402'].outcome
    ).toBe('canceled')
  })

  it('a wave made a moment ago whose approval record isn’t written yet is left for the next run', async () => {
    const { store, run } = setup()
    await issue(store, {
      1: { hardbounces: '25' },
      2: { cdate: acDate(MIN) },
    })
    await store.set(APPROVED_PREFIX + '402', null)
    let s = await run()
    expect(s.canceled.map(c => c.campaignId)).toEqual(['403', '404'])
    s = await run(later(10 * MIN))
    expect(s.canceled.map(c => c.campaignId)).toEqual(['402'])
  })

  it('leaves test lists and Funding alone', async () => {
    const { store, run } = setup()
    await issue(store, { 1: { hardbounces: '25' } })
    for (const c of ac.campaigns) ac.lists[c.id] = ['8']
    const s = await run()
    expect(s.canceled).toEqual([])
    expect(writes()).toEqual([])
  })
})

/* ─── Account and API ────────────────────────────────────────────────── */

describe('runWatch: the account', () => {
  it('alerts when the contact limit or account status changes', async () => {
    const { sent, run } = setup()
    expect((await run()).alerts).toEqual([])
    ac.account.subscriber_limit = '10000'
    let s = await run(later(10 * MIN))
    expect(ids(s)).toEqual(['account-change'])
    expect(sent[0].subject).toBe(
      'Newsletter: ActiveCampaign’s account limit or status changed'
    )
    expect(sent[0].text).toContain('5000 → 10000')
    s = await run(later(20 * MIN))
    expect(sent).toHaveLength(1)
    ac.account.status = 'suspended'
    await run(later(30 * MIN))
    expect(sent).toHaveLength(2)
    expect(sent[1].text).toContain('“nobody” → “suspended”')
    // It clears three days after the last change.
    expect((await run(later(30 * MIN + 3 * DAY + MIN))).alerts).toEqual([])
  })

  it('alerts at 4,950 contacts, and again at the limit itself', async () => {
    const { sent, run } = setup()
    ac.account.subscriber_total = '4949'
    ac.contactsTotal = 4949
    expect((await run()).alerts).toEqual([])
    ac.contactsTotal = 4950
    expect(ids(await run(later(10 * MIN)))).toEqual(['contacts-cap'])
    expect(sent[0].subject).toBe(
      'Newsletter: ActiveCampaign is at 4,950 of 5,000 contacts – sends stop at 5,000'
    )
    ac.contactsTotal = 4990
    await run(later(20 * MIN))
    expect(sent).toHaveLength(1)
    ac.account.subscriber_total = '5000'
    await run(later(30 * MIN))
    expect(sent[1].subject).toBe(
      'Newsletter: ActiveCampaign is at its 5,000-contact limit – sends have stopped'
    )
  })
})

describe('runWatch: ActiveCampaign unreachable', () => {
  it('alerts after an hour of failures and keeps open alerts meanwhile', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = [campaign({ id: '250', status: '3' })]
    ac.lists['250'] = ['6']
    await approve(store, '250')
    expect(ids(await run())).toEqual(['status:250'])
    expect(sent).toHaveLength(1)

    ac.down = 502
    let s = await run(later(10 * MIN))
    expect(s.errors[0]).toMatch(/^campaigns: ActiveCampaign campaigns: 502/)
    // The paused campaign can't be seen, so its alert stays as it was.
    expect(ids(s)).toEqual(['status:250'])
    s = await run(later(60 * MIN))
    expect(ids(s)).toEqual(['status:250'])
    s = await run(later(70 * MIN))
    expect(ids(s)).toEqual(['ac-unreachable', 'status:250'])
    expect(sent.map(m => m.subject)).toEqual([
      'Newsletter: Events · Week 41 is paused',
      'Newsletter: The site can’t read ActiveCampaign',
    ])
    const state = await store.get<{ api: { failures: number } }>(STATE_KEY)
    expect(state?.api.failures).toBe(3)

    ac.down = null
    ac.campaigns[0].status = '5'
    s = await run(later(80 * MIN))
    expect(s.alerts).toEqual([])
    expect(s.errors).toEqual([])
  })

  it('never lets the API key into an error, a summary or an email', async () => {
    const { sent, run } = setup()
    vi.stubGlobal('fetch', async (input: unknown) => {
      throw new Error(`request to ${String(input)} failed`)
    })
    let s = await run()
    s = await run(later(2 * HOUR))
    expect(s.errors.length).toBeGreaterThan(0)
    expect(JSON.stringify(s)).not.toContain(KEY)
    expect(JSON.stringify(sent)).not.toContain(KEY)
    expect(sent.map(m => m.subject)).toEqual([
      'Newsletter: The site can’t read ActiveCampaign',
    ])
  })
})

/* ─── Health, 18 hours after ─────────────────────────────────────────── */

describe('runWatch: health checks', () => {
  function sentWave(over: Partial<FakeCampaign> = {}) {
    return campaign({
      id: '260',
      name: 'Training · Week 41, 2026 · wave 1/4',
      status: '5',
      cdate: acDate(20 * HOUR),
      sdate: acDate(20 * HOUR),
      ldate: acDate(19 * HOUR),
      send_amt: '1000',
      total_amt: '1000',
      verified_unique_opens: '400',
      ...over,
    })
  }

  it('reports once, 18 hours after, and stores the verdict', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = [sentWave({ hardbounces: '25' })]
    ac.lists['260'] = ['7']
    ac.unsubTotals['260'] = { spam_complaints: '0', unsubscribes: '12' }
    await approve(store, '260', { listId: '7', expected: 1003 })

    const s = await run()
    expect(s.health).toEqual([{ campaignId: '260', verdict: 'red' }])
    expect(sent.map(m => m.subject)).toEqual([
      'Newsletter: Training · Week 41 wave 1/4 health check: red – hold the next wave',
    ])
    expect(sent[0].text).toContain(
      'Sent to: 1,000 (the approval expected 1,003)'
    )
    expect(sent[0].text).toContain('Hard bounces: 25 (2.5%)')
    expect(sent[0].text).toContain('Unsubscribes: 12 (1.2%)')
    const record = await store.get<HealthRecord>(HEALTH_PREFIX + '260')
    expect(record?.verdict).toBe('red')
    expect(record?.numbers.spamComplaints).toBe(0)
    expect(record?.emailedAt).toBe(NOW.toISOString())
    expect(ids(s)).toEqual(['health:260'])

    // Next run: no second report, no second read, no second email.
    const again = await run(later(10 * MIN))
    expect(again.health).toEqual([])
    expect(ids(again)).toEqual(['health:260'])
    expect(sent).toHaveLength(1)
    expect(
      calls.filter(
        c =>
          c.url.searchParams.get('api_action') ===
          'campaign_report_unsubscription_totals'
      )
    ).toHaveLength(1)
  })

  it('emails a green check and raises nothing', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = [sentWave()]
    ac.lists['260'] = ['7']
    await approve(store, '260', { listId: '7', expected: 1000 })
    const s = await run()
    expect(s.health).toEqual([{ campaignId: '260', verdict: 'green' }])
    expect(sent[0].subject).toBe(
      'Newsletter: Training · Week 41 wave 1/4 health check: green'
    )
    expect(sent).toHaveLength(1)
    expect(s.alerts).toEqual([])
  })

  it('counts spam complaints from the v1 report', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = [sentWave()]
    ac.lists['260'] = ['7']
    await approve(store, '260', { listId: '7', expected: 1000 })
    ac.unsubTotals['260'] = { spam_complaints: '3' }
    const s = await run()
    expect(s.health[0].verdict).toBe('red')
    expect(sent[0].text).toContain(
      'Spam complaints: 3 (0.3%, non-Gmail readers only)'
    )
  })

  it('waits the full 18 hours, and skips Funding', async () => {
    const { run } = setup()
    ac.campaigns = [
      sentWave({ ldate: acDate(17 * HOUR) }),
      sentWave({ id: '261', ldate: acDate(19 * HOUR) }),
    ]
    ac.lists = { '260': ['7'], '261': ['8'] }
    const s = await run()
    expect(s.health).toEqual([])
  })

  it('stores but does not email a check on a rehearsal to a few people', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = [
      sentWave({ send_amt: '3', total_amt: '3', verified_unique_opens: '0' }),
    ]
    ac.lists['260'] = ['7']
    await approve(store, '260', { listId: '7' })
    const s = await run()
    expect(s.health).toEqual([{ campaignId: '260', verdict: 'red' }])
    expect(sent).toEqual([])
    expect(s.alerts).toEqual([])
    expect(
      (await store.get<HealthRecord>(HEALTH_PREFIX + '260'))?.smallSample
    ).toBe(true)
  })

  it('retries a health email that did not go out, without rereading', async () => {
    const { store, sent, run, breakMail } = setup()
    ac.campaigns = [sentWave()]
    ac.lists['260'] = ['7']
    await approve(store, '260', { listId: '7', expected: 1000 })
    breakMail(true)
    await run()
    expect(sent).toEqual([])
    breakMail(false)
    await run(later(10 * MIN))
    expect(sent).toHaveLength(1)
    expect(
      calls.filter(c => c.url.searchParams.has('campaignid'))
    ).toHaveLength(1)
  })
})

/* ─── Dedupe, email batching, lock, dry runs, read-only ──────────────── */

describe('runWatch: plumbing', () => {
  it('retries an alert email that failed, then stops', async () => {
    const { sent, run, breakMail, mail } = setup()
    ac.campaigns = [campaign({ id: '270', status: '3' })]
    ac.lists['270'] = ['6']
    breakMail(true)
    await run()
    expect(mail).toHaveBeenCalledTimes(1)
    breakMail(false)
    await run(later(10 * MIN))
    await run(later(20 * MIN))
    expect(sent).toHaveLength(1)
    expect(mail).toHaveBeenCalledTimes(2)
  })

  it('saves what it found before emailing, so a run cut short resumes', async () => {
    const store = memoryWatchStore()
    ac.campaigns = [campaign({ id: '277', status: '3' })]
    ac.lists['277'] = ['6']
    // The function is stopped at its time limit while the email is going.
    await expect(
      runWatch({
        now: NOW,
        store,
        retryDelayMs: 0,
        mail: async () => {
          throw new Error('function timed out')
        },
      })
    ).rejects.toThrow('function timed out')
    expect(Object.keys(store.dump()).sort()).toEqual([
      'aisafety:newsletter:watch:alerts',
      'aisafety:newsletter:watch:state',
    ])
    const sent: Mail[] = []
    const s = await runWatch({
      now: later(10 * MIN),
      store,
      retryDelayMs: 0,
      mail: async m => {
        sent.push(m)
        return true
      },
    })
    expect(ids(s)).toEqual(['status:277'])
    expect(sent.map(m => m.subject)).toEqual([
      'Newsletter: Events · Week 41 is paused',
    ])
  })

  it('reads ids and statuses sent as numbers', async () => {
    const { run } = setup()
    ac.campaigns = [
      { ...campaign({ id: '278', status: '3' }), id: 278, status: 3 },
    ] as unknown as FakeCampaign[]
    ac.lists['278'] = ['6']
    expect(ids(await run())).toEqual(['status:278'])
  })

  it('sends one summary instead of more than three emails at once', async () => {
    const { sent, run } = setup()
    ac.campaigns = ['271', '272', '273', '274'].map(id =>
      campaign({ id, status: '3' })
    )
    for (const id of ['271', '272', '273', '274']) ac.lists[id] = ['6']
    const s = await run()
    expect(s.alerts).toHaveLength(4)
    expect(sent.map(m => m.subject)).toEqual([
      'Newsletter: 4 problems need a look (4 red)',
    ])
  })

  it('alerts again when a problem comes back, but not when it flaps', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = [campaign({ id: '275', status: '3' })]
    ac.lists['275'] = ['6']
    await approve(store, '275')
    const flip = async (status: string, at: number) => {
      ac.campaigns[0].status = status
      ac.campaigns[0].sdate = acDate(MIN, later(at))
      return run(later(at))
    }
    await run()
    // Paused, resumed, paused again within the hour: on the banner each
    // time it's open, emailed once.
    await flip('2', 10 * MIN)
    expect(ids(await flip('3', 20 * MIN))).toEqual(['status:275'])
    await flip('2', 30 * MIN)
    await flip('3', 40 * MIN)
    expect(sent).toHaveLength(1)
    // Back more than six hours after it was last open: emailed again.
    await flip('2', 50 * MIN)
    await flip('3', 7 * HOUR)
    expect(sent.map(m => m.subject)).toEqual([
      'Newsletter: Events · Week 41 is paused',
      'Newsletter: Events · Week 41 is paused',
    ])
  })

  it('skips a run while another holds the lock', async () => {
    const { store, run } = setup()
    await store.lock(LOCK_KEY, 300)
    const s = await run()
    expect(s).toMatchObject({
      ran: false,
      skipped: 'another run is still going',
    })
    expect(calls).toEqual([])
    await store.unlock(LOCK_KEY)
    expect((await run()).ran).toBe(true)
    // The lock is released after a run.
    expect(await store.lock(LOCK_KEY, 300)).toBe(true)
  })

  it('writes nothing and emails nobody on a dry run', async () => {
    const { store, mail, run } = setup()
    ac.campaigns = [campaign({ id: '276', status: '3' })]
    ac.lists['276'] = ['6']
    const s = await run(NOW, { dry: true })
    expect(ids(s)).toEqual(['status:276'])
    expect(s.emails).toEqual(['Newsletter: Events · Week 41 is paused'])
    expect(mail).not.toHaveBeenCalled()
    expect(store.dump()).toEqual({})
  })

  it('only ever reads from ActiveCampaign', async () => {
    const { store, run } = setup()
    ac.campaigns = [
      campaign({ id: '280', status: '7', cdate: acDate(HOUR) }),
      campaign({
        id: '281',
        status: '1',
        segmentid: '0',
        sdate: acDate(-5 * MIN),
      }),
      campaign({
        id: '282',
        status: '0',
        cdate: acDate(2 * DAY),
        message_id: '905',
      }),
      campaign({
        id: '283',
        status: '5',
        ldate: acDate(20 * HOUR),
        send_amt: '900',
      }),
    ]
    ac.lists = { '280': ['6'], '281': ['7'], '282': ['6'], '283': ['6'] }
    ac.messages['905'] = MARKER
    await approve(store, '281')
    await run()
    expect(calls.length).toBeGreaterThan(5)
    for (const c of calls) {
      expect(c.method).toBe('GET')
      const action = c.url.searchParams.get('api_action')
      if (action)
        expect([
          'account_view',
          'campaign_report_unsubscription_totals',
        ]).toContain(action)
    }
  })

  it('skips when ActiveCampaign is not configured', async () => {
    delete process.env.ACTIVECAMPAIGN_KEY
    const { run } = setup()
    expect(await run()).toMatchObject({ ran: false })
    expect(calls).toEqual([])
  })
})

/* ─── Review of 29 Sept 2026: auth, flaps, ceilings, clocks ───────────── */

describe('cronAuthorized', () => {
  it('refuses without CRON_SECRET, with a wrong one and without a header', () => {
    expect(cronAuthorized('Bearer x', undefined)).toBe(false)
    expect(cronAuthorized('Bearer ', '')).toBe(false)
    expect(cronAuthorized(null, 's3cret')).toBe(false)
    expect(cronAuthorized('Bearer s3cre', 's3cret')).toBe(false)
    expect(cronAuthorized('Bearer s3cret!', 's3cret')).toBe(false)
    expect(cronAuthorized('s3cret', 's3cret')).toBe(false)
    expect(cronAuthorized('Bearer s3cret', 's3cret')).toBe(true)
  })
})

describe('runWatch: review hardening', () => {
  it('catches an old draft sent later from ActiveCampaign’s own screens', async () => {
    const { sent, run } = setup()
    // A pipeline draft built three days ago, seen as a draft first.
    ac.campaigns = [
      campaign({
        id: '280',
        status: '0',
        cdate: acDate(3 * DAY),
        sdate: null,
      }),
    ]
    ac.lists['280'] = ['7']
    await run()
    // Then someone sends it from ActiveCampaign, not the page.
    ac.campaigns[0].status = '2'
    ac.campaigns[0].sdate = acDate(MIN, later(10 * MIN))
    const s = await run(later(10 * MIN))
    expect(ids(s)).toContain('unapproved:280')
    expect(sent[0].subject).toBe(
      'Newsletter: Events · Week 41 was not sent through the approval page'
    )
  })

  it('rereads a campaign’s lists when its status changes', async () => {
    const { run } = setup()
    // A draft made in ActiveCampaign's editor, no list picked yet.
    ac.campaigns = [
      campaign({ id: '281', status: '0', cdate: acDate(2 * DAY), sdate: null }),
    ]
    ac.lists['281'] = []
    expect((await run()).alerts).toEqual([])
    // A list is picked and it's scheduled.
    ac.lists['281'] = ['6']
    ac.campaigns[0].status = '1'
    ac.campaigns[0].sdate = acDate(-30 * MIN, later(10 * MIN))
    expect(ids(await run(later(10 * MIN)))).toEqual(['unapproved:281'])
  })

  it('leaves automatic emails (auto-responders) out of the timing and wave rules', async () => {
    const { sent, run } = setup()
    ac.campaigns = [
      // Switched on three days ago, "scheduled" ever since.
      campaign({
        id: '286',
        type: 'responder',
        status: '1',
        segmentid: '0',
        cdate: acDate(3 * DAY),
        sdate: acDate(5 * MIN),
      }),
      campaign({
        id: '287',
        type: 'responder',
        status: '2',
        segmentid: '0',
        cdate: acDate(3 * DAY),
        sdate: acDate(3 * DAY),
      }),
    ]
    ac.lists = { '286': ['6'], '287': ['7'] }
    expect((await run()).alerts).toEqual([])
    expect((await run(later(HOUR))).alerts).toEqual([])
    // A new one, not set up through the page, is flagged once.
    ac.campaigns.push(
      campaign({
        id: '288',
        type: 'responder',
        status: '1',
        segmentid: '0',
        cdate: acDate(10 * MIN, later(HOUR)),
        sdate: acDate(10 * MIN, later(HOUR)),
      })
    )
    ac.lists['288'] = ['6']
    expect(ids(await run(later(HOUR + MIN)))).toEqual(['unapproved:288'])
    expect(sent).toHaveLength(1)
  })

  it('judges "more than expected" by emails sent, not total_amt', async () => {
    const { store, run } = setup()
    ac.campaigns = [
      campaign({
        id: '282',
        name: 'Events · Week 41, 2026 · wave 1/4',
        status: '1',
        segmentid: '14',
        sdate: acDate(-5 * MIN),
        send_amt: '0',
        total_amt: '2889',
      }),
      campaign({
        id: '283',
        name: 'Training · Week 41, 2026 · wave 1/4',
        status: '2',
        segmentid: '15',
        sdate: acDate(MIN),
        send_amt: '300',
        total_amt: '2889',
      }),
    ]
    ac.lists = { '282': ['6'], '283': ['7'] }
    await approve(store, '282', { expected: 494 })
    await approve(store, '283', { expected: 494, listId: '7' })
    expect((await run()).alerts).toEqual([])
    ac.campaigns[1].send_amt = '700'
    expect(ids(await run(later(10 * MIN)))).toEqual(['oversend:283'])
  })

  it('reads ActiveCampaign’s winter offset, and an offset-less date as unknown', async () => {
    const { store, run } = setup()
    const winter = (msAgo: number) =>
      new Date(NOW.getTime() - msAgo - 6 * HOUR)
        .toISOString()
        .replace(/\.\d{3}Z$/, '-06:00')
    ac.campaigns = [
      campaign({
        id: '284',
        status: '1',
        cdate: winter(HOUR),
        sdate: winter(10 * MIN),
      }),
      // Local time with no offset: can't be placed, so it can't be "late".
      campaign({
        id: '285',
        status: '1',
        cdate: acDate(HOUR),
        sdate: '2026-10-08 06:00:00',
      }),
    ]
    ac.lists = { '284': ['6'], '285': ['6'] }
    await approve(store, '284')
    await approve(store, '285')
    expect((await run()).alerts).toEqual([])
    expect(ids(await run(later(11 * MIN)))).toEqual(['late:284'])
  })

  it('emails an account status that flips back and forth at most twice', async () => {
    const { sent, run } = setup()
    await run()
    for (let i = 1; i <= 12; i++) {
      ac.account.status = i % 2 ? 'sending' : 'nobody'
      await run(later(i * 10 * MIN))
    }
    expect(sent).toHaveLength(2)
  })

  it('never tries more than 4 emails an hour or 20 a day', async () => {
    const { sent, run } = setup()
    // A new paused campaign every run, each its own problem.
    for (let i = 0; i < 6; i++) {
      ac.campaigns.push(campaign({ id: String(300 + i), status: '3' }))
      ac.lists[String(300 + i)] = ['6']
      await run(later(i * 10 * MIN))
    }
    expect(sent).toHaveLength(4)
    // What waited goes out once the hour has room again.
    const s = await run(later(70 * MIN))
    expect(s.deferred).toEqual([])
    expect(sent).toHaveLength(6)

    // A mail script that sends but always answers "failed" retries each
    // run, yet stays under the ceilings.
    const log = setup()
    log.breakMail(true)
    ac.campaigns = [campaign({ id: '310', status: '3' })]
    ac.lists['310'] = ['6']
    for (let i = 0; i < 6 * 24; i++) await log.run(later(i * 10 * MIN))
    expect(log.mail).toHaveBeenCalledTimes(20)
    const doc = await log.store.get<{ mailLog: string[] }>(ALERTS_KEY)
    expect(doc?.mailLog).toHaveLength(20)
  })

  it('puts alerts before health checks when the ceiling is near', async () => {
    const { store, sent, run } = setup()
    ac.campaigns = ['320', '321', '322', '323', '324'].map((id, i) =>
      campaign({
        id,
        name: `Training · Week 41, 2026 · wave ${i + 1}/5`,
        status: '5',
        cdate: acDate(20 * HOUR),
        sdate: acDate(20 * HOUR),
        ldate: acDate(19 * HOUR),
        send_amt: '1000',
        total_amt: '1000',
        verified_unique_opens: '400',
      })
    )
    ac.campaigns.push(campaign({ id: '325', status: '3' }))
    for (const c of ac.campaigns) {
      ac.lists[c.id] = ['7']
      await approve(store, c.id, { listId: '7', expected: 1000 })
    }
    const s = await run()
    expect(sent[0].subject).toBe('Newsletter: Events · Week 41 is paused')
    expect(sent).toHaveLength(4)
    expect(s.deferred).toHaveLength(2)
    // The two left go in the next hour; each check is emailed once.
    await run(later(61 * MIN))
    await run(later(71 * MIN))
    expect(sent).toHaveLength(6)
    expect(
      sent.filter(m => m.subject.includes('health check')).map(m => m.subject)
    ).toHaveLength(5)
  })

  it.skipIf(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)(
    'refuses a real run without Upstash rather than forget what it emailed',
    async () => {
      const mail = vi.fn(async () => true)
      ac.campaigns = [campaign({ id: '331', status: '3' })]
      ac.lists['331'] = ['6']
      await expect(
        runWatch({ now: NOW, mail, retryDelayMs: 0 })
      ).rejects.toThrow(/KV_REST_API_URL/)
      expect(mail).not.toHaveBeenCalled()
      expect(calls).toEqual([])
      // A dry run on a laptop still works.
      const s = await runWatch({ now: NOW, mail, retryDelayMs: 0, dry: true })
      expect(ids(s)).toEqual(['status:331'])
    }
  )

  it('sends nothing when Upstash fails, and never calls a send unapproved for it', async () => {
    const { store, mail, run } = setup()
    ac.campaigns = [
      campaign({
        id: '330',
        status: '2',
        cdate: acDate(10 * MIN),
        sdate: acDate(MIN),
      }),
    ]
    ac.lists['330'] = ['6']
    await approve(store, '330')
    expect((await run()).alerts).toEqual([])

    // The approval records can't be read: the campaign part counts as not
    // read, so nothing is raised about it.
    const mget = store.mget
    store.mget = async () => {
      throw new Error('Upstash 503')
    }
    let s = await run(later(10 * MIN))
    expect(s.alerts).toEqual([])
    expect(s.errors[0]).toMatch(/^campaigns: Upstash 503/)
    store.mget = mget

    // The stored state can't be read at all: the run stops before
    // reading or emailing anything.
    const get = store.get
    store.get = async () => {
      throw new Error('Upstash 503')
    }
    await expect(run(later(20 * MIN))).rejects.toThrow('Upstash 503')
    store.get = get
    expect(mail).not.toHaveBeenCalled()
    s = await run(later(30 * MIN))
    expect(s.ran).toBe(true)
  })
})

describe('readAlerts', () => {
  it('returns the open alerts, red first, and when the watcher last ran', async () => {
    const { store, run } = setup()
    ac.campaigns = [
      campaign({ id: '290', status: '4', send_amt: '10' }),
      campaign({ id: '291', status: '3' }),
    ]
    ac.lists = { '290': ['6'], '291': ['7'] }
    await run()
    const view = await readAlerts({ store, now: later(5 * MIN) })
    expect(view.lastRunAt).toBe(NOW.toISOString())
    expect(view.stale).toBe(false)
    expect(view.alerts.map(a => [a.id, a.severity])).toEqual([
      ['status:291', 'red'],
      ['status:290', 'amber'],
    ])
    expect(Object.keys(view.alerts[0]).sort()).toEqual([
      'campaignId',
      'detail',
      'id',
      'severity',
      'since',
      'title',
    ])
  })

  it('calls the watcher stale after 30 minutes without a run', async () => {
    const { store, run } = setup()
    await run()
    expect((await readAlerts({ store, now: later(31 * MIN) })).stale).toBe(true)
  })

  it('calls a watcher that never ran stale in production only', async () => {
    const store = memoryWatchStore()
    expect((await readAlerts({ store })).stale).toBe(false)
    process.env.VERCEL_ENV = 'production'
    expect((await readAlerts({ store })).stale).toBe(true)
  })
})
