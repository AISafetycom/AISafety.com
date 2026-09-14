'use client'

import { useState, useMemo, useRef, useLayoutEffect, useEffect } from 'react'
import FilterBar from '@/components/FilterBar'
import FilterDropdown from '@/components/FilterDropdown'
import ListingCard from '@/components/ListingCard'
import { Job } from '@/lib/data/jobs'
import { withUtm } from '@/lib/utm'
import { placementsById } from '@/lib/placements'
import { setPageContext } from '@/lib/assistant/page-context'
import { filterItems, optionCounts } from '@/lib/filter-counts'

interface JobsClientProps {
  jobs: Job[]
}

const skillSetOptions = [
  'Data',
  'Information security',
  'Legal',
  'Management',
  'Operations',
  'Other',
  'Outreach',
  'Policy',
  'Research',
  'Software engineering',
  'Strategy',
]

const experienceOptions = [
  'Entry-level',
  'Junior (1–4 years experience)',
  'Mid (5–9 years experience)',
  'Senior (10+ years experience)',
]

// The 80k !Role type field mixes two independent things, so we split it into
// two filters: how much time the role takes (Commitment) and what kind of
// position it is (Type).
const commitmentOptions = ['Full-time', 'Part-time']

// "Regular role" is the default: a job with none of the special tokens below.
// Fellowship / Funding / Course / Volunteering listings never reach the site
// (the Airtable view excludes them), so the only non-regular kinds left here
// are internships and the catch-all "Other".
const typeOptions = ['Regular role', 'Internship', 'Other']

// Tokens that make a role something other than a "Regular role".
const SPECIAL_ROLE_TOKENS = ['Internship', 'Other']

// Type tokens shown on the card — the special ones only, so a regular role
// shows no Type row.
const DISPLAY_TYPE_TOKENS = typeOptions.filter(t => t !== 'Regular role')

const roleTokens = (job: Job) =>
  job.roleType
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)

const workLocationOptions = ['Remote', 'On-site']

// 80k sometimes lists a region instead of a country ("Europe", "Various,
// Europe", "Remote (Europe)"). Those roles are available from any country
// in the region, so they match every member country in the filter. Only
// "Europe" appears in the data today; the other regions are listed so the
// same behavior kicks in automatically if 80k ever uses them.
const REGION_MEMBERS: Record<string, Set<string>> = {
  Europe: new Set([
    'UK',
    'Ireland',
    'France',
    'Germany',
    'Netherlands',
    'Belgium',
    'Luxembourg',
    'Switzerland',
    'Austria',
    'Denmark',
    'Norway',
    'Sweden',
    'Finland',
    'Iceland',
    'Spain',
    'Portugal',
    'Italy',
    'Greece',
    'Poland',
    'Czechia',
    'Czech Republic',
    'Slovakia',
    'Hungary',
    'Romania',
    'Bulgaria',
    'Croatia',
    'Serbia',
    'Slovenia',
    'Estonia',
    'Latvia',
    'Lithuania',
    'Ukraine',
  ]),
  Asia: new Set([
    'China',
    'India',
    'Japan',
    'Singapore',
    'South Korea',
    'Taiwan',
    'Hong Kong',
    'Indonesia',
    'Malaysia',
    'Thailand',
    'Vietnam',
    'Philippines',
    'Israel',
    'United Arab Emirates',
    'UAE',
    'Saudi Arabia',
    'Turkey',
  ]),
  'Middle East': new Set([
    'Israel',
    'United Arab Emirates',
    'UAE',
    'Saudi Arabia',
    'Qatar',
    'Turkey',
    'Jordan',
    'Egypt',
  ]),
  'North America': new Set(['USA', 'Canada', 'Mexico']),
  'Latin America': new Set([
    'Mexico',
    'Brazil',
    'Argentina',
    'Chile',
    'Colombia',
    'Peru',
    'Uruguay',
    'Costa Rica',
  ]),
  'South America': new Set([
    'Brazil',
    'Argentina',
    'Chile',
    'Colombia',
    'Peru',
    'Uruguay',
  ]),
  Africa: new Set([
    'South Africa',
    'Nigeria',
    'Kenya',
    'Ghana',
    'Egypt',
    'Morocco',
    'Rwanda',
    'Uganda',
  ]),
  Oceania: new Set(['Australia', 'New Zealand']),
}

const REGION_NAMES = Object.keys(REGION_MEMBERS)

const jobMatchesCountry = (job: Job, country: string) =>
  job.countries.includes(country) ||
  REGION_NAMES.some(
    region =>
      REGION_MEMBERS[region].has(country) && job.countries.includes(region)
  )

const degreeOptions = [
  'Undergraduate degree or less',
  "Master's degree",
  'Doctoral degree',
]

const allPass = () => true

export default function JobsClient({ jobs }: JobsClientProps) {
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [selectedExperience, setSelectedExperience] = useState<string[]>([])
  const [selectedCommitment, setSelectedCommitment] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedWorkLocation, setSelectedWorkLocation] = useState<string[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [selectedDegrees, setSelectedDegrees] = useState<string[]>([])
  const savedScrollY = useRef<number | null>(null)

  // Each job's slot in the full page order, stamped onto a click so the
  // dashboard can tie clicks to page position even after later reordering.
  const placements = useMemo(() => placementsById(jobs), [jobs])

  // Countries come from the data itself; only those with a meaningful
  // number of jobs get a checkbox, ordered by overall job count (the
  // order stays put while filtering). "Other" collects jobs in the
  // remaining countries.
  const countryOptions = useMemo(() => {
    const raw: Record<string, number> = {}
    for (const job of jobs) {
      for (const country of job.countries) {
        raw[country] = (raw[country] || 0) + 1
      }
    }
    const options = Object.keys(raw).filter(
      c => !(c in REGION_MEMBERS) && raw[c] >= 5
    )
    const totals: Record<string, number> = {}
    for (const option of options) {
      totals[option] = jobs.filter(job => jobMatchesCountry(job, option)).length
    }
    options.sort((a, b) => totals[b] - totals[a])
    options.push('Other')
    return options
  }, [jobs])

  const groups = useMemo(() => {
    const named = new Set(countryOptions.filter(c => c !== 'Other'))
    return {
      skill: {
        selected: selectedSkills,
        matches: (job: Job, value: string) =>
          job.skillSet
            .split(',')
            .map(s => s.trim())
            .includes(value),
      },
      experience: {
        selected: selectedExperience,
        matches: (job: Job, value: string) =>
          job.minimumExperience
            .split(',')
            .map(e => e.trim())
            .includes(value),
      },
      commitment: {
        selected: selectedCommitment,
        matches: (job: Job, value: string) => roleTokens(job).includes(value),
      },
      type: {
        selected: selectedTypes,
        matches: (job: Job, value: string) =>
          value === 'Regular role'
            ? !roleTokens(job).some(t => SPECIAL_ROLE_TOKENS.includes(t))
            : roleTokens(job).includes(value),
      },
      workLocation: {
        selected: selectedWorkLocation,
        matches: (job: Job, value: string) => job.workLocation === value,
      },
      country: {
        selected: selectedCountries,
        matches: (job: Job, value: string) =>
          value === 'Other'
            ? job.countries.some(c => !named.has(c))
            : jobMatchesCountry(job, value),
      },
      degree: {
        selected: selectedDegrees,
        matches: (job: Job, value: string) => job.requiredDegree === value,
      },
    }
  }, [
    selectedSkills,
    selectedExperience,
    selectedCommitment,
    selectedTypes,
    selectedWorkLocation,
    selectedCountries,
    selectedDegrees,
    countryOptions,
  ])

  const filteredJobs = useMemo(
    () => filterItems(jobs, allPass, groups),
    [jobs, groups]
  )

  const skillCounts = useMemo(
    () =>
      optionCounts(
        filterItems(jobs, allPass, groups, 'skill'),
        skillSetOptions,
        groups.skill.matches
      ),
    [jobs, groups]
  )

  const experienceCounts = useMemo(
    () =>
      optionCounts(
        filterItems(jobs, allPass, groups, 'experience'),
        experienceOptions,
        groups.experience.matches
      ),
    [jobs, groups]
  )

  const commitmentCounts = useMemo(
    () =>
      optionCounts(
        filterItems(jobs, allPass, groups, 'commitment'),
        commitmentOptions,
        groups.commitment.matches
      ),
    [jobs, groups]
  )

  const typeCounts = useMemo(
    () =>
      optionCounts(
        filterItems(jobs, allPass, groups, 'type'),
        typeOptions,
        groups.type.matches
      ),
    [jobs, groups]
  )

  const workLocationCounts = useMemo(
    () =>
      optionCounts(
        filterItems(jobs, allPass, groups, 'workLocation'),
        workLocationOptions,
        groups.workLocation.matches
      ),
    [jobs, groups]
  )

  const countryCounts = useMemo(
    () =>
      optionCounts(
        filterItems(jobs, allPass, groups, 'country'),
        countryOptions,
        groups.country.matches
      ),
    [jobs, groups, countryOptions]
  )

  const degreeCounts = useMemo(
    () =>
      optionCounts(
        filterItems(jobs, allPass, groups, 'degree'),
        degreeOptions,
        groups.degree.matches
      ),
    [jobs, groups]
  )

  const toggleFilter = (
    value: string,
    current: string[],
    setter: (v: string[]) => void
  ) => {
    savedScrollY.current = window.scrollY
    if (current.includes(value)) {
      setter(current.filter(v => v !== value))
    } else {
      setter([...current, value])
    }
  }

  useLayoutEffect(() => {
    if (savedScrollY.current !== null) {
      window.scrollTo(0, savedScrollY.current)
      savedScrollY.current = null
    }
  }, [filteredJobs])

  // Publish current filter state for the assistant to read
  useEffect(() => {
    const state: Record<string, unknown> = {}
    if (selectedSkills.length) state.skills = selectedSkills
    if (selectedExperience.length) state.experience = selectedExperience
    if (selectedCommitment.length) state.commitment = selectedCommitment
    if (selectedTypes.length) state.roleType = selectedTypes
    if (selectedWorkLocation.length) state.workLocation = selectedWorkLocation
    if (selectedCountries.length) state.countries = selectedCountries
    if (selectedDegrees.length) state.requiredDegree = selectedDegrees
    setPageContext({
      page: '/jobs',
      filters: Object.keys(state).length > 0 ? state : undefined,
    })
    return () => setPageContext(null)
  }, [
    selectedSkills,
    selectedExperience,
    selectedCommitment,
    selectedTypes,
    selectedWorkLocation,
    selectedCountries,
    selectedDegrees,
  ])

  return (
    <>
      {/* Ordered by real filter usage (Skill set > Minimum experience >
          Role type > Work location > Location > Required degree). The old
          "Role type" is now split into Commitment + Type, which take its slot. */}
      <FilterBar count={filteredJobs.length} noun="job">
        <FilterDropdown
          trackingPage="Jobs"
          title="Skill set"
          icon="/images/icons/wrench.svg"
          options={skillSetOptions}
          selected={selectedSkills}
          counts={skillCounts}
          onToggle={v => toggleFilter(v, selectedSkills, setSelectedSkills)}
        />
        <FilterDropdown
          trackingPage="Jobs"
          title="Minimum experience"
          icon="/images/icons/briefcase.svg"
          options={experienceOptions}
          selected={selectedExperience}
          counts={experienceCounts}
          onToggle={v =>
            toggleFilter(v, selectedExperience, setSelectedExperience)
          }
        />
        <FilterDropdown
          trackingPage="Jobs"
          title="Commitment"
          icon="/images/icons/timer.svg"
          options={commitmentOptions}
          selected={selectedCommitment}
          counts={commitmentCounts}
          onToggle={v =>
            toggleFilter(v, selectedCommitment, setSelectedCommitment)
          }
        />
        <FilterDropdown
          trackingPage="Jobs"
          title="Type"
          icon="/images/icons/person-alt.svg"
          options={typeOptions}
          selected={selectedTypes}
          counts={typeCounts}
          onToggle={v => toggleFilter(v, selectedTypes, setSelectedTypes)}
        />
        <FilterDropdown
          trackingPage="Jobs"
          title="Remote or on-site"
          icon="/images/icons/computer.svg"
          options={workLocationOptions}
          selected={selectedWorkLocation}
          counts={workLocationCounts}
          onToggle={v =>
            toggleFilter(v, selectedWorkLocation, setSelectedWorkLocation)
          }
        />
        <FilterDropdown
          trackingPage="Jobs"
          title="Location"
          icon="/images/icons/pin.svg"
          options={countryOptions}
          selected={selectedCountries}
          counts={countryCounts}
          onToggle={v =>
            toggleFilter(v, selectedCountries, setSelectedCountries)
          }
        />
        <FilterDropdown
          trackingPage="Jobs"
          title="Required degree"
          icon="/images/icons/grad-cap.svg"
          options={degreeOptions}
          selected={selectedDegrees}
          counts={degreeCounts}
          onToggle={v => toggleFilter(v, selectedDegrees, setSelectedDegrees)}
        />
      </FilterBar>

      <div className="flex gap-56px">
        <div className="collection-list padding-bottom-40px width-9-col">
          {filteredJobs.map(job => {
            const posted = job.datePublished
              ? new Date(job.datePublished + 'T00:00:00').toLocaleDateString(
                  'en-GB',
                  { day: 'numeric', month: 'long', year: 'numeric' }
                )
              : null
            const tokens = roleTokens(job)
            const commitmentValue = tokens
              .filter(t => commitmentOptions.includes(t))
              .join(' · ')
            // Special types only; empty for a regular role, which then shows
            // no Type row.
            const typeValue = tokens
              .filter(t => DISPLAY_TYPE_TOKENS.includes(t))
              .join(' · ')
            return (
              <ListingCard
                key={job.id}
                href={job.url}
                name={job.name}
                // Keeps the pre-redesign analytics name — 80,000 Hours reuses
                // titles across orgs, so the org is what makes a row unique.
                trackingName={`${job.name} – ${job.organization}`}
                description={job.summary}
                logo={job.logo}
                titleMeta={[
                  ...(job.organization
                    ? [
                        {
                          icon: '/images/icons/building.svg',
                          value: job.organization,
                        },
                      ]
                    : []),
                  ...(job.locations.length
                    ? [
                        {
                          icon: '/images/icons/pin.svg',
                          value: job.locations.join(' · '),
                        },
                      ]
                    : []),
                ]}
                meta={[
                  ...(job.skillSet
                    ? [
                        {
                          icon: '/images/icons/wrench.svg',
                          value: `Skillset: ${job.skillSet}`,
                        },
                      ]
                    : []),
                  ...(job.minimumExperience
                    ? [
                        {
                          icon: '/images/icons/briefcase.svg',
                          value: `Min experience: ${job.minimumExperience}`,
                        },
                      ]
                    : []),
                  // "Undergraduate degree or less" is the no-op baseline — hide
                  // it unless the visitor has explicitly filtered for it.
                  ...(job.requiredDegree &&
                  (job.requiredDegree !== 'Undergraduate degree or less' ||
                    selectedDegrees.includes('Undergraduate degree or less'))
                    ? [
                        {
                          icon: '/images/icons/grad-cap.svg',
                          value: job.requiredDegree,
                        },
                      ]
                    : []),
                  ...(commitmentValue
                    ? [
                        {
                          // Part-time gets the half timer, like the training
                          // page; anything including full-time gets the full one.
                          icon:
                            commitmentValue === 'Part-time'
                              ? '/images/icons/timer-half.svg'
                              : '/images/icons/timer.svg',
                          value: commitmentValue,
                        },
                      ]
                    : []),
                  ...(typeValue
                    ? [
                        {
                          icon: '/images/icons/person-alt.svg',
                          value: typeValue,
                        },
                      ]
                    : []),
                  // Compensation last so its presence/absence never shifts the
                  // rows above it.
                  ...(job.salary
                    ? [{ icon: '/images/icons/money.svg', value: job.salary }]
                    : []),
                ]}
                footnote={posted ? `Posted ${posted}` : undefined}
                trackingPage="Jobs"
                listingId={job.id}
                placement={placements.get(job.id)}
                trackingSource="cards"
              />
            )
          })}
          {filteredJobs.length === 0 && (
            <p className="paragraph-small color-teal-300">Nothing found.</p>
          )}
        </div>

        <div className="hide-mobile width-3-col">
          <p className="paragraph-small padding-bottom-4px">Source:</p>
          <a
            href={withUtm('https://jobs.80000hours.org/', 'Jobs')}
            target="_blank"
            rel="noopener noreferrer"
            className="color-light-teal"
          >
            80,000 Hours Job Board
          </a>
        </div>
      </div>
    </>
  )
}
