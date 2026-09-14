'use client'

import { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ListingCard from '@/components/ListingCard'
import ContributeButtons from '@/components/ContributeButtons'
import { Community } from '@/lib/data/communities'
import { filterItems, optionCounts } from '@/lib/filter-counts'
import { withUtm } from '@/lib/utm'
import { placementsById } from '@/lib/placements'
import { communityCardProps } from './card'

interface CommunitiesClientProps {
  communities: Community[]
}

// Filter options based on Airtable data
const platformOptions = [
  'Local',
  'Discord',
  'Facebook',
  'Forum',
  'Gather',
  'Reddit',
  'Slack',
  'Telegram',
  'WhatsApp',
  'Other',
]
const activityOptions = ['Very active', 'Active', 'Semi-active', 'Inactive']
const focusOptions = ['Main focus is AI safety', 'Partial focus on AI safety']

// No search box on this page, so every community passes the base filter.
const allPass = () => true

export default function CommunitiesClient({
  communities,
}: CommunitiesClientProps) {
  const [platformFilters, setPlatformFilters] = useState<string[]>([])
  const [activityFilters, setActivityFilters] = useState<string[]>([])
  const [focusFilters, setFocusFilters] = useState<string[]>([])

  // Each community's slot in the full page order, stamped onto a click so the
  // dashboard can tie clicks to page position even after later reordering.
  const placements = useMemo(() => placementsById(communities), [communities])

  // Live counts (the shared filter-counts idiom): each dropdown's numbers are
  // computed over the communities passing every OTHER group, so a count
  // answers "what would I get if I also ticked this?".
  const groups = useMemo(
    () => ({
      platform: {
        selected: platformFilters,
        matches: (community: Community, value: string) =>
          community.platform.includes(value),
      },
      activity: {
        selected: activityFilters,
        matches: (community: Community, value: string) =>
          community.activityLevel === value,
      },
      focus: {
        selected: focusFilters,
        matches: (community: Community, value: string) =>
          community.focus === value,
      },
    }),
    [platformFilters, activityFilters, focusFilters]
  )

  const filteredCommunities = useMemo(
    () => filterItems(communities, allPass, groups),
    [communities, groups]
  )

  const filterCounts = useMemo(
    () => ({
      platform: optionCounts(
        filterItems(communities, allPass, groups, 'platform'),
        platformOptions,
        groups.platform.matches
      ),
      activity: optionCounts(
        filterItems(communities, allPass, groups, 'activity'),
        activityOptions,
        groups.activity.matches
      ),
      focus: optionCounts(
        filterItems(communities, allPass, groups, 'focus'),
        focusOptions,
        groups.focus.matches
      ),
    }),
    [communities, groups]
  )

  const savedScrollY = useRef<number | null>(null)

  // Card images are below the map and load lazily as they scroll into view.
  // After 7 s — by which time the map's tooltip logos should be done
  // preloading — proactively warm the browser cache for every card logo so
  // someone scrolling quickly down doesn't have to wait. The refs keep the
  // preloaded Image objects alive so their decoded bitmaps stay cached.
  const preloadedCardLogosRef = useRef<HTMLImageElement[]>([])
  useEffect(() => {
    const timer = setTimeout(() => {
      communities.forEach(c => {
        if (!c.logo) return
        const img = new window.Image()
        img.decoding = 'async'
        img.src = c.logo
        img.decode().catch(() => {})
        preloadedCardLogosRef.current.push(img)
      })
    }, 7000)
    return () => clearTimeout(timer)
  }, [communities])

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
  }, [filteredCommunities])

  const count = filteredCommunities.length

  return (
    <>
      <FilterBar
        count={count}
        noun="community"
        label={`${count} ${count === 1 ? 'community' : 'communities'}`}
      >
        <FilterDropdown
          trackingPage="Communities"
          title="Platform"
          icon="/images/icons/computer.svg"
          options={platformOptions}
          selected={platformFilters}
          counts={filterCounts.platform}
          onToggle={v => toggleFilter(v, platformFilters, setPlatformFilters)}
        />
        <FilterDropdown
          trackingPage="Communities"
          title="Activity level"
          icon="/images/icons/activity.svg"
          options={activityOptions}
          selected={activityFilters}
          counts={filterCounts.activity}
          onToggle={v => toggleFilter(v, activityFilters, setActivityFilters)}
        />
        <FilterDropdown
          trackingPage="Communities"
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
          {filteredCommunities.map(community => (
            <ListingCard
              key={community.id}
              {...communityCardProps(community)}
              trackingPage="Communities"
              listingId={community.id}
              placement={placements.get(community.id)}
              trackingSource="cards"
            />
          ))}
          {filteredCommunities.length === 0 && (
            <p className="paragraph-small color-teal-300">Nothing found.</p>
          )}
        </div>

        <div className="hide-mobile width-3-col">
          {/* Related resources (moved here from the featured section, since the
              new full-width featured cards leave no room beside them) */}
          <div className="padding-bottom-40px">
            <p className="paragraph-small-bold padding-bottom-32px">
              Related resources
            </p>
            <a
              href={withUtm(
                'https://www.lesswrong.com/community',
                'Communities'
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="block padding-bottom-40px hover-opacity-80"
            >
              <h3 className="padding-bottom-16px">
                Map of LessWrong groups{' '}
                <span className="color-teal-400">→</span>
              </h3>
              <p className="paragraph-small color-teal-300">
                People in Rationalist groups like these often overlap with those
                in AI safety
              </p>
            </a>
            <a
              href={withUtm(
                'https://forum.effectivealtruism.org/groups',
                'Communities'
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover-opacity-80"
            >
              <h3 className="padding-bottom-16px">
                Map of EA groups <span className="color-teal-400">→</span>
              </h3>
              <p className="paragraph-small color-teal-300">
                Effective Altruism groups also tend to be concerned with AI
                safety
              </p>
            </a>
          </div>

          <ContributeButtons
            trackingPage="Communities"
            suggestEntryUrl="https://airtable.com/appF8XfZUGXtfi40E/pagKhplUqu07DwVqC/form"
            suggestCorrectionUrl="https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form"
            noun="community"
            airtableUrl="https://airtable.com/appF8XfZUGXtfi40E/shrA9iDx7G2roYKwq"
          />
        </div>
      </div>
    </>
  )
}
