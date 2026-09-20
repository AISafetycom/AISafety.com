'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ListingCard from '@/components/ListingCard'
import { projectCardProps } from './card'
import ContributeButtons from '@/components/ContributeButtons'
import { Project } from '@/lib/data/projects'
import { filterItems, optionCounts } from '@/lib/filter-counts'
import { gridListings, placementsById } from '@/lib/placements'

interface ProjectsClientProps {
  projects: Project[]
}

const statusOptions = ['Active', 'Paused', 'Seeking owner']

const allPass = () => true

export default function ProjectsClient({ projects }: ProjectsClientProps) {
  const [statusFilters, setStatusFilters] = useState<string[]>([])

  // Each project's slot in the full page order; here it only tells the grid
  // which two cards are the featured ones.
  const placements = useMemo(() => placementsById(projects), [projects])

  const groups = useMemo(
    () => ({
      status: {
        selected: statusFilters,
        matches: (project: Project, value: string) => project.status === value,
      },
    }),
    [statusFilters]
  )

  const filteredProjects = useMemo(
    () => filterItems(projects, allPass, groups),
    [projects, groups]
  )

  const filterCounts = useMemo(
    () => ({
      status: optionCounts(
        filterItems(projects, allPass, groups, 'status'),
        statusOptions,
        groups.status.matches
      ),
    }),
    [projects, groups]
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
  }, [filteredProjects])

  // Featured projects show in the grid only once a filter is on; unfiltered,
  // the featured row above already has them.
  const gridProjects = gridListings(
    filteredProjects,
    placements,
    statusFilters.length > 0
  )

  return (
    <>
      <FilterBar count={filteredProjects.length} noun="project">
        <FilterDropdown
          trackingPage="Projects"
          title="Status"
          icon="/images/icons/activity.svg"
          options={statusOptions}
          selected={statusFilters}
          counts={filterCounts.status}
          onToggle={v => toggleFilter(v, statusFilters, setStatusFilters)}
        />
      </FilterBar>

      <div className="flex gap-56px">
        <div className="collection-list padding-bottom-40px width-9-col">
          {gridProjects.map(project => (
            <ListingCard
              key={project.id}
              {...projectCardProps(project)}
              trackingPage="Projects"
            />
          ))}
          {filteredProjects.length === 0 && (
            <p className="paragraph-small color-teal-300">Nothing found.</p>
          )}
        </div>

        <div className="hide-mobile width-3-col">
          <ContributeButtons
            trackingPage="Projects"
            suggestEntryUrl="https://airtable.com/appF8XfZUGXtfi40E/pagudvyKXZISztcOI/form"
            suggestCorrectionUrl="https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form"
            noun="project"
            airtableUrl="https://airtable.com/appF8XfZUGXtfi40E/shrSOZFEW790ANG0Q"
          />
        </div>
      </div>
    </>
  )
}
