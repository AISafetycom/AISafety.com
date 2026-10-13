import { createHash } from 'node:crypto'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// An in-memory stand-in for Upstash holding the sent-issues record and the
// click counts, under the keys the live site writes. The kept web copies
// and link lists on the Blob store come from a stubbed fetch.
const hashes = new Map<string, Record<string, unknown>>()
const reads: string[] = []
let failCounts = false

vi.mock('@upstash/redis', () => {
  class FakeRedis {
    // A link list's Upstash copy: kept after a Blob read, never read back
    // here (the Blob answers).
    async set() {
      return 'OK'
    }
    async get() {
      return null
    }
    async hgetall(key: string) {
      reads.push(key)
      return hashes.get(key) ?? null
    }
    pipeline() {
      const keys: string[] = []
      const p = {
        hgetall(key: string) {
          keys.push(key)
          return p
        },
        async exec() {
          if (failCounts) throw new Error('Upstash down')
          reads.push(...keys)
          return keys.map(k => hashes.get(k) ?? null)
        },
      }
      return p
    }
  }
  return { Redis: FakeRedis }
})

let readIssueClicks: typeof import('./org-newsletter').readIssueClicks

beforeAll(async () => {
  process.env.KV_REST_API_URL = 'https://fake.upstash.example'
  process.env.KV_REST_API_TOKEN = 'fake'
  ;({ readIssueClicks } = await import('./org-newsletter'))
  hashes.set('aisafety:newsletter:archive:training', {
    'week-41-2026': '2026-10-08T07:00:00.000Z',
    'week-40-2026': '2026-10-01T07:00:00.000Z',
  })
  hashes.set('aisafety:newsletter:archive:events', {
    'week-41-2026': '2026-10-08T07:30:00.000Z',
  })
  hashes.set('aisafety:newsletter:clicks:Training · Week 41, 2026', {
    [JSON.stringify({
      t: 'Lens Academy: AI Control',
      u: 'https://lensacademy.org/courses/ai-control',
    })]: 12,
    __total: 12,
  })
})

const OCTOBER = {
  startMs: Date.parse('2026-10-05T00:00:00Z'),
  endMs: Date.parse('2026-10-13T23:59:59.999Z'),
}

const BLOB = 'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com'

/** A link list as the pipeline saves it, under the name it gets. */
function linkList(
  campaign: string,
  links: { u: string; k: string; t: string }[]
) {
  const json = JSON.stringify({ v: 1, c: campaign, links })
  const id = createHash('sha256').update(json).digest('hex').slice(0, 16)
  return { json, id }
}

const TRAINING = linkList('Training · Week 41, 2026', [
  {
    u: 'https://lensacademy.org/courses/ai-control',
    k: 'recCourses',
    t: 'Lens Academy: AI Control',
  },
  // The same card's Outlook title link: the same label and address.
  {
    u: 'https://lensacademy.org/courses/ai-control',
    k: 'recCourses2',
    t: 'Lens Academy: AI Control',
  },
  { u: 'https://bluedot.org/', k: 'recBlue', t: 'BlueDot: AGI Strategy' },
])
const EVENTS = linkList('Events · Week 41, 2026', [
  { u: 'https://luma.com/lenses', k: 'recTalk', t: 'Theoretical Lenses talk' },
])

/** The email as kept: its counted links point into its list. */
const email = (id: string, n: number) =>
  `<html><body><!--aisafety-issue:3366354382b40bf9-->${Array.from(
    { length: n },
    (_, i) => `<a href="https://aisafety.com/api/nl/${id}/${i}">Link</a>`
  ).join('')}</body></html>`

/** The Blob store: these files, a 404 for anything else. */
function blob(files: Record<string, string>) {
  return vi.fn(async (url: string | URL) => {
    const body = files[String(url)]
    return body == null
      ? new Response('Not found', { status: 404 })
      : new Response(body, { status: 200 })
  })
}

const BOTH = {
  [`${BLOB}/newsletter/web/training/week-41-2026.html`]: email(TRAINING.id, 2),
  [`${BLOB}/newsletter/web/events/week-41-2026.html`]: email(EVENTS.id, 1),
  [`${BLOB}/newsletter/links/${TRAINING.id}.json`]: TRAINING.json,
  [`${BLOB}/newsletter/links/${EVENTS.id}.json`]: EVENTS.json,
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.stubGlobal('fetch', blob(BOTH))
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const TRAINING_LINKS = [
  {
    label: 'Lens Academy: AI Control',
    url: 'https://lensacademy.org/courses/ai-control',
    clicks: 12,
  },
  { label: 'BlueDot: AGI Strategy', url: 'https://bluedot.org/', clicks: 0 },
]

describe('readIssueClicks', () => {
  it('reads the issues sent in the range, in send order, with every link of each', async () => {
    const r = await readIssueClicks(OCTOBER)
    expect(r).toEqual({
      status: 'ok',
      complete: true,
      issues: [
        {
          name: 'Training · Week 41, 2026',
          sentAt: '2026-10-08T07:00:00.000Z',
          links: TRAINING_LINKS,
          complete: true,
        },
        {
          // Nobody clicked anything in it: its one link, with 0.
          name: 'Events · Week 41, 2026',
          sentAt: '2026-10-08T07:30:00.000Z',
          links: [
            {
              label: 'Theoretical Lenses talk',
              url: 'https://luma.com/lenses',
              clicks: 0,
            },
          ],
          complete: true,
        },
      ],
    })
    // Week 40 went out before the range, so its counts aren't read.
    expect(reads).not.toContain(
      'aisafety:newsletter:clicks:Training · Week 40, 2026'
    )
    // A kept copy never changes, so Next's fetch cache may keep it.
    const fetchMock = vi.mocked(fetch)
    const copyRead = fetchMock.mock.calls.find(
      ([url]) =>
        String(url) === `${BLOB}/newsletter/web/events/week-41-2026.html`
    )
    expect(copyRead?.[1]).toMatchObject({ cache: 'force-cache' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('shows an issue whose list can’t be found with its clicked links only, and says so', async () => {
    // The Events copy isn't filed yet.
    const notFiled: Record<string, string> = { ...BOTH }
    delete notFiled[`${BLOB}/newsletter/web/events/week-41-2026.html`]
    vi.stubGlobal('fetch', blob(notFiled))
    const r = await readIssueClicks(OCTOBER)
    expect(r).toMatchObject({
      status: 'ok',
      complete: false,
      issues: [
        { name: 'Training · Week 41, 2026', complete: true },
        { name: 'Events · Week 41, 2026', links: [], complete: false },
      ],
    })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Events · Week 41, 2026')
    )
  })

  it('treats a kept copy without counted links as incomplete', async () => {
    vi.stubGlobal(
      'fetch',
      blob({
        ...BOTH,
        [`${BLOB}/newsletter/web/events/week-41-2026.html`]:
          '<a href="https://luma.com/lenses">Talk</a>',
      })
    )
    const r = await readIssueClicks(OCTOBER)
    expect(r.status === 'ok' && r.issues.map(i => i.complete)).toEqual([
      true,
      false,
    ])
  })

  it('gives up on a stalled Blob store after 2.5 s, showing clicked links only', async () => {
    // A stall in Next's fetch cache ignores the signal, as this fetch does.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    )
    const t0 = Date.now()
    const r = await readIssueClicks(OCTOBER)
    const waited = Date.now() - t0
    expect(waited).toBeGreaterThanOrEqual(2400)
    expect(waited).toBeLessThan(3500)
    expect(r).toEqual({
      status: 'ok',
      complete: false,
      issues: [
        {
          name: 'Training · Week 41, 2026',
          sentAt: '2026-10-08T07:00:00.000Z',
          links: [TRAINING_LINKS[0]],
          complete: false,
        },
        {
          name: 'Events · Week 41, 2026',
          sentAt: '2026-10-08T07:30:00.000Z',
          links: [],
          complete: false,
        },
      ],
    })
  }, 10_000)

  it('says so when the counts can’t be read, rather than showing zero', async () => {
    failCounts = true
    expect(await readIssueClicks(OCTOBER)).toEqual({ status: 'error' })
    failCounts = false
  })
})
