import { describe, expect, it } from 'vitest'
import type { AnalyticsEvent } from '@/lib/analytics/events'
import { joinRecordings, matchesFilter, pageName } from './join'
import {
  NAV_TAG,
  RR,
  isInteraction,
  isRecordablePath,
  isRecordingId,
  summarizeChunk,
} from './shared'
import { summarize, type ChunkRecord, type RecordingSummary } from './store'

const meta = (t: number, href: string, width = 1440) => ({
  type: RR.Meta,
  timestamp: t,
  data: { href, width, height: 900 },
})
const full = (t: number) => ({ type: RR.FullSnapshot, timestamp: t, data: {} })
const click = (t: number) => ({
  type: RR.IncrementalSnapshot,
  timestamp: t,
  data: { source: RR.MouseInteraction, type: RR.Click, id: 1, x: 1, y: 1 },
})
const move = (t: number) => ({
  type: RR.IncrementalSnapshot,
  timestamp: t,
  data: { source: RR.MouseMove, positions: [] },
})
const scroll = (t: number) => ({
  type: RR.IncrementalSnapshot,
  timestamp: t,
  data: { source: 3, id: 1, x: 0, y: 100 },
})
const nav = (t: number, path: string) => ({
  type: RR.Custom,
  timestamp: t,
  data: { tag: NAV_TAG, payload: { path } },
})

describe('summarizeChunk', () => {
  it('reads times, pages, clicks and width', () => {
    const s = summarizeChunk([
      meta(1000, 'https://aisafety.com/funding'),
      full(1001),
      move(1500),
      click(2000),
      nav(3000, '/jobs'),
      nav(3500, '/jobs'),
      click(4000),
    ])
    expect(s).toEqual({
      t0: 1000,
      t1: 4000,
      pages: ['/funding', '/jobs'],
      clicks: 2,
      width: 1440,
      full: true,
    })
  })

  it('refuses anything that is not a list of rrweb events', () => {
    expect(summarizeChunk([])).toBeNull()
    expect(summarizeChunk('nope')).toBeNull()
    expect(summarizeChunk([{ type: 3 }])).toBeNull()
    expect(summarizeChunk([{ type: 'x', timestamp: 1 }])).toBeNull()
    expect(summarizeChunk([null])).toBeNull()
  })
})

describe('isInteraction', () => {
  it('counts mouse, touch and typing, not scrolling or page changes', () => {
    expect(isInteraction(move(1))).toBe(true)
    expect(isInteraction(click(1))).toBe(true)
    expect(isInteraction(scroll(1))).toBe(false)
    expect(isInteraction(full(1))).toBe(false)
  })
})

describe('isRecordablePath', () => {
  it('keeps private and admin pages out', () => {
    expect(isRecordablePath('/funding')).toBe(true)
    expect(isRecordablePath('/')).toBe(true)
    expect(isRecordablePath('/admin/analytics')).toBe(false)
    expect(isRecordablePath('/stats/abc123')).toBe(false)
    expect(isRecordablePath('/work-test/xyz')).toBe(false)
    expect(isRecordablePath('/newsletter')).toBe(false)
    expect(isRecordablePath('/newsletters-archive')).toBe(true)
  })
})

describe('isRecordingId', () => {
  it('takes only a lowercase UUID', () => {
    expect(isRecordingId('0b9d6a5e-6f3b-4c1e-9d2a-3e4f5a6b7c8d')).toBe(true)
    expect(isRecordingId('../../etc/passwd')).toBe(false)
    expect(isRecordingId(42)).toBe(false)
  })
})

const chunk = (over: Partial<ChunkRecord>): ChunkRecord => ({
  seq: 0,
  t0: 0,
  t1: 0,
  pages: [],
  clicks: 0,
  full: false,
  url: 'x',
  bytes: 100,
  off: 0,
  at: 0,
  ...over,
})

describe('summarize', () => {
  it('joins chunks in order, whatever order they arrived in', () => {
    const s = summarize('id', 1_000, { vid: 'v1' }, [
      chunk({ seq: 1, t0: 20_000, t1: 40_000, pages: ['/jobs', '/'] }),
      chunk({
        seq: 0,
        t0: 1_000,
        t1: 19_000,
        pages: ['/funding', '/jobs'],
        clicks: 2,
        width: 390,
      }),
    ])
    expect(s.pages).toEqual(['/funding', '/jobs', '/'])
    expect(s.end).toBe(40_000)
    expect(s.clicks).toBe(2)
    expect(s.chunks).toBe(2)
    expect(s.bytes).toBe(200)
    expect(s.width).toBe(390)
  })

  it("moves a wrong visitor clock onto the server's", () => {
    const s = summarize('id', 500_000, {}, [
      chunk({ seq: 0, t0: 0, t1: 60_000, off: 500_000 }),
    ])
    expect(s.end).toBe(560_000)
    expect(s.off).toBe(500_000)
  })
})

const rec = (over: Partial<RecordingSummary>): RecordingSummary => ({
  id: 'r',
  vid: 'v1',
  start: Date.parse('2026-11-25T10:00:00Z'),
  end: Date.parse('2026-11-25T10:05:00Z'),
  pages: ['/funding'],
  clicks: 0,
  chunks: 1,
  bytes: 1,
  off: 0,
  ...over,
})
const ev = (over: Partial<AnalyticsEvent>): AnalyticsEvent => ({
  type: 'listing_click',
  vid: 'v1',
  ts: '2026-11-25T10:01:00.000Z',
  ...over,
})

describe('joinRecordings', () => {
  it("gives each recording its own visitor's events from the same minutes", () => {
    const [row] = joinRecordings(
      [rec({})],
      [
        ev({ type: 'search_query', query: 'Grants', results: 0 }),
        ev({ type: 'search_query', query: 'grants', results: 0 }),
        ev({ type: 'search_query', query: 'jobs', results: 12 }),
        ev({ type: 'chatbot_open', ts: '2026-11-25T10:05:20.000Z' }),
        ev({ page: 'Funding', ts: '2026-11-25T09:59:58.000Z' }),
        // Someone else, and the same visitor an hour later.
        ev({ vid: 'v2' }),
        ev({ ts: '2026-11-25T11:00:00.000Z' }),
        // Shown by the replay itself.
        ev({ type: 'page_view', page: '/funding' }),
      ]
    )
    expect(row.zeroSearches).toEqual(['grants'])
    expect(row.openedChatbot).toBe(true)
    expect(row.listingClickPages).toEqual(['Funding'])
    expect(row.moments.map(m => m.type)).toEqual([
      'listing_click',
      'search_query',
      'search_query',
      'search_query',
      'chatbot_open',
    ])
  })

  it('leaves a recording without a visitor id on its own', () => {
    const [row] = joinRecordings([rec({ vid: undefined })], [ev({})])
    expect(row.moments).toEqual([])
  })
})

describe('matchesFilter', () => {
  const [clicked] = joinRecordings(
    [rec({ pages: ['/funding', '/jobs'] })],
    [ev({ page: 'Jobs' })]
  )
  it('left without clicking: anywhere, or on the page picked', () => {
    expect(matchesFilter(clicked, 'noclick')).toBe(false)
    expect(matchesFilter(clicked, 'noclick', '/funding')).toBe(true)
    expect(matchesFilter(clicked, 'noclick', '/jobs')).toBe(false)
  })
  it('a page filter needs the visit to have been there', () => {
    expect(matchesFilter(clicked, 'all', '/map')).toBe(false)
    expect(matchesFilter(clicked, 'all', '/jobs')).toBe(true)
  })
  it('names pages the way listing clicks do', () => {
    expect(pageName('/funding')).toBe('Funding')
    expect(pageName('/')).toBe('Home')
  })
})
