import { describe, expect, it } from 'vitest'
import { orgLookup, type AnalyticsEvent } from './events'
import {
  catalogFrom,
  cleanUrl,
  hostOf,
  matchesNorm,
  normText,
  orgSpec,
  parseLeftOut,
  quickHost,
  rowHash,
  spreadsTo,
  type CatalogEntry,
} from './org-lookup'

// Lens Academy's records as of 13 October 2026, plus the near misses a naive
// "lens" match would catch, and a shared host (discord.gg) with other orgs.
const entry = (
  page: string,
  name: string,
  id: string,
  url: string,
  extra: Partial<CatalogEntry> = {}
): CatalogEntry => ({
  page,
  name,
  id,
  url,
  logo: `https://blob.example/${id}.png`,
  orgText: [],
  live: true,
  ...extra,
})

const CATALOG: CatalogEntry[] = [
  entry(
    'Map',
    'Lens Academy',
    'recKXruCx6WS2Atq1',
    'https://lensacademy.org/',
    {
      orgText: ['Lens Academy', 'Lens'],
    }
  ),
  entry(
    'Training',
    'Lens Academy courses',
    'rechpNtQUj1Xm5d9j',
    'https://lensacademy.org/'
  ),
  entry(
    'Communities',
    'Lens Academy',
    'reczjIMFHcdphqdkk',
    'https://discord.gg/3fbaazEYYA'
  ),
  entry(
    'Self-study',
    'AI Risk Fundamentals',
    'recgirSqrtuF0eXcp',
    'https://lensacademy.org/courses/ai-risk-fundamentals/curriculum',
    { orgText: ['Lens Academy'] }
  ),
  entry(
    'Jobs',
    'Co-Founder – Lens Academy',
    'recvsFi6wz9BTTfLr',
    'https://www.lesswrong.com/posts/LDbGob3XJ3LDBFmAe/x',
    { orgText: ['Lens Academy'] }
  ),
  // Past rounds: no logo, not live; one has no "Lens" in its name.
  entry(
    'Training',
    'AI Futures: Forecasting & Strategy',
    'recv2JLjsMsXgDn4d',
    'https://lensacademy.org/courses/ai-futures',
    { live: false, logo: null }
  ),
  entry(
    'Training',
    'Lens Academy: AI Control',
    'recfMR1W9JpsB4IBv',
    'https://lensacademy.org/courses/ai-control',
    { live: false, logo: null }
  ),
  // Near misses.
  entry(
    'Events',
    "AI Governance Fundamentals: Allan Dafoe's Overview and Theoretical Lenses",
    'recOhl5yP9rurHHlJ',
    'https://luma.com/aic-to-14-10',
    { orgText: ['The AI Collective'] }
  ),
  entry(
    'Events',
    'Mechanistic Interpretability Hackathon 4: J-lens',
    'recoLv5Ra78BZdeoh',
    'https://itch.io/jam/mi-4',
    { orgText: ['Mech Interp Discord'], live: false, logo: null }
  ),
  // Other orgs on the shared hosts.
  ...Array.from({ length: 5 }, (_, i) =>
    entry(
      'Communities',
      `Other server ${i}`,
      `recOther${i}`,
      `https://discord.gg/other${i}`
    )
  ),
  entry(
    'Jobs',
    'Researcher – Someone Else',
    'recJobElse',
    'https://www.lesswrong.com/posts/zzz/y',
    { orgText: ['Someone Else'] }
  ),
]

const spec = (q: string, x = '') => orgSpec(CATALOG, q, parseLeftOut(x))

describe('matching', () => {
  it('normalizes punctuation, accents and ampersands', () => {
    expect(normText('AISafety.info')).toBe('aisafety info')
    expect(normText('80,000 Hours')).toBe('80 000 hours')
    expect(normText('Q&A Café')).toBe('q and a cafe')
  })

  it('matches whole words only', () => {
    const m = (text: string, q: string) => {
      const n = normText(q)
      return matchesNorm(normText(text), n, n.replace(/ /g, ''))
    }
    expect(m('Co-Founder – Lens Academy', 'lens')).toBe(true)
    expect(m('Hackathon 4: J-lens', 'lens')).toBe(true)
    expect(m('Overview and Theoretical Lenses', 'lens')).toBe(false)
    expect(m('TransformerLens workshop', 'lens')).toBe(false)
    expect(m('BlueDot Impact', 'Blue Dot')).toBe(true)
    expect(m('80,000 Hours Job Board', '80000 hours')).toBe(true)
    expect(m('AI Safety Camp', 'AI Safety Camp')).toBe(true)
    expect(m('Campaign for AI Safety (CAS)', 'AI Safety Camp')).toBe(false)
  })

  it('keeps letters NFKD leaves whole, and other scripts', () => {
    expect(normText('Søren Elverlin')).toBe('soren elverlin')
    expect(normText('Straße')).toBe('strasse')
    expect(normText('Минимизаторы рисков')).toBe('минимизаторы рисков')
  })

  it('joins a one-word search only at the start of a name', () => {
    const m = (text: string, q: string) => {
      const n = normText(q)
      return matchesNorm(normText(text), n, n.replace(/ /g, ''))
    }
    expect(m('Blue Dot Impact', 'BlueDot')).toBe(true)
    expect(m('Control AI', 'ControlAI')).toBe(true)
    expect(m('Cambridge Long View Initiative (CLVI)', 'Longview')).toBe(false)
    expect(m('ARC White-Box Estimation Challenge', 'Whitebox')).toBe(false)
    expect(m('The 80,000 Hours Podcast', '80000 Hours')).toBe(true)
  })

  it('never throws on characters a pattern would choke on', () => {
    for (const q of ['c++', '(', '[a', '\\', '.*'])
      expect(() => spec(q)).not.toThrow()
  })

  it('cleans addresses and refuses non-web and own-site ones', () => {
    expect(
      cleanUrl(
        'https://www.LensAcademy.org/courses/?utm_source=aisafety.com&id=2#top'
      )
    ).toBe('lensacademy.org/courses?id=2')
    expect(hostOf('#')).toBeNull()
    expect(hostOf('mailto:a@b.org')).toBeNull()
    expect(hostOf('/jobs')).toBeNull()
    expect(hostOf('https://www.aisafety.com/funding')).toBeNull()
  })

  it('reads event hosts the way hostOf does, without parsing', () => {
    for (const u of [
      'https://www.LensAcademy.org/courses/?utm_source=x#top',
      'http://lensacademy.org',
      'https://user@forum.effectivealtruism.org:443/posts/a',
      'https://discord.gg/3fbaazEYYA',
      'https://www.aisafety.com/jobs',
      'https://jobs.aisafety.com/a',
      'mailto:a@b.org',
      '/jobs',
      '#',
      'https://ki-sicherheit-münchen.de/kurs',
      'https://exa%6Dple.org/',
    ])
      expect(quickHost(u)).toBe(hostOf(u))
  })
})

describe('orgSpec', () => {
  it("finds Lens Academy's listings and none of the near misses", () => {
    const s = spec('Lens')
    const names = [...s.entries.values()].map(
      e => `${e.page}: ${e.name} (${e.why})`
    )
    expect(names.sort()).toEqual(
      [
        'Communities: Lens Academy (name)',
        'Events: Mechanistic Interpretability Hackathon 4: J-lens (name)',
        'Jobs: Co-Founder – Lens Academy (organizer)',
        'Map: Lens Academy (name)',
        'Self-study: AI Risk Fundamentals (organizer)',
        'Training: AI Futures: Forecasting & Strategy (website)',
        'Training: Lens Academy courses (name)',
        'Training: Lens Academy: AI Control (name)',
      ].sort()
    )
    expect(s.hosts.has('lensacademy.org')).toBe(true)
    expect(s.orgName).toBe('Lens Academy')
    expect(s.tooBroad).toBeNull()
  })

  it('never spreads a shared host', () => {
    // One of six discord.gg listings and one of two lesswrong.com ones.
    const s = spec('Lens')
    expect(s.hosts.has('discord.gg')).toBe(false)
    expect(s.hosts.has('lesswrong.com')).toBe(false)
    expect([...s.entries.keys()].some(k => k.includes('Someone Else'))).toBe(
      false
    )
  })

  it('keeps a parent website’s subdomains of other groups out', () => {
    // Twelve CEA-hosted events on effectivealtruism.org; the Forum and EA
    // Funds hold other groups' listings on its subdomains.
    const cea = [
      ...Array.from({ length: 12 }, (_, i) =>
        entry(
          'Events',
          `EAG ${i}`,
          `recEag${i}`,
          `https://www.effectivealtruism.org/ea-global/${i}`,
          { orgText: ['Centre for Effective Altruism'] }
        )
      ),
      ...Array.from({ length: 9 }, (_, i) =>
        entry(
          'Communities',
          `Group ${i}`,
          `recGroup${i}`,
          `https://forum.effectivealtruism.org/groups/${i}`
        )
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        entry(
          'Funding',
          `Fund ${i}`,
          `recFund${i}`,
          `https://funds.effectivealtruism.org/funds/${i}`
        )
      ),
    ]
    const s = orgSpec(cea, 'Centre for Effective Altruism', new Set())
    expect(s.entries.size).toBe(12)
    expect(spreadsTo(s, 'effectivealtruism.org')).toBe(true)
    expect(spreadsTo(s, 'forum.effectivealtruism.org')).toBe(false)
    expect(spreadsTo(s, 'funds.effectivealtruism.org')).toBe(false)
    // A deep link on the org's own site with no listing of its own still
    // counts.
    expect(spreadsTo(s, 'www2.effectivealtruism.org')).toBe(true)
  })

  it('never spreads a form or job-board host', () => {
    const c = [
      entry('Map', 'BlueDot Impact', 'recBd', 'https://bluedot.org/'),
      entry(
        'Funding',
        'BlueDot AGI Strategy Fund',
        'recBdFund',
        'https://airtable.com/appX/form'
      ),
      entry(
        'Advisors',
        'AI Safety Hungary',
        'recHu',
        'https://airtable.com/appY/form'
      ),
      ...Array.from({ length: 50 }, (_, i) =>
        entry(
          'Training',
          `Someone's round ${i}`,
          `recPast${i}`,
          `https://airtable.com/app${i}/form`,
          {
            live: false,
            logo: null,
          }
        )
      ),
    ]
    const s = orgSpec(c, 'BlueDot', new Set())
    expect(s.tooBroad).toBeNull()
    expect(s.hosts.has('airtable.com')).toBe(false)
    expect([...s.entries.values()].map(e => e.name).sort()).toEqual([
      'BlueDot AGI Strategy Fund',
      'BlueDot Impact',
    ])
  })

  it('treats a group’s own blog subdomain as its website, but never a shared forum', () => {
    const c = [
      entry('Map', 'Google DeepMind', 'recGdm', 'https://deepmind.google/'),
      entry(
        'Map',
        'DeepMind Safety Research',
        'recDsr',
        'https://deepmindsafetyresearch.medium.com/'
      ),
      entry(
        'Self-study',
        'DeepMind AGI Safety Short Course',
        'recCourse',
        'https://deepmindsafetyresearch.medium.com/course',
        {
          orgText: ['Google DeepMind'],
        }
      ),
      entry(
        'Communities',
        'r/EffectiveAltruism',
        'recReddit1',
        'https://www.reddit.com/r/EffectiveAltruism/'
      ),
      entry(
        'Communities',
        'r/ControlProblem',
        'recReddit2',
        'https://www.reddit.com/r/ControlProblem/'
      ),
    ]
    const gdm = orgSpec(c, 'Google DeepMind', new Set())
    expect(gdm.hosts.has('deepmindsafetyresearch.medium.com')).toBe(true)
    expect([...gdm.entries.values()].map(e => e.name).sort()).toEqual([
      'DeepMind AGI Safety Short Course',
      'DeepMind Safety Research',
      'Google DeepMind',
    ])
    const ea = orgSpec(c, 'Effective Altruism', new Set())
    expect(ea.hosts.has('reddit.com')).toBe(false)
    expect([...ea.entries.values()].map(e => e.name)).toEqual([
      'r/EffectiveAltruism',
    ])
  })

  it('keeps the org’s name when its Field map row is left out', () => {
    const s = spec('Lens', rowHash('Map', 'Lens Academy'))
    expect(s.orgName).toBe('Lens Academy')
  })

  it('brings a sub-brand on a subdomain along with its parent website', () => {
    const c = [
      entry(
        'Map',
        'Center for AI Safety (CAIS)',
        'recCais',
        'https://safe.ai/'
      ),
      entry(
        'Map',
        'AI Safety Newsletter',
        'recAsnMap',
        'https://newsletter.safe.ai/'
      ),
      entry(
        'Media channels',
        'AI Safety Newsletter',
        'recAsnMedia',
        'https://newsletter.safe.ai/'
      ),
    ]
    const s = orgSpec(c, 'CAIS', new Set())
    expect(
      [...s.entries.values()].map(e => `${e.page}: ${e.name}`).sort()
    ).toEqual([
      'Map: AI Safety Newsletter',
      'Map: Center for AI Safety (CAIS)',
      'Media channels: AI Safety Newsletter',
    ])
  })

  it('never lets a past round spread a website it once linked to', () => {
    const c = [
      entry('Map', 'OpenAI', 'recOpenAi', 'https://openai.com/'),
      entry(
        'Training',
        'EleutherAI Summer of Open AI Research 2026',
        'recSoar',
        'https://www.eleuther.ai/soar',
        { live: false, logo: null }
      ),
      entry('Map', 'EleutherAI', 'recEleuther', 'https://www.eleuther.ai/'),
    ]
    const s = orgSpec(c, 'Open AI', new Set())
    expect(s.hosts.has('eleuther.ai')).toBe(false)
    expect([...s.entries.values()].map(e => e.name).sort()).toEqual([
      'EleutherAI Summer of Open AI Research 2026',
      'OpenAI',
    ])
  })

  it('counts one employer once toward too broad', () => {
    const jobs = Array.from({ length: 70 }, (_, i) =>
      entry(
        'Jobs',
        `Role ${i} – Big Lab`,
        `recJob${i}`,
        `https://jobs.example/${i}`,
        { orgText: ['Big Lab'] }
      )
    )
    expect(
      orgSpec(
        [...jobs, entry('Map', 'Big Lab', 'recLab', 'https://biglab.org/')],
        'Big Lab',
        new Set()
      ).tooBroad
    ).toBeNull()
  })

  it('drops a left-out listing before spreading its website', () => {
    const x = rowHash(
      'Events',
      'Mechanistic Interpretability Hackathon 4: J-lens'
    )
    const s = spec('lens', x)
    expect([...s.entries.values()].some(e => e.name.includes('J-lens'))).toBe(
      false
    )
    expect(s.leftOutEntries.map(e => e.name)).toEqual([
      'Mechanistic Interpretability Hackathon 4: J-lens',
    ])
  })

  it('calls a search that matches too much too broad', () => {
    const many = Array.from({ length: 70 }, (_, i) =>
      entry('Map', `AI org ${i}`, `recAi${i}`, `https://ai${i}.org/`)
    )
    expect(orgSpec(many, 'AI', new Set()).tooBroad).toEqual({
      listings: 70,
      websites: 70,
    })
  })

  it('reads ?x= safely', () => {
    expect([...parseLeftOut('abc12,BAD!,,zz9')]).toEqual(['abc12', 'zz9'])
    expect(
      parseLeftOut(
        Array(80)
          .fill('a1')
          .map((a, i) => a + i)
          .join(',')
      ).size
    ).toBe(50)
    // A label with commas still has one short, fixed id.
    expect(
      rowHash(
        'Jobs',
        'Forecasting, Modeling, and Shaping AI Futures – Lens Academy'
      )
    ).toMatch(/^[0-9a-z]{1,8}$/)
  })
})

describe('catalogFrom', () => {
  it('keeps a live round over its past copy and labels jobs as tracked', () => {
    const live = { id: 'r1', name: 'Round', url: 'https://x.org/', logo: 'L' }
    const c = catalogFrom({
      training: [live as never],
      trainingRounds: [{ ...live, logo: undefined, host: null } as never],
      jobs: [
        {
          id: 'j1',
          name: 'Co-Founder',
          organization: 'Lens Academy',
          url: 'https://y.org',
          logo: null,
        } as never,
      ],
    })
    expect(c.filter(e => e.id === 'r1')).toHaveLength(1)
    expect(c.find(e => e.id === 'r1')?.live).toBe(true)
    expect(c.find(e => e.id === 'j1')?.name).toBe('Co-Founder – Lens Academy')
  })
})

// --- Counting ---------------------------------------------------------------

const DAY1 = '2026-10-10T10:00:00Z'
const DAY1_LATER = '2026-10-10T15:00:00Z'
const DAY2 = '2026-10-11T09:00:00Z'
const RANGE = {
  startMs: Date.parse('2026-10-09T00:00:00Z'),
  endMs: Date.parse('2026-10-12T23:59:59.999Z'),
}
const NOW = Date.parse('2026-10-13T12:00:00Z')

const click = (
  page: string,
  label: string,
  vid: string | undefined,
  ts: string,
  extra: Partial<AnalyticsEvent> = {}
) =>
  ({ type: 'listing_click', page, label, vid, ts, ...extra }) as AnalyticsEvent

/** Newest first, like the store. */
const newestFirst = (events: AnalyticsEvent[]) =>
  [...events].sort((a, b) => b.ts.localeCompare(a.ts))

const views = new Map([
  ['Training', new Set(['v1', 'v2', 'v3', 'v4'])],
  ['Map', new Set(['v1', 'v2'])],
])

describe('orgLookup', () => {
  const events = newestFirst([
    click('Training', 'Lens Academy courses', 'v1', DAY1, {
      listingId: 'rechpNtQUj1Xm5d9j',
      url: 'https://lensacademy.org/',
      position: 'F1',
      source: 'recurring',
    }),
    click('Training', 'Lens Academy courses', 'v1', DAY1_LATER, {
      url: 'https://lensacademy.org/',
    }),
    click('Training', 'Lens Academy courses', 'v1', DAY2, {
      url: 'https://lensacademy.org/',
    }),
    click('Training', 'Lens Academy courses', undefined, DAY2, {
      url: 'https://lensacademy.org/',
    }),
    click('Map', 'Lens Academy', 'v2', DAY1, {
      url: 'https://lensacademy.org/',
      source: 'map',
    }),
    click('Home', 'Lens Academy courses', 'v3', DAY1, {
      url: 'https://lensacademy.org/',
      position: 'F1',
    }),
    // A past round, now off the site, found by its label.
    click('Training', 'Lens Academy: AI Control', 'v4', DAY1, {
      url: 'https://lensacademy.org/courses/ai-control',
    }),
    // Renamed since: matched by record id alone.
    click('Training', 'Old name', 'v4', DAY1, {
      listingId: 'recv2JLjsMsXgDn4d',
      url: 'https://x.example/',
    }),
    // The team's Queue preview, never counted.
    click('admin-queue', 'Lens Academy courses', 'v9', DAY1, {
      url: 'https://lensacademy.org/',
    }),
    // Not Lens.
    click('Training', 'Something else', 'v1', DAY1, {
      url: 'https://else.org/',
    }),
    {
      type: 'listing_hover',
      page: 'Map',
      label: 'Lens Academy',
      vid: 'v1',
      ts: DAY1,
    } as AnalyticsEvent,
    {
      type: 'map_search_pick',
      page: 'Map',
      label: 'Lens Academy',
      vid: 'v1',
      ts: DAY1,
      query: 'lens',
    } as AnalyticsEvent,
    // The same job found through search from two pages on one day: one click
    // in unique mode. The search label is the job title only.
    {
      type: 'search_click',
      page: '/',
      label: 'Co-Founder',
      url: 'https://www.lesswrong.com/posts/LDbGob3XJ3LDBFmAe/x',
      source: 'job',
      vid: 'v5',
      ts: DAY1,
    } as AnalyticsEvent,
    {
      type: 'search_click',
      page: '/training',
      label: 'Co-Founder',
      url: 'https://www.lesswrong.com/posts/LDbGob3XJ3LDBFmAe/x',
      source: 'job',
      vid: 'v5',
      ts: DAY1_LATER,
    } as AnalyticsEvent,
    // Someone else's job on the same shared host: not Lens.
    {
      type: 'search_click',
      page: '/',
      label: 'Researcher',
      url: 'https://www.lesswrong.com/posts/zzz/y',
      source: 'job',
      vid: 'v5',
      ts: DAY1,
    } as AnalyticsEvent,
    // A chatbot card: no label, prefixed id.
    {
      type: 'chatbot_click',
      page: '/training',
      listingId: 'course:recgirSqrtuF0eXcp',
      url: 'https://lensacademy.org/courses/ai-risk-fundamentals/curriculum',
      source: 'card',
      vid: 'v6',
      ts: DAY2,
    } as AnalyticsEvent,
    // Dead and own-site addresses never count.
    {
      type: 'chatbot_click',
      page: '/',
      url: '#',
      vid: 'v7',
      ts: DAY2,
    } as AnalyticsEvent,
    {
      type: 'search_click',
      page: '/',
      url: '/jobs',
      label: 'Jobs',
      source: 'page',
      vid: 'v7',
      ts: DAY2,
    } as AnalyticsEvent,
    {
      type: 'search_query',
      page: '/',
      query: 'Lens Academy',
      results: 3,
      vid: 'v5',
      ts: DAY1,
    } as AnalyticsEvent,
    {
      type: 'search_query',
      page: '/',
      query: 'lens academy',
      results: 3,
      vid: 'v5',
      ts: DAY2,
    } as AnalyticsEvent,
    {
      type: 'map_search_query',
      page: '/map',
      query: 'lens',
      results: 1,
      vid: 'v1',
      ts: DAY1,
    } as AnalyticsEvent,
    {
      type: 'search_query',
      page: '/',
      query: 'lenses',
      results: 0,
      vid: 'v5',
      ts: DAY1,
    } as AnalyticsEvent,
  ])

  const run = (unique: boolean, x = '') =>
    orgLookup(events, spec('Lens', x), unique, views, RANGE, NOW)

  it('counts each row like the page tabs, and leaves the team out', () => {
    const d = run(true)
    const byKey = new Map(d.rows.map(r => [`${r.page}: ${r.name}`, r]))
    // v1 twice on day 1 = once; v1 on day 2; a vid-less click.
    expect(byKey.get('Training: Lens Academy courses')?.clicks).toBe(3)
    expect(byKey.get('Training: Lens Academy courses')?.share).toEqual({
      name: 'Training\x00Lens Academy courses',
      active: 1,
      visitors: 4,
    })
    expect(byKey.get('Training: Lens Academy courses')?.featured).toBe(true)
    expect(byKey.get('Home: Lens Academy courses')?.clicks).toBe(1)
    expect(byKey.get('Map: Lens Academy')).toMatchObject({
      clicks: 1,
      hovers: 1,
      picks: 1,
    })
    expect(byKey.get('Training: Lens Academy: AI Control')).toMatchObject({
      live: false,
      why: 'name',
    })
    expect(byKey.get('Training: Old name')).toMatchObject({
      clicks: 1,
      why: 'website',
    })
    expect([...byKey.keys()].some(k => k.includes('admin-queue'))).toBe(false)
    expect(byKey.has('Training: Something else')).toBe(false)
    // Live listings with no clicks still show.
    expect(byKey.get('Communities: Lens Academy')).toMatchObject({
      clicks: 0,
      live: true,
    })
  })

  it('adds search and chatbot clicks by address, deduped per visitor per day', () => {
    const d = run(true)
    expect(d.destinations.map(r => [r.where, r.name, r.count])).toEqual([
      ['Site search', 'Co-Founder', 1],
      [
        'Chatbot',
        'https://lensacademy.org/courses/ai-risk-fundamentals/curriculum',
        1,
      ],
    ])
    const total = run(false)
    expect(total.destinations.find(r => r.where === 'Site search')?.count).toBe(
      2
    )
  })

  it('splits the clicks by how visitors reached them, adding up to the total', () => {
    for (const unique of [true, false]) {
      const d = run(unique)
      const sum = d.reached.reduce((s, r) => s + r.count, 0)
      expect(sum).toBe(d.clicks)
      expect(d.series.reduce((s, b) => s + b.count, 0)).toBe(d.clicks)
    }
    // Unique mode keeps a visitor's newest click of the day, as the page tabs
    // do, so v1's featured-slot click gives way to their later card click.
    expect(run(true).reached).toEqual([
      { name: 'Cards', count: 5 },
      { name: 'Map pins', count: 1 },
      { name: 'Homepage', count: 1 },
      { name: 'Site search', count: 1 },
      { name: 'Chatbot', count: 1 },
    ])
  })

  it('counts visitors whatever the mode', () => {
    const u = run(true)
    const t = run(false)
    // v1, v2, v3, v4, v5, v6 + one vid-less click.
    expect(u.visitors).toBe(7)
    expect(t.visitors).toBe(7)
    expect(t.clicks).toBe(11)
    expect(t.reached.find(r => r.name === 'Featured slot')?.count).toBe(1)
  })

  it('finds what people searched for, as whole words', () => {
    expect(run(true).searches.map(s => [s.where, s.term, s.count])).toEqual([
      ['Map search', 'lens', 1],
      ['Site search', 'lens academy', 1],
    ])
    expect(run(false).searches[0].count).toBe(2)
  })

  it('leaves out a row, and its search clicks, on request', () => {
    const x = rowHash('Self-study', 'AI Risk Fundamentals')
    const d = run(true, x)
    expect(d.rows.some(r => r.name === 'AI Risk Fundamentals')).toBe(false)
    expect(d.destinations.some(r => r.where === 'Chatbot')).toBe(false)
    expect(d.leftOut.map(r => r.name)).toEqual(['AI Risk Fundamentals'])
  })

  it('draws a bar per day from where the data starts to the range end', () => {
    // The range opens on the 9th, but nothing was stored before the 10th.
    expect(run(true).series.map(b => b.start)).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
    ])
    const allTime = orgLookup(
      events,
      spec('Lens'),
      true,
      views,
      { startMs: null, endMs: null },
      NOW
    )
    expect(allTime.series[0].start).toBe('2026-10-10')
    expect(allTime.series.at(-1)?.start).toBe('2026-10-13')
  })

  it('draws nothing when nothing was read, however early the range', () => {
    const early = {
      startMs: Date.parse('0999-01-01T00:00:00Z'),
      endMs: Date.parse('0999-03-01T00:00:00Z'),
    }
    expect(orgLookup([], spec('Lens'), true, views, early, NOW).series).toEqual(
      []
    )
  })

  it('keeps chatbot cards for a kept listing that shares a left-out row’s record', () => {
    const ev = newestFirst([
      click('Home', 'Lens Academy courses', 'v1', DAY1, {
        listingId: 'rechpNtQUj1Xm5d9j',
        url: 'https://lensacademy.org/',
      }),
      click('Training', 'Lens Academy courses', 'v2', DAY1, {
        listingId: 'rechpNtQUj1Xm5d9j',
        url: 'https://lensacademy.org/',
      }),
      {
        type: 'chatbot_click',
        page: '/',
        listingId: 'training:rechpNtQUj1Xm5d9j',
        url: 'https://lensacademy.org/',
        source: 'card',
        vid: 'v3',
        ts: DAY1,
      } as AnalyticsEvent,
    ])
    const x = rowHash('Home', 'Lens Academy courses')
    const d = orgLookup(ev, spec('Lens', x), true, views, RANGE, NOW)
    expect(d.reached.find(r => r.name === 'Chatbot')?.count).toBe(1)
  })

  it('never draws (or throws on) years with no data', () => {
    const far = { startMs: Date.parse('0001-01-01T00:00:00Z'), endMs: null }
    const d = orgLookup(events, spec('Lens'), true, views, far, NOW)
    expect(d.series[0].start).toBe('2026-10-10')
    expect(d.seriesUnit).toBe('day')
  })

  it('keeps search clicks on an address a kept listing shares', () => {
    // Field map "Lens Academy" and Training "Lens Academy courses" share
    // lensacademy.org; leaving out the first keeps the second's clicks.
    const shared = newestFirst([
      click('Training', 'Lens Academy courses', 'v1', DAY1, {
        url: 'https://lensacademy.org/',
      }),
      click('Map', 'Lens Academy', 'v2', DAY1, {
        url: 'https://lensacademy.org/',
        listingId: 'recKXruCx6WS2Atq1',
      }),
      {
        type: 'search_click',
        page: '/',
        label: 'Lens Academy courses',
        url: 'https://lensacademy.org/',
        source: 'training',
        vid: 'v3',
        ts: DAY1,
      } as AnalyticsEvent,
      // A chatbot card naming the left-out Map record stays out.
      {
        type: 'chatbot_click',
        page: '/',
        listingId: 'org:recKXruCx6WS2Atq1',
        url: 'https://lensacademy.org/',
        source: 'card',
        vid: 'v4',
        ts: DAY1,
      } as AnalyticsEvent,
    ])
    const d = orgLookup(
      shared,
      spec('Lens', rowHash('Map', 'Lens Academy')),
      true,
      views,
      RANGE,
      NOW
    )
    expect(d.rows.some(r => r.page === 'Map')).toBe(false)
    expect(d.reached).toEqual([
      { name: 'Cards', count: 1 },
      { name: 'Site search', count: 1 },
    ])
    expect(d.visitors).toBe(2)
  })

  it('never calls a homepage card gone', () => {
    const home = [
      click('Home', 'Lens Academy courses', 'v1', DAY1, {
        url: 'https://lensacademy.org/',
      }),
    ]
    expect(
      orgLookup(home, spec('Lens'), true, views, RANGE, NOW).rows.find(
        r => r.page === 'Home'
      )?.live
    ).toBe(true)
  })

  it('survives a flood of clicks on one listing', () => {
    const flood = Array.from({ length: 130_000 }, (_, i) =>
      click('Map', 'Lens Academy', `f${i}`, DAY1, {
        url: 'https://lensacademy.org/',
      })
    )
    const d = orgLookup(flood, spec('Lens'), false, views, RANGE, NOW)
    expect(d.visitors).toBe(130_000)
  })

  it('returns nothing for a too-broad search', () => {
    const broad = { ...spec('Lens'), tooBroad: { listings: 99, websites: 9 } }
    expect(orgLookup(events, broad, true, views, RANGE, NOW).rows).toEqual([])
  })
})
