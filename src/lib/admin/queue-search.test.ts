import { describe, expect, it } from 'vitest'

import type { QueueItem } from './queue'
import {
  itemParts,
  markRanges,
  matchDoc,
  parseQuery,
  searchDoc,
  textsOf,
} from './queue-search'

const rid = (n: string) => `rec${n.padStart(14, '0')}`

function item(over: Partial<QueueItem>): QueueItem {
  return {
    id: rid('q1'),
    createdAt: '2026-09-17T00:00:00.000Z',
    title: 'PauseAI South Korea',
    type: 'Add',
    source: 'Comb',
    status: 'Pending',
    page: '/events',
    targetTable: 'tblAAAAAAAAAAAAAA',
    targetRecord: rid('live'),
    issueRow: null,
    sourceLink: null,
    sourceExcerpt: null,
    logo: null,
    fields: {
      Name: 'PauseAI South Korea',
      URL: 'https://luma.com/pauseai-smi8',
      Description: 'Casual session in Zürich for people concerned about AI.',
      Type: ['Meetup'],
      'Publish?': false,
    },
    name: 'PauseAI South Korea',
    url: 'https://luma.com/pauseai-smi8',
    changes: [],
    diff: null,
    summary: null,
    appliesTo: null,
    verdict: 'Publish',
    reasons: ['Fits the events page: an in-person meetup on AI risk.'],
    rejectChips: [],
    replyDraft: null,
    replyStatus: null,
    saidBy: null,
    replyTo: null,
    rejectReason: null,
    note: null,
    edits: null,
    decidedAt: null,
    appliedAt: null,
    error: null,
    ...over,
  }
}

function hit(i: QueueItem, query: string) {
  const doc = searchDoc(
    itemParts(i, { title: i.name ?? i.title, heading: i.title, page: i.page }),
    [i.id, i.targetRecord ?? '']
  )
  const q = parseQuery(query)
  if (!q) throw new Error('empty query')
  return matchDoc(doc, q)
}

describe('parseQuery', () => {
  it('is null for an empty box and folds each word once', () => {
    expect(parseQuery('')).toBeNull()
    expect(parseQuery('   ')).toBeNull()
    expect(parseQuery('  Zürich  zurich AI ')?.words).toEqual(['zurich', 'ai'])
  })
})

describe('matchDoc', () => {
  it('finds a word at the start of a word, in any case, accents aside', () => {
    expect(hit(item({}), 'pause')).not.toBeNull()
    expect(hit(item({}), 'KOREA')).not.toBeNull()
    expect(hit(item({}), 'zurich')).not.toBeNull()
    expect(hit(item({}), 'zür')).not.toBeNull()
    // "ai" starts no word here except "AI" itself; "sai" starts none.
    expect(hit(item({}), 'sai')).toBeNull()
  })

  it('needs every word, each found anywhere', () => {
    expect(hit(item({}), 'pause meetup')).not.toBeNull()
    expect(hit(item({}), 'pause jobs')).toBeNull()
  })

  it('puts a match in the name ahead of one elsewhere', () => {
    expect(hit(item({}), 'pause korea')?.inName).toBe(true)
    expect(hit(item({}), 'pause meetup')?.inName).toBe(false)
    expect(hit(item({}), 'events')?.inName).toBe(false)
    const i = item({})
    expect(hit(i, `pause ${i.id}`)?.inName).toBe(true)
  })

  it('finds the page and the verdict, which the row shows already', () => {
    expect(hit(item({}), '/events')?.excerpt).toBeNull()
    expect(hit(item({}), 'events')?.excerpt).toBeNull()
    expect(hit(item({}), 'publish')?.excerpt).toBeNull()
    expect(hit(item({}), '/jobs')).toBeNull()
  })

  it('gives an excerpt when a word is found off the row', () => {
    const h = hit(item({}), 'pause casual')
    expect(h?.excerpt?.label).toBe('Description')
    expect(h?.excerpt?.text).toMatch(/^Casual session/)
    expect(h?.excerpt?.marks).toEqual([[0, 6]])
    expect(hit(item({}), 'risk')?.excerpt?.label).toBe('Fable')
  })

  it('searches a Change by its field and both values', () => {
    const change = item({
      type: 'Change',
      source: 'Broom',
      title: 'Apart Research: deadline has passed',
      name: 'Apart Research',
      fields: null,
      changes: [
        { field: 'Deadline', from: '2026-09-01', to: '2026-10-15' },
        { field: 'Location', from: 'London, UK', to: 'Berlin, Germany' },
      ],
    })
    expect(hit(change, 'berlin')?.excerpt?.label).toBe('Location')
    expect(hit(change, 'london')?.excerpt?.label).toBe('Location (now)')
    expect(hit(change, 'deadline')?.excerpt?.label).toBe('Finding')
    expect(hit(change, 'apart')?.excerpt).toBeNull()
  })

  it('finds the sender of a request and the edits already made', () => {
    const request = item({
      source: 'Discord',
      saidBy: {
        name: 'Mick Zijdel',
        handle: 'harhux',
        when: null,
        how: null,
        where: null,
        avatar: null,
      },
      sourceExcerpt: 'Could you add our reading group?',
      edits: { Name: 'Reading group Utrecht' },
    })
    expect(hit(request, 'harhux')?.excerpt?.label).toBe('From')
    expect(hit(request, 'reading')?.excerpt?.label).toBe('Name')
    expect(hit(request, 'utrecht')).not.toBeNull()
    expect(hit(request, 'could')?.excerpt?.label).toBe('Message')
  })

  it('reads the source text the way the page words it', () => {
    const comb = item({
      sourceExcerpt:
        'BlueDot Slack #05, posted 7 September 2026 00:06 UTC+01:00',
    })
    const doc = searchDoc(
      itemParts(comb, {
        title: comb.title,
        heading: comb.title,
        page: comb.page,
        source: 'BlueDot Slack #05, posted 7 September 2026',
      }),
      [comb.id]
    )
    const found = matchDoc(doc, parseQuery('bluedot')!)
    expect(found?.excerpt?.label).toBe('Found')
    expect(found?.excerpt?.text).toBe(
      'BlueDot Slack #05, posted 7 September 2026'
    )
    expect(matchDoc(doc, parseQuery('utc')!)).toBeNull()
  })

  it('matches a record id only in full', () => {
    const i = item({})
    expect(hit(i, i.id)).not.toBeNull()
    expect(hit(i, rid('live'))).not.toBeNull()
    expect(hit(i, rid('other'))).toBeNull()
    // A bare "rec" is an ordinary word, found nowhere here.
    expect(hit(i, 'rec')).toBeNull()
  })
})

describe('markRanges', () => {
  it('marks each match, merging overlaps', () => {
    expect(markRanges('PauseAI South Korea', ['pause', 'so'])).toEqual([
      [0, 5],
      [8, 10],
    ])
    expect(markRanges('Pause pause', ['pau', 'pause'])).toEqual([
      [0, 5],
      [6, 11],
    ])
    expect(markRanges('Anything', [])).toEqual([])
  })

  it('marks the original characters when accents are folded', () => {
    expect(markRanges('Café Zürich', ['zurich'])).toEqual([[5, 11]])
    // Decomposed input: the accent is its own code unit, and stays marked.
    const text = 'Zu\u0308rich'
    expect(markRanges(text, ['zurich'])).toEqual([[0, text.length]])
  })
})

describe('textsOf', () => {
  it('reads text, numbers, lists and file names, not ticks', () => {
    expect(textsOf(' ')).toEqual([])
    expect(textsOf(['Course', 'Online'])).toEqual(['Course', 'Online'])
    expect(textsOf(42)).toEqual(['42'])
    expect(textsOf(true)).toEqual([])
    expect(textsOf([{ url: 'https://x', filename: 'logo.png' }])).toEqual([
      'logo.png',
    ])
  })
})
