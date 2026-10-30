'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import FilterRange from '@/components/FilterRange'
import ListingCard from '@/components/ListingCard'
import ContributeButtons from '@/components/ContributeButtons'
import { Funder } from '@/lib/data/funding'
import {
  APPLICATION_STATUSES,
  GRANT_LABELS,
  GRANT_TOP,
  WHO_CAN_APPLY,
  grantBars,
  grantOverlaps,
  grantRangeActive,
  grantRangeSummary,
} from '@/lib/funding-meta'
import { filterItems, optionCounts } from '@/lib/filter-counts'
import { gridListings, placementsById } from '@/lib/placements'
import { funderCardProps } from './card'

interface FundingClientProps {
  funders: Funder[]
}

const statusOptions = [...APPLICATION_STATUSES]
const whoOptions = [...WHO_CAN_APPLY]

export default function FundingClient({ funders }: FundingClientProps) {
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [whoFilters, setWhoFilters] = useState<string[]>([])
  const [grantRange, setGrantRange] = useState<[number, number]>([0, GRANT_TOP])

  // Each funder's slot in the full (unfiltered) page order, so a click is
  // tagged with the rank Bryce set — not its position within an active filter.
  const placements = useMemo(() => placementsById(funders), [funders])

  // Grant size is a range rather than a list of options, so it narrows every
  // list and count as an always-on condition instead of one of the groups.
  const grantActive = grantRangeActive(grantRange[0], grantRange[1])
  const grantFilter = useMemo(
    () => (funder: Funder) =>
      !grantActive || grantOverlaps(funder, grantRange[0], grantRange[1]),
    [grantActive, grantRange]
  )

  const groups = useMemo(
    () => ({
      status: {
        selected: statusFilters,
        matches: (funder: Funder, value: string) =>
          funder.applicationStatus === value,
      },
      who: {
        selected: whoFilters,
        matches: (funder: Funder, value: string) =>
          funder.whoCanApply.includes(value),
      },
    }),
    [statusFilters, whoFilters]
  )

  const filteredFunders = useMemo(
    () => filterItems(funders, grantFilter, groups),
    [funders, grantFilter, groups]
  )

  const filterCounts = useMemo(
    () => ({
      status: optionCounts(
        filterItems(funders, grantFilter, groups, 'status'),
        statusOptions,
        groups.status.matches
      ),
      who: optionCounts(
        filterItems(funders, grantFilter, groups, 'who'),
        whoOptions,
        groups.who.matches
      ),
    }),
    [funders, grantFilter, groups]
  )

  // The bars above the slider show every funder, whatever else is ticked.
  const bars = useMemo(() => grantBars(funders), [funders])

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

  const changeGrantRange = (range: [number, number]) => {
    savedScrollY.current = window.scrollY
    setGrantRange(range)
  }

  useLayoutEffect(() => {
    if (savedScrollY.current !== null) {
      window.scrollTo(0, savedScrollY.current)
      savedScrollY.current = null
    }
  }, [filteredFunders])

  const count = filteredFunders.length

  // Featured funders show in the grid only once a filter is on; unfiltered,
  // the featured row above already has them.
  const filtering =
    statusFilters.length > 0 || whoFilters.length > 0 || grantActive
  const gridFunders = gridListings(filteredFunders, placements, filtering)

  return (
    <>
      <FilterBar count={count} noun="funder">
        <FilterDropdown
          trackingPage="Funding"
          title="Application status"
          icon="/images/icons/paper.svg"
          options={statusOptions}
          selected={statusFilters}
          counts={filterCounts.status}
          onToggle={v => toggleFilter(v, statusFilters, setStatusFilters)}
        />
        <FilterDropdown
          trackingPage="Funding"
          title="Who can apply"
          icon="/images/icons/team.svg"
          options={whoOptions}
          selected={whoFilters}
          counts={filterCounts.who}
          onToggle={v => toggleFilter(v, whoFilters, setWhoFilters)}
        />
        <FilterRange
          trackingPage="Funding"
          title="Grant size"
          icon="/images/icons/grant-size.svg"
          labels={GRANT_LABELS}
          bars={bars}
          value={grantRange}
          summary={grantRangeSummary(grantRange[0], grantRange[1])}
          onChange={changeGrantRange}
        />
      </FilterBar>

      <div className="flex gap-56px">
        <div className="collection-list padding-bottom-40px width-9-col">
          {gridFunders.map(funder => (
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
            <p className="paragraph-small color-teal-grey-300">
              Nothing found.
            </p>
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
