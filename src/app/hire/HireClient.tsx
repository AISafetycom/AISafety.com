'use client'

import { useEffect, useMemo, useState } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import Icon from '@/components/Icon'
import CandidateCard from '@/components/hire/CandidateCard'
import HireAssistantSearch, {
  type HireAssistantResult,
} from '@/components/hire/HireAssistantSearch'
import { Candidate, KNOWN_FOCUS_AREAS } from '@/lib/data/hire'
import { placementsById } from '@/lib/placements'
import { setPageContext } from '@/lib/assistant/page-context'
import { filterItems, optionCounts } from '@/lib/filter-counts'
import styles from './HireClient.module.css'

interface HireClientProps {
  candidates: Candidate[]
}

const availabilityOptions = ['Open to full-time roles', 'Available now']

const allPass = () => true

export default function HireClient({ candidates }: HireClientProps) {
  const [selectedFocus, setSelectedFocus] = useState<string[]>([])
  const [selectedAvailability, setSelectedAvailability] = useState<string[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  // Result of the question currently showing in the assistant search box
  // (src/components/hire/HireAssistantSearch.tsx), built from the actual
  // candidate listings its tool calls returned. While set, it takes over the
  // grid and the Focus/Location checkboxes below instead of the manual
  // filters — touching a filter (toggleFilter) exits back to manual mode.
  const [assistantResult, setAssistantResult] =
    useState<HireAssistantResult | null>(null)
  // Whether the folded "other" tier (assistantResult.otherCandidateIds) is
  // expanded. Reset to collapsed each time a new question is sent (see
  // handleAssistantResult), so every answer starts folded.
  const [showOthers, setShowOthers] = useState(false)

  const handleAssistantResult = (result: HireAssistantResult | null) => {
    if (result === null) setShowOthers(false)
    setAssistantResult(result)
  }

  const candidateById = useMemo(
    () => new Map(candidates.map(c => [c.id, c])),
    [candidates]
  )

  const focusOptions = useMemo(() => {
    const present = new Set(candidates.flatMap(c => c.focusAreas))
    const known = KNOWN_FOCUS_AREAS.filter(a => present.has(a))
    const other = [...present].filter(
      a => !(KNOWN_FOCUS_AREAS as readonly string[]).includes(a)
    )
    return [...known, ...other.sort()]
  }, [candidates])

  const countryOptions = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of candidates) counts[c.country] = (counts[c.country] || 0) + 1
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])
  }, [candidates])

  const skillOptions = useMemo(() => {
    const present = new Set(
      candidates.flatMap(c => c.projects.flatMap(p => p.categories))
    )
    return [...present].sort()
  }, [candidates])

  const groups = useMemo(
    () => ({
      focus: {
        selected: selectedFocus,
        matches: (candidate: Candidate, value: string) =>
          candidate.focusAreas.includes(value),
      },
      availability: {
        selected: selectedAvailability,
        matches: (candidate: Candidate, value: string) =>
          value === 'Open to full-time roles'
            ? candidate.openToFullTime
            : candidate.availability.hasCapacity,
      },
      country: {
        selected: selectedCountries,
        matches: (candidate: Candidate, value: string) =>
          candidate.country === value,
      },
      skill: {
        selected: selectedSkills,
        matches: (candidate: Candidate, value: string) =>
          candidate.projects.some(p => p.categories.includes(value)),
      },
    }),
    [selectedFocus, selectedAvailability, selectedCountries, selectedSkills]
  )

  const filteredCandidates = useMemo(
    () => filterItems(candidates, allPass, groups),
    [candidates, groups]
  )

  const focusCounts = useMemo(
    () =>
      optionCounts(
        filterItems(candidates, allPass, groups, 'focus'),
        focusOptions,
        groups.focus.matches
      ),
    [candidates, groups, focusOptions]
  )

  const availabilityCounts = useMemo(
    () =>
      optionCounts(
        filterItems(candidates, allPass, groups, 'availability'),
        availabilityOptions,
        groups.availability.matches
      ),
    [candidates, groups]
  )

  const countryCounts = useMemo(
    () =>
      optionCounts(
        filterItems(candidates, allPass, groups, 'country'),
        countryOptions,
        groups.country.matches
      ),
    [candidates, groups, countryOptions]
  )

  const skillCounts = useMemo(
    () =>
      optionCounts(
        filterItems(candidates, allPass, groups, 'skill'),
        skillOptions,
        groups.skill.matches
      ),
    [candidates, groups, skillOptions]
  )

  const toggleFilter = (
    value: string,
    current: string[],
    setter: (v: string[]) => void
  ) => {
    // Touching a filter by hand exits the assistant's result view and hands
    // control back to the manual filters, which were untouched underneath it.
    setAssistantResult(null)
    if (current.includes(value)) {
      setter(current.filter(v => v !== value))
    } else {
      setter([...current, value])
    }
  }

  // While the assistant view is active, the primary tier (its first,
  // most-on-target search this turn) floats to the top; anything only found
  // by a later, broadened search folds under "Show N more" instead of mixing
  // in — see HireAssistantSearch/hire-result.ts. An explicitly empty result
  // (nothing found even after broadening) falls back to the manual list
  // instead of a blank grid.
  const activeResult =
    assistantResult && assistantResult.primaryCandidateIds.length > 0
      ? assistantResult
      : null

  const { primaryCandidates, otherCandidates } = useMemo(() => {
    const idsToCandidates = (ids: string[]) =>
      ids
        .map(id => candidateById.get(id))
        .filter((c): c is Candidate => Boolean(c))
    return activeResult
      ? {
          primaryCandidates: idsToCandidates(activeResult.primaryCandidateIds),
          otherCandidates: idsToCandidates(activeResult.otherCandidateIds),
        }
      : { primaryCandidates: filteredCandidates, otherCandidates: [] }
  }, [activeResult, candidateById, filteredCandidates])

  // Built from what's actually displayed, so a slot number always matches
  // what the visitor saw — including while the assistant view reorders them.
  const placements = useMemo(
    () => placementsById([...primaryCandidates, ...otherCandidates]),
    [primaryCandidates, otherCandidates]
  )

  // Publish current filter state for the assistant to read.
  useEffect(() => {
    const state: Record<string, unknown> = {}
    if (selectedFocus.length) state.focusAreas = selectedFocus
    if (selectedAvailability.length) state.availability = selectedAvailability
    if (selectedCountries.length) state.countries = selectedCountries
    if (selectedSkills.length) state.skills = selectedSkills
    setPageContext({
      page: '/hire',
      filters: Object.keys(state).length > 0 ? state : undefined,
    })
    return () => setPageContext(null)
  }, [selectedFocus, selectedAvailability, selectedCountries, selectedSkills])

  return (
    <>
      <HireAssistantSearch onResult={handleAssistantResult} />

      <FilterBar
        count={primaryCandidates.length}
        noun="person"
        label={`${primaryCandidates.length} ${primaryCandidates.length === 1 ? 'person' : 'people'}`}
      >
        <FilterDropdown
          trackingPage="Hire"
          title="Focus"
          icon="/images/icons/wrench.svg"
          options={focusOptions}
          selected={activeResult ? activeResult.focusAreas : selectedFocus}
          counts={focusCounts}
          onToggle={v => toggleFilter(v, selectedFocus, setSelectedFocus)}
        />
        <FilterDropdown
          trackingPage="Hire"
          title="Availability"
          icon="/images/icons/timer.svg"
          options={availabilityOptions}
          selected={selectedAvailability}
          counts={availabilityCounts}
          onToggle={v =>
            toggleFilter(v, selectedAvailability, setSelectedAvailability)
          }
        />
        <FilterDropdown
          trackingPage="Hire"
          title="Location"
          icon="/images/icons/pin.svg"
          options={countryOptions}
          selected={activeResult ? activeResult.countries : selectedCountries}
          counts={countryCounts}
          onToggle={v =>
            toggleFilter(v, selectedCountries, setSelectedCountries)
          }
        />
        <FilterDropdown
          trackingPage="Hire"
          title="Skills"
          icon="/images/icons/briefcase.svg"
          options={skillOptions}
          selected={selectedSkills}
          counts={skillCounts}
          onToggle={v => toggleFilter(v, selectedSkills, setSelectedSkills)}
        />
      </FilterBar>

      {assistantResult && (
        <div className="flex items-center justify-between padding-bottom-24px">
          <p className="paragraph-small color-teal-300">
            {activeResult
              ? 'Showing the people the assistant found.'
              : "The assistant didn't find an exact match — showing everyone below."}
          </p>
          <button
            type="button"
            className="paragraph-xs-bold color-light-teal"
            onClick={() => setAssistantResult(null)}
          >
            Clear
          </button>
        </div>
      )}

      <div
        className={`flex flex-col gap-24px${activeResult && otherCandidates.length > 0 ? '' : ' padding-bottom-40px'}`}
      >
        {primaryCandidates.map(candidate => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            placement={placements.get(candidate.id)}
          />
        ))}
        {primaryCandidates.length === 0 && (
          <p className="paragraph-small color-teal-300">Nothing found.</p>
        )}
      </div>

      {activeResult && otherCandidates.length > 0 && (
        <div className="padding-top-24px padding-bottom-40px">
          <button
            type="button"
            className={`paragraph-small-bold ${styles.othersToggle}`}
            onClick={() => setShowOthers(o => !o)}
            aria-expanded={showOthers}
          >
            <span>
              {showOthers ? 'Hide' : 'Show'} {otherCandidates.length} more{' '}
              {otherCandidates.length === 1 ? 'person' : 'people'} outside this
              search
            </span>
            <Icon
              src="/images/icons/chevron-down.svg"
              size={16}
              className={`${styles.othersChevron} ${showOthers ? styles.othersChevronOpen : ''}`}
            />
          </button>
          {showOthers && (
            <div className="flex flex-col gap-24px padding-top-24px">
              {otherCandidates.map(candidate => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  placement={placements.get(candidate.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
