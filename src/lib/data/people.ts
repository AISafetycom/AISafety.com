import { unstable_cache } from 'next/cache'
import {
  hoursBucketFor,
  regionForTimeZone,
  trackRecordFor,
  type HoursBucket,
  type ProjectStatus,
  type Region,
  type TrackRecord,
} from '../people-filters'
import sample from './people.sample.json'

// People on /hire come from Mangrove One's partner read API (see the docs
// Zach sent — base URL https://try.mangrove.one/api/partners/aisafety/v1,
// `Authorization: Bearer <key>`, OpenAPI at .../openapi.json): members who
// opted in to being shown here, with focus areas, capacity, links and
// project history. Read only. Env: MANGROVE_API_KEY (required to go live),
// MANGROVE_API_URL (optional, defaults to the base URL above). Without a key
// the page runs on the sample records in people.sample.json (contributor
// mode, same pattern as src/lib/data/jobs.ts without an Airtable token).
//
// Sandbox vs. live isn't a separate setting here — whichever key is in
// MANGROVE_API_KEY is the one used (sandbox key while building/testing, swap
// in the live key to go live). Every response carries
// `X-Mangrove-Partner-Sandbox: 1|0`, which is authoritative, so that header
// (not the key's own prefix) is what gets logged to confirm which mode a
// deployment is actually running in.
//
// The API's rules and how this module meets them:
// - "Key on id, never on handle": Person.id derives from Mangrove's id.
// - "Delete an id listed by /removals within 24 hours" and "do not show a
//   record you have not re-confirmed in the last 72 hours": every read
//   re-fetches the whole feed (no separate /removals sync needed while the
//   feed is small enough to page through in full — the docs call this out as
//   sufficient: "This is one or two calls"). The result is cached for one
//   hour via unstable_cache, so a removed id is gone on the next hourly
//   refresh. On top of that, getPeople() below tracks when the feed was last
//   actually fetched and returns nothing at all once that's more than 72
//   hours ago — an explicit guard against Next silently serving a stale
//   cached value if the Mangrove fetch starts failing, per the docs: "If
//   your poller stops, the board empties instead of showing people who left."

const CACHE_SECONDS = 3600
const STALE_AFTER_MS = 72 * 60 * 60 * 1000
const PAGE_LIMIT = 100
const MAX_PAGES = 50
const DEFAULT_API_URL = 'https://try.mangrove.one/api/partners/aisafety/v1'

export interface PersonLink {
  label: string
  url: string
}

export interface PersonProject {
  id: string
  title: string
  status: ProjectStatus
  role: string
  /** Mangrove kind: an independent project or a hackathon team. */
  kind: 'independent' | 'hackathon'
  organization: string | null
  /** YYYY-MM the person joined. */
  joined: string
  /** YYYY-MM the person's involvement ended; null while it continues. */
  ended: string | null
  /** Deliverables with a public link. */
  artifacts: PersonLink[]
}

export interface Person {
  /** Catalog-friendly id: "rec" + Mangrove's opaque id. The chatbot's card
   *  tokens only recognise Airtable-style rec… ids, and Mangrove's ids are
   *  stable per partner, so the prefix costs nothing and keeps cards working. */
  id: string
  mangroveId: string
  /** Mangrove's path key for the profile; not an identity. */
  handle: string
  displayName: string
  profileUrl: string
  initials: string
  avatarUrl: string | null
  /** One or two sentences. */
  interests: string
  /** Mangrove's focus-area labels, e.g. "Evals & benchmarks". */
  focusAreas: string[]
  /** "What you want to work on", in the member's words. */
  wantToWorkOn: string
  links: PersonLink[]
  /** IANA zone, e.g. Europe/London. */
  timeZone: string
  /** "UTC+1 · Europe/London", for the card. */
  timeZoneLabel: string
  /** City and country once Mangrove sends them; null until then. */
  location: string | null
  region: Region
  maxConcurrentProjects: number | null
  maxHoursPerWeek: number | null
  hoursBucket: HoursBucket | null
  track: TrackRecord[]
  projects: PersonProject[]
  /** Posts and papers on the profile that belong to no project. */
  writing: PersonLink[]
  updatedAt: string
}

// ---- Mangrove's wire shape (the parts we read) ---------------------------

interface MangroveArtifact {
  id: string
  title: string
  url: string | null
  kind: string
  at: string
  projectId?: string | null
}

interface MangroveParticipation {
  id: string
  title: string
  kind: 'independent' | 'hackathon'
  status: 'Current' | 'Active' | 'Debrief' | 'Completed' | 'Cancelled'
  role: string
  joinedAt: string
  leftAt: string | null
  outcome: 'active' | 'completed' | 'left' | 'cancelled'
  organization: string | null
  artifacts: MangroveArtifact[]
}

interface MangroveCandidate {
  id: string
  handle: string
  displayName: string
  profileUrl: string
  avatar: { url: string | null; initials: string }
  interests: { summary: string; focusAreas: { slug: string; label: string }[] }
  workingOn: string
  links: {
    linkedin?: string | null
    x?: string | null
    github?: string | null
    website?: string | null
  }
  timeZone: string
  city?: string | null
  country?: string | null
  capacity: {
    maxConcurrentProjects: number | null
    maxHoursPerWeek: number | null
  }
  projects: MangroveParticipation[]
  artifacts: MangroveArtifact[]
  updatedAt: string
}

interface CandidatePage {
  data: MangroveCandidate[]
  nextCursor: string | null
  meta?: { sandbox?: boolean; generatedAt?: string }
}

// ---- Mapping ---------------------------------------------------------------

function yearMonth(iso: string): string {
  return iso.slice(0, 7)
}

/** "UTC+1", "UTC−7", "UTC+5:30" for a zone right now. */
function utcOffsetLabel(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value
    if (!part) return 'UTC'
    // "GMT+1" → "UTC+1"; a true minus sign like the design.
    return part.replace(/^GMT/, 'UTC').replace('-', '−')
  } catch {
    // An unknown zone name in the feed: the zone still shows, just without
    // an offset. Loud enough via the label, so no throw here.
    console.warn(`[people] Unknown time zone "${timeZone}"`)
    return 'UTC'
  }
}

function projectStatus(p: MangroveParticipation): ProjectStatus {
  if (p.outcome === 'left') return 'Left'
  if (p.outcome === 'cancelled') return 'Cancelled'
  return p.status
}

function linksOf(c: MangroveCandidate): PersonLink[] {
  const out: PersonLink[] = []
  if (c.links.linkedin) out.push({ label: 'LinkedIn', url: c.links.linkedin })
  if (c.links.x) out.push({ label: 'X', url: c.links.x })
  if (c.links.github) out.push({ label: 'GitHub', url: c.links.github })
  if (c.links.website) out.push({ label: 'Website', url: c.links.website })
  return out
}

/** Artifact rows with a link. Titles arrive as "Repository: <project>",
 *  "Slides: <project>" — the part before the colon is the label the card
 *  shows, so a row reads "Repository", "Slides", "Paper". */
function artifactLinks(artifacts: MangroveArtifact[]): PersonLink[] {
  const out: PersonLink[] = []
  for (const a of artifacts) {
    if (!a.url) continue
    const colon = a.title.indexOf(':')
    out.push({
      label: colon > 0 ? a.title.slice(0, colon).trim() : a.title,
      url: a.url,
    })
  }
  return out
}

function expect(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`[people] Malformed Mangrove record: ${what}`)
}

export function personFromCandidate(c: MangroveCandidate): Person {
  expect(typeof c.id === 'string' && c.id, 'missing id')
  expect(
    typeof c.displayName === 'string' && c.displayName,
    `${c.id}: missing displayName`
  )
  expect(
    typeof c.timeZone === 'string' && c.timeZone,
    `${c.id}: missing timeZone`
  )
  expect(Array.isArray(c.projects), `${c.id}: projects must be a list`)
  const projects: PersonProject[] = c.projects.map(p => ({
    id: p.id,
    title: p.title,
    status: projectStatus(p),
    role: p.role,
    kind: p.kind,
    organization: p.organization ?? null,
    joined: yearMonth(p.joinedAt),
    ended: p.leftAt ? yearMonth(p.leftAt) : null,
    artifacts: artifactLinks(p.artifacts ?? []),
  }))
  const writing = artifactLinks(
    (c.artifacts ?? []).filter(a => a.kind === 'writing')
  )
  const maxHours = c.capacity?.maxHoursPerWeek ?? null
  return {
    id: `rec${c.id}`,
    mangroveId: c.id,
    handle: c.handle,
    displayName: c.displayName,
    profileUrl: c.profileUrl,
    initials: c.avatar?.initials || c.displayName.slice(0, 2).toUpperCase(),
    avatarUrl: c.avatar?.url ?? null,
    interests: c.interests?.summary ?? '',
    focusAreas: (c.interests?.focusAreas ?? []).map(f => f.label),
    wantToWorkOn: c.workingOn ?? '',
    links: linksOf(c),
    timeZone: c.timeZone,
    timeZoneLabel: `${utcOffsetLabel(c.timeZone)} · ${c.timeZone}`,
    location: c.city ? (c.country ? `${c.city}, ${c.country}` : c.city) : null,
    region: regionForTimeZone(c.timeZone),
    maxConcurrentProjects: c.capacity?.maxConcurrentProjects ?? null,
    maxHoursPerWeek: maxHours,
    hoursBucket: hoursBucketFor(maxHours),
    track: trackRecordFor(projects, writing.length),
    projects,
    writing,
    updatedAt: c.updatedAt,
  }
}

// ---- Fetching ----------------------------------------------------------------

function mangroveConfig(): { url: string; key: string } | null {
  const key = process.env.MANGROVE_API_KEY?.trim()
  if (!key) return null
  const url = (process.env.MANGROVE_API_URL?.trim() || DEFAULT_API_URL).replace(
    /\/$/,
    ''
  )
  return { url, key }
}

let loggedSandboxState = false

async function fetchPage(
  cfg: { url: string; key: string },
  cursor: string | null
): Promise<CandidatePage> {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) })
  if (cursor) params.set('cursor', cursor)
  const request = () =>
    fetch(`${cfg.url}/candidates?${params}`, {
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })
  let res = await request()
  if (res.status === 429) {
    // One polite retry: the API rate-limits per key.
    const wait = Number(res.headers.get('retry-after')) || 2
    await new Promise(r => setTimeout(r, wait * 1000))
    res = await request()
  }
  if (!res.ok) {
    throw new Error(
      `[people] Mangrove One responded ${res.status} for /candidates: ${(await res.text()).slice(0, 200)}`
    )
  }
  if (!loggedSandboxState) {
    loggedSandboxState = true
    const sandbox = res.headers.get('X-Mangrove-Partner-Sandbox') === '1'
    console.log(`[people] Mangrove One key is ${sandbox ? 'SANDBOX' : 'LIVE'}`)
  }
  return (await res.json()) as CandidatePage
}

async function fetchAllCandidates(cfg: {
  url: string
  key: string
}): Promise<Person[]> {
  const people: Person[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await fetchPage(cfg, cursor)
    for (const c of body.data) people.push(personFromCandidate(c))
    cursor = body.nextCursor
    if (!cursor) break
  }
  if (cursor) {
    console.warn(
      `[people] Mangrove feed longer than ${MAX_PAGES * PAGE_LIMIT} records — raise MAX_PAGES`
    )
  }
  console.log(`[people] ${people.length} people from Mangrove One`)
  return people
}

interface CachedPeople {
  people: Person[]
  fetchedAt: number
}

const cachedCandidates = unstable_cache(
  async (): Promise<CachedPeople> => {
    const cfg = mangroveConfig()
    if (!cfg) return { people: [], fetchedAt: Date.now() }
    return { people: await fetchAllCandidates(cfg), fetchedAt: Date.now() }
  },
  ['mangrove-candidates'],
  { revalidate: CACHE_SECONDS, tags: ['mangrove-candidates'] }
)

let warnedFallback = false

/** Every listed person, in the feed's order. Mangrove One when configured,
 *  otherwise the sample records. Returns an empty list — never a stale one —
 *  if the last successful Mangrove fetch is more than 72 hours old. */
export async function getPeople(): Promise<Person[]> {
  const cfg = mangroveConfig()
  if (!cfg) {
    if (!warnedFallback) {
      warnedFallback = true
      console.warn(
        '[people] No Mangrove One credentials — /hire shows the sample records'
      )
    }
    return (sample as unknown as MangroveCandidate[]).map(personFromCandidate)
  }
  let cached: CachedPeople
  try {
    cached = await cachedCandidates()
  } catch (error) {
    // A Mangrove outage shouldn't 500 the page — same "board empties" rule
    // as the 72-hour staleness check below, just triggered by a fetch that
    // failed outright instead of one that never ran. Loud in the server
    // logs either way.
    console.warn(`[people] Mangrove One fetch failed: ${error}`)
    return []
  }
  if (Date.now() - cached.fetchedAt > STALE_AFTER_MS) {
    console.warn(
      '[people] Mangrove feed has not refreshed in over 72 hours — showing nobody rather than a stale list'
    )
    return []
  }
  return cached.people
}
