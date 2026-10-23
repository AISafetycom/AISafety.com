'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ListingCard from '@/components/ListingCard'
import { advisorCardProps } from './card'
import ContributeButtons from '@/components/ContributeButtons'
import { Advisor } from '@/lib/data/advisors'
import { APPLICATIONS, FOCUS_AREAS, WHO_ITS_FOR } from '@/lib/advisor-meta'
import { filterItems, optionCounts } from '@/lib/filter-counts'
import { gridListings, placementsById } from '@/lib/placements'

interface AdvisorsClientProps {
  advisors: Advisor[]
}

const whoOptions = [...WHO_ITS_FOR]
const focusOptions = [...FOCUS_AREAS]
const applicationsOptions = [...APPLICATIONS]

const allPass = () => true

export default function AdvisorsClient({ advisors }: AdvisorsClientProps) {
  const [whoFilters, setWhoFilters] = useState<string[]>([])
  const [focusFilters, setFocusFilters] = useState<string[]>([])
  const [applicationsFilters, setApplicationsFilters] = useState<string[]>([])

  // Each advisor's slot in the full page order, stamped onto a click so the
  // dashboard can tie clicks to page position even after later reordering.
  const placements = useMemo(() => placementsById(advisors), [advisors])

  const groups = useMemo(
    () => ({
      who: {
        selected: whoFilters,
        matches: (advisor: Advisor, value: string) =>
          advisor.whoItsFor.includes(value),
      },
      focus: {
        selected: focusFilters,
        matches: (advisor: Advisor, value: string) =>
          advisor.focusAreas.includes(value),
      },
      applications: {
        selected: applicationsFilters,
        matches: (advisor: Advisor, value: string) =>
          advisor.applications === value,
      },
    }),
    [whoFilters, focusFilters, applicationsFilters]
  )

  const filteredAdvisors = useMemo(
    () => filterItems(advisors, allPass, groups),
    [advisors, groups]
  )

  const filterCounts = useMemo(
    () => ({
      who: optionCounts(
        filterItems(advisors, allPass, groups, 'who'),
        whoOptions,
        groups.who.matches
      ),
      focus: optionCounts(
        filterItems(advisors, allPass, groups, 'focus'),
        focusOptions,
        groups.focus.matches
      ),
      applications: optionCounts(
        filterItems(advisors, allPass, groups, 'applications'),
        applicationsOptions,
        groups.applications.matches
      ),
    }),
    [advisors, groups]
  )

  const savedScrollY = useRef<number | null>(null)

  const toggleFilter = (
    value: string,
    current: string[],
    setter: (v: string[]) => void
  ) => {
    savedScrollY.current = window.scrollY
    setter(
      current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value]
    )
  }

  useLayoutEffect(() => {
    if (savedScrollY.current !== null) {
      window.scrollTo(0, savedScrollY.current)
      savedScrollY.current = null
    }
  }, [filteredAdvisors])

  // Featured advisors show in the grid only once a filter is on; unfiltered,
  // the featured row above already has them.
  const filtering =
    whoFilters.length > 0 ||
    focusFilters.length > 0 ||
    applicationsFilters.length > 0
  const gridAdvisors = gridListings(filteredAdvisors, placements, filtering)

  return (
    <>
      <FilterBar count={filteredAdvisors.length} noun="advisor">
        <FilterDropdown
          trackingPage="Advisors"
          title="Who it's for"
          icon="/images/icons/team.svg"
          options={whoOptions}
          selected={whoFilters}
          counts={filterCounts.who}
          onToggle={v => toggleFilter(v, whoFilters, setWhoFilters)}
        />
        <FilterDropdown
          trackingPage="Advisors"
          title="Focus"
          icon="/images/icons/target.svg"
          options={focusOptions}
          selected={focusFilters}
          counts={filterCounts.focus}
          onToggle={v => toggleFilter(v, focusFilters, setFocusFilters)}
        />
        <FilterDropdown
          trackingPage="Advisors"
          title="Applications"
          icon="/images/icons/paper.svg"
          options={applicationsOptions}
          selected={applicationsFilters}
          counts={filterCounts.applications}
          onToggle={v =>
            toggleFilter(v, applicationsFilters, setApplicationsFilters)
          }
        />
      </FilterBar>

      <div className="flex gap-56px">
        <div className="collection-list padding-bottom-40px width-9-col">
          {gridAdvisors.map(advisor => (
            <ListingCard
              key={advisor.id}
              {...advisorCardProps(advisor)}
              trackingPage="Advisors"
              listingId={advisor.id}
              placement={placements.get(advisor.id)}
              trackingSource="cards"
            />
          ))}
          {filteredAdvisors.length === 0 && (
            <p className="paragraph-small color-teal-300">Nothing found.</p>
          )}
        </div>

        <div className="hide-mobile width-3-col">
          <ContributeButtons
            trackingPage="Advisors"
            suggestEntryUrl="https://airtable.com/appF8XfZUGXtfi40E/pagTw6PRaIHUHh8ty/form"
            suggestCorrectionUrl="https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form"
            noun="advisor"
            airtableUrl="https://airtable.com/appF8XfZUGXtfi40E/shr3u6yIAwM9Hi2fL"
            extraLinks={[
              {
                label: 'Review an advisor',
                url: 'https://airtable.com/appF8XfZUGXtfi40E/pagPIJgReOkrd1kEU/form',
              },
            ]}
          />
        </div>
      </div>
    </>
  )
}
