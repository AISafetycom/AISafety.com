'use client'

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from 'react'
import { useSearchParams } from 'next/navigation'
import Icon from '@/components/Icon'
import ListingCard from '@/components/ListingCard'
import FeaturedCard from '@/components/FeaturedCard'
import ContributeButtons from '@/components/ContributeButtons'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ModeToggle from '@/components/ModeToggle'
import StickyBar, { scrollToAnchor } from '@/components/StickyBar'
import { EVENT_TYPES, eventTypeColor } from '@/lib/event-types'
import { selectFeatured, withRandomStandIns } from '@/lib/featured'
import { trackFilterApply } from '@/lib/analytics'
import { placementsById } from '@/lib/placements'
import type { EventListing } from '@/lib/data/events'
import { bottomMetaFor, eventCardProps, parseISO, titleMetaFor } from './card'
import styles from './page.module.css'

const ADD_EVENT_URL =
  'https://airtable.com/appF8XfZUGXtfi40E/pagns0zQqcM713eKk/form'
const SUGGEST_CORRECTION_URL =
  'https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form'
const AIRTABLE_VIEW_URL =
  'https://airtable.com/appF8XfZUGXtfi40E/shrteEg2cClc3x484/tblXbN9swwldwq8f7?viewControls=on'

const applicationOptions = ['Open', 'Closed']
// Cards show the full Airtable Cost value ("Pay to attend (assistance
// available)", "Free (cash prize available)", …); the filter collapses
// them to two groups.
const costOptions = ['Pay to attend', 'Free']

function costGroup(cost: string): string {
  if (cost.startsWith('Pay to attend')) return 'Pay to attend'
  if (cost.startsWith('Free')) return 'Free'
  console.warn(`Unknown Cost value from Airtable: ${cost}`)
  return cost
}

type Mode = 'in-person' | 'online'

interface EventsClientProps {
  events: EventListing[]
}

function monthKey(startDate: string | null): string {
  if (!startDate) return 'tbc'
  const d = parseISO(startDate)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()).padStart(2, '0')}`
}
function monthLabel(startDate: string | null): string {
  if (!startDate) return 'Dates to be confirmed'
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseISO(startDate))
}

function pluralizeTypes(types: string[]): string {
  const plural = types.map(t => `${t.toLowerCase()}s`)
  if (plural.length <= 1) return plural[0] ?? ''
  if (plural.length === 2) return `${plural[0]} and ${plural[1]}`
  return `${plural.slice(0, -1).join(', ')} and ${plural[plural.length - 1]}`
}

function emptyStateMessage(
  mode: Mode,
  selectedStatus: string[],
  selectedTypes: string[],
  selectedCost: string[]
): string {
  const activePills =
    (selectedStatus.length > 0 ? 1 : 0) +
    (selectedTypes.length > 0 ? 1 : 0) +
    (selectedCost.length > 0 ? 1 : 0)
  if (activePills > 1) {
    return 'No results found based on these filters. Try adjusting them.'
  }
  const modeLabel = mode === 'online' ? 'online' : 'in person'
  const cost =
    selectedCost.length > 0
      ? `${selectedCost.map(c => c.toLowerCase()).join(' or ')} `
      : ''
  const noun =
    selectedTypes.length > 0 ? pluralizeTypes(selectedTypes) : 'events'
  const applications =
    selectedStatus.length === 1
      ? ` with ${selectedStatus[0].toLowerCase()} applications`
      : ''
  return `No results found for ${cost}${noun} ${modeLabel}${applications}. Try adjusting the filters.`
}

function CitySearch({
  cities,
  selectedCities,
  onAdd,
  onRemove,
  onClear,
}: {
  cities: string[]
  selectedCities: string[]
  onAdd: (city: string) => void
  onRemove: (city: string) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  const normalized = query.trim().toLowerCase()
  const matches = cities.filter(
    c => c.toLowerCase().includes(normalized) && !selectedCities.includes(c)
  )

  function selectCity(city: string) {
    setQuery('')
    onAdd(city)
    setOpen(false)
    setHighlighted(-1)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (matches.length === 0) return
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setHighlighted(h => (h + delta + matches.length) % matches.length)
    } else if (e.key === 'Enter') {
      if (open && highlighted >= 0 && highlighted < matches.length) {
        e.preventDefault()
        selectCity(matches[highlighted])
      }
    } else if (e.key === 'Backspace') {
      if (query === '' && selectedCities.length > 0) {
        onRemove(selectedCities[selectedCities.length - 1])
      }
    }
  }

  return (
    <div className={styles.nearMeSearch} ref={ref}>
      <span className={styles.nearMeIcon} aria-hidden="true" />
      <div
        className={styles.nearMeField}
        onClick={() => inputRef.current?.focus()}
      >
        {selectedCities.map(city => (
          <span key={city} className={`paragraph-xs ${styles.cityChip}`}>
            {city}
            <button
              type="button"
              className={styles.cityChipRemove}
              aria-label={`Remove ${city}`}
              onClick={e => {
                e.stopPropagation()
                onRemove(city)
              }}
            >
              <Icon src="/images/icons/x-small.svg" size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className={`text-field ${styles.nearMeInput}`}
          placeholder={
            selectedCities.length > 0
              ? 'Add another location'
              : 'Type your city or country'
          }
          maxLength={256}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlighted(-1)
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {(query.length > 0 || selectedCities.length > 0) && (
        <button
          type="button"
          className={styles.nearMeClear}
          aria-label="Clear locations"
          onClick={() => {
            setQuery('')
            onClear()
            setOpen(false)
          }}
        >
          <Icon src="/images/icons/x.svg" size={16} />
        </button>
      )}
      {open && (matches.length > 0 || normalized !== '') && (
        <div className={`${styles.cityList} drop-shadow-dark`}>
          {matches.length > 0 ? (
            matches.map((city, i) => (
              <button
                key={city}
                type="button"
                ref={
                  i === highlighted
                    ? el => el?.scrollIntoView({ block: 'nearest' })
                    : undefined
                }
                className={`paragraph-small ${styles.cityOption} ${
                  i === highlighted ? styles.cityOptionHighlighted : ''
                }`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => selectCity(city)}
              >
                <span className={styles.cityOptionIcon} aria-hidden="true" />
                {city}
              </button>
            ))
          ) : (
            <p className={`paragraph-small ${styles.cityEmpty}`}>
              No events found in that city.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// "Online" writes ?view=online so the online set has a shareable URL;
// "In person" is the default and keeps the bare URL. Old ?view=in-person
// links still resolve to the in-person set via applyViewParam's fallback.
// replaceState (not push) so toggling never stacks history entries;
// history.state is passed through untouched because Next.js keeps its
// routing internals there.
function syncViewParam(next: Mode) {
  const url = new URL(window.location.href)
  if (next === 'online') url.searchParams.set('view', next)
  else url.searchParams.delete('view')
  window.history.replaceState(window.history.state, '', url)
}

// Mirrors the URL back into state — reactively, not just on mount, because a
// soft navigation can rewrite the query string without remounting the page
// (e.g. clicking the nav's link for the page you're already on strips ?view=,
// and the old set would stay up while the bare URL promises the default).
// Lives in its own null-rendering leaf behind a Suspense boundary so
// useSearchParams doesn't bail the statically-generated page out to client
// rendering. Layout effect so a shared link swaps sets before first paint.
function ViewParamSync({ onView }: { onView: (view: string | null) => void }) {
  const view = useSearchParams().get('view')
  useLayoutEffect(() => {
    onView(view)
  }, [view, onView])
  return null
}

export default function EventsClient({ events }: EventsClientProps) {
  const [mode, setMode] = useState<Mode>('in-person')
  const [selectedStatus, setSelectedStatus] = useState<string[]>(['Open'])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedCost, setSelectedCost] = useState<string[]>([])
  const [selectedCities, setSelectedCities] = useState<string[]>([])

  const toggleAnchorRef = useRef<HTMLDivElement>(null)

  // URL -> state, fed by ViewParamSync below. Only ?view=online selects the
  // online set; anything else — the bare URL (the default, also what
  // switching back to In person leaves behind), legacy ?view=in-person
  // links, unknown values — resolves to in person. A deep link doesn't
  // auto-scroll the way a click does. Landing on online drops the city
  // filter, mirroring switchMode.
  const applyViewParam = useCallback((view: string | null) => {
    const next: Mode = view === 'online' ? 'online' : 'in-person'
    if (next === 'online') setSelectedCities([])
    setMode(next)
  }, [])

  // Switching sets replaces the whole grid, so jump back to the top of the
  // listings (just below the global nav) for the new set.
  function switchMode(next: Mode) {
    if (next === 'online') setSelectedCities([])
    setMode(next)
    syncViewParam(next)
    scrollToAnchor(toggleAnchorRef.current)
  }

  // Hybrid events belong to both views, so they stay visible whichever way
  // the toggle is set.
  const modeEvents = useMemo(
    () =>
      events.filter(e =>
        mode === 'online' ? e.mode !== 'In person' : e.mode !== 'Online'
      ),
    [events, mode]
  )

  // Events whose applications/registrations closed (competitions can run for
  // months after their deadline) are never shown as featured, matching
  // /training; when the queue can't fill both slots, the row is topped up
  // with random stand-ins from the same view. Hybrid events are featured
  // under Online only — in the In person view they appear in the grid but
  // never in the featured row.
  const featuredEvents = useMemo(() => {
    const pool =
      mode === 'online'
        ? modeEvents
        : modeEvents.filter(e => e.mode !== 'Hybrid')
    const isOpen = (e: EventListing) => e.applicationStatus === 'Open'
    return withRandomStandIns(selectFeatured(pool, isOpen), pool, isOpen)
  }, [modeEvents, mode])

  // Each event's slot in the full (unfiltered) order of the active mode, so a
  // click is tagged with the rank the visitor saw — not its position within an
  // active filter.
  const placements = useMemo(
    () => placementsById(modeEvents, featuredEvents),
    [modeEvents, featuredEvents]
  )

  const cities = useMemo(() => {
    const set = new Set<string>()
    for (const e of modeEvents) {
      const loc = e.location.trim()
      if (loc) set.add(loc)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [modeEvents])

  // Each dropdown's counts are faceted (like the 80,000 Hours job board):
  // an option's number is how many events would show if you picked it,
  // i.e. it respects every OTHER active filter (including the city) but not
  // the dropdown's own, so multi-selecting within one dropdown stays
  // possible. Mirrors TrainingClient.
  const { filteredEvents, statusCounts, typeCounts, costCounts } =
    useMemo(() => {
      const matchesFilters = (event: EventListing, skip?: string) => {
        if (
          skip !== 'status' &&
          selectedStatus.length > 0 &&
          !selectedStatus.includes(event.applicationStatus)
        )
          return false
        if (
          skip !== 'type' &&
          selectedTypes.length > 0 &&
          !event.type.some(t => selectedTypes.includes(t))
        )
          return false
        if (
          skip !== 'cost' &&
          selectedCost.length > 0 &&
          !event.cost.some(c => selectedCost.includes(costGroup(c)))
        )
          return false
        if (
          mode === 'in-person' &&
          selectedCities.length > 0 &&
          !selectedCities.includes(event.location)
        )
          return false
        return true
      }

      const countBy = (
        skip: string,
        extract: (e: EventListing) => string[]
      ) => {
        const counts: Record<string, number> = {}
        for (const e of modeEvents) {
          if (!matchesFilters(e, skip)) continue
          for (const key of extract(e)) counts[key] = (counts[key] || 0) + 1
        }
        return counts
      }

      return {
        filteredEvents: modeEvents.filter(e => matchesFilters(e)),
        statusCounts: countBy('status', e => [e.applicationStatus]),
        typeCounts: countBy('type', e => e.type),
        costCounts: countBy('cost', e => e.cost.map(costGroup)),
      }
    }, [
      modeEvents,
      selectedStatus,
      selectedTypes,
      selectedCost,
      mode,
      selectedCities,
    ])

  // Events group under month-of-start headings: the date you attend is what
  // matters. (/training differs — its programs order by application deadline
  // with no month headings; see TrainingClient.)
  const monthGroups = useMemo(() => {
    const groups: { key: string; label: string; events: EventListing[] }[] = []
    for (const event of filteredEvents) {
      const key = monthKey(event.startDate)
      let group = groups.find(g => g.key === key)
      if (!group) {
        group = { key, label: monthLabel(event.startDate), events: [] }
        groups.push(group)
      }
      group.events.push(event)
    }
    return groups
  }, [filteredEvents])

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
  }, [filteredEvents])

  return (
    <>
      <Suspense fallback={null}>
        <ViewParamSync onView={applyViewParam} />
      </Suspense>
      {/* Sticky so it's always clear which of the two event sets is shown */}
      <div ref={toggleAnchorRef} aria-hidden="true" />
      <StickyBar className="margin-bottom-32px">
        <ModeToggle
          mode={mode}
          onChange={switchMode}
          ariaLabel="Event format"
          tabs={[
            {
              value: 'in-person',
              icon: '/images/icons/pin.svg',
              label: 'In person',
            },
            {
              value: 'online',
              icon: '/images/icons/computer.svg',
              label: 'Online',
            },
          ]}
        />
      </StickyBar>

      {featuredEvents.length > 0 && (
        <div className="flex flex-wrap gap-56px padding-bottom-80px">
          {featuredEvents.map((event, i) => (
            <FeaturedCard
              key={event.id}
              className="width-6-col"
              href={event.url !== '#' ? event.url : undefined}
              tagline={
                event.type[0]
                  ? `Featured ${event.type[0].toLowerCase()}`
                  : 'Featured event'
              }
              name={event.name}
              description={event.description}
              logo={event.logo}
              accentClass={
                event.type[0] ? eventTypeColor(event.type[0]) : undefined
              }
              titleMeta={titleMetaFor(event)}
              meta={bottomMetaFor(event)}
              trackingPage="Events"
              trackingId={event.id}
              trackingPosition={placements.get(event.id)}
              trackingSource={mode}
              index={i}
              count={featuredEvents.length}
            />
          ))}
        </div>
      )}

      <div className="width-9-col">
        <FilterBar
          count={filteredEvents.length}
          noun="event"
          label={`${filteredEvents.length} upcoming event${
            filteredEvents.length === 1 ? '' : 's'
          } ${mode === 'in-person' ? 'in person' : 'online'}`}
        >
          <FilterDropdown
            trackingPage="Events"
            title="Applications"
            options={applicationOptions}
            selected={selectedStatus}
            counts={statusCounts}
            onToggle={v => toggleFilter(v, selectedStatus, setSelectedStatus)}
          />
          <FilterDropdown
            trackingPage="Events"
            title="Type"
            options={[...EVENT_TYPES]}
            selected={selectedTypes}
            counts={typeCounts}
            onToggle={v => toggleFilter(v, selectedTypes, setSelectedTypes)}
          />
          <FilterDropdown
            trackingPage="Events"
            title="Cost"
            options={costOptions}
            selected={selectedCost}
            counts={costCounts}
            onToggle={v => toggleFilter(v, selectedCost, setSelectedCost)}
          />
        </FilterBar>

        {mode === 'in-person' && (
          <div className={`border-only margin-bottom-32px ${styles.nearMe}`}>
            <p className="paragraph-small padding-bottom-16px">
              Find events near you
            </p>
            <CitySearch
              cities={cities}
              selectedCities={selectedCities}
              onAdd={city => {
                trackFilterApply('Events', 'City', city)
                setSelectedCities(prev =>
                  prev.includes(city) ? prev : [...prev, city]
                )
              }}
              onRemove={city =>
                setSelectedCities(prev => prev.filter(c => c !== city))
              }
              onClear={() => setSelectedCities([])}
            />
          </div>
        )}
      </div>

      <div className="flex gap-56px">
        <div className="width-9-col padding-bottom-80px">
          {monthGroups.map((group, i) => (
            <div
              key={group.key}
              className={i === 0 ? undefined : 'padding-top-32px'}
            >
              <p className="paragraph-small color-teal-300 padding-bottom-24px">
                {group.label}
              </p>
              <div className="collection-list">
                {group.events.map(event => (
                  <ListingCard
                    key={event.id}
                    {...eventCardProps(event)}
                    trackingPage="Events"
                    listingId={event.id}
                    placement={placements.get(event.id)}
                    trackingSource={mode}
                  />
                ))}
              </div>
            </div>
          ))}
          {filteredEvents.length === 0 && (
            <p className="paragraph-small color-teal-300">
              {emptyStateMessage(
                mode,
                selectedStatus,
                selectedTypes,
                selectedCost
              )}
            </p>
          )}
        </div>

        <ContributeButtons
          trackingPage="Events"
          sidebar
          suggestEntryUrl={ADD_EVENT_URL}
          suggestCorrectionUrl={SUGGEST_CORRECTION_URL}
          noun="event"
          airtableUrl={AIRTABLE_VIEW_URL}
          airtableNote="(includes past events)"
        />
      </div>
    </>
  )
}
