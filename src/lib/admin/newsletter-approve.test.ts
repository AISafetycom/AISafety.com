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
import {
  buildEmail,
  camp,
  expireLocks,
  freshModule,
  kv,
  LINK_LIST,
  makeAC,
  outcome,
  resetKv,
} from './__fixtures__/fake-ac'

// The pretend ActiveCampaign, Upstash and mail script: ./__fixtures__/fake-ac.ts
vi.mock('@upstash/redis', async () => ({
  Redis: (await import('./__fixtures__/fake-ac')).FakeRedis,
}))

type NL = typeof import('./newsletter')

const kvData = kv.data
const kvExpiry = kv.expiry
const zsets = kv.zsets
const kvState = kv

const ENV = { ...process.env }

const WHO = { approver: 'Bryce Robertson' }

beforeEach(() => {
  resetKv()
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
    expect(d.deletable).toBe(false)
    expect(d.blocks.join(' ')).toMatch(/only aisafety\.com itself/)
    expect(d.problems).toEqual([])
  })
})

/* ─── Delete on a draft ────────────────────────────────────────────────── */

describe('deleteDraft', () => {
  const deletes = (ac: ReturnType<typeof makeAC>) =>
    ac.calls.filter(c => c.action === 'campaign_delete')

  it('deletes a pipeline draft, and only the campaign: its message stays', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    expect((await nl.listDrafts())[0].deletable).toBe(true)
    await expect(nl.deleteDraft('200', 'Bryce')).resolves.toEqual({
      deleted: true,
    })
    expect(deletes(ac).map(c => c.form?.get('id'))).toEqual(['200'])
    expect(ac.calls.some(c => c.action === 'message_delete')).toBe(false)
    expect(ac.msgs.has('300')).toBe(true)
    expect(await nl.listDrafts()).toEqual([])
  })

  it('a draft already gone answers deleted: false', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    await expect(nl.deleteDraft('999', 'Bryce')).resolves.toEqual({
      deleted: false,
    })
    expect(deletes(ac)).toEqual([])
  })

  it('refuses a campaign that isn’t a draft any more', async () => {
    const ac = makeAC({
      extra: [
        camp({
          id: '181',
          name: 'Events · Week 41, 2026',
          status: '1',
          msg: '300',
        }),
      ],
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.deleteDraft('181', 'Bryce'))
    expect(r.err).toBeInstanceOf(nl.DraftProblemError)
    expect((r.err as Error).message).toMatch(/not a draft/)
    expect(deletes(ac)).toEqual([])
  })

  it('refuses a draft without the pipeline’s marker', async () => {
    const e = buildEmail()
    const ac = makeAC({
      email: {
        html: e.html.replace(/<!--aisafety-issue:[0-9a-f]+-->/, ''),
        text: e.text,
      },
    })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    const r = await outcome(nl.deleteDraft('200', 'Bryce'))
    expect((r.err as Error).message).toMatch(/wasn’t built by the pipeline/)
    expect(deletes(ac)).toEqual([])
  })

  it('refuses a real list’s draft outside production; a test list’s goes anywhere', async () => {
    const ac = makeAC()
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule({ VERCEL_ENV: 'preview' })
    const r = await outcome(nl.deleteDraft('200', 'Bryce'))
    expect((r.err as Error).message).toMatch(/only aisafety\.com itself/)
    expect(deletes(ac)).toEqual([])

    const test = makeAC({ draftList: '5' })
    vi.stubGlobal('fetch', test.fetchMock)
    await expect(nl.deleteDraft('200', 'Bryce')).resolves.toEqual({
      deleted: true,
    })
  })

  it('waits while an approval of the issue holds the lock', async () => {
    const ac = makeAC({ deleteFails: true })
    vi.stubGlobal('fetch', ac.fetchMock)
    const nl = await freshModule()
    // The approval's own delete of the draft fails, so the draft stays.
    await nl.approveAndSend('200', '6', WHO)
    const before = deletes(ac).length
    const r = await outcome(nl.deleteDraft('200', 'Bryce'))
    expect(r.err).toBeInstanceOf(nl.DraftProblemError)
    expect((r.err as Error).message).toMatch(/deleting the draft waits/)
    expect(deletes(ac)).toHaveLength(before)
    expireLocks()
    const later = await outcome(nl.deleteDraft('200', 'Bryce'))
    expect(later.err).toBeInstanceOf(nl.DraftDeleteError)
    expect((later.err as Error).message).toMatch(/temporary failure/)
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

  it('sends card text edited by hand without asking for a tick', async () => {
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
    await expect(nl.approveAndSend('200', '6', WHO)).resolves.toMatchObject({
      campaignId: '201',
    })
  })

  it('asks for a tick on a word left in an edit, and sends once it has the ticks', async () => {
    const e = buildEmail({
      cards: [
        {
          key: 'recAAAAAAAAAAAAAA',
          title: 'The Big Tent',
          fields: [
            ['title', '', 'The Big Tent'],
            ['desc', '', 'A rewritten description. test'],
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
    expect(warnings.map(w => w.kind)).toEqual(['words'])
    expect(warnings[0].text).toMatch(/“test” in the email/)
    // A stale tick (an id from before a later edit) doesn't count.
    const stale = await outcome(
      nl.approveAndSend('200', '6', { ...WHO, confirmed: ['words:old'] })
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

  it('leaves card text edited since Pen wrote it alone', async () => {
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
    expect(r.warnings).toEqual([])
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

describe('reading the page through a burst', () => {
  it('rides out the empty 511 Cloudflare gives a burst of reads (8 Oct 2026)', async () => {
    const ac = makeAC()
    let refused = 0
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      if (/\/campaignLists$/.test(String(input)) && refused === 0) {
        refused++
        return new Response(null, { status: 511 })
      }
      return ac.fetchMock(input, init)
    })
    const nl = await freshModule()
    const drafts = await nl.listDrafts()
    expect(refused).toBe(1)
    expect(drafts.map(d => d.id)).toEqual(['200'])
  })
})
