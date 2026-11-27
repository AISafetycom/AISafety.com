import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/admin/newsletter/changes, the newsletter page's Fix button,
// with the session and the fix itself replaced: what the route hands on
// (the fingerprint the page sent, and whose request it is), and what it
// answers when the Queue refuses.

const h = vi.hoisted(() => ({
  email: 'Bryce@Example.org' as string | null,
  queue: true,
  calls: [] as { args: unknown[]; as: string | null }[],
  fail: null as Error | null,
}))

vi.mock('@/lib/admin/auth', () => ({
  canViewNewsletter: async () => true,
  canSendNewsletter: async () => true,
  canReviewQueue: async () => h.queue,
  currentAdmin: async () =>
    h.email ? { name: 'Bryce', email: h.email } : null,
}))
vi.mock('@/lib/admin/newsletter', () => ({
  DraftProblemError: class DraftProblemError extends Error {
    problems: string[] = []
  },
  isNewsletterConfigured: () => true,
}))
vi.mock('@/lib/admin/queue', () => ({
  QueueError: class QueueError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/admin/newsletter-changes', async () => {
  const { actorEmail } = await import('@/lib/admin/queue-actor')
  return {
    draftListingAlerts: vi.fn(async () => []),
    fixListing: async (...args: unknown[]) => {
      // Whose request it runs in: the address a History entry written
      // inside would carry (queue-actor.ts).
      h.calls.push({ args, as: actorEmail() })
      if (h.fail) throw h.fail
      return {
        cards: [],
        alerts: [],
        applied: true,
        cardUpdated: false,
        note: null,
      }
    },
  }
})

import { POST } from './route'
import { QueueError } from '@/lib/admin/queue'

const KEY = 'recLISTING0000001'
const ROW = 'recBROOMROW000001'
const SHOWN = 'a'.repeat(64)

function post(
  body: Record<string, unknown>,
  headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Sec-Fetch-Site': 'same-origin',
  }
) {
  return POST(
    new NextRequest('http://localhost/api/admin/newsletter/changes', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  h.email = 'Bryce@Example.org'
  h.queue = true
  h.calls = []
  h.fail = null
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('the newsletter page’s Fix', () => {
  it('hands on what the page showed, in the name of whoever pressed it', async () => {
    const res = await post({
      campaign: '12',
      key: KEY,
      queue: ROW,
      shown: SHOWN,
    })
    expect(res.status).toBe(200)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].args).toEqual(['12', KEY, ROW, undefined, 'Bryce', SHOWN])
    // The address, as the Mac compares it: lowercased.
    expect(h.calls[0].as).toBe('bryce@example.org')
  })

  it('hands on nothing when the page sent nothing, for the Queue to refuse', async () => {
    await post({ campaign: '12', key: KEY, queue: ROW })
    expect(h.calls[0].args[5]).toBeUndefined()
  })

  it('answers 412 in the Queue’s own words when the row changed', async () => {
    h.fail = new QueueError(
      'The changes are not what your page showed: they changed after it read them.',
      412
    )
    const res = await post({
      campaign: '12',
      key: KEY,
      queue: ROW,
      shown: SHOWN,
    })
    expect(res.status).toBe(412)
    expect(await res.json()).toEqual({
      error:
        'The changes are not what your page showed: they changed after it read them.',
    })
  })

  it('still needs Queue access to apply a Broom item', async () => {
    h.queue = false
    const res = await post({
      campaign: '12',
      key: KEY,
      queue: ROW,
      shown: SHOWN,
    })
    expect(res.status).toBe(401)
    expect(h.calls).toEqual([])
  })

  it('refuses a request from another site before anything runs', async () => {
    const res = await post(
      { campaign: '12', key: KEY, queue: ROW, shown: SHOWN },
      { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-site' }
    )
    expect(res.status).toBe(403)
    expect(h.calls).toEqual([])
  })

  it('rewrites a card with no Broom item without one', async () => {
    const res = await post({ campaign: '12', key: KEY })
    expect(res.status).toBe(200)
    expect(h.calls[0].args.slice(0, 3)).toEqual(['12', KEY, null])
  })
})
