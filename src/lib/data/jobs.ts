import {
  fetchAirtableRecords,
  fieldAttachmentUrl,
  fieldString,
  fieldText,
} from './airtable'
import { fetchPublicData, hasAirtableCredentials } from './public-api'

const TABLE_ID = 'tblyLelYCQjP6w3nV'
const VIEW_ID = 'viwBfn9CIUVqQHUy6'

// Permanent Airtable field IDs for the Jobs table. Fetching and selecting
// by ID keeps the page working when fields are renamed.
const FIELD = {
  title: 'fldDVJcmd66eF3E7c', // !Title
  description: 'fldZY5rS7RSw3G6vw', // !Description
  org: 'fldG5yHF2GRnwXLcZ', // !Org
  orgLogo: 'fld0HYRj3o8ZPzIpB', // Org's logo
  skillSetText: 'fld7B5GTUR1kEj2wH', // Skill set text
  location: 'fldlVhQnyT9FuwXA2', // !Location (raw 80k format)
  minimumExperienceText: 'fldAskPW25nc6R4GZ', // !MinimumExperienceLevel (text)
  requiredDegree: 'fldYWMoWdoz4ouo36', // !Required degree
  salary: 'fldgrtlDR72nactSX', // !Salary (display)
  roleTypeText: 'fldCXYRLhvZbwf0Pp', // Role type text
  workLocation: 'fldffza4UJBfsjL3v', // Work location
  orgVacanciesPage: 'fldw33cUFdvqcOz64', // Org's vacancies page
  vacancyButton: 'fldihcmZcHWNWPsxe', // Vacancy Button
  datePublished: 'fldo9SdkQLyzUI9yp', // Date published
} as const

const FIELDS = Object.values(FIELD)

export interface Job {
  id: string
  name: string
  description: string
  summary: string
  organization: string
  logo: string | null
  skillSet: string
  location: string
  locations: string[]
  countries: string[]
  minimumExperience: string
  requiredDegree: string
  salary: string
  roleType: string
  workLocation: string
  url: string
  datePublished: string | null
}

interface ParsedLocation {
  label: string
  country: string | null
}

// The 80k !Location field packs every location into one string: locations
// are comma-separated, a period separates place from country, and places
// that themselves contain a comma are wrapped in double quotes, e.g.
//   San Francisco Bay Area.USA, "New York, NY.USA", Remote.Global
export function parseJobLocations(raw: string): ParsedLocation[] {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of raw) {
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      tokens.push(current)
      current = ''
    } else {
      current += char
    }
  }
  tokens.push(current)

  const locations: ParsedLocation[] = []
  for (const token of tokens) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const dot = trimmed.lastIndexOf('.')
    if (dot === -1) {
      locations.push({ label: trimmed, country: null })
      continue
    }
    // A leading period is 80k's legacy remote marker; drop it.
    const place = trimmed.slice(0, dot).trim().replace(/^\.+/, '')
    const country = trimmed.slice(dot + 1).trim()
    if (!place) {
      locations.push({ label: country, country })
    } else if (place === 'Remote') {
      locations.push({ label: `Remote (${country})`, country })
    } else {
      locations.push({ label: `${place}, ${country}`, country })
    }
  }
  return locations
}

// One-sentence summary for the card. 80k descriptions are usually bullet
// lists whose first bullet is a summary sentence; a minority are quoted
// free text, where we cut at the first sentence boundary instead.
// Most bullets open with the stock phrase "In this role, you'll …" —
// dropping it leaves a natural sentence ("Lead …", "Build …").
export function jobSummary(description: string): string {
  let line = description
    .split('\n', 1)[0]
    .replace(/^[\s*\-–"]+/, '')
    .replace(/["\s]+$/, '')
    .trim()
  const stripped = line.replace(
    /^in this [a-z]+,\s+(?:you'll\s+|you will\s+)?/i,
    ''
  )
  if (stripped !== line && stripped.length > 0) {
    line = stripped.charAt(0).toUpperCase() + stripped.slice(1)
  }
  if (line.length <= 220) return line
  const sentence = line.match(/^(.{40,220}?[.!?])(?:\s|$)/)
  if (sentence) return sentence[1]
  return line.slice(0, 200).trimEnd() + '…'
}

// 80k writes "Not Found" when a posting lists no salary; treat it as empty.
// Ranges arrive hyphenated ("$100,000 - $150,000") and are shown with an
// en dash.
export function jobSalary(raw: string): string {
  if (!raw || raw.toLowerCase() === 'not found') return ''
  return raw.replace(/\s+-\s+/g, ' – ')
}

// The board holds vacancies only. The Airtable view ("Jobs AI Safety Only")
// already excludes Fellowship, Funding, Course and Volunteering, so there is no
// code-side filter — change the set there, then mirror it in the site's filter
// options.
export async function getJobs(): Promise<Job[]> {
  if (!hasAirtableCredentials()) return fetchPublicData<Job>('jobs')
  const raw = await fetchAirtableRecords({
    tableId: TABLE_ID,
    viewId: VIEW_ID,
    returnFieldsByFieldId: true,
    fields: FIELDS,
  })

  const results: Job[] = []
  for (const record of raw) {
    const f = record.fields
    const name = fieldString(f[FIELD.title])
    if (!name) continue

    // Org's logo is usually a URL string, but has also held attachments.
    const logoRaw = f[FIELD.orgLogo]
    const logo = fieldString(logoRaw) ?? fieldAttachmentUrl(logoRaw)

    const parsedLocations = parseJobLocations(fieldText(f[FIELD.location]))
    const locations = parsedLocations.map(l => l.label)
    // "Global" marks worldwide-remote roles, not a country; the Work
    // location filter covers those.
    const countries = [
      ...new Set(
        parsedLocations
          .map(l => l.country)
          .filter((c): c is string => c !== null && c !== 'Global')
      ),
    ]

    const description = fieldString(f[FIELD.description]) || ''

    results.push({
      id: record.id,
      name,
      description,
      summary: jobSummary(description),
      organization: fieldString(f[FIELD.org]) || '',
      logo,
      skillSet: fieldText(f[FIELD.skillSetText]),
      location: locations.join('; '),
      locations,
      countries,
      minimumExperience: fieldText(f[FIELD.minimumExperienceText]),
      requiredDegree: fieldString(f[FIELD.requiredDegree]) || '',
      salary: jobSalary(fieldString(f[FIELD.salary]) || ''),
      roleType: fieldText(f[FIELD.roleTypeText]),
      workLocation: fieldText(f[FIELD.workLocation]),
      url:
        fieldString(f[FIELD.vacancyButton]) ||
        fieldString(f[FIELD.orgVacanciesPage]) ||
        '#',
      datePublished: fieldString(f[FIELD.datePublished]),
    })
  }

  results.sort((a, b) => {
    if (!a.datePublished && !b.datePublished) return 0
    if (!a.datePublished) return 1
    if (!b.datePublished) return -1
    return b.datePublished.localeCompare(a.datePublished)
  })

  return results
}
