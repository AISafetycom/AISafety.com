'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ListingCard from '@/components/ListingCard'
import ContributeButtons from '@/components/ContributeButtons'
import type { Course } from '@/lib/data/self-study'
import { placementsById } from '@/lib/placements'
import { courseCardProps } from './card'

interface SelfStudyClientProps {
  courses: Course[]
}

// Must match the raw values stored in Airtable's Focus/Format fields.
const categoryOptions = [
  'General intro',
  'Technical alignment',
  'Governance',
  'Strategy',
]

const typeOptions = ['Curriculum', 'Reading list']

export default function SelfStudyClient({ courses }: SelfStudyClientProps) {
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])

  // Each course's slot in the full page order, stamped onto a click so the
  // dashboard can tie clicks to page position even after later reordering.
  const placements = useMemo(() => placementsById(courses), [courses])

  // Each dropdown's counts are faceted (same system as /events and
  // /training): an option's number is how many courses would show if you
  // picked it, i.e. it respects the OTHER dropdown but not the dropdown's
  // own, so multi-selecting within one dropdown stays possible.
  const { filteredCourses, categoryCounts, typeCounts } = useMemo(() => {
    const facets = (value: string) => value.split(',').map(v => v.trim())

    const matchesFilters = (course: Course, skip?: string) => {
      if (
        skip !== 'category' &&
        selectedCategories.length > 0 &&
        !facets(course.category).some(c => selectedCategories.includes(c))
      )
        return false
      if (
        skip !== 'type' &&
        selectedTypes.length > 0 &&
        !facets(course.courseType).some(t => selectedTypes.includes(t))
      )
        return false
      return true
    }

    const countBy = (skip: string, extract: (c: Course) => string[]) => {
      const counts: Record<string, number> = {}
      for (const course of courses) {
        if (!matchesFilters(course, skip)) continue
        for (const key of extract(course)) counts[key] = (counts[key] || 0) + 1
      }
      return counts
    }

    return {
      filteredCourses: courses.filter(c => matchesFilters(c)),
      categoryCounts: countBy('category', c => facets(c.category)),
      typeCounts: countBy('type', c => facets(c.courseType)),
    }
  }, [courses, selectedCategories, selectedTypes])

  // Preserve scroll position when toggling a filter re-renders the list.
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
  }, [filteredCourses])

  return (
    <>
      {/* FilterBar lives above the grid (not inside the left column) so the
          cards and the Contribute/Airtable column both start at the same top. */}
      <FilterBar count={filteredCourses.length} noun="course">
        <FilterDropdown
          trackingPage="Self-study"
          title="Focus"
          icon="/images/icons/category.svg"
          options={categoryOptions}
          selected={selectedCategories}
          counts={categoryCounts}
          onToggle={v =>
            toggleFilter(v, selectedCategories, setSelectedCategories)
          }
        />
        <FilterDropdown
          trackingPage="Self-study"
          title="Format"
          icon="/images/icons/type.svg"
          options={typeOptions}
          selected={selectedTypes}
          counts={typeCounts}
          onToggle={v => toggleFilter(v, selectedTypes, setSelectedTypes)}
        />
      </FilterBar>

      <div className="flex gap-56px">
        <div className="collection-list padding-bottom-40px width-9-col">
          {filteredCourses.map(course => (
            <ListingCard
              key={course.id}
              {...courseCardProps(course)}
              trackingPage="Self-study"
              listingId={course.id}
              placement={placements.get(course.id)}
            />
          ))}
          {filteredCourses.length === 0 && (
            <p className="paragraph-small color-teal-300">Nothing found.</p>
          )}
        </div>

        <div className="hide-mobile width-3-col">
          <ContributeButtons
            trackingPage="Self-study"
            suggestEntryUrl="https://airtable.com/appF8XfZUGXtfi40E/pag6L4BzdkxocBzqr/form"
            suggestCorrectionUrl="https://airtable.com/appF8XfZUGXtfi40E/pagndDvdya1DSqoxN/form"
            noun="course"
            airtableUrl="https://airtable.com/appF8XfZUGXtfi40E/shrOkWNUJKcfgCSiB"
          />
        </div>
      </div>
    </>
  )
}
