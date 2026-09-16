'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ListingCard from '@/components/ListingCard'
import { advisorCardProps } from './card'
import ContributeButtons from '@/components/ContributeButtons'
import { Advisor } from '@/lib/data/advisors'
import { filterItems, optionCounts } from '@/lib/filter-counts'
import { placementsById } from '@/lib/placements'

interface AdvisorsClientProps {
  advisors: Advisor[]
}

const focusOptions = ['Career/contribution', 'Other']

const allPass = () => true

export default function AdvisorsClient({ advisors }: AdvisorsClientProps) {
  const [focusFilters, setFocusFilters] = useState<string[]>([])

  // Each advisor's slot in the full page order, stamped onto a click so the
  // dashboard can tie clicks to page position even after later reordering.
  const placements = useMemo(() => placementsById(advisors), [advisors])

  const groups = useMemo(
    () => ({
      focus: {
        selected: focusFilters,
        matches: (advisor: Advisor, value: string) => advisor.focus === value,
      },
    }),
    [focusFilters]
  )

  const filteredAdvisors = useMemo(
    () => filterItems(advisors, allPass, groups),
    [advisors, groups]
  )

  const filterCounts = useMemo(
    () => ({
      focus: optionCounts(
        filterItems(advisors, allPass, groups, 'focus'),
        focusOptions,
        groups.focus.matches
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

  return (
    <>
      <FilterBar count={filteredAdvisors.length} noun="advisor">
        <FilterDropdown
          trackingPage="Advisors"
          title="Focus"
          icon="/images/icons/target.svg"
          options={focusOptions}
          selected={focusFilters}
          counts={filterCounts.focus}
          onToggle={v => toggleFilter(v, focusFilters, setFocusFilters)}
        />
      </FilterBar>

      <div className="flex gap-56px">
        <div className="collection-list padding-bottom-40px width-9-col">
          {filteredAdvisors.map(advisor => (
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
