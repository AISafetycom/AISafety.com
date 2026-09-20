'use client'

import { useEffect, useMemo, useState } from 'react'
import CandidateCard from '@/components/CandidateCard'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import Icon from '@/components/Icon'
import { setPageContext } from '@/lib/assistant/page-context'
import { setAssistantPanelSlot } from '@/lib/assistant/panel-slot'
import {
  ASSISTANT_TOOL_EVENT,
  askAssistant,
  type AssistantToolDetail,
} from '@/lib/assistant/page-events'
import {
  EMPTY_PEOPLE_FILTERS,
  PEOPLE_FILTER_KEYS,
  PEOPLE_FILTER_LABELS,
  matchesPeopleFilters,
  peopleFilterOptions,
  sanitizePeopleFilters,
  type PeopleFilterKey,
  type PeopleFilters,
} from '@/lib/people-filters'
import type { Person } from '@/lib/data/people'
import styles from './page.module.css'

const TRACKING_PAGE = 'Hire'

// Example questions under the hero field. Each one is a full message:
// clicking sends it to the chatbot as if typed.
const PROMPT_IDEAS = [
  'Interpretability researchers in Europe',
  'Open to full-time roles',
  'Referred by MATS mentors',
]

interface HireClientProps {
  people: Person[]
}

export default function HireClient({ people }: HireClientProps) {
  const [filters, setFilters] = useState<PeopleFilters>(EMPTY_PEOPLE_FILTERS)
  const options = useMemo(() => peopleFilterOptions(people), [people])
  const [question, setQuestion] = useState('')

  // Faceted counts like the other listing pages: a dropdown's numbers ignore
  // that dropdown's own selection but respect every other one.
  const { filtered, counts } = useMemo(() => {
    const countBy = (
      key: PeopleFilterKey,
      extract: (p: Person) => readonly string[]
    ) => {
      const out: Record<string, number> = {}
      for (const p of people) {
        if (!matchesPeopleFilters(p, filters, key)) continue
        for (const value of extract(p)) out[value] = (out[value] || 0) + 1
      }
      return out
    }
    return {
      filtered: people.filter(p => matchesPeopleFilters(p, filters)),
      counts: {
        focus: countBy('focus', p => p.focusAreas),
        hours: countBy('hours', p => (p.hoursBucket ? [p.hoursBucket] : [])),
        region: countBy('region', p => [p.region]),
        track: countBy('track', p => p.track),
      },
    }
  }, [people, filters])

  const toggle = (key: PeopleFilterKey, value: string) =>
    setFilters(current => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter(v => v !== value)
        : [...current[key], value],
    }))

  // Publish the current filters so the chatbot sees them as page state (and
  // can tell the visitor what the list already shows).
  useEffect(() => {
    const state: Record<string, unknown> = {}
    for (const key of PEOPLE_FILTER_KEYS) {
      if (filters[key].length) state[key] = filters[key]
    }
    setPageContext({
      page: '/hire',
      filters: Object.keys(state).length > 0 ? state : undefined,
    })
    return () => setPageContext(null)
  }, [filters])

  // The other direction: when the chatbot's set_page_filters tool runs for
  // this page, apply it to the pills. Keys it doesn't mention are left alone.
  useEffect(() => {
    const onTool = (e: Event) => {
      const detail = (e as CustomEvent<AssistantToolDetail>).detail
      if (!detail || detail.name !== 'set_page_filters' || !detail.ok) return
      if (detail.input.page && detail.input.page !== '/hire') return
      const next = sanitizePeopleFilters(
        detail.input.filters as Record<string, unknown> | undefined,
        options
      )
      if (Object.keys(next).length === 0) return
      setFilters(current => ({ ...current, ...next }))
    }
    window.addEventListener(ASSISTANT_TOOL_EVENT, onTool)
    return () => window.removeEventListener(ASSISTANT_TOOL_EVENT, onTool)
  }, [options])

  const anyFilterActive = PEOPLE_FILTER_KEYS.some(k => filters[k].length > 0)

  // The same pills twice: above the list, and inside the chatbot's expanded
  // panel (whose scrim covers the page). Both read and write this
  // component's state, so a change in either place, or by the assistant's
  // tool, shows up in both.
  const renderFilterBar = (inPanel: boolean) => {
    const popover = inPanel ? 'absolute' : 'fixed'
    return (
      <FilterBar
        count={filtered.length}
        noun="person"
        label={`${filtered.length} ${filtered.length === 1 ? 'person' : 'people'}`}
        compact={inPanel}
      >
        {PEOPLE_FILTER_KEYS.map(key => (
          <FilterDropdown
            key={key}
            trackingPage={TRACKING_PAGE}
            title={PEOPLE_FILTER_LABELS[key]}
            options={options[key]}
            selected={filters[key]}
            counts={counts[key]}
            onToggle={v => toggle(key, v)}
            popover={popover}
          />
        ))}
      </FilterBar>
    )
  }

  const panelFilterBar = renderFilterBar(true)
  useEffect(() => {
    setAssistantPanelSlot(panelFilterBar)
    return () => setAssistantPanelSlot(null)
  }, [panelFilterBar])

  function ask(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    askAssistant({ message: trimmed, expand: true })
    setQuestion('')
  }

  return (
    <>
      <section
        className="width-8-col margin-bottom-56px"
        aria-label="Ask the assistant to find people"
      >
        <div className="flex items-center gap-8px padding-bottom-12px">
          <Icon
            src="/images/icons/chat.svg"
            className="color-teal-bright-300"
          />
          <p className="paragraph-small color-white">
            Describe your ideal candidate and let our chatbot find the right
            people
          </p>
        </div>
        {/* Enter submits; there is no separate send button in the design. */}
        <form
          className="flex items-center"
          onSubmit={e => {
            e.preventDefault()
            ask(question)
          }}
        >
          <div className={styles.askFieldWrap}>
            <Icon
              src="/images/icons/magnifying-glass.svg"
              className={`color-teal-400 ${styles.askIcon}`}
            />
            <input
              type="text"
              className={`text-field ${styles.askField}`}
              placeholder='e.g. "Who is building evals for agents and open to full-time work?"'
              value={question}
              onChange={e => setQuestion(e.target.value)}
              aria-label="Describe your ideal candidate"
              maxLength={4000}
            />
          </div>
        </form>
        <div className="flex flex-wrap gap-8px padding-top-12px">
          {PROMPT_IDEAS.map(idea => (
            <button
              key={idea}
              type="button"
              className="button-secondary"
              onClick={() => ask(idea)}
            >
              {idea}
            </button>
          ))}
        </div>
      </section>

      {renderFilterBar(false)}

      <div className="flex flex-col gap-40px padding-bottom-80px">
        {filtered.map(person => (
          <CandidateCard key={person.id} person={person} />
        ))}
        {filtered.length === 0 && (
          <p className="paragraph-small color-teal-300">
            {anyFilterActive
              ? 'No one matches these filters. Try removing one, or ask the assistant above.'
              : 'No profiles listed yet.'}
          </p>
        )}
      </div>
    </>
  )
}
