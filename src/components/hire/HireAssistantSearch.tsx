'use client'

import { useCallback, useRef } from 'react'
import Icon from '@/components/Icon'
import ChatBody from '@/components/assistant/ChatBody'
import {
  deriveHireResult,
  type HireAssistantResult,
} from '@/lib/assistant/hire-result'
import type { CitationRef } from '@/lib/assistant/types'
import styles from './HireAssistantSearch.module.css'

export type { HireAssistantResult }

const SUGGESTED_QUERIES = [
  'Interpretability researchers in Europe',
  'Open to full-time roles',
  'Referred by MATS mentors',
]

interface HireAssistantSearchProps {
  /** Fires with the latest result as tool calls resolve, and with `null`
   *  right when a new question is sent (so the grid falls back to the
   *  regular filters instead of showing the previous answer's results while
   *  the new one streams in). */
  onResult?: (result: HireAssistantResult | null) => void
}

// Embedded, page-scoped instance of the shared chat engine (ChatBody is also
// what powers the floating assistant widget) — a chromeless search box
// instead of the widget's floating panel. It shares the same /api/assistant
// endpoint and rate limit as the widget (see src/lib/assistant/rate-limit.ts)
// rather than a separate budget.
//
// Simplification vs. the floating widget (Assistant.tsx): this box doesn't
// send a sessionId, geo fallback, or UTM capture, so its turns won't group
// into a session or carry geo/campaign context in the admin conversation
// log the way widget turns do. Fine for a first version; worth revisiting
// if that context turns out to matter for /hire specifically.
export default function HireAssistantSearch({
  onResult,
}: HireAssistantSearchProps) {
  const buildBodyExtras = useCallback(
    () => ({
      currentPage: '/hire',
    }),
    []
  )

  // Each qualifying candidate search this turn becomes one "round" (only its
  // newly-seen candidates — see seenIdsRef), in call order; deriveHireResult
  // treats the first round as the primary tier and later rounds as the
  // folded "other" tier. Both reset on each new send.
  const roundsRef = useRef<CitationRef[][]>([])
  const seenIdsRef = useRef<Set<string>>(new Set())

  const handleUserSend = useCallback(() => {
    roundsRef.current = []
    seenIdsRef.current = new Set()
    onResult?.(null)
  }, [onResult])

  const handleToolResult = useCallback(
    (
      _name: string,
      input: Record<string, unknown>,
      listings: CitationRef[],
      ok: boolean
    ) => {
      if (!ok) return
      const candidateListings = listings.filter(l => l.type === 'candidate')
      // A search_listings call explicitly scoped to candidates that came back
      // empty is still meaningful (it's the "no exact match" case) — surface
      // it. A call for some other type that just happens to carry no
      // candidates isn't, so it's left alone rather than clearing the grid.
      if (candidateListings.length === 0 && input.type !== 'candidate') return
      const newInRound = candidateListings.filter(
        l => !seenIdsRef.current.has(l.id)
      )
      for (const l of newInRound) seenIdsRef.current.add(l.id)
      roundsRef.current = [...roundsRef.current, newInRound]
      onResult?.(deriveHireResult(roundsRef.current))
    },
    [onResult]
  )

  return (
    <div className="padding-bottom-40px">
      <p
        className={`paragraph-small color-teal-300 padding-bottom-8px ${styles.label}`}
      >
        <Icon src="/images/icons/search.svg" />
        Ask the assistant to find people for you
      </p>
      <div className={styles.box}>
        <ChatBody
          endpoint="/api/assistant"
          bodyExtras={buildBodyExtras}
          chips={SUGGESTED_QUERIES}
          placeholder='e.g. "Who is building evals for agents and open to full-time work?"'
          storageKey="aisafety-hire-search-v1"
          onUserSend={handleUserSend}
          onToolResult={handleToolResult}
        />
      </div>
    </div>
  )
}
