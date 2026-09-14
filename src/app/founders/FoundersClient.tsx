'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ListingCard from '@/components/ListingCard'
import { founderResourceCardProps } from './card'
import ContributeButtons from '@/components/ContributeButtons'
import { FounderResource } from '@/lib/data/founders'
import { filterItems, optionCounts } from '@/lib/filter-counts'
import { placementsById } from '@/lib/placements'

interface FoundersClientProps {
  resources: FounderResource[]
}

const typeOptions = [
  'Article/tool',
  'Fiscal sponsor',
  'Incubator',
  'Venture capitalist',
]

const allPass = () => true

export default function FoundersClient({ resources }: FoundersClientProps) {
  const [typeFilters, setTypeFilters] = useState<string[]>([])

  // Each resource's slot in the full page order, stamped onto a click so the
  // dashboard can tie clicks to page position even after later reordering.
  const placements = useMemo(() => placementsById(resources), [resources])

  const groups = useMemo(
    () => ({
      type: {
        selected: typeFilters,
        matches: (resource: FounderResource, value: string) =>
          resource.type
            .split(',')
            .map(t => t.trim())
            .includes(value),
      },
    }),
    [typeFilters]
  )

  const filteredResources = useMemo(
    () => filterItems(resources, allPass, groups),
    [resources, groups]
  )

  const filterCounts = useMemo(
    () => ({
      type: optionCounts(
        filterItems(resources, allPass, groups, 'type'),
        typeOptions,
        groups.type.matches
      ),
    }),
    [resources, groups]
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
  }, [filteredResources])

  return (
    <>
      <FilterBar count={filteredResources.length} noun="resource">
        <FilterDropdown
          trackingPage="Founders"
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
          {filteredResources.map(resource => (
            <ListingCard
              key={resource.id}
              {...founderResourceCardProps(resource)}
              trackingPage="Founders"
              listingId={resource.id}
              placement={placements.get(resource.id)}
              trackingSource="cards"
            />
          ))}
          {filteredResources.length === 0 && (
            <p className="paragraph-small color-teal-300">Nothing found.</p>
          )}
        </div>

        <div className="hide-mobile width-3-col">
          <ContributeButtons
            trackingPage="Founders"
            suggestEntryUrl="https://airtable.com/appF8XfZUGXtfi40E/pag1OO5TrQkO96W7R/form"
            suggestCorrectionUrl="https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form"
            noun="resource"
            airtableUrl="https://airtable.com/appF8XfZUGXtfi40E/shr63cQohkMqyzOZv"
          />
        </div>
      </div>
    </>
  )
}
