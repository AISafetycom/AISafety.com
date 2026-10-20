import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { StoredTurn } from '@/lib/assistant/conversation-store'

// POST /api/assistant with the model, the catalog and the log stubbed: what
// time the conversation log gets for a turn. The log orders a conversation's
// turns by that time (placeTurn), so it must be when the message ARRIVED,
// not when the slow setup before the model call finished.

const h = vi.hoisted(() => ({
  clock: 0,
  pending: [] as Promise<unknown>[],
  turns: [] as unknown[],
}))

vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: Promise<unknown>) => void h.pending.push(task),
}))
vi.mock('@/lib/admin/auth', () => ({ isAdmin: async () => false }))
vi.mock('@/lib/assistant/rate-limit', () => ({
  checkAssistantRateLimit: async () => ({ ok: true }),
  getClientIp: () => '203.0.113.7',
}))
// A cold instance: the catalog takes 5 s to load.
vi.mock('@/lib/assistant/catalog', () => ({
  getCatalog: async () => {
    h.clock += 5_000
    return { listings: [] }
  },
}))
vi.mock('@/lib/assistant/page-dates', () => ({
  getPageLastUpdatedDates: async () => ({}),
}))
vi.mock('@/lib/assistant/donation-guide', () => ({
  getDonationGuideText: async () => '',
}))
vi.mock('@/lib/assistant/conversation-store', () => ({
  INTERNAL_TAG: 'internal',
  storeConversationTurn: async (turn: unknown) => void h.turns.push(turn),
}))
// The model answers in 2 s.
vi.mock('@/lib/assistant/stream', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/assistant/stream')>()),
  runAssistantStream: async () => {
    h.clock += 2_000
    return {
      assistantText: 'Try the training page.',
      toolCalls: [],
      citations: [],
      fallbackCardIds: [],
    }
  },
}))

import { POST } from './route'

const ARRIVED = Date.UTC(2026, 9, 9, 12, 0, 0)

beforeEach(() => {
  h.clock = ARRIVED
  h.pending = []
  h.turns = []
  vi.spyOn(Date, 'now').mockImplementation(() => h.clock)
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('POST /api/assistant conversation log', () => {
  it('stamps the turn when the message arrived, before the slow setup', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/assistant', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'route-test-session',
          messages: [{ role: 'user', content: 'Any courses?' }],
          currentPage: '/training',
        }),
      })
    )
    // Run the stream to the end, then let the log write settle.
    await res.text()
    await Promise.all(h.pending)

    expect(h.turns).toHaveLength(1)
    const turn = h.turns[0] as StoredTurn
    expect(turn.ts).toBe(new Date(ARRIVED).toISOString())
    // Latency still measures the model call alone.
    expect(turn.latencyMs).toBe(2_000)
  })
})
