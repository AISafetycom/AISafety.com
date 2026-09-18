'use client'

import {
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from 'react'
import { useSearchParams } from 'next/navigation'
import ListingCard from '@/components/ListingCard'
import FeaturedCard from '@/components/FeaturedCard'
import ContributeButtons from '@/components/ContributeButtons'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ModeToggle from '@/components/ModeToggle'
import StickyBar, { scrollToAnchor } from '@/components/StickyBar'
import {
  ENTRY_BARS,
  LENGTH_BUCKETS,
  STIPEND_OPTIONS,
  TRAINING_TYPES,
  trainingTypeColor,
} from '@/lib/training-types'
import { selectFeatured, withRandomStandIns } from '@/lib/featured'
import { placementsById } from '@/lib/placements'
import {
  compareByDeadline,
  SECTION_LABELS,
  sectionFor,
  type Section,
} from '@/lib/training-order'
import type {
  ProgramBase,
  RecurringProgram,
  TrainingProgram,
} from '@/lib/data/training'
import {
  bottomMetaFor,
  recurringProgramCardProps,
  titleMetaFor,
  trainingCardProps,
} from './card'

// Each tab links to its own add form and share view; the correction form is
// the sitewide one.
const ADD_PROGRAM_URLS: Record<Mode, string> = {
  upcoming: 'https://airtable.com/appF8XfZUGXtfi40E/pagSB4ucUn38CvXFD/form',
  recurring: 'https://airtable.com/appF8XfZUGXtfi40E/pagMXYNesOJse9Ga0/form',
}
const SUGGEST_CORRECTION_URL =
  'https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form'
const AIRTABLE_VIEW_URLS: Record<Mode, string> = {
  upcoming:
    'https://airtable.com/appF8XfZUGXtfi40E/shrripC3ZUNDHqZkU/tbli1YSCpIuNY2DvL?viewControls=on',
  recurring:
    'https://airtable.com/appF8XfZUGXtfi40E/shrjEwxwchrKPvnDO/tblEEIbj6dW5oS4cX?viewControls=on',
}

const applicationOptions = ['Open', 'Closed']
const focusOptions = ['General', 'Technical', 'Governance']
const locationOptions = ['Online', 'In person', 'Hybrid']

type Mode = 'upcoming' | 'recurring'

interface TrainingClientProps {
  programs: TrainingProgram[]
  recurring: RecurringProgram[]
}

// Online-or-in-person programs can be done either way, so they surface under
// both the Online and In person filters. Hybrid programs (required online +
// in-person parts, job-board sense) get their own filter option — they don't
// truly belong to either pure bucket. Mixed/choice programs spell out their
// facets in the Location text ("Online & Berkeley, USA"), so the card shows
// that instead of a bare "Online".
function locationFacets(program: ProgramBase): string[] {
  return program.mode === 'Online or in person'
    ? ['Online', 'In person']
    : [program.mode]
}

// The active set is shareable: the non-default tab writes ?view= to the
// address bar, the default keeps the bare URL. replaceState (not push) so
// toggling never stacks history entries; history.state is passed through
// untouched because Next.js keeps its routing internals there.
function syncViewParam(next: Mode) {
  const url = new URL(window.location.href)
  if (next === 'upcoming') url.searchParams.delete('view')
  else url.searchParams.set('view', next)
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

export default function TrainingClient({
  programs,
  recurring,
}: TrainingClientProps) {
  const [mode, setMode] = useState<Mode>('upcoming')
  const toggleAnchorRef = useRef<HTMLDivElement>(null)

  // URL -> state, fed by ViewParamSync below. Unknown values fall through to
  // the default; a deep link doesn't auto-scroll the way a click does.
  const applyViewParam = useCallback((view: string | null) => {
    setMode(view === 'recurring' ? 'recurring' : 'upcoming')
  }, [])

  // Switching sets replaces the whole grid, so jump back to the top of the
  // listings (just below the global nav) for the new set.
  function switchMode(next: Mode) {
    setMode(next)
    syncViewParam(next)
    scrollToAnchor(toggleAnchorRef.current)
  }

  // No default Applications filter: the deadline order already keeps open
  // programs first and parks closed ones at the bottom under a divider, so
  // everything can show. (/events defaults to Open — a closed event is one
  // you can't attend, and it has no such ordering to lean on.)
  const [selectedStatus, setSelectedStatus] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedFocus, setSelectedFocus] = useState<string[]>([])
  const [selectedEntryBar, setSelectedEntryBar] = useState<string[]>([])
  const [selectedStipend, setSelectedStipend] = useState<string[]>([])
  const [selectedLength, setSelectedLength] = useState<string[]>([])
  const [selectedLocation, setSelectedLocation] = useState<string[]>([])

  const orderedPrograms = useMemo(
    () => [...programs].sort(compareByDeadline),
    [programs]
  )
  const modePrograms: ProgramBase[] =
    mode === 'upcoming' ? orderedPrograms : recurring

  // Programs whose applications closed are never shown as featured
  // (recurring programs have no applications and always count as open);
  // when the queue can't fill both slots, the row is topped up with random
  // stand-ins from the same set.
  const featuredPrograms = useMemo(() => {
    const isOpen = (p: ProgramBase) =>
      'applicationStatus' in p
        ? (p as TrainingProgram).applicationStatus === 'Open'
        : true
    return withRandomStandIns(
      selectFeatured(modePrograms, isOpen),
      modePrograms,
      isOpen
    )
  }, [modePrograms])

  // Each program's slot in the full (unfiltered) order of the active set, so a
  // click is tagged with the rank the visitor saw — not its position within an
  // active filter.
  const placements = useMemo(
    () => placementsById(modePrograms, featuredPrograms),
    [modePrograms, featuredPrograms]
  )

  // Each dropdown's counts are faceted (like the 80,000 Hours job board):
  // an option's number is how many programs would show if you picked it,
  // i.e. it respects every OTHER active filter but not the dropdown's own,
  // so multi-selecting within one dropdown stays possible.
  const {
    filtered,
    statusCounts,
    typeCounts,
    focusCounts,
    entryBarCounts,
    stipendCounts,
    lengthCounts,
    locationCounts,
  } = useMemo(() => {
    const upcoming = mode === 'upcoming'

    const matchesFilters = (program: ProgramBase, skip?: string) => {
      const dated = upcoming ? (program as TrainingProgram) : null
      if (
        dated &&
        skip !== 'status' &&
        selectedStatus.length > 0 &&
        !selectedStatus.includes(dated.applicationStatus)
      )
        return false
      if (
        skip !== 'type' &&
        selectedTypes.length > 0 &&
        !program.type.some(t => selectedTypes.includes(t))
      )
        return false
      if (
        skip !== 'focus' &&
        selectedFocus.length > 0 &&
        !program.focus.some(f => selectedFocus.includes(f))
      )
        return false
      if (
        skip !== 'entrybar' &&
        selectedEntryBar.length > 0 &&
        !(program.entryBar && selectedEntryBar.includes(program.entryBar))
      )
        return false
      if (
        skip !== 'stipend' &&
        selectedStipend.length > 0 &&
        !(program.stipend && selectedStipend.includes(program.stipend))
      )
        return false
      if (
        skip !== 'length' &&
        selectedLength.length > 0 &&
        !(program.lengthBucket && selectedLength.includes(program.lengthBucket))
      )
        return false
      if (
        skip !== 'location' &&
        selectedLocation.length > 0 &&
        !locationFacets(program).some(f => selectedLocation.includes(f))
      )
        return false
      return true
    }

    const countBy = (skip: string, extract: (p: ProgramBase) => string[]) => {
      const counts: Record<string, number> = {}
      for (const p of modePrograms) {
        if (!matchesFilters(p, skip)) continue
        for (const key of extract(p)) counts[key] = (counts[key] || 0) + 1
      }
      return counts
    }

    return {
      filtered: modePrograms.filter(p => matchesFilters(p)),
      statusCounts: upcoming
        ? countBy('status', p => [(p as TrainingProgram).applicationStatus])
        : {},
      typeCounts: countBy('type', p => p.type),
      focusCounts: countBy('focus', p => p.focus),
      entryBarCounts: countBy('entrybar', p =>
        p.entryBar ? [p.entryBar] : []
      ),
      stipendCounts: countBy('stipend', p => (p.stipend ? [p.stipend] : [])),
      lengthCounts: countBy('length', p =>
        p.lengthBucket ? [p.lengthBucket] : []
      ),
      locationCounts: countBy('location', p => locationFacets(p)),
    }
  }, [
    mode,
    modePrograms,
    selectedStatus,
    selectedTypes,
    selectedFocus,
    selectedEntryBar,
    selectedStipend,
    selectedLength,
    selectedLocation,
  ])

  // Upcoming programs are one deadline-ordered list; each card carries its
  // own "Apply by" line, so no month headings. Programs that can't be applied
  // to sit at the bottom, and once the Applications filter shows more than
  // one set the blocks get labels so the switch is obvious. Recurring
  // programs have no dates and stay one flat A–Z grid.
  const sections = useMemo(() => {
    if (mode !== 'upcoming') return []
    const groups: { key: Section; programs: TrainingProgram[] }[] = []
    for (const program of filtered as TrainingProgram[]) {
      const key = sectionFor(program)
      let group = groups.find(g => g.key === key)
      if (!group) {
        group = { key, programs: [] }
        groups.push(group)
      }
      group.programs.push(program)
    }
    return groups
  }, [mode, filtered])

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
  }, [filtered])

  const anyFilterActive =
    selectedTypes.length > 0 ||
    selectedFocus.length > 0 ||
    selectedEntryBar.length > 0 ||
    selectedStipend.length > 0 ||
    selectedLocation.length > 0 ||
    selectedLength.length > 0 ||
    (mode === 'upcoming' && selectedStatus.length > 0)

  const renderCard = (program: ProgramBase) => (
    <ListingCard
      key={program.id}
      {...(mode === 'upcoming'
        ? trainingCardProps(program as TrainingProgram)
        : recurringProgramCardProps(program as RecurringProgram))}
      trackingPage="Training"
      listingId={program.id}
      placement={placements.get(program.id)}
      trackingSource={mode}
    />
  )

  return (
    <>
      <Suspense fallback={null}>
        <ViewParamSync onView={applyViewParam} />
      </Suspense>
      {/* Sticky so it's always clear which of the two program sets is shown */}
      <div ref={toggleAnchorRef} aria-hidden="true" />
      <StickyBar className="margin-bottom-32px">
        <ModeToggle
          mode={mode}
          onChange={switchMode}
          ariaLabel="Program set"
          tabs={[
            {
              value: 'upcoming',
              icon: '/images/icons/calendar.svg',
              label: 'Upcoming',
            },
            {
              value: 'recurring',
              icon: '/images/icons/repeat.svg',
              label: 'Recurring',
            },
          ]}
        />
      </StickyBar>

      {featuredPrograms.length > 0 && (
        <div className="flex flex-wrap gap-56px padding-bottom-80px">
          {featuredPrograms.map((program, i) => (
            <FeaturedCard
              key={program.id}
              className="width-6-col"
              href={program.url !== '#' ? program.url : undefined}
              tagline={
                program.type[0]
                  ? `Featured ${program.type[0].toLowerCase()}`
                  : 'Featured program'
              }
              name={program.name}
              description={program.description}
              logo={program.logo}
              accentClass={
                program.type[0] ? trainingTypeColor(program.type[0]) : undefined
              }
              titleMeta={titleMetaFor(
                program,
                mode === 'upcoming' ? (program as TrainingProgram) : undefined
              )}
              meta={bottomMetaFor(
                program,
                mode === 'upcoming' ? (program as TrainingProgram) : undefined
              )}
              trackingPage="Training"
              trackingId={program.id}
              trackingPosition={placements.get(program.id)}
              trackingSource={mode}
              index={i}
              count={featuredPrograms.length}
            />
          ))}
        </div>
      )}

      <FilterBar
        count={filtered.length}
        noun="program"
        label={`${filtered.length} ${mode} training program${
          filtered.length === 1 ? '' : 's'
        }`}
      >
        {mode === 'upcoming' && (
          <FilterDropdown
            trackingPage="Training"
            title="Applications"
            options={applicationOptions}
            selected={selectedStatus}
            counts={statusCounts}
            onToggle={v => toggleFilter(v, selectedStatus, setSelectedStatus)}
          />
        )}
        <FilterDropdown
          trackingPage="Training"
          title="Type"
          options={[...TRAINING_TYPES]}
          selected={selectedTypes}
          counts={typeCounts}
          onToggle={v => toggleFilter(v, selectedTypes, setSelectedTypes)}
        />
        <FilterDropdown
          trackingPage="Training"
          title="Focus"
          options={focusOptions}
          selected={selectedFocus}
          counts={focusCounts}
          onToggle={v => toggleFilter(v, selectedFocus, setSelectedFocus)}
        />
        <FilterDropdown
          trackingPage="Training"
          title="Entry bar"
          options={[...ENTRY_BARS]}
          selected={selectedEntryBar}
          counts={entryBarCounts}
          onToggle={v => toggleFilter(v, selectedEntryBar, setSelectedEntryBar)}
        />
        <FilterDropdown
          trackingPage="Training"
          title="Stipend"
          options={[...STIPEND_OPTIONS]}
          selected={selectedStipend}
          counts={stipendCounts}
          onToggle={v => toggleFilter(v, selectedStipend, setSelectedStipend)}
        />
        <FilterDropdown
          trackingPage="Training"
          title="Length"
          options={[...LENGTH_BUCKETS]}
          selected={selectedLength}
          counts={lengthCounts}
          onToggle={v => toggleFilter(v, selectedLength, setSelectedLength)}
        />
        <FilterDropdown
          trackingPage="Training"
          title="Location"
          options={locationOptions}
          selected={selectedLocation}
          counts={locationCounts}
          onToggle={v => toggleFilter(v, selectedLocation, setSelectedLocation)}
        />
      </FilterBar>

      <div className="flex gap-56px">
        <div className="width-9-col padding-bottom-80px">
          {mode === 'upcoming' ? (
            sections.map((section, i) => (
              <div
                key={section.key}
                className={i === 0 ? undefined : 'padding-top-32px'}
              >
                {sections.length > 1 && (
                  <p className="paragraph-small color-teal-300 padding-bottom-24px">
                    {SECTION_LABELS[section.key]}
                  </p>
                )}
                <div className="collection-list">
                  {section.programs.map(program => renderCard(program))}
                </div>
              </div>
            ))
          ) : (
            <div className="collection-list">
              {filtered.map(program => renderCard(program))}
            </div>
          )}
          {filtered.length === 0 && (
            <p className="paragraph-small color-teal-300">
              {anyFilterActive
                ? 'No results found based on these filters. Try adjusting them.'
                : mode === 'upcoming'
                  ? 'No upcoming training programs right now.'
                  : 'No recurring training programs right now.'}
            </p>
          )}
        </div>

        <ContributeButtons
          trackingPage="Training"
          sidebar
          suggestEntryUrl={ADD_PROGRAM_URLS[mode]}
          suggestCorrectionUrl={SUGGEST_CORRECTION_URL}
          noun="program"
          airtableUrl={AIRTABLE_VIEW_URLS[mode]}
          airtableNote={
            mode === 'upcoming' ? '(includes past programs)' : undefined
          }
        />
      </div>
    </>
  )
}
