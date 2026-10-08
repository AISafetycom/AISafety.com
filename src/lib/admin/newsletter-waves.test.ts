/*
  Warm-up waves, the Stop buttons, grouping by issue and the owner's notice,
  against the pretend ActiveCampaign (./__fixtures__/fake-ac.ts).

  The numbers are the test sweep's practice export (29 Sept 2026): 2,889 on
  list 6, waves of 494, 986 and 710 tagged and 699 everyone else. Nothing in
  this file touches the network.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  camp,
  expireLocks,
  freshModule,
  kv,
  MAIL_SCRIPT_URL,
  makeAC,
  outcome,
  resetKv,
  WAVE_COUNTS,
  WAVE_IDS,
  waveSegments,
  type AcOptions,
} from './__fixtures__/fake-ac'

vi.mock('@upstash/redis', async () => ({
  Redis: (await import('./__fixtures__/fake-ac')).FakeRedis,
}))

// The routes' sign-in checks, and next/server's after() (outside a real
// request it would throw): the callbacks are kept to be run by the test.
const session = { fresh: true, canSend: true }
vi.mock('@/lib/admin/auth', () => ({
  canSendNewsletter: async () => session.canSend,
  canViewNewsletter: async () => true,
  hasFreshSession: async () => session.fresh,
  currentAdmin: async () => ({ name: 'Bryce', email: 'bryce@example.com' }),
  NEWSLETTER_FRESH_SECONDS: 14400,
}))
const afterQueue: Array<() => unknown> = []
vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => unknown) => {
    afterQueue.push(fn)
  },
}))

type NL = typeof import('./newsletter')

const ENV = { ...process.env }
const WHO = { approver: 'Bryce Robertson' }
const ISSUE = 'Events · Week 41, 2026'

/** The page's choice: wave k and every one after it, of n (the fixture's
 *  segments). */
function waves(k: number, n = 4) {
  return { from: k, waves: n, segmentIds: WAVE_IDS.slice(k - 1, n) }
}

/** The creates in the order they were asked for: [name, segment, sdate]. */
function created(ac: ReturnType<typeof makeAC>) {
  return ac.calls
    .filter(c => c.action === 'campaign_create')
    .map(c => [
      c.form!.get('name'),
      c.form!.get('segmentid'),
      c.form!.get('sdate'),
    ])
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

/** A wave of the issue that went out: finished 8 October 2026, 14:30 UTC. */
function sentWave(k: number, more: Parameters<typeof camp>[0] | object = {}) {
  return camp({
    id: String(179 + k),
    name: `${ISSUE} · wave ${k}/4`,
    status: '5',
    send_amt: String([494, 986, 710, 699][k - 1]),
    ldate: '2026-10-08T09:30:00-05:00',
    segmentid: String(8 + k),
    ...more,
  })
}

beforeEach(() => {
  resetKv()
  afterQueue.length = 0
  session.fresh = true
  session.canSend = true
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

/* ─── The page ─────────────────────────────────────────────────────────── */

describe('waves on the page', () => {
  it('lists the waves with their sizes, wave 1 next, and no warm-up block', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const [d] = await nl.listDrafts()
    expect(d.blocks).toEqual([])
    expect(d.alreadySent).toBeNull()
    expect(d.sendDelayMinutes).toBe(5)
    expect(d.waves).toMatchObject({
      error: null,
      active: 2889,
      reached: 0,
      next: 1,
      notBefore: null,
      startFrom: null,
      spacingMinutes: 1440,
      holds: [],
      wait: null,
      blocked: null,
      wholeList: false,
      going: false,
    })
    expect(
      d.waves!.waves.map(w => [w.wave, w.waves, w.label, w.count, w.sent])
    ).toEqual([
      [1, 4, 'Newsletter wave 1', 494, null],
      [2, 4, 'Newsletter wave 2', 986, null],
      [3, 4, 'Newsletter wave 3', 710, null],
      [4, 4, 'Newsletter wave 4 (everyone else)', 699, null],
    ])
    // Waves are found by name and counted per list with the tag filter.
    expect(
      ac.calls.some(c => c.path.startsWith('audiences?search=Newsletter'))
    ).toBe(true)
    expect(
      ac.calls.some(c =>
        /^contacts\?listid=6&status=1&tagid=102&limit=1$/.test(c.path)
      )
    ).toBe(true)
  })

  it('shows a sent wave with its numbers, and when the next one is due', async () => {
    const ac = makeAC(
      waved({
        extra: [
          sentWave(1, {
            hardbounces: '3',
            softbounces: '2',
            unsubscribes: '4',
            verified_unique_opens: '300',
          }),
        ],
        spamComplaints: { '180': '1' },
      })
    )
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    kv.data.set('aisafety:newsletter:health:180', {
      verdict: 'green',
      reasons: [],
    })
    const [d] = await nl.listDrafts()
    expect(d.alreadySent).toBeNull()
    expect(d.waves!.waves[0].sent).toEqual({
      campaignId: '180',
      status: 'sent',
      scheduledAt: null,
      canCancel: false,
      finishedAt: '2026-10-08T14:30:00.000Z',
      sent: 494,
      bounces: 5,
      unsubscribes: 4,
      verifiedOpens: 300,
      spamComplaints: 1,
      health: 'green',
    })
    // The verdict is in: wave 2 may start as soon as the 18 hours are up.
    expect(d.waves).toMatchObject({
      reached: 494,
      next: 2,
      notBefore: '2026-10-09T08:30:00.000Z',
      startFrom: '2026-10-09T08:30:00.000Z',
      going: false,
    })
    expect(d.editable).toBe(true)
    expect(d.deletable).toBe(true)
  })

  it('without wave segments a big list is blocked and a small one goes whole', async () => {
    const big = makeAC({ active: { '6': 2889 } })
    vi.stubGlobal('fetch', big.fetchMock)
    let nl = await freshModule()
    let [d] = await nl.listDrafts()
    expect(d.waves).toBeNull()
    expect(d.blocks.join(' ')).toMatch(/2889 active contacts.*waves/)
    expect(d.blocks.join(' ')).toMatch(/no wave segments were found/)

    const small = makeAC()
    vi.stubGlobal('fetch', small.fetchMock)
    nl = await freshModule()
    ;[d] = await nl.listDrafts()
    expect(d.waves).toBeNull()
    expect(d.blocks).toEqual([])
  })

  it('wave segments that break the contract block the big list', async () => {
    const segments = waveSegments()
    // The last wave forgets to leave out wave 3's tag: those 710 would get
    // the issue twice.
    segments[3] = {
      ...segments[3],
      conditions: [
        ['tagid', '!=', '101'],
        ['tagid', '!=', '102'],
      ],
    }
    const ac = makeAC(waved({ segments }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const [d] = await nl.listDrafts()
    expect(d.waves!.error).toMatch(
      /“Newsletter wave 4 \(everyone else\)” doesn’t leave out exactly the earlier waves’ tags/
    )
    expect(d.blocks.join(' ')).toMatch(/must go out in waves/)
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect((r.err as Error).message).toMatch(/doesn’t leave out exactly/)
    expect(ac.creates).toEqual([])
  })

  it('a test list uses the test run’s “SWEEP TEST wave” segments, and may still go whole', async () => {
    const ac = makeAC({
      draftList: '5',
      active: { '5': 2 },
      segments: waveSegments(2, 'SWEEP TEST wave '),
      tagCounts: { '5': { '101': 1 } },
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const [d] = await nl.listDrafts()
    expect(d.sendDelayMinutes).toBe(2)
    expect(d.waves).toMatchObject({
      next: 1,
      wholeList: true,
      error: null,
      spacingMinutes: 10,
    })
    expect(d.waves!.waves.map(w => [w.label, w.count])).toEqual([
      ['SWEEP TEST wave 1', 1],
      ['SWEEP TEST wave 2 (everyone else)', 1],
    ])
  })
})

/* ─── Approve once: one press schedules every wave still to go ─────────── */

describe('approving the waves (approve once)', () => {
  it('one press schedules waves 1–4, the soonest last, each to its own segment and a day apart; the draft stays and each is recorded', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'))
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    // Made last wave first; sdates in the account's time (UTC−5).
    expect(created(ac)).toEqual([
      [`${ISSUE} · wave 4/4`, WAVE_IDS[3], '2026-10-11 10:05:00'],
      [`${ISSUE} · wave 3/4`, WAVE_IDS[2], '2026-10-10 10:05:00'],
      [`${ISSUE} · wave 2/4`, WAVE_IDS[1], '2026-10-09 10:05:00'],
      [`${ISSUE} · wave 1/4`, WAVE_IDS[0], '2026-10-08 10:05:00'],
    ])
    // Each made exactly as one wave was before.
    for (const c of ac.calls.filter(x => x.action === 'campaign_create')) {
      expect(c.form!.get('status')).toBe('1')
      expect(c.form!.get('tracklinks')).toBe('none')
      expect(c.form!.get('tracklinksanalytics')).toBe('0')
      expect(c.form!.get('p[6]')).toBe('6')
      expect(c.form!.get('m[300]')).toBe('100')
    }
    expect(r).toMatchObject({
      campaignId: '204',
      name: `${ISSUE} · wave 1/4`,
      wave: 1,
      waves: 4,
      expected: 494,
      segmentId: WAVE_IDS[0],
      draftKept: true,
      activeContacts: 2889,
      override: null,
      sendAt: '2026-10-08T15:05:00.000Z',
      listName: 'AISafety.com Events',
      notes: [],
    })
    expect(
      r.scheduled.map(s => [s.wave, s.campaignId, s.sendAt, s.expected])
    ).toEqual([
      [1, '204', '2026-10-08T15:05:00.000Z', 494],
      [2, '203', '2026-10-09T15:05:00.000Z', 986],
      [3, '202', '2026-10-10T15:05:00.000Z', 710],
      [4, '201', '2026-10-11T15:05:00.000Z', 699],
    ])
    // The draft stays (a canceled wave is approved again from it).
    expect(ac.camps.find(c => c.id === '200')?.status).toBe('0')
    expect(ac.calls.some(c => c.action === 'campaign_delete')).toBe(false)
    // Every wave recorded for the send watcher, the reason (none) on none.
    for (const [id, k, n] of [
      ['204', 1, 494],
      ['203', 2, 986],
      ['202', 3, 710],
      ['201', 4, 699],
    ] as const) {
      const rec = kv.data.get(`aisafety:newsletter:approved:${id}`)
      expect(rec).toMatchObject({
        campaignId: id,
        listId: '6',
        name: `${ISSUE} · wave ${k}/4`,
        baseName: ISSUE,
        wave: k,
        waves: 4,
        segmentId: WAVE_IDS[k - 1],
        expected: n,
        approver: 'Bryce Robertson',
      })
      expect(rec).not.toHaveProperty('override')
      expect(kv.zsets.get('aisafety:newsletter:approved')?.has(id)).toBe(true)
    }
    // The page now shows the schedule, not Approve, and the email is frozen.
    const [d] = await nl.listDrafts()
    expect(d.alreadySent).toBeNull()
    expect(d.waves).toMatchObject({ next: null, going: true, wait: null })
    expect(
      d.waves!.waves.map(w => [
        w.wave,
        w.sent?.status,
        w.sent?.scheduledAt,
        w.sent?.canCancel,
      ])
    ).toEqual([
      [1, 'scheduled', '2026-10-08T15:05:00.000Z', true],
      [2, 'scheduled', '2026-10-09T15:05:00.000Z', true],
      [3, 'scheduled', '2026-10-10T15:05:00.000Z', true],
      [4, 'scheduled', '2026-10-11T15:05:00.000Z', true],
    ])
    expect(d.editable).toBe(false)
    expect(d.deletable).toBe(false)
    expect(d.editLock).toMatch(
      /^Waves 1–4 of this issue are scheduled or going out and send this draft’s email as it was approved/
    )
    const e = await outcome(
      nl.editDraftCard('200', 'g0', 'recAAAAAAAAAAAAAA', { desc: 'New text.' })
    )
    expect(e.err).toBeInstanceOf(nl.DraftProblemError)
    expect(
      ac.calls.some(c => c.method === 'PUT' && c.path.startsWith('messages/'))
    ).toBe(false)
  })

  it('wave 1 already went tonight: one press schedules waves 2–4 from the 18-hour gap, with room for its verdict', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T22:00:00Z'))
    // Wave 1 finished 8 October, 14:30 UTC (the one-press-per-wave flow).
    const ac = makeAC(waved({ extra: [sentWave(1)] }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const [d] = await nl.listDrafts()
    expect(d.waves).toMatchObject({
      next: 2,
      notBefore: '2026-10-09T08:30:00.000Z',
      startFrom: '2026-10-09T10:00:00.000Z',
      holds: [],
    })
    const r = await nl.approveAndSend('200', '6', { ...WHO, waves: waves(2) })
    // No reason needed: the gap only sets the time. 18 hours after the
    // finish, plus 90 minutes while the watcher's verdict isn't in.
    expect(created(ac)).toEqual([
      [`${ISSUE} · wave 4/4`, WAVE_IDS[3], '2026-10-11 05:00:00'],
      [`${ISSUE} · wave 3/4`, WAVE_IDS[2], '2026-10-10 05:00:00'],
      [`${ISSUE} · wave 2/4`, WAVE_IDS[1], '2026-10-09 05:00:00'],
    ])
    expect(r.scheduled.map(s => [s.wave, s.sendAt])).toEqual([
      [2, '2026-10-09T10:00:00.000Z'],
      [3, '2026-10-10T10:00:00.000Z'],
      [4, '2026-10-11T10:00:00.000Z'],
    ])
    expect(r).toMatchObject({ wave: 2, expected: 986, override: null })
  })

  it('…pressed once the verdict is in: from five minutes after the press', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T09:00:00Z'))
    const ac = makeAC(waved({ extra: [sentWave(1)] }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    kv.data.set('aisafety:newsletter:health:180', {
      verdict: 'green',
      reasons: [],
    })
    const r = await nl.approveAndSend('200', '6', { ...WHO, waves: waves(2) })
    expect(r.scheduled.map(s => [s.wave, s.sendAt])).toEqual([
      [2, '2026-10-09T09:05:00.000Z'],
      [3, '2026-10-10T09:05:00.000Z'],
      [4, '2026-10-11T09:05:00.000Z'],
    ])
  })

  it('a verdict that should be in but isn’t holds the waves; a typed reason sends them and is recorded on the first only', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 19 hours after wave 1 finished, and no verdict on it.
    vi.setSystemTime(new Date('2026-10-09T09:30:00Z'))
    const ac = makeAC(waved({ extra: [sentWave(1)] }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const first = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(2) })
    )
    expect(first.err).toBeInstanceOf(nl.NeedsOverrideError)
    expect((first.err as InstanceType<NL['NeedsOverrideError']>).holds).toEqual(
      [
        'the send watcher hasn’t checked wave 1 yet (it was due 9 October 2026, 08:30 UTC), so it would cancel wave 2 before it starts',
      ]
    )
    // Too short a reason is no reason.
    const short = await outcome(
      nl.approveAndSend('200', '6', {
        ...WHO,
        waves: waves(2),
        override: 'ok',
      })
    )
    expect(short.err).toBeInstanceOf(nl.NeedsOverrideError)
    expect(ac.creates).toEqual([])

    const reason = 'The watcher is down; the numbers look fine by hand'
    const r = await nl.approveAndSend('200', '6', {
      ...WHO,
      waves: waves(2),
      override: reason,
    })
    expect(r).toMatchObject({ wave: 2, expected: 986, override: reason })
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toMatch(
      /Bryce Robertson is sending waves 2–4 of “Events · Week 41, 2026” on list 6 although the send watcher hasn’t checked wave 1 yet.*Reason given: The watcher is down/
    )
    const rec = (id: string) =>
      kv.data.get(`aisafety:newsletter:approved:${id}`) as Record<
        string,
        unknown
      >
    const byWave = Object.fromEntries(r.scheduled.map(s => [s.wave, s]))
    expect(rec(byWave[2].campaignId)).toMatchObject({
      wave: 2,
      override: reason,
    })
    expect(rec(byWave[3].campaignId)).not.toHaveProperty('override')
    expect(rec(byWave[4].campaignId)).not.toHaveProperty('override')
  })

  it('a red verdict from the watcher holds the waves; a small-sample one doesn’t', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
    const ac = makeAC(waved({ extra: [sentWave(1)] }))
    vi.stubGlobal('fetch', ac.fetchMock)
    let nl = await freshModule()
    kv.data.set('aisafety:newsletter:health:180', {
      verdict: 'red',
      reasons: ['hard bounces 3.1% (over 2%)'],
      smallSample: false,
    })
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(2) })
    )
    expect((r.err as InstanceType<NL['NeedsOverrideError']>).holds).toEqual([
      'the send watcher flagged wave 1 red: hard bounces 3.1% (over 2%)',
    ])
    const [d] = await nl.listDrafts()
    expect(d.waves!.holds).toEqual([
      'the send watcher flagged wave 1 red: hard bounces 3.1% (over 2%)',
    ])
    expect(d.waves!.waves[0].sent?.health).toBe('red')

    kv.data.set('aisafety:newsletter:health:180', {
      verdict: 'red',
      reasons: ['1 bounce of 3'],
      smallSample: true,
    })
    nl = await freshModule()
    await expect(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(2) })
    ).resolves.toMatchObject({ wave: 2 })
  })

  it('test lists: two minutes after the press, then ten minutes apart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'))
    const ac = makeAC({
      draftList: '5',
      active: { '5': 3 },
      segments: waveSegments(3, 'SWEEP TEST wave '),
      tagCounts: { '5': { '101': 1, '102': 1 } },
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await nl.approveAndSend('200', '5', {
      ...WHO,
      waves: waves(1, 3),
    })
    expect(r.scheduled.map(s => [s.wave, s.sendAt])).toEqual([
      [1, '2026-10-08T15:02:00.000Z'],
      [2, '2026-10-08T15:12:00.000Z'],
      [3, '2026-10-08T15:22:00.000Z'],
    ])
    // A test list isn't the watcher's: nothing recorded.
    expect(kv.zsets.size).toBe(0)
  })

  it('waves go in order', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(2) })
    )
    expect(r.err).toBeInstanceOf(nl.DraftProblemError)
    expect((r.err as Error).message).toMatch(
      /waves go in order: wave 1 is next, not wave 2/
    )
    expect(ac.creates).toEqual([])
  })

  it('the rest wait while an earlier wave is still going out', async () => {
    const ac = makeAC(
      waved({ extra: [sentWave(1, { status: '2', ldate: null })] })
    )
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(2) })
    )
    expect((r.err as Error).message).toMatch(
      /waves 2–4 can go once wave 1 has finished sending \(it is sending now\)/
    )
    expect(ac.creates).toEqual([])
  })

  it('the same waves twice are refused: any wave of the range scheduled, going or sent', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    expireLocks()
    const again = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect(again.err).toBeInstanceOf(nl.DraftProblemError)
    expect(
      (again.err as InstanceType<NL['DraftProblemError']>).problems
    ).toEqual(
      ['204', '203', '202', '201'].map(
        (id, i) =>
          `wave ${i + 1} of this issue already went to this list as campaign ${id} (scheduled) – approving it again would send it twice`
      )
    )
    expect(ac.creates).toHaveLength(4)

    // One wave of the range already there (a status it doesn't know counts):
    // nothing is made.
    for (const status of ['1', '7', '9']) {
      const one = makeAC(
        waved({
          extra: [
            sentWave(1),
            camp({ id: '182', name: `${ISSUE} · wave 3/4`, status }),
          ],
        })
      )
      vi.stubGlobal('fetch', one.fetchMock)
      const fresh = await freshModule()
      const r = await outcome(
        fresh.approveAndSend('200', '6', { ...WHO, waves: waves(2) })
      )
      expect((r.err as Error).message).toMatch(
        /wave 3 of this issue already went to this list as campaign 182/
      )
      expect(one.creates).toEqual([])
    }
  })

  it('a whole-list send refuses every wave of the issue, and any wave refuses the whole list', async () => {
    const ac = makeAC(
      waved({
        extra: [camp({ id: '150', name: ISSUE, status: '5', send_amt: '3' })],
      })
    )
    vi.stubGlobal('fetch', ac.fetchMock)
    let nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect((r.err as Error).message).toMatch(
      /this issue already went to this list as campaign 150/
    )
    const [d] = await nl.listDrafts()
    expect(d.alreadySent).toEqual({ campaignId: '150', status: 'sent' })

    // A small list may go whole — until a wave of the issue has gone.
    const small = makeAC({
      segments: waveSegments(),
      tagCounts: { '6': { '101': 10, '102': 10, '103': 10 } },
      active: { '6': 40 },
      extra: [sentWave(1)],
    })
    vi.stubGlobal('fetch', small.fetchMock)
    nl = await freshModule()
    const whole = await outcome(nl.approveAndSend('200', '6', WHO))
    expect((whole.err as Error).message).toMatch(
      /wave 1 of this issue already went to this list as campaign 180/
    )
    expect(small.creates).toEqual([])
    const [s] = await nl.listDrafts()
    expect(s.waves!.wholeList).toBe(false)
  })

  it('a wave stopped after reaching people ends the run', async () => {
    const ac = makeAC(
      waved({ extra: [sentWave(1, { status: '4', send_amt: '200' })] })
    )
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(2) })
    )
    expect((r.err as Error).message).toMatch(
      /wave 1 was stopped after reaching 200 people, so no further wave of this issue goes out/
    )
    const [d] = await nl.listDrafts()
    expect(d.waves).toMatchObject({ next: null })
    expect(d.waves!.blocked).toMatch(/wave 1 was stopped/)
  })

  it('the last wave on its own: the draft stays until it has gone (the send watcher deletes it then)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
    const ac = makeAC(
      waved({
        extra: [
          sentWave(1, { ldate: '2026-10-08T09:30:00-05:00' }),
          sentWave(2, { ldate: '2026-10-09T09:30:00-05:00' }),
          sentWave(3, { ldate: '2026-10-10T09:30:00-05:00' }),
        ],
      })
    )
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    kv.data.set('aisafety:newsletter:health:182', {
      verdict: 'green',
      reasons: [],
    })
    const r = await nl.approveAndSend('200', '6', { ...WHO, waves: waves(4) })
    expect(r).toMatchObject({
      name: `${ISSUE} · wave 4/4`,
      expected: 699,
      draftKept: true,
    })
    expect(r.scheduled).toHaveLength(1)
    expect(ac.camps.find(c => c.id === '200')?.status).toBe('0')
    const [d] = await nl.listDrafts()
    expect(d.alreadySent).toBeNull()
    expect(d.waves).toMatchObject({ going: true, next: null })
  })

  it('ActiveCampaign dropping the wave: the send is deleted at once, nothing goes out, the draft stays', async () => {
    const ac = makeAC(waved({ createdSegment: '0' }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect(r.err).toBeInstanceOf(nl.WaveDroppedError)
    expect(r.err).toBeInstanceOf(nl.SendDeletedError)
    expect((r.err as Error).message).toMatch(
      /didn’t keep the wave on the new campaign 201 \(it came back with no segment\), so it would have gone to the whole list/
    )
    // The first one made (wave 4) came back wrong: nothing else was made.
    expect(ac.creates).toEqual(['201'])
    expect(ac.camps.some(c => c.id === '201')).toBe(false)
    expect(
      ac.calls.some(
        c => c.method === 'DELETE' && c.path === 'campaigns/201/delete'
      )
    ).toBe(true)
    expect(ac.camps.find(c => c.id === '200')?.status).toBe('0')
    expect(kv.data.has('aisafety:newsletter:approved:201')).toBe(false)
  })

  it('ActiveCampaign tying the send to another segment: deleted the same way', async () => {
    const ac = makeAC(waved({ createdSegment: 'other' }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect(r.err).toBeInstanceOf(nl.WaveDroppedError)
    expect((r.err as Error).message).toMatch(
      /its segment 9 points at 99999999-9999-4999-8999-999999999999, not the wave/
    )
    expect(ac.camps.some(c => c.id === '201')).toBe(false)
  })

  it('the wave can’t be deleted after coming back wrong: “delete it in ActiveCampaign now”', async () => {
    const ac = makeAC(waved({ createdSegment: '0', v3DeleteFails: true }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect(r.err).toBeInstanceOf(nl.MaybeScheduledError)
    expect((r.err as Error).message).toMatch(
      /so it would go to the whole list\), and it couldn’t be deleted\. Delete it in ActiveCampaign now/
    )
  })

  it('refuses waves that changed since the page loaded', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    for (const w of [
      { from: 1, waves: 4, segmentIds: [WAVE_IDS[1], ...WAVE_IDS.slice(1)] },
      { from: 2, waves: 3, segmentIds: WAVE_IDS.slice(1, 3) },
    ]) {
      const r = await outcome(
        nl.approveAndSend('200', '6', { ...WHO, waves: w })
      )
      expect((r.err as Error).message).toMatch(
        /the waves in ActiveCampaign changed since the page loaded/
      )
    }
    for (const w of [
      { from: 1, waves: 4, segmentIds: ['not-a-uuid', ...WAVE_IDS.slice(1)] },
      // Not every wave from the first to the last.
      { from: 1, waves: 4, segmentIds: WAVE_IDS.slice(0, 2) },
    ]) {
      const bad = await outcome(
        nl.approveAndSend('200', '6', { ...WHO, waves: w })
      )
      expect((bad.err as Error).message).toMatch(
        /those aren’t the list’s waves/
      )
    }
    expect(ac.creates).toEqual([])
  })

  it('two presses at once: one schedules, the other is refused', async () => {
    const ac = makeAC(waved({ latencyMs: 20 }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await Promise.allSettled([
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) }),
      nl.approveAndSend('200', '6', { approver: 'plex', waves: waves(1) }),
    ])
    expect(ac.creates).toHaveLength(4)
    const refused = r.find(
      x => x.status === 'rejected'
    ) as PromiseRejectedResult
    expect(refused.reason).toBeInstanceOf(nl.ApprovalLockedError)
    expect(refused.reason.message).toMatch(
      /Another approval of waves 1–4 of “Events · Week 41, 2026”/
    )
  })

  it('while a wave is going out card edits wait; once it has sent they work again', async () => {
    const ac = makeAC(
      waved({ extra: [sentWave(1, { status: '1', msg: '300' })] })
    )
    vi.stubGlobal('fetch', ac.fetchMock)
    let nl = await freshModule()
    const e = await outcome(
      nl.editDraftCard('200', 'g0', 'recAAAAAAAAAAAAAA', { desc: 'New text.' })
    )
    expect(e.err).toBeInstanceOf(nl.DraftProblemError)
    expect((e.err as Error).message).toMatch(
      /Wave 1 of this issue \(campaign 180\) is scheduled and uses this draft’s email, so card edits are off/
    )
    expect(ac.calls.some(c => c.method === 'PUT')).toBe(false)
    const [d] = await nl.listDrafts()
    expect(d.editable).toBe(false)
    expect(d.editLock).toMatch(/Wave 1 of this issue/)

    const done = makeAC(waved({ extra: [sentWave(1, { msg: '300' })] }))
    vi.stubGlobal('fetch', done.fetchMock)
    nl = await freshModule()
    await expect(
      nl.editDraftCard('200', 'g0', 'recAAAAAAAAAAAAAA', { desc: 'New text.' })
    ).resolves.toHaveProperty('cards')
  })

  it('the draft can’t be deleted while a wave is still to go: it is how a canceled wave is approved again', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    expireLocks()
    const r = await outcome(nl.deleteDraft('200', 'Bryce'))
    expect(r.err).toBeInstanceOf(nl.DraftProblemError)
    expect((r.err as Error).message).toMatch(
      /Waves 1–4 of this issue are still to go out, and a canceled wave is approved again from this draft/
    )
    expect(ac.calls.some(c => c.action === 'campaign_delete')).toBe(false)
  })
})

/* ─── All or nothing ───────────────────────────────────────────────────── */

describe('all or nothing: a press that fails part-way takes back what it made', () => {
  /** The pretend ActiveCampaign, with a hook on each campaign_create
   *  (n = 1 for the first) once the campaign exists, before the answer. */
  function hooked(
    ac: ReturnType<typeof makeAC>,
    onCreate: (n: number, id: string) => void,
    more?: (url: string, init?: RequestInit) => Response | null
  ) {
    let n = 0
    return async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      const early = more?.(url, init)
      if (early) return early
      const res = await ac.fetchMock(input, init)
      if (url.includes('api_action=campaign_create'))
        onCreate(++n, String(ac.creates[ac.creates.length - 1]))
      return res
    }
  }

  it('a wave that comes back wrong mid-way: it and the waves already made are deleted, nothing is left', async () => {
    const ac = makeAC(waved())
    // The second campaign made (wave 3) comes back without its segment.
    vi.stubGlobal(
      'fetch',
      hooked(ac, n => {
        if (n === 2) ac.camps.find(c => c.id === '202')!.segmentid = '0'
      })
    )
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect(r.err).toBeInstanceOf(nl.WaveDroppedError)
    expect((r.err as Error).message).toMatch(
      /didn’t keep the wave on the new campaign 202 .*Tell Claude before trying again\. Wave 4, which this approval had already scheduled, was canceled again\.$/
    )
    expect(ac.creates).toEqual(['201', '202'])
    expect(ac.camps.some(c => c.id === '201' || c.id === '202')).toBe(false)
    expect(ac.camps.find(c => c.id === '200')?.status).toBe('0')
    // As for one wave that came back wrong: the lock stays a while.
    const again = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect(again.err).toBeInstanceOf(nl.ApprovalLockedError)
  })

  it('an unclear create mid-way: the waves made are deleted again, and it says that one may be scheduled', async () => {
    const ac = makeAC(waved({ createGatewayError: [false, true] }))
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    const err = r.err as InstanceType<NL['MaybeScheduledError']>
    expect(err).toBeInstanceOf(nl.MaybeScheduledError)
    expect(err.message).toMatch(
      /^It may have been scheduled anyway \(wave 3\): something went wrong after ActiveCampaign was asked to schedule it\. Don’t press Approve again – check Recent sends, which updates by itself\. Wave 4, which this approval had already scheduled, was canceled again\.$/
    )
    expect(err.facts).toMatchObject({ wave: 3, expected: 710 })
    // Wave 4 is gone; wave 3's create may have landed (it did here).
    expect(ac.camps.some(c => c.id === '201')).toBe(false)
    expect(ac.camps.some(c => c.id === '202')).toBe(true)
    expect(ac.creates).toEqual(['201', '202'])
  })

  it('a wave that can’t be read back mid-way: everything is deleted, and it may be approved again at once', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal(
      'fetch',
      hooked(
        ac,
        () => {},
        url =>
          /\/api\/3\/campaigns\/202$/.test(new URL(url).pathname)
            ? Response.json({ message: 'read failed' }, { status: 500 })
            : null
      )
    )
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect(r.err).toBeInstanceOf(nl.ReadBackDeletedError)
    expect((r.err as Error).message).toMatch(
      /Nothing was sent, and the draft is still here: approve again in a minute\. Wave 4, which this approval had already scheduled, was canceled again\.$/
    )
    expect(ac.camps.some(c => c.id === '201' || c.id === '202')).toBe(false)
    // No lock left: the next press goes through.
    vi.stubGlobal('fetch', ac.fetchMock)
    await expect(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    ).resolves.toMatchObject({ wave: 1 })
  })

  it('a wave made that can’t be deleted again is named: cancel it before it starts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'))
    const ac = makeAC(waved())
    vi.stubGlobal(
      'fetch',
      hooked(
        ac,
        n => {
          if (n === 2) ac.camps.find(c => c.id === '202')!.segmentid = '0'
        },
        (url, init) => {
          // Campaign 201 (wave 4) won't go: both deletes refuse.
          const path = new URL(url).pathname
          if (
            init?.method === 'DELETE' &&
            path.endsWith('/campaigns/201/delete')
          )
            return Response.json({ succeeded: 0, message: 'busy' })
          if (
            url.includes('api_action=campaign_delete') &&
            String(init?.body).includes('id=201')
          )
            return Response.json({ result_code: 0, result_message: 'busy' })
          return null
        }
      )
    )
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    const err = r.err as InstanceType<NL['MaybeScheduledError']>
    expect(err).toBeInstanceOf(nl.MaybeScheduledError)
    expect(err.campaignId).toBe('201')
    expect(err.message).toMatch(
      /^The approval of waves 1–4 stopped part-way\. ActiveCampaign didn’t keep the wave on the new campaign 202 .* Wave 4 \(campaign 201\) couldn’t be canceled again, so it is still scheduled: cancel it on the newsletter page \(or in ActiveCampaign\) before 11 October 2026, 15:05 UTC\. Don’t press Approve again until then\.$/
    )
    expect(ac.camps.some(c => c.id === '201')).toBe(true)
    expect(ac.camps.some(c => c.id === '202')).toBe(false)
  })

  it('ActiveCampaign too slow: it stops before the next wave and deletes what it made', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'))
    const ac = makeAC(waved())
    // The first create takes two and a half minutes.
    vi.stubGlobal(
      'fetch',
      hooked(ac, n => {
        if (n === 1) vi.setSystemTime(new Date('2026-10-08T15:02:30Z'))
      })
    )
    const nl = await freshModule()
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    expect(r.err).toBeInstanceOf(nl.TooSlowError)
    expect(r.err).toBeInstanceOf(nl.SendDeletedError)
    expect((r.err as Error).message).toMatch(
      /answered too slowly to schedule waves 1–4 in one go, so the approval stopped before wave 3 and nothing goes out\. Try again in a few minutes\. Wave 4, which this approval had already scheduled, was canceled again\./
    )
    expect(ac.creates).toEqual(['201'])
    expect(ac.camps.some(c => c.id === '201')).toBe(false)
    // Nothing exists, so it may be pressed again at once.
    vi.stubGlobal('fetch', ac.fetchMock)
    await expect(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    ).resolves.toMatchObject({ wave: 1 })
  })
})

/* ─── The owner hears about every real-list approval ──────────────────── */

describe('the owner’s notice', () => {
  const MAIL_ENV = {
    ADMIN_MAIL_SCRIPT_URL: MAIL_SCRIPT_URL,
    ADMIN_MAIL_SECRET: 'secret',
  }

  it('emails the owner what went, which wave, to how many, when, by whom, and where to stop it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'))
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule(MAIL_ENV)
    const r = await nl.approveAndSend('200', '6', {
      approver: 'plex',
      waves: waves(1),
    })
    expect(await nl.notifyApproval(r)).toBe(true)
    expect(ac.mails).toHaveLength(1)
    const m = ac.mails[0]
    expect(m).toMatchObject({
      kind: 'digest',
      to: 'bryceerobertson@gmail.com',
      secret: 'secret',
      subject: `Newsletter approved: ${ISSUE} · wave 1/4 (494 people)`,
    })
    const text = String(m.text)
    for (const line of [
      `“${ISSUE} · wave 1/4” was approved by plex and is scheduled to send.`,
      'Wave: 1 of 4',
      'To: 494 people on AISafety.com Events (list 6)',
      'Sends: 8 October 2026, 15:05 UTC',
      'Approved by: plex',
      'Campaign: 204',
      'To cancel it before it sends, or pause or stop it while it’s sending: https://aisafety.com/admin/newsletter',
    ])
      expect(text).toContain(line)
    expect(String(m.html)).toContain(
      '<a href="https://aisafety.com/admin/newsletter">'
    )
  })

  it('says when an approval may have gone out despite an error; test lists send nothing', async () => {
    const ac = makeAC(waved({ createGatewayError: [true] }))
    vi.stubGlobal('fetch', ac.fetchMock)
    let nl = await freshModule(MAIL_ENV)
    const r = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    )
    // The first campaign made (wave 4) answered with a gateway error.
    const err = r.err as InstanceType<NL['MaybeScheduledError']>
    expect(err).toBeInstanceOf(nl.MaybeScheduledError)
    expect(err.facts).toMatchObject({ wave: 4, expected: 699, listId: '6' })
    await nl.notifyApproval({ ...err.facts!, campaignId: err.campaignId }, true)
    expect(ac.mails[0].subject).toBe(
      `Newsletter: “${ISSUE} · wave 4/4” may have been scheduled – check`
    )
    expect(String(ac.mails[0].text)).toMatch(
      /ran into an error after ActiveCampaign was asked to schedule it/
    )

    const test = makeAC({ draftList: '5' })
    vi.stubGlobal('fetch', test.fetchMock)
    nl = await freshModule(MAIL_ENV)
    const t = await nl.approveAndSend('200', '5', WHO)
    expect(await nl.notifyApproval(t)).toBe(false)
    expect(test.mails).toEqual([])
  })
})

/* ─── Stop: cancel, pause, stop, resume ────────────────────────────────── */

describe('stopping a send', () => {
  const BY = { by: 'Bryce Robertson' }
  const at = (status: string, list = '6') =>
    camp({
      id: '181',
      name: `${ISSUE} · wave 1/4`,
      status,
      list,
      send_amt: status === '1' || status === '7' ? '0' : '120',
    })

  it('cancels a scheduled wave with the later ones: they are deleted, and the waves can be approved again at once', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const sent = await nl.approveAndSend('200', '6', {
      ...WHO,
      waves: waves(1),
    })
    expect(sent.campaignId).toBe('204')
    const r = await nl.stopSend(sent.campaignId, 'cancel', BY)
    expect(r).toMatchObject({
      campaignId: '204',
      action: 'cancel',
      status: 'deleted',
      draftWaiting: true,
      by: 'Bryce Robertson',
      laterProblem: null,
    })
    // Waves go in order: 2–4 went with wave 1.
    expect(r.alsoCanceled).toEqual([
      { campaignId: '203', wave: 2 },
      { campaignId: '202', wave: 3 },
      { campaignId: '201', wave: 4 },
    ])
    expect(ac.camps.map(c => c.id)).toEqual(['200'])
    expect(vi.mocked(console.info).mock.calls.flat().join(' ')).toMatch(
      /campaign 204 “Events · Week 41, 2026 · wave 1\/4” cancel by Bryce Robertson: scheduled → deleted/
    )
    // The lock went with it: the waves can be approved again now.
    await expect(
      nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    ).resolves.toMatchObject({ campaignId: '208', wave: 1 })
  })

  it('canceling a later wave leaves the earlier ones; the issue offers the canceled ones again once those have gone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T15:00:00Z'))
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    // Wave 3 is campaign 202; wave 4 (201) goes with it, waves 1–2 stay.
    const r = await nl.stopSend('202', 'cancel', BY)
    expect(r.alsoCanceled).toEqual([{ campaignId: '201', wave: 4 }])
    expect(ac.camps.map(c => c.id).sort()).toEqual(['200', '203', '204'])
    let [d] = await nl.listDrafts()
    expect(d.waves).toMatchObject({
      next: 3,
      going: true,
      wait: 'waves 3–4 can go once wave 2 has finished sending (it is scheduled now)',
    })
    // Waves 1 and 2 go out, and the watcher judges wave 2.
    for (const [id, ldate] of [
      ['204', '2026-10-08T10:20:00-05:00'],
      ['203', '2026-10-09T10:20:00-05:00'],
    ]) {
      const c = ac.camps.find(x => x.id === id)!
      c.status = '5'
      c.ldate = ldate
      c.send_amt = '500'
    }
    kv.data.set('aisafety:newsletter:health:203', {
      verdict: 'green',
      reasons: [],
    })
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
    ;[d] = await nl.listDrafts()
    expect(d.waves).toMatchObject({ next: 3, going: false, wait: null })
    const again = await nl.approveAndSend('200', '6', {
      ...WHO,
      waves: waves(3),
    })
    expect(again.scheduled.map(s => [s.wave, s.sendAt])).toEqual([
      [3, '2026-10-10T12:05:00.000Z'],
      [4, '2026-10-11T12:05:00.000Z'],
    ])
  })

  it('a later wave that can’t be canceled is named', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await nl.approveAndSend('200', '6', { ...WHO, waves: waves(1) })
    // Wave 4 (campaign 201) won't go: both deletes refuse.
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'DELETE' && url.endsWith('/campaigns/201/delete'))
        return Promise.resolve(Response.json({ succeeded: 0 }))
      if (
        url.includes('api_action=campaign_delete') &&
        String(init?.body).includes('id=201')
      )
        return Promise.resolve(Response.json({ result_code: 0 }))
      return ac.fetchMock(input, init)
    })
    const r = await nl.stopSend('202', 'cancel', BY)
    expect(r.alsoCanceled).toEqual([])
    expect(r.laterProblem).toBe(
      'Wave 4 (campaign 201) is scheduled and wasn’t canceled: cancel it under Recent sends, or it goes out without the earlier wave.'
    )
  })

  it('a second press finds the send gone and changes nothing', async () => {
    const ac = makeAC({ extra: [at('1')] })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await nl.stopSend('181', 'cancel', BY)
    const again = await outcome(nl.stopSend('181', 'cancel', BY))
    expect(again.err).toBeInstanceOf(nl.StopRefusedError)
    expect((again.err as Error).message).toMatch(
      /Campaign 181 isn’t in ActiveCampaign any more/
    )
  })

  it('two presses at once: one goes through, the other is told to wait', async () => {
    const ac = makeAC({ extra: [at('1')], latencyMs: 20 })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await Promise.allSettled([
      nl.stopSend('181', 'cancel', BY),
      nl.stopSend('181', 'cancel', BY),
    ])
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    const refused = r.find(
      x => x.status === 'rejected'
    ) as PromiseRejectedResult
    expect(refused.reason).toBeInstanceOf(nl.StopLockedError)
    expect(ac.calls.filter(c => c.method === 'DELETE')).toHaveLength(1)
  })

  it('each state allows only its own actions', async () => {
    const table: Array<[string, string, string]> = [
      ['1', 'cancel', 'deleted'],
      ['7', 'cancel', 'deleted'],
      ['2', 'pause', 'paused'],
      ['3', 'stop', 'stopped'],
      ['3', 'resume', 'sending'],
    ]
    for (const [status, action, after] of table) {
      const ac = makeAC({ extra: [at(status)] })
      vi.stubGlobal('fetch', ac.fetchMock)
      const nl = await freshModule()
      await expect(
        nl.stopSend('181', action as 'cancel', BY)
      ).resolves.toMatchObject({ status: after })
    }
    const refused: Array<[string, string]> = [
      ['1', 'pause'],
      ['1', 'stop'],
      ['2', 'cancel'],
      ['2', 'resume'],
      ['3', 'cancel'],
      ['5', 'cancel'],
      ['5', 'stop'],
      ['4', 'resume'],
    ]
    for (const [status, action] of refused) {
      const ac = makeAC({ extra: [at(status)] })
      vi.stubGlobal('fetch', ac.fetchMock)
      const nl = await freshModule()
      const r = await outcome(nl.stopSend('181', action as 'cancel', BY))
      expect(r.err).toBeInstanceOf(nl.StopRefusedError)
      expect(
        ac.calls.some(c => c.method === 'DELETE' || c.method === 'PUT')
      ).toBe(false)
    }
  })

  it('pause, then stop for good', async () => {
    const ac = makeAC({ extra: [at('2')] })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await expect(nl.stopSend('181', 'pause', BY)).resolves.toMatchObject({
      status: 'paused',
    })
    expect(
      ac.calls.some(c => c.method === 'PUT' && c.path === 'campaigns/181/pause')
    ).toBe(true)
    await expect(nl.stopSend('181', 'stop', BY)).resolves.toMatchObject({
      status: 'stopped',
    })
  })

  it('only newsletter sends (lists 5–8) can be stopped from the page', async () => {
    for (const list of ['4', '9']) {
      const ac = makeAC({ extra: [at('1', list)] })
      vi.stubGlobal('fetch', ac.fetchMock)
      const nl = await freshModule()
      const r = await outcome(nl.stopSend('181', 'cancel', BY))
      expect((r.err as Error).message).toMatch(/not a newsletter send/)
    }
  })

  it('outside production a real list’s send can be canceled, paused or stopped, but not resumed', async () => {
    let ac = makeAC({ extra: [at('3')] })
    vi.stubGlobal('fetch', ac.fetchMock)
    let nl = await freshModule({ VERCEL_ENV: 'preview' })
    const r = await outcome(nl.stopSend('181', 'resume', BY))
    expect((r.err as Error).message).toMatch(/only aisafety\.com itself/)
    await expect(nl.stopSend('181', 'stop', BY)).resolves.toMatchObject({
      status: 'stopped',
    })
    ac = makeAC({ extra: [at('1')] })
    vi.stubGlobal('fetch', ac.fetchMock)
    nl = await freshModule({ VERCEL_ENV: 'preview' })
    await expect(nl.stopSend('181', 'cancel', BY)).resolves.toMatchObject({
      status: 'deleted',
    })
  })

  it('no clear answer: it may or may not have worked', async () => {
    const ac = makeAC({ extra: [at('2')], stopGatewayError: true })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.stopSend('181', 'pause', BY))
    expect(r.err).toBeInstanceOf(nl.StopFailedError)
    expect((r.err as InstanceType<NL['StopFailedError']>).uncertain).toBe(true)
    expect((r.err as Error).message).toMatch(/may or may not have been paused/)
  })

  it('ActiveCampaign refusing: says so, nothing changed', async () => {
    const ac = makeAC({ extra: [at('2')], stopRefuses: true })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.stopSend('181', 'pause', BY))
    expect(r.err).toBeInstanceOf(nl.StopFailedError)
    expect((r.err as InstanceType<NL['StopFailedError']>).uncertain).toBe(false)
    expect((r.err as Error).message).toMatch(
      /ActiveCampaign didn’t pause campaign 181: it is sending now/
    )
  })

  it('a send that started before the cancel: told to pause, and never deleted mid-send', async () => {
    const ac = makeAC({ extra: [at('1')], startsBeforeDelete: true })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.stopSend('181', 'cancel', BY))
    expect((r.err as Error).message).toMatch(
      /It started sending first – press Pause, then Stop/
    )
    expect(ac.calls.some(c => c.action === 'campaign_delete')).toBe(false)
    expect(ac.camps.find(c => c.id === '181')?.status).toBe('2')
  })

  it('Upstash being down never stops a stop', async () => {
    const ac = makeAC({ extra: [at('1')] })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    kv.down = true
    await expect(nl.stopSend('181', 'cancel', BY)).resolves.toMatchObject({
      status: 'deleted',
    })
  })
})

/* ─── Recent sends and Analytics, per issue ────────────────────────────── */

describe('Recent sends and Analytics group waves by issue', () => {
  it('Recent sends: an issue’s waves side by side, with the time a scheduled one goes and what may be done to each', async () => {
    const ac = makeAC({
      extra: [
        camp({
          id: '170',
          name: 'Training · Week 41, 2026',
          list: '7',
          status: '5',
          send_amt: '3',
          ldate: '2026-10-08T12:00:00-05:00',
        }),
        sentWave(1),
        camp({
          id: '181',
          name: `${ISSUE} · wave 2/4`,
          status: '1',
          sdate: '2026-10-09 09:00:00',
        }),
      ],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const rows = await nl.listRecent()
    expect(rows.map(r => [r.id, r.group, r.wave, r.actions])).toEqual([
      ['181', `6|${ISSUE}`, { wave: 2, waves: 4 }, ['cancel']],
      ['180', `6|${ISSUE}`, { wave: 1, waves: 4 }, []],
      ['170', '7|Training · Week 41, 2026', null, []],
    ])
    expect(rows[0].scheduledAt).toBe('2026-10-09T14:00:00.000Z')
    expect(rows[0].baseName).toBe(ISSUE)
  })

  it('Analytics: one row per issue, its waves added up, its clicks once', async () => {
    const ac = makeAC({
      extra: [
        sentWave(1, { uniqueopens: '300', unsubscribes: '4' }),
        sentWave(2, {
          uniqueopens: '500',
          unsubscribes: '6',
          ldate: '2026-10-09T09:30:00-05:00',
        }),
        camp({
          id: '170',
          name: 'Training · Week 41, 2026',
          list: '7',
          status: '5',
          send_amt: '3',
          uniqueopens: '2',
          ldate: '2026-10-08T12:00:00-05:00',
        }),
      ],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const stats = await nl.readSendStats({ startMs: null, endMs: null })
    expect(
      stats.map(s => [
        s.id,
        s.name,
        s.newsletter,
        s.delivered,
        s.opens,
        s.unsubscribes,
        s.waves,
      ])
    ).toEqual([
      ['181', ISSUE, 'Events', 1480, 800, 10, 2],
      ['170', 'Training · Week 41, 2026', 'Training', 3, 2, 0, 0],
    ])
  })
})

/* ─── The routes' answers ──────────────────────────────────────────────── */

async function stopRoute() {
  return import('../../app/api/admin/newsletter/stop/route')
}
async function approveRoute() {
  return import('../../app/api/admin/newsletter/route')
}
function post(body: unknown) {
  return new Request('http://localhost/api/admin/newsletter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest
}

describe('the routes', () => {
  it('Stop: a second press answers 409, a stale session 401 reauth, a bad action 400', async () => {
    const ac = makeAC({
      extra: [camp({ id: '181', name: ISSUE, status: '1' })],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    await freshModule()
    const { POST } = await stopRoute()
    const first = await POST(post({ campaign: '181', action: 'cancel' }))
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ status: 'deleted' })
    const second = await POST(post({ campaign: '181', action: 'cancel' }))
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ refused: true })

    expect(
      (await POST(post({ campaign: '181', action: 'explode' }))).status
    ).toBe(400)
    session.fresh = false
    const stale = await POST(post({ campaign: '181', action: 'cancel' }))
    expect(stale.status).toBe(401)
    expect(await stale.json()).toEqual({ error: 'reauth' })
  })

  it('Approve: every wave still to go, then 409 on a second press; no email to the owner', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    await freshModule({
      ADMIN_MAIL_SCRIPT_URL: MAIL_SCRIPT_URL,
      ADMIN_MAIL_SECRET: 'secret',
    })
    const { POST } = await approveRoute()
    const body = {
      campaign: '200',
      list: '6',
      waves: { from: 1, n: 4, segments: WAVE_IDS },
    }
    const first = await POST(post(body))
    expect(first.status).toBe(200)
    const answer = await first.json()
    expect(answer).toMatchObject({
      campaignId: '204',
      wave: 1,
      expected: 494,
      draftKept: true,
    })
    expect(
      (answer.scheduled as Array<{ wave: number }>).map(s => s.wave)
    ).toEqual([1, 2, 3, 4])
    // No email for an ordinary approval (Bryce, 2 Oct 2026), with the mail
    // script set up: nothing is queued to run after the answer.
    expect(afterQueue).toHaveLength(0)
    expect(ac.mails).toHaveLength(0)

    const second = await POST(post(body))
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ locked: true })
    expect(ac.creates).toEqual(['201', '202', '203', '204'])

    for (const waves of [
      { from: 1, n: 4, segments: ['x'] },
      { from: 'one', n: 4, segments: WAVE_IDS },
      { from: 1, n: 4, segments: 'all' },
    ]) {
      const malformed = await POST(post({ ...body, waves }))
      expect(malformed.status).toBe(400)
    }
  })

  it('Approve: a page loaded before approve once (one wave per press) is asked to reload', async () => {
    const ac = makeAC(waved())
    vi.stubGlobal('fetch', ac.fetchMock)
    await freshModule()
    const { POST } = await approveRoute()
    const res = await POST(
      post({
        campaign: '200',
        list: '6',
        wave: { segment: WAVE_IDS[0], k: 1, n: 4 },
      })
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      problems: [
        'this page is out of date – reload it, then approve the waves again',
      ],
    })
    expect(ac.calls).toEqual([])
  })

  it('Approve: held waves answer 409 needsOverride with the holds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
    const ac = makeAC(waved({ extra: [sentWave(1)] }))
    vi.stubGlobal('fetch', ac.fetchMock)
    await freshModule()
    kv.data.set('aisafety:newsletter:health:180', {
      verdict: 'red',
      reasons: ['hard bounces 3.1% (red at 2%)'],
    })
    const { POST } = await approveRoute()
    const res = await POST(
      post({
        campaign: '200',
        list: '6',
        waves: { from: 2, n: 4, segments: WAVE_IDS.slice(1) },
      })
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      needsOverride: true,
      holds: [expect.stringMatching(/the send watcher flagged wave 1 red/)],
    })
    expect(ac.creates).toEqual([])
  })
})
