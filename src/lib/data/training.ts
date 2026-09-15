import { fetchAirtableRecords, type AirtableRawRecord } from './airtable'
import { fetchPublicData, hasAirtableCredentials } from './public-api'
import {
  ENTRY_BARS,
  TRAINING_TYPES,
  type EntryBar,
  type LengthBucket,
  type TrainingType,
} from '../training-types'
import { parseFeaturedRank } from '../featured'

// The redesigned /training page reads from two tables: "Training" holds
// dated upcoming iterations, "Recurring training" holds evergreen programs
// that run repeatedly (shown under the Recurring toggle, without dates).
export const TRAINING_TABLE_ID = 'tbli1YSCpIuNY2DvL'
export const RECURRING_TABLE_ID = 'tblEEIbj6dW5oS4cX'
// Grid view on "Recurring training" — records come back in the view's order
// (driven by its Sort field), so the page mirrors the table as arranged in
// Airtable.
const RECURRING_VIEW_ID = 'viwbP4fD6gTUeWj49'

// Permanent Airtable field IDs (returnFieldsByFieldId), rename-proof.
const TRAINING_FIELD = {
  name: 'fldNq08J2QqQ8SreD',
  logo: 'fldlVUH5xZ7sNGv0j',
  description: 'fldIRngvk0vjSwjh8',
  url: 'fld1dv9ed8uwiaHh4',
  type: 'fldYhxEyLrNOBWIpY',
  mode: 'fldh2n93X7R478mDW',
  startDate: 'fldQ173rUHJa5MHiA',
  startDateApprox: 'flddeSidJxFZXXwDs',
  endDate: 'fld7Ec5O8m71oZV44',
  deadline: 'fldoBOQpi5ZC6TnwU',
  notYetOpen: 'fldEJLrVPCpawJ6vU',
  location: 'fldbXDQcn21eXLIsj',
  featured: 'fldohjDIPWGdaYbde',
  publish: 'fldqlN36P6BVFP151',
  hide: 'flddDc88G07fcDQu4',
  focus: 'fldvXetgmH68KXi64',
  entryBar: 'fldNGM0Z7xQciYeDW',
  timeCommitment: 'fld55R10v0Pz6Gaxp',
  stipend: 'fldttliZeFMxWW9Hb',
  lastModified: 'fldG0Cn6ozrw0c0N9',
} as const

const RECURRING_FIELD = {
  name: 'fld2ujguXgAB0VIuH',
  logo: 'fld4prSjzf1grRz8g',
  description: 'fldmxKtipDTvG4mes',
  url: 'flda40IiCohiSbKoq',
  type: 'fld86l7WsvLm8jm86',
  mode: 'fldZketwZonfcYWie',
  location: 'fld3wvi1BIj2QSXMV',
  host: 'fldaQgHIMc3RqnFqv',
  featured: 'fldonn5EmegA4Yqlf',
  publish: 'fldpjcvh7n6w4cIsi',
  hide: 'fldnYj4lieZlkXjWB',
  focus: 'fld1yyUL3BM0KQw8l',
  entryBar: 'fld1FGDbT7BJpY7Vi',
  timeCommitment: 'fldU91KGSj2APdDRq',
  stipend: 'fldoHJPQyRJUA8gap',
  typicalLength: 'fldYWSizGyk6GGrwu',
  lastModified: 'fldq0bMboXuM1lYX4',
} as const

/**
 * How participants attend, from the Mode single-select. On training, Hybrid =
 * required online and in-person parts (its own filter option, job-board
 * sense), while 'Online or in person' = the participant chooses (shows under
 * both the Online and In person filters). On events (which keep three modes)
 * Hybrid still means the participant chooses and shows in both views.
 */
export type AttendMode =
  | 'Online'
  | 'In person'
  | 'Hybrid'
  | 'Online or in person'

// Card fields shared by upcoming and recurring programs.
export interface ProgramBase {
  id: string
  dateAdded: string | null
  lastModified: string | null
  name: string
  description: string
  url: string
  type: string[]
  location: string
  mode: AttendMode
  /** Multi-select: General / Technical / Governance — a program can carry more than one. */
  focus: string[]
  entryBar: EntryBar | null
  timeCommitment: string | null
  stipend: string | null
  logo: string | null
  /** Rank in the featured queue — the two lowest live ranks are displayed. */
  featured: number | null
  /** From dates for upcoming programs, from "Typical length" for recurring. */
  lengthBucket: LengthBucket | null
}

export interface TrainingProgram extends ProgramBase {
  startDate: string | null
  /** Org's own wording ("early September 2026"), shown instead of startDate. */
  startDateApprox: string | null
  endDate: string | null
  applicationStatus: 'Open' | 'Closed'
  applicationsClose: string | null
  /** Announced but not yet accepting applications (outranks the deadline). */
  notYetOpen: boolean
}

export interface RecurringProgram extends ProgramBase {
  host: string
  /** How long an iteration typically runs, e.g. "10 weeks", "3–6 months". */
  typicalLength: string | null
}

/**
 * One dated round of a training program or event as recorded in Airtable —
 * past or upcoming. The resource pages drop rounds once they've started or
 * ended; the chatbot's round-history tool reads these so it can answer
 * "when has this run before?" and "will there be another round?" from the
 * site's own records instead of guessing.
 */
export interface ProgramRound {
  id: string
  name: string
  url: string
  description: string
  /** Events only — the organizer, when recorded. */
  host: string | null
  startDate: string | null
  /** Org's own wording ("early September 2026") when the start is approximate. */
  startDateApprox: string | null
  endDate: string | null
  applicationsClose: string | null
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function toArray(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : []
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string')
  }
  return []
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return '#'
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function isUpcomingOrOngoing(
  endDate: string | null,
  startDate: string | null
): boolean {
  const effectiveEnd = endDate || startDate
  if (!effectiveEnd) return true
  const end = new Date(effectiveEnd + 'T23:59:59Z').getTime()
  if (Number.isNaN(end)) return true
  return end >= Date.now()
}

function bucketForDays(days: number): LengthBucket {
  if (days < 30) return 'Under 1 month'
  if (days <= 92) return '1–3 months'
  return '3+ months'
}

function lengthBucketFor(
  startDate: string | null,
  endDate: string | null
): LengthBucket | null {
  if (!startDate || !endDate) return null
  const start = new Date(startDate + 'T00:00:00Z').getTime()
  const end = new Date(endDate + 'T00:00:00Z').getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  const days = Math.round((end - start) / 86_400_000) + 1
  return bucketForDays(days)
}

const TYPICAL_UNIT_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30.44,
  year: 365,
}

// Bucket a "Typical length" string ("10 weeks", "3–6 months", "Up to 2
// years") by the midpoint of its range, on the same thresholds as dated
// programs.
function lengthBucketForTypical(text: string | null): LengthBucket | null {
  if (!text) return null
  const m = text.match(
    /(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*(day|week|month|year)s?/i
  )
  if (!m) {
    console.warn(`[training] Can't parse Typical length "${text}"`)
    return null
  }
  const lo = parseFloat(m[1])
  const hi = m[2] ? parseFloat(m[2]) : lo
  return bucketForDays(((lo + hi) / 2) * TYPICAL_UNIT_DAYS[m[3].toLowerCase()])
}

function validEntryBar(value: unknown, name: string): EntryBar | null {
  const raw = optionalString(value)
  if (!raw) return null
  if ((ENTRY_BARS as readonly string[]).includes(raw)) return raw as EntryBar
  console.warn(
    `[training] "${name}" has unexpected Entry bar "${raw}" (allowed: ${ENTRY_BARS.join(', ')})`
  )
  return null
}

/**
 * Reads the Mode single-select. Records without a valid Mode fall back to
 * the Location, with a warning so they get fixed.
 */
export function parseAttendMode(
  raw: unknown,
  location: string,
  name: string,
  source: string
): AttendMode {
  if (
    raw === 'Online' ||
    raw === 'In person' ||
    raw === 'Hybrid' ||
    raw === 'Online or in person'
  )
    return raw
  console.warn(
    `[${source}] "${name}" has ${
      raw == null ? 'no Mode set' : `unexpected Mode "${raw}"`
    } — falling back to the Location`
  )
  return location.trim().toLowerCase() === 'online' ? 'Online' : 'In person'
}

function validTypes(value: unknown, name: string): string[] {
  const rawTypes = toArray(value)
  for (const t of rawTypes) {
    if (!TRAINING_TYPES.includes(t as TrainingType)) {
      console.warn(
        `[training] "${name}" has unexpected Type "${t}" ` +
          `(allowed: ${TRAINING_TYPES.join(', ')})`
      )
    }
  }
  return rawTypes.filter(t => TRAINING_TYPES.includes(t as TrainingType))
}

interface BaseFieldIds {
  name: string
  logo: string
  description: string
  url: string
  type: string
  mode: string
  location: string
  featured: string
  focus: string
  entryBar: string
  timeCommitment: string
  stipend: string
  lastModified: string
}

function parseBase(
  fields: Record<string, unknown>,
  id: string,
  name: string,
  FIELD: BaseFieldIds
): ProgramBase {
  const location = optionalString(fields[FIELD.location]) || ''
  const mode = parseAttendMode(fields[FIELD.mode], location, name, 'training')
  const logoField = fields[FIELD.logo] as Array<{ url?: string }> | undefined
  const featuredRaw = fields[FIELD.featured]

  return {
    id,
    name,
    description: optionalString(fields[FIELD.description]) || '',
    url: normalizeUrl(optionalString(fields[FIELD.url]) || ''),
    type: validTypes(fields[FIELD.type], name),
    location,
    mode,
    focus: toArray(fields[FIELD.focus]),
    entryBar: validEntryBar(fields[FIELD.entryBar], name),
    timeCommitment: optionalString(fields[FIELD.timeCommitment]),
    stipend: optionalString(fields[FIELD.stipend]),
    logo: logoField?.[0]?.url ?? null,
    featured: parseFeaturedRank(featuredRaw),
    dateAdded: null, // overridden by each caller (needs the record's createdTime)
    lastModified:
      optionalString(fields[FIELD.lastModified])?.slice(0, 10) ?? null,
    lengthBucket: null, // overridden by each caller from its own source
  }
}

/**
 * One Training record (fields keyed by field id) → the dated program the
 * page renders, or null when the site would skip it (no name). Publish/Hide
 * and the date cut-offs are getTrainingPrograms()'s filters, not the
 * mapper's, so an unpublished or draft record can still be mapped — the
 * admin Queue previews proposed records through this. `today` (YYYY-MM-DD)
 * decides Open/Closed against the deadline; it defaults to the current
 * date, and getTrainingPrograms() passes one value for the whole batch.
 */
export function trainingProgramFromRecord(
  record: AirtableRawRecord,
  today: string = new Date().toISOString().slice(0, 10)
): TrainingProgram | null {
  const f = record.fields
  const name = optionalString(f[TRAINING_FIELD.name])
  if (!name) return null

  const startDate = optionalString(f[TRAINING_FIELD.startDate])
  const endDate = optionalString(f[TRAINING_FIELD.endDate])
  const closesOn = optionalString(f[TRAINING_FIELD.deadline])

  // No close date means applications are open-ended — unless applications
  // haven't opened yet, which outranks any deadline (orgs sometimes
  // announce the deadline before opening). See the field descriptions on
  // the Training table.
  const notYetOpen = f[TRAINING_FIELD.notYetOpen] === true
  const applicationStatus: 'Open' | 'Closed' =
    !notYetOpen && (!closesOn || closesOn >= today) ? 'Open' : 'Closed'

  return {
    ...parseBase(f, record.id, name, TRAINING_FIELD),
    dateAdded: record.createdTime?.slice(0, 10) ?? null,
    startDate,
    startDateApprox:
      optionalString(f[TRAINING_FIELD.startDateApprox])?.trim() || null,
    endDate,
    applicationStatus,
    applicationsClose: closesOn,
    notYetOpen,
    lengthBucket: lengthBucketFor(startDate, endDate),
  }
}

export async function getTrainingPrograms(): Promise<TrainingProgram[]> {
  if (!hasAirtableCredentials()) {
    const all = await fetchPublicData<TrainingProgram & { recurring: boolean }>(
      'training'
    )
    return all.filter(p => !p.recurring)
  }

  // Publish/Hide filtering and sorting happen in code below rather than in
  // the Airtable query — filterByFormula and sort reference fields by name,
  // which would break when a field is renamed.
  const raw = await fetchAirtableRecords({
    tableId: TRAINING_TABLE_ID,
    returnFieldsByFieldId: true,
  })

  const today = new Date().toISOString().slice(0, 10)
  const results: TrainingProgram[] = []

  for (const record of raw) {
    const f = record.fields
    if (f[TRAINING_FIELD.publish] !== true || f[TRAINING_FIELD.hide] === true)
      continue

    const startDate = optionalString(f[TRAINING_FIELD.startDate])
    const endDate = optionalString(f[TRAINING_FIELD.endDate])
    if (!isUpcomingOrOngoing(endDate, startDate)) continue

    // A program leaves the page once its start date has passed; until then
    // a passed deadline only marks it Closed, and the Applications filter
    // (defaulting to Open) hides it. Dateless programs stay indefinitely.
    if (startDate && startDate < today) continue

    const program = trainingProgramFromRecord(record, today)
    if (!program) continue
    results.push(program)
  }

  // Order by start date (soonest first), programs without a start date
  // after that. This is the order the public API serves; the /training page
  // itself re-sorts by application deadline (see TrainingClient).
  results.sort((a, b) => {
    if (!a.startDate && !b.startDate) return 0
    if (!a.startDate) return 1
    if (!b.startDate) return -1
    return a.startDate.localeCompare(b.startDate)
  })

  return results
}

/**
 * Every published, non-hidden round in the Training table, past and
 * upcoming, in table order. getTrainingPrograms() drops rounds once they've
 * started; the chatbot's round-history tool needs those too. Same raw fetch
 * (identical arguments) as getTrainingPrograms, so both read one cached
 * Airtable result.
 */
export async function getTrainingRounds(): Promise<ProgramRound[]> {
  // The public Data API serves only what the live page shows, so contributor
  // mode has no round history to offer (the chatbot needs credentials anyway).
  if (!hasAirtableCredentials()) return []

  const raw = await fetchAirtableRecords({
    tableId: TRAINING_TABLE_ID,
    returnFieldsByFieldId: true,
  })

  const rounds: ProgramRound[] = []
  for (const record of raw) {
    const f = record.fields
    const name = optionalString(f[TRAINING_FIELD.name])
    if (!name) continue
    if (f[TRAINING_FIELD.publish] !== true || f[TRAINING_FIELD.hide] === true)
      continue
    rounds.push({
      id: record.id,
      name,
      url: normalizeUrl(optionalString(f[TRAINING_FIELD.url]) || ''),
      description: optionalString(f[TRAINING_FIELD.description]) || '',
      host: null,
      startDate: optionalString(f[TRAINING_FIELD.startDate]),
      startDateApprox:
        optionalString(f[TRAINING_FIELD.startDateApprox])?.trim() || null,
      endDate: optionalString(f[TRAINING_FIELD.endDate]),
      applicationsClose: optionalString(f[TRAINING_FIELD.deadline]),
    })
  }
  return rounds
}

/**
 * One Training (recurring) record (fields keyed by field id) → the evergreen
 * program the page renders, or null when the site would skip it (no name).
 * Publish/Hide filtering stays in getRecurringPrograms(), so an unpublished
 * record can still be mapped — the admin Queue previews proposed records
 * through this.
 */
export function recurringProgramFromRecord(
  record: AirtableRawRecord
): RecurringProgram | null {
  const f = record.fields
  const name = optionalString(f[RECURRING_FIELD.name])
  if (!name) return null

  const typicalLength = optionalString(f[RECURRING_FIELD.typicalLength])
  return {
    ...parseBase(f, record.id, name, RECURRING_FIELD),
    dateAdded: record.createdTime?.slice(0, 10) ?? null,
    host: optionalString(f[RECURRING_FIELD.host]) || '',
    typicalLength,
    lengthBucket: lengthBucketForTypical(typicalLength),
  }
}

export async function getRecurringPrograms(): Promise<RecurringProgram[]> {
  if (!hasAirtableCredentials()) {
    const all = await fetchPublicData<
      RecurringProgram & { recurring: boolean }
    >('training')
    return all.filter(p => p.recurring)
  }

  const raw = await fetchAirtableRecords({
    tableId: RECURRING_TABLE_ID,
    viewId: RECURRING_VIEW_ID,
    returnFieldsByFieldId: true,
  })

  const results: RecurringProgram[] = []

  for (const record of raw) {
    const f = record.fields
    if (f[RECURRING_FIELD.publish] !== true || f[RECURRING_FIELD.hide] === true)
      continue

    const program = recurringProgramFromRecord(record)
    if (!program) continue
    results.push(program)
  }

  // Order comes from the Airtable view (RECURRING_VIEW_ID) — no sorting here.
  return results
}
