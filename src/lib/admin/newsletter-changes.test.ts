import { describe, expect, it, vi } from 'vitest'

// The module reads Airtable and ActiveCampaign through these; the tests here
// cover only its pure part, so the clients are stand-ins.
vi.mock('./airtable', () => ({
  airtableRequest: vi.fn(),
  listAll: vi.fn(),
  isRecordId: (id: string) => /^rec[A-Za-z0-9]{14}$/.test(id),
}))
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock('./session', () => ({ sealToken: vi.fn() }))
vi.mock('@/lib/assistant/catalog', () => ({ getCatalog: vi.fn() }))

import type { CardProps } from '@/components/ListingCard'
import type { EventListing } from '@/lib/data/events'
import type { CardGroup, CardInfo } from './newsletter'
import {
  compareCard,
  listingAlerts,
  openBroomItems,
  siteFields,
} from './newsletter-changes'
import type { QueueItem } from './queue'

const TEST_BENCH = 'rec2JS6gVoqxklH4e'
const COMMONS = 'recNlOQIbagPMQrij'
const EVENTS = 'tblXbN9swwldwq8f7'

/** Week 41's Test Bench #1 card as the email carried it (built 8 Oct 2026). */
function testBenchCard(
  date = '17 Oct 2026',
  deadline = '16 Oct 2026'
): CardInfo {
  return {
    key: TEST_BENCH,
    title: 'Test Bench #1 – AI Safety Build Club',
    logo: null,
    fit: null,
    pipelineFit: null,
    fields: [
      {
        name: 'title',
        label: 'Title',
        value: 'Test Bench #1 – AI Safety Build Club',
        original: null,
        hasLink: false,
        icon: null,
      },
      {
        name: 'm0',
        label: 'Location',
        value: 'Paris, France',
        original: null,
        hasLink: false,
        icon: 'pin',
      },
      {
        name: 'm1',
        label: 'Dates',
        value: date,
        original: null,
        hasLink: false,
        icon: 'calendar',
      },
      {
        name: 'desc',
        label: 'Description',
        value: 'Short hands-on demo.',
        original: null,
        hasLink: false,
        icon: null,
      },
      {
        name: 'b0',
        label: 'Host',
        value: 'By Nouvelle Machine',
        original: null,
        hasLink: false,
        icon: 'person',
      },
      {
        name: 'b1',
        label: 'Cost',
        value: 'Free',
        original: null,
        hasLink: false,
        icon: 'tag',
      },
      {
        name: 'b2',
        label: 'Deadline',
        value: `Register by ${deadline}`,
        original: null,
        hasLink: false,
        icon: 'paper',
      },
    ],
  }
}

function testBenchListing(over: Partial<EventListing> = {}): EventListing {
  return {
    url: 'https://luma.com/6gzxitmx',
    name: 'Test Bench #1 – AI Safety Build Club',
    description: 'Short hands-on\n demo.',
    logo: null,
    type: ['Workshop'],
    mode: 'In person',
    location: 'Paris, France',
    startDate: '2026-10-18',
    endDate: '2026-10-18',
    startTime: null,
    endTime: null,
    host: 'Nouvelle Machine',
    cost: ['Free'],
    deadlineType: 'Register',
    applicationsClose: '2026-10-18',
    ...over,
  } as unknown as EventListing
}

function broomRow(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'rec7yUPueXjt3xMG3',
    source: 'Broom',
    type: 'Change',
    status: 'Pending',
    verdict: 'Fix',
    targetTable: EVENTS,
    targetRecord: TEST_BENCH,
    changes: [{ field: 'Start date', from: '2026-10-17', to: '2026-10-18' }],
    reasons: ['Luma now shows Sunday 18 October.'],
    ...over,
  } as unknown as QueueItem
}

describe('siteFields', () => {
  it('numbers the lines as the email does, dropping empty rows first', () => {
    const p: CardProps = {
      href: '#',
      name: ' DISPATCH  – AI Safety Comms Fellowship',
      description: '',
      logo: null,
      pills: [],
      titleMeta: [
        { icon: '/images/icons/computer.svg', value: 'Online' },
        { icon: '/images/icons/calendar.svg', value: '' },
        {
          icon: '/images/icons/calendar.svg',
          value: '6 weeks · Starts 19 Oct 2026',
        },
      ],
      meta: [
        { icon: '/images/icons/paper.svg', value: 'Apply by 17 Oct 2026' },
      ],
    }
    expect(siteFields(p)).toEqual([
      {
        name: 'title',
        icon: null,
        value: 'DISPATCH – AI Safety Comms Fellowship',
      },
      { name: 'm0', icon: 'computer', value: 'Online' },
      { name: 'm1', icon: 'calendar', value: '6 weeks · Starts 19 Oct 2026' },
      { name: 'b0', icon: 'paper', value: 'Apply by 17 Oct 2026' },
    ])
  })
})

describe('compareCard', () => {
  const site = (over: Partial<CardProps> = {}) =>
    siteFields({
      href: '#',
      name: 'Test Bench #1 – AI Safety Build Club',
      description: 'Short hands-on demo.',
      logo: null,
      pills: [],
      titleMeta: [
        { icon: '/images/icons/pin.svg', value: 'Paris, France' },
        { icon: '/images/icons/calendar.svg', value: '18 Oct 2026' },
      ],
      meta: [
        { icon: '/images/icons/person.svg', value: 'By Nouvelle Machine' },
        { icon: '/images/icons/tag.svg', value: 'Free' },
        { icon: '/images/icons/paper.svg', value: 'Register by 18 Oct 2026' },
      ],
      ...over,
    })

  it('finds the lines the organizer changed (week 41: Test Bench moved a day)', () => {
    const r = compareCard(testBenchCard(), site())
    expect(r.updatable).toBe(true)
    expect(r.changes).toEqual([
      { name: 'm1', label: 'Dates', email: '17 Oct 2026', site: '18 Oct 2026' },
      {
        name: 'b2',
        label: 'Deadline',
        email: 'Register by 16 Oct 2026',
        site: 'Register by 18 Oct 2026',
      },
    ])
  })

  it('is quiet when the card already says what the site says', () => {
    expect(
      compareCard(testBenchCard('18 Oct 2026', '18 Oct 2026'), site()).changes
    ).toEqual([])
  })

  it('leaves a hand edit alone while the listing is unchanged since the build', () => {
    const card = testBenchCard('18 Oct 2026', '18 Oct 2026')
    card.fields[3] = {
      ...card.fields[3],
      value: 'Bryce’s own words.',
      original: 'Short hands-on demo.',
    }
    expect(compareCard(card, site()).changes).toEqual([])
  })

  it('says the card can’t be updated line by line when a row changes shape', () => {
    const r = compareCard(
      testBenchCard('18 Oct 2026', '18 Oct 2026'),
      site({
        meta: [
          { icon: '/images/icons/person.svg', value: 'By Nouvelle Machine' },
          { icon: '/images/icons/tag.svg', value: 'Free' },
          {
            icon: '/images/icons/paper-closed.svg',
            value: 'Registration closed',
          },
        ],
      })
    )
    expect(r.updatable).toBe(false)
    expect(r.note).toContain('“Registration closed”')
    expect(r.note).toContain('rebuild')
  })
})

describe('openBroomItems', () => {
  it('keeps open Broom changes for the email’s listings, not Fable’s dismissals', () => {
    const keys = new Set([TEST_BENCH])
    const rows = [
      broomRow(),
      broomRow({ id: 'r2', verdict: 'Dismiss' }),
      broomRow({ id: 'r3', status: 'Applied' }),
      broomRow({ id: 'r4', targetRecord: 'recAAAAAAAAAAAAAA' }),
      broomRow({ id: 'r5', source: 'Comb' }),
      broomRow({ id: 'r6', status: 'Revising' }),
    ]
    expect(openBroomItems(rows, keys).map(r => r.id)).toEqual([
      'rec7yUPueXjt3xMG3',
      'r6',
    ])
  })
})

describe('listingAlerts', () => {
  const groups = (card = testBenchCard()): CardGroup[] => [
    {
      id: 'g0',
      label: 'New events',
      cards: [
        card,
        {
          key: COMMONS,
          title: 'The Commons Problem – Playtest 1',
          logo: null,
          fit: null,
          pipelineFit: null,
          fields: [],
        },
        {
          key: 'manual-callout',
          title: 'Not a listing',
          logo: null,
          fit: null,
          pipelineFit: null,
          fields: [],
        },
      ],
    },
  ]

  it('names a listing with an open Broom fix and what the site says now', () => {
    const out = listingAlerts(groups(), [broomRow()], {
      [`${EVENTS}/${TEST_BENCH}`]: {
        kind: 'event',
        listing: testBenchListing(),
      },
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      key: TEST_BENCH,
      group: 'g0',
      updatable: true,
      broom: [
        {
          id: 'rec7yUPueXjt3xMG3',
          changes: [
            { field: 'Start date', from: '2026-10-17', to: '2026-10-18' },
          ],
          reason: 'Luma now shows Sunday 18 October.',
        },
      ],
    })
    expect(out[0].changes.map(c => c.name)).toEqual(['m1', 'b2'])
  })

  it('names a listing edited after the build even with no Broom item', () => {
    const out = listingAlerts(groups(), [], {
      [`${EVENTS}/${TEST_BENCH}`]: {
        kind: 'event',
        listing: testBenchListing(),
      },
    })
    expect(out.map(a => a.key)).toEqual([TEST_BENCH])
    expect(out[0].broom).toEqual([])
  })

  it('says nothing when every card matches its listing', () => {
    const out = listingAlerts(
      groups(testBenchCard('18 Oct 2026', '18 Oct 2026')),
      [],
      {
        [`${EVENTS}/${TEST_BENCH}`]: {
          kind: 'event',
          listing: testBenchListing(),
        },
      }
    )
    expect(out).toEqual([])
  })

  it('still shows a Broom fix on a card the site doesn’t draw (funding)', () => {
    const out = listingAlerts(groups(), [broomRow()], {})
    expect(out).toHaveLength(1)
    expect(out[0].changes).toEqual([])
    expect(out[0].note).toContain('Pen')
  })
})
