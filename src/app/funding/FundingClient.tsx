'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ListingCard from '@/components/ListingCard'
import ContributeButtons from '@/components/ContributeButtons'
import { Funder } from '@/lib/data/funding'
import { isAcceptingApplications } from '@/lib/funding-status'
import { filterItems, optionCounts } from '@/lib/filter-counts'
import { placementsById } from '@/lib/placements'
import { funderCardProps } from './card'

interface FundingClientProps {
  funders: Funder[]
}

// Were "Yes" / "No" until 6 September 2026; analytics still log those values
// so the filter's history stays in one line (see lib/filter-tracking).
const acceptingOptions = ['Open', 'Closed']
const typeOptions = ['Fund', 'Grant program', 'Platform']

// No search box on this page, so every funder passes the base filter.
const allPass = () => true

export default function FundingClient({ funders }: FundingClientProps) {
  const [acceptingFilters, setAcceptingFilters] = useState<string[]>([])
  const [typeFilters, setTypeFilters] = useState<string[]>([])

  // Each funder's slot in the full (unfiltered) page order, so a click is
  // tagged with the rank Bryce set — not its position within an active filter.
  const placements = useMemo(() => placementsById(funders), [funders])

  const groups = useMemo(
    () => ({
      accepting: {
        selected: acceptingFilters,
        // Airtable values are full sentences ("Applications on a rolling
        // basis", "Not accepting applications"); bucket them into Open/Closed
        // via the shared status helper.
        matches: (funder: Funder, value: string) => {
          const status = funder.acceptingApplications || ''
          if (!status) return false
          return value === 'Open'
            ? isAcceptingApplications(status)
            : !isAcceptingApplications(status)
        },
      },
      type: {
        selected: typeFilters,
        matches: (funder: Funder, value: string) =>
          (funder.type || '')
            .split(',')
            .map(t => t.trim())
            .includes(value),
      },
    }),
    [acceptingFilters, typeFilters]
  )

  const filteredFunders = useMemo(
    () => filterItems(funders, allPass, groups),
    [funders, groups]
  )

  const filterCounts = useMemo(
    () => ({
      accepting: optionCounts(
        filterItems(funders, allPass, groups, 'accepting'),
        acceptingOptions,
        groups.accepting.matches
      ),
      type: optionCounts(
        filterItems(funders, allPass, groups, 'type'),
        typeOptions,
        groups.type.matches
      ),
    }),
    [funders, groups]
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
  }, [filteredFunders])

  const count = filteredFunders.length

  return (
    <>
      <FilterBar count={count} noun="funder">
        <FilterDropdown
          trackingPage="Funding"
          title="Application status"
          icon="/images/icons/paper.svg"
          options={acceptingOptions}
          selected={acceptingFilters}
          counts={filterCounts.accepting}
          onToggle={v => toggleFilter(v, acceptingFilters, setAcceptingFilters)}
        />
        <FilterDropdown
          trackingPage="Funding"
          title="Type"
          icon="/images/icons/tag.svg"
          options={typeOptions}
          selected={typeFilters}
          counts={filterCounts.type}
          onToggle={v => toggleFilter(v, typeFilters, setTypeFilters)}
        />
      </FilterBar>

      <div className="flex gap-56px">
        <div className="collection-list padding-bottom-40px width-9-col">
          {filteredFunders.map(funder => (
            <ListingCard
              key={funder.id}
              {...funderCardProps(funder)}
              trackingPage="Funding"
              listingId={funder.id}
              placement={placements.get(funder.id)}
              trackingSource="cards"
            />
          ))}
          {filteredFunders.length === 0 && (
            <p className="paragraph-small color-teal-300">Nothing found.</p>
          )}
        </div>

        <div className="hide-mobile width-3-col">
          <ContributeButtons
            trackingPage="Funding"
            suggestEntryUrl="https://airtable.com/appF8XfZUGXtfi40E/pagBI1UdaBbFplw20/form"
            suggestCorrectionUrl="https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form"
            noun="funder"
            airtableUrl="https://airtable.com/appF8XfZUGXtfi40E/shr9Mki0gKgHFdcbd"
          />
        </div>
      </div>
    </>
  )
}
