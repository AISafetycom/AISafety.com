// Vocabulary and pure helpers for the /hire page and the chatbot's `person`
// listings. Dependency-free so the page, the catalog, the tools and the tests
// share one definition of every option label: a filter value the assistant
// sets must be spelled exactly like the pill the visitor sees.
//
// The people come from Mangrove One (src/lib/data/people.ts). Focus areas are
// Mangrove's own labels and vary with the data, so those options are derived
// from the loaded people; the other three groups are fixed buckets computed
// per person.

export const PROJECT_STATUSES = [
  'Current',
  'Active',
  'Debrief',
  'Completed',
  'Left',
  'Cancelled',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Capacity buckets from maxHoursPerWeek. */
export const HOURS_BUCKETS = [
  'Up to 10 hours',
  '10–20 hours',
  '20+ hours',
] as const
export type HoursBucket = (typeof HOURS_BUCKETS)[number]

/** Broad location from the member's IANA time zone (Mangrove sends no city
 *  yet; when it does, the card can show it, but the filter stays coarse). */
export const REGIONS = [
  'Europe',
  'Americas',
  'Asia',
  'Australia & Pacific',
  'Africa',
] as const
export type Region = (typeof REGIONS)[number]

export const TRACK_RECORD_OPTIONS = [
  'Led a project',
  'Completed a project',
  'Has public artifacts',
] as const
export type TrackRecord = (typeof TRACK_RECORD_OPTIONS)[number]

/** The filter groups on /hire, in the order the pills appear. Also the shape
 *  the assistant's set_page_filters tool sends. */
export interface PeopleFilters {
  focus: string[]
  hours: string[]
  region: string[]
  track: string[]
}
export type PeopleFilterKey = keyof PeopleFilters

export const PEOPLE_FILTER_KEYS: PeopleFilterKey[] = [
  'focus',
  'hours',
  'region',
  'track',
]

export const PEOPLE_FILTER_LABELS: Record<PeopleFilterKey, string> = {
  focus: 'Focus',
  hours: 'Hours per week',
  region: 'Location',
  track: 'Track record',
}

export const EMPTY_PEOPLE_FILTERS: PeopleFilters = {
  focus: [],
  hours: [],
  region: [],
  track: [],
}

export type PeopleFilterOptions = Record<PeopleFilterKey, string[]>

/** The facets a person exposes to the filters — the subset of a Person the
 *  matcher needs, so the pure helpers don't depend on the data module. */
export interface PersonFacets {
  focusAreas: readonly string[]
  hoursBucket: string | null
  region: string
  track: readonly string[]
}

export function hoursBucketFor(
  maxHoursPerWeek: number | null
): HoursBucket | null {
  if (maxHoursPerWeek == null) return null
  if (maxHoursPerWeek <= 10) return 'Up to 10 hours'
  if (maxHoursPerWeek <= 20) return '10–20 hours'
  return '20+ hours'
}

/** "Europe/London" → "Europe"; the zone's continent prefix, with the IANA
 *  oddities folded in (Atlantic/Indian islands go with their nearest region). */
export function regionForTimeZone(timeZone: string): Region {
  const prefix = timeZone.split('/')[0]
  switch (prefix) {
    case 'Europe':
      return 'Europe'
    case 'America':
    case 'Atlantic':
      return 'Americas'
    case 'Asia':
    case 'Indian':
      return 'Asia'
    case 'Australia':
    case 'Pacific':
      return 'Australia & Pacific'
    case 'Africa':
      return 'Africa'
    default:
      // UTC, Etc/GMT+N and the like: nothing geographic to go on.
      return 'Europe'
  }
}

/** The track-record facets a project history earns. */
export function trackRecordFor(
  projects: readonly {
    status: string
    role: string
    artifacts: readonly unknown[]
  }[],
  profileArtifactCount: number
): TrackRecord[] {
  const out: TrackRecord[] = []
  if (projects.some(p => p.role === 'Project lead')) out.push('Led a project')
  if (projects.some(p => p.status === 'Completed'))
    out.push('Completed a project')
  if (profileArtifactCount > 0 || projects.some(p => p.artifacts.length > 0))
    out.push('Has public artifacts')
  return out
}

const FOCUS_COLOR: Record<string, string> = {
  Interpretability: 'color-orange',
  'Evals & benchmarks': 'color-bright-green',
  'Agent safety': 'color-blue',
  'Alignment theory': 'color-purple',
  'Governance & policy': 'color-yellow',
  'Security & cyber': 'color-pink',
  Biosecurity: 'color-light-teal',
  'Robustness & adversarial': 'color-teal-bright-400',
  'Forecasting & strategy': 'color-teal-bright-300',
  'Field-building & community': 'color-teal-300',
}

/** Colour utility class for a focus-area pill (same palette as the training
 *  and event type pills). Labels Mangrove adds later get the default pill. */
export function focusAreaColor(label: string): string {
  return FOCUS_COLOR[label] ?? 'color-teal-bright-400'
}

const STATUS_COLOR: Record<ProjectStatus, string> = {
  Current: 'color-bright-green',
  Active: 'color-blue',
  Debrief: 'color-yellow',
  Completed: 'color-teal-bright-400',
  Left: 'color-teal-300',
  Cancelled: 'color-orange',
}

export function projectStatusColor(status: string): string {
  return STATUS_COLOR[status as ProjectStatus] ?? 'color-teal-bright-400'
}

/** The options each pill offers for this set of people: focus labels as they
 *  occur in the data (most common first), fixed buckets for the rest but only
 *  the regions that actually appear. */
export function peopleFilterOptions(
  people: readonly PersonFacets[]
): PeopleFilterOptions {
  const focusCounts = new Map<string, number>()
  const regions = new Set<string>()
  for (const p of people) {
    for (const f of p.focusAreas)
      focusCounts.set(f, (focusCounts.get(f) ?? 0) + 1)
    regions.add(p.region)
  }
  return {
    focus: [...focusCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label]) => label),
    hours: [...HOURS_BUCKETS],
    region: REGIONS.filter(r => regions.has(r)),
    track: [...TRACK_RECORD_OPTIONS],
  }
}

/** Keeps only values that are real option labels for their group, so a typo
 *  from the model (or a stale shared link) can never leave a phantom filter
 *  selected. Unknown keys are dropped. */
export function sanitizePeopleFilters(
  input: Record<string, unknown> | null | undefined,
  options: PeopleFilterOptions
): Partial<PeopleFilters> {
  const out: Partial<PeopleFilters> = {}
  if (!input) return out
  for (const key of PEOPLE_FILTER_KEYS) {
    const raw = input[key]
    if (raw === undefined) continue
    const values = Array.isArray(raw) ? raw : [raw]
    const allowed = options[key]
    out[key] = values.filter(
      (v): v is string => typeof v === 'string' && allowed.includes(v)
    )
  }
  return out
}

/** Whether a person passes every filter group; pass `skip` to ignore one
 *  group (used for that group's faceted counts, like the other pages). */
export function matchesPeopleFilters(
  person: PersonFacets,
  filters: PeopleFilters,
  skip?: PeopleFilterKey
): boolean {
  if (
    skip !== 'focus' &&
    filters.focus.length > 0 &&
    !person.focusAreas.some(f => filters.focus.includes(f))
  )
    return false
  if (
    skip !== 'hours' &&
    filters.hours.length > 0 &&
    !(person.hoursBucket && filters.hours.includes(person.hoursBucket))
  )
    return false
  if (
    skip !== 'region' &&
    filters.region.length > 0 &&
    !filters.region.includes(person.region)
  )
    return false
  if (
    skip !== 'track' &&
    filters.track.length > 0 &&
    !person.track.some(t => filters.track.includes(t))
  )
    return false
  return true
}

/** "Focus: Evals & benchmarks · Location: Europe" — how a filter set reads in
 *  the chatbot's tool pill and its tool result. */
export function describePeopleFilters(filters: Partial<PeopleFilters>): string {
  const parts: string[] = []
  for (const key of PEOPLE_FILTER_KEYS) {
    const values = filters[key]
    if (!values) continue
    parts.push(
      `${PEOPLE_FILTER_LABELS[key]}: ${values.length ? values.join(', ') : 'any'}`
    )
  }
  return parts.join(' · ')
}
