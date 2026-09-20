'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ListingCard from '@/components/ListingCard'
import { mediaChannelCardProps } from './card'
import ContributeButtons from '@/components/ContributeButtons'
import { MediaChannel } from '@/lib/data/media-channels'
import { filterItems, optionCounts } from '@/lib/filter-counts'
import { gridListings, placementsById } from '@/lib/placements'

interface MediaChannelsClientProps {
  channels: MediaChannel[]
}

const typeOptions = [
  'Article',
  'Blog',
  'Book',
  'Forum',
  'Newsletter',
  'Podcast',
  'Twitter/X list',
  'YouTube channel',
]

const allPass = () => true

export default function MediaChannelsClient({
  channels,
}: MediaChannelsClientProps) {
  const [typeFilters, setTypeFilters] = useState<string[]>([])

  // Each channel's slot in the full page order, stamped onto a click so the
  // dashboard can tie clicks to page position even after later reordering.
  const placements = useMemo(() => placementsById(channels), [channels])

  const groups = useMemo(
    () => ({
      type: {
        selected: typeFilters,
        matches: (channel: MediaChannel, value: string) =>
          channel.type
            .split(',')
            .map(t => t.trim())
            .includes(value),
      },
    }),
    [typeFilters]
  )

  const filteredChannels = useMemo(
    () => filterItems(channels, allPass, groups),
    [channels, groups]
  )

  const filterCounts = useMemo(
    () => ({
      type: optionCounts(
        filterItems(channels, allPass, groups, 'type'),
        typeOptions,
        groups.type.matches
      ),
    }),
    [channels, groups]
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
  }, [filteredChannels])

  // Featured channels show in the grid only once a filter is on; unfiltered,
  // the featured row above already has them.
  const gridChannels = gridListings(
    filteredChannels,
    placements,
    typeFilters.length > 0
  )

  return (
    <>
      <FilterBar count={filteredChannels.length} noun="media source">
        <FilterDropdown
          trackingPage="Media channels"
          title="Type"
          icon="/images/icons/computer.svg"
          options={typeOptions}
          selected={typeFilters}
          counts={filterCounts.type}
          onToggle={v => toggleFilter(v, typeFilters, setTypeFilters)}
        />
      </FilterBar>

      <div className="flex gap-56px">
        <div className="collection-list padding-bottom-40px width-9-col">
          {gridChannels.map(channel => (
            <ListingCard
              key={channel.id}
              {...mediaChannelCardProps(channel)}
              trackingPage="Media channels"
              listingId={channel.id}
              placement={placements.get(channel.id)}
              trackingSource="cards"
            />
          ))}
          {filteredChannels.length === 0 && (
            <p className="paragraph-small color-teal-300">Nothing found.</p>
          )}
        </div>

        <div className="hide-mobile width-3-col">
          <ContributeButtons
            trackingPage="Media channels"
            suggestEntryUrl="https://airtable.com/appF8XfZUGXtfi40E/pagSZ7vJj9MHyYmtS/form"
            suggestCorrectionUrl="https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form"
            noun="media source"
            airtableUrl="https://airtable.com/appF8XfZUGXtfi40E/shrK0YGL591cGcAE1"
          />
        </div>
      </div>
    </>
  )
}
