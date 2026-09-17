/** The fields a listing cannot go out without, page by page: the ones the
 *  site's card draws or its filters run on. The Queue names any of these
 *  that is still empty in an amber strip at the top of the record instead
 *  of folding it into the quiet "Not set" line (Bryce, 17 Sept 2026: IASEAI
 *  and PauseAI South Korea went out with no Cost, "I had missed that").
 *
 *  Housekeeping (Publish?, Hide?, Featured, Sort, Newsletter, Internal
 *  notes) is never needed. A field the site draws only in some cases is
 *  needed only in those: Location once the Mode is in person, a deadline's
 *  type once there is a deadline, coordinates once a community is Local, a
 *  Featured tagline once the record is Featured. A dated training program
 *  needs a start date, exact or approximate. Field names are Airtable's own,
 *  matched without regard to case. */

type Fields = Record<string, unknown>

type Need =
  /** Always. */
  | string
  /** At least one of these; the first names the gap. */
  | { any: string[] }
  /** Only when the record says so. */
  | { field: string; when: (f: Fields) => boolean }

/** Nothing there: no value, blank text, an empty list or an unticked box.
 *  A number is a value, zero included (the map's x and y). */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

/** The record's value for a field, by name, case and spacing aside. */
function valueOf(f: Fields, name: string): unknown {
  const key = name.trim().toLowerCase()
  for (const [k, v] of Object.entries(f)) {
    if (k.trim().toLowerCase() === key) return v
  }
  return undefined
}

const filled = (name: string) => (f: Fields) => !isEmptyValue(valueOf(f, name))

/** A Mode that puts people in a room: In person or Hybrid. */
function inPerson(f: Fields): boolean {
  const mode = String(valueOf(f, 'Mode') ?? '').toLowerCase()
  return mode.includes('person') || mode.includes('hybrid')
}

/** A community that meets somewhere: Local among its platforms. */
function isLocal(f: Fields): boolean {
  const v = valueOf(f, 'Platform')
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  return list.some(p => String(p).trim().toLowerCase() === 'local')
}

const FEATURED_TAGLINE: Need = {
  field: 'Featured tagline',
  when: filled('Featured'),
}

const NEEDED: Record<string, Need[]> = {
  '/events': [
    'Name',
    'URL',
    'Description',
    'Type',
    'Mode',
    'Start date',
    'End date',
    'Host name',
    'Cost',
    'Logo',
    { field: 'Location', when: inPerson },
    { field: 'Deadline', when: filled('Deadline type') },
    { field: 'Deadline type', when: filled('Deadline') },
  ],
  '/training': [
    'Name',
    'URL',
    'Description',
    'Type',
    'Mode',
    'Focus',
    'Entry bar',
    'Time commitment',
    'Stipend',
    'Logo',
    { any: ['Start date', 'Start date (approximate)'] },
    { field: 'Location', when: inPerson },
  ],
  '/communities': [
    'Name',
    'Link',
    'Description',
    'Logo',
    'Platform',
    'Type',
    'Activity level',
    'Focus',
    { field: 'Location (if in-person)', when: isLocal },
    { field: 'Latitude', when: isLocal },
    { field: 'Longitude', when: isLocal },
    FEATURED_TAGLINE,
  ],
  '/map': [
    'Long name',
    'Short name',
    'Description',
    'Category',
    'Link',
    'Logo (for cards)',
    'Logo (for map)',
    'x',
    'y',
  ],
  '/self-study': [
    'Name',
    'Link',
    'Description',
    'Logo',
    'Focus',
    'Format',
    'Created by',
    FEATURED_TAGLINE,
  ],
  '/funding': [
    'Name',
    'Website',
    'Description',
    'Logo',
    'Type',
    'Accepting applications?',
    FEATURED_TAGLINE,
  ],
  '/media-channels': [
    'Name',
    'Link',
    'Description',
    'Image',
    'Type',
    FEATURED_TAGLINE,
  ],
  '/advisors': [
    'Name',
    'Link',
    'Description',
    'Logo',
    'Focus',
    'Status',
    FEATURED_TAGLINE,
  ],
  '/projects': [
    'Project Name',
    'Description (short)',
    'Description (long)',
    'Status',
    'Contact name',
    FEATURED_TAGLINE,
  ],
  '/founders': [
    'Name',
    'Website',
    'Description',
    'Image',
    'Type',
    FEATURED_TAGLINE,
  ],
}
NEEDED['/founder-toolkit'] = NEEDED['/founders']

/** The names of the page's needed fields that the record leaves empty, in
 *  the page's order. Nothing for a page the Queue does not know. */
export function missingFields(page: string | null, fields: Fields): string[] {
  const needs = NEEDED[page?.trim().toLowerCase() ?? ''] ?? []
  const out: string[] = []
  for (const need of needs) {
    if (typeof need === 'string') {
      if (isEmptyValue(valueOf(fields, need))) out.push(need)
    } else if ('any' in need) {
      if (need.any.every(n => isEmptyValue(valueOf(fields, n)))) {
        out.push(need.any[0])
      }
    } else if (need.when(fields) && isEmptyValue(valueOf(fields, need.field))) {
      out.push(need.field)
    }
  }
  return out
}
