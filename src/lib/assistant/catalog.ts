import { getJobs } from '@/lib/data/jobs'
import { getFunders } from '@/lib/data/funding'
import { isAcceptingApplications } from '@/lib/funding-status'
import { getAdvisors } from '@/lib/data/advisors'
import { getCommunities } from '@/lib/data/communities'
import { getCourses } from '@/lib/data/self-study'
import { getFounderResources } from '@/lib/data/founders'
import { getProjects } from '@/lib/data/projects'
import { getMediaChannels } from '@/lib/data/media-channels'
import { getMapData } from '@/lib/data/map'
import { mapAreaFor } from '@/lib/data/map-areas'
import { getEvents } from '@/lib/data/events'
import { getTrainingPrograms, getRecurringPrograms } from '@/lib/data/training'
import { selectFeatured } from '@/lib/featured'
import type { Catalog, Listing } from './types'

// Known job-board domains. Their favicons are the platform logo, not the
// hiring org, so don't derive a favicon from job URLs that hit them.
const JOB_BOARD_HOSTS = new Set([
  'jobs.lever.co',
  'lever.co',
  'boards.greenhouse.io',
  'greenhouse.io',
  'jobs.ashbyhq.com',
  'ashbyhq.com',
  'apply.workable.com',
  'workable.com',
  'recruitee.com',
  'myworkday.com',
  'icims.com',
  'jobvite.com',
  'smartrecruiters.com',
  'careers.anthropic.com', // these all serve the org's own brand fine
])

function deriveFaviconFromUrl(
  url: string | null | undefined
): string | undefined {
  if (!url || url === '#') return undefined
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    return `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`
  } catch {
    return undefined
  }
}

function deriveFaviconAvoidingJobBoards(
  url: string | null | undefined
): string | undefined {
  if (!url || url === '#') return undefined
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    for (const board of JOB_BOARD_HOSTS) {
      if (host === board || host.endsWith('.' + board)) {
        // Job board — don't derive, the favicon would be the platform logo
        if (host !== 'careers.anthropic.com') return undefined
      }
    }
    return `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`
  } catch {
    return undefined
  }
}

function isFeatured(item: { featured?: string | null }): boolean {
  return item.featured === '1' || item.featured === '2'
}

// Events and training use a ranked featured queue instead of the fixed
// 1/2 slots, so "featured" for them means "currently displayed" — the
// same selection the page itself makes via selectFeatured().
function displayedIds(items: Array<{ id: string }>): Set<string> {
  return new Set(items.map(i => i.id))
}

function compact(
  meta: Record<string, string | null | undefined>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v && v.trim()) out[k] = v.trim()
  }
  return out
}

function clamp(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  return t.slice(0, max - 1).trimEnd() + '…'
}

export async function buildCatalog(): Promise<Catalog> {
  const [
    jobs,
    funders,
    advisors,
    communities,
    courses,
    founders,
    projects,
    mediaChannels,
    mapData,
    events,
    trainingPrograms,
    recurringPrograms,
  ] = await Promise.all([
    getJobs(),
    getFunders(),
    getAdvisors(),
    getCommunities(),
    getCourses(),
    getFounderResources(),
    getProjects(),
    getMediaChannels(),
    getMapData(),
    getEvents(),
    getTrainingPrograms(),
    getRecurringPrograms(),
  ])

  const listings: Listing[] = []

  // No freshness filter: the bot's catalog mirrors the live /jobs page (every
  // published, non-hidden job), so counts and lookups match what visitors see.
  // datePublished stays in meta so the model can weigh recency itself.
  for (const j of jobs) {
    listings.push({
      id: `job:${j.id}`,
      type: 'job',
      name: j.name,
      description: clamp(j.description, 280),
      organization: j.organization || undefined,
      logo: j.logo ?? deriveFaviconAvoidingJobBoards(j.url),
      url: j.url,
      pageUrl: '/jobs',
      meta: compact({
        skillSet: j.skillSet,
        minimumExperience: j.minimumExperience,
        roleType: j.roleType,
        workLocation: j.workLocation,
        location: j.location,
        datePublished: j.datePublished,
      }),
    })
  }

  for (const f of funders) {
    listings.push({
      id: `funder:${f.id}`,
      type: 'funder',
      name: f.name,
      description: clamp(f.description, 280),
      logo: f.logo ?? deriveFaviconFromUrl(f.url),
      url: f.url,
      pageUrl: '/funding',
      dateAdded: f.dateAdded ?? undefined,
      lastModified: f.lastModified ?? undefined,
      meta: compact({
        type: f.type,
        recipientType: f.recipientType,
        acceptingApplications: f.acceptingApplications,
        // The open and closed display wordings share substrings ("Not
        // accepting applications" contains "accepting applications";
        // "applications" appears in every state), so a substring filter
        // on the field above can't separate open from closed — filter on
        // this token instead.
        applicationStatus: f.acceptingApplications
          ? isAcceptingApplications(f.acceptingApplications)
            ? 'Open'
            : 'Closed'
          : null,
      }),
      featured: isFeatured(f),
    })
  }

  for (const a of advisors) {
    listings.push({
      id: `advisor:${a.id}`,
      type: 'advisor',
      name: a.name,
      description: clamp(a.description, 280),
      logo: a.logo ?? deriveFaviconFromUrl(a.url),
      url: a.url,
      pageUrl: '/advisors',
      dateAdded: a.dateAdded ?? undefined,
      lastModified: a.lastModified ?? undefined,
      meta: compact({
        focus: a.focus,
        status: a.status,
      }),
      featured: isFeatured(a),
    })
  }

  for (const c of communities) {
    listings.push({
      id: `community:${c.id}`,
      type: 'community',
      name: c.name,
      description: clamp(c.description, 280),
      logo: c.logo ?? deriveFaviconFromUrl(c.joinLink),
      url: c.joinLink || '#',
      pageUrl: '/communities',
      dateAdded: c.dateAdded ?? undefined,
      lastModified: c.lastModified ?? undefined,
      latitude: c.latitude ?? undefined,
      longitude: c.longitude ?? undefined,
      meta: compact({
        platform: c.platformText,
        type: c.type.join(', '),
        activityLevel: c.activityLevel,
        focus: c.focus,
        location: c.location,
        size: c.size,
      }),
      featured: isFeatured(c),
    })
  }

  for (const c of courses) {
    listings.push({
      id: `course:${c.id}`,
      type: 'course',
      name: c.name,
      description: clamp(c.description, 280),
      organization: c.organizer || undefined,
      logo: c.image ?? deriveFaviconFromUrl(c.url),
      url: c.url,
      pageUrl: '/self-study',
      dateAdded: c.dateAdded ?? undefined,
      lastModified: c.lastModified ?? undefined,
      meta: compact({
        category: c.category,
        courseType: c.courseType,
      }),
      featured: isFeatured(c),
    })
  }

  for (const r of founders) {
    listings.push({
      id: `founder-resource:${r.id}`,
      type: 'founder-resource',
      name: r.name,
      description: clamp(r.description, 280),
      logo: r.image ?? deriveFaviconFromUrl(r.website),
      url: r.website,
      pageUrl: '/founders',
      dateAdded: r.dateAdded ?? undefined,
      lastModified: r.lastModified ?? undefined,
      meta: compact({
        type: r.type,
      }),
      featured: isFeatured(r),
    })
  }

  for (const p of projects) {
    listings.push({
      id: `project:${p.id}`,
      type: 'project',
      name: p.name,
      description: clamp(p.description, 280),
      details: p.descriptionLong?.trim() || undefined,
      url: p.email ? `mailto:${p.email}` : '#',
      pageUrl: '/projects',
      dateAdded: p.dateAdded ?? undefined,
      lastModified: p.lastModified ?? undefined,
      meta: compact({
        status: p.status,
        contact: p.contact,
      }),
      featured: isFeatured(p),
    })
  }

  for (const m of mediaChannels) {
    listings.push({
      id: `media-channel:${m.id}`,
      type: 'media-channel',
      name: m.name,
      description: clamp(m.description, 280),
      logo: m.logo ?? deriveFaviconFromUrl(m.url),
      url: m.url,
      pageUrl: '/media-channels',
      dateAdded: m.dateAdded ?? undefined,
      lastModified: m.lastModified ?? undefined,
      meta: compact({
        type: m.type,
      }),
      featured: isFeatured(m),
    })
  }

  for (const o of mapData.records) {
    if (o.isMagic) continue
    listings.push({
      id: `org:${o.id}`,
      type: 'org',
      name: o.title,
      description: clamp(o.description, 280),
      logo: o.logo ?? deriveFaviconFromUrl(o.link),
      url: o.link,
      pageUrl: '/map',
      dateAdded: o.dateAdded ?? undefined,
      lastModified: o.lastModified ?? undefined,
      meta: compact({
        category: o.category,
        // Named region the org's logo sits in on /map — decided by its FIRST
        // category only. Lets the model answer "what's in Advocacy Anchorage"
        // without mistaking every org tagged Advocacy for one drawn there.
        mapArea: mapAreaFor(o.category),
        status: o.status,
        scale: o.scale,
        // Acronym/short name (e.g. "AED", "MIRI") so users can search the org
        // by the label shown on the field map. Searchable but not displayed.
        shortName: o.shortName,
      }),
    })
  }

  const featuredEventIds = displayedIds(
    selectFeatured(events, e => e.applicationStatus === 'Open')
  )
  const featuredTrainingIds = displayedIds(
    selectFeatured(trainingPrograms, p => p.applicationStatus === 'Open')
  )
  const featuredRecurringIds = displayedIds(selectFeatured(recurringPrograms))

  for (const e of events) {
    listings.push({
      id: `event:${e.id}`,
      type: 'event',
      name: e.name,
      description: clamp(e.description, 280),
      organization: e.host || undefined,
      logo: e.logo ?? deriveFaviconFromUrl(e.url),
      url: e.url,
      pageUrl: '/events',
      dateAdded: e.dateAdded ?? undefined,
      lastModified: e.lastModified ?? undefined,
      meta: compact({
        type: e.type.join(', '),
        mode: e.mode,
        location: e.location,
        host: e.host,
        cost: e.cost.join(', '),
        startDate: e.startDate,
        endDate: e.endDate,
        applicationsClose: e.applicationsClose,
        deadlineType: e.deadlineType,
        notYetOpen: e.notYetOpen ? 'Yes' : null,
      }),
      featured: featuredEventIds.has(e.id),
    })
  }

  // /training shows two sets behind a toggle: dated upcoming iterations and
  // evergreen recurring programs. Both share the 'training' catalog type;
  // recurring ones are marked meta.recurring = 'Yes' and carry no dates.
  for (const t of trainingPrograms) {
    listings.push({
      id: `training:${t.id}`,
      type: 'training',
      name: t.name,
      description: clamp(t.description, 280),
      logo: t.logo ?? deriveFaviconFromUrl(t.url),
      url: t.url,
      pageUrl: '/training',
      dateAdded: t.dateAdded ?? undefined,
      lastModified: t.lastModified ?? undefined,
      meta: compact({
        type: t.type.join(', '),
        mode: t.mode,
        location: t.location,
        focus: t.focus.join(', '),
        entryBar: t.entryBar,
        timeCommitment: t.timeCommitment,
        stipend: t.stipend,
        length: t.lengthBucket,
        startDate: t.startDate,
        startDateApprox: t.startDateApprox,
        endDate: t.endDate,
        applicationsClose: t.applicationsClose,
        notYetOpen: t.notYetOpen ? 'Yes' : null,
      }),
      featured: featuredTrainingIds.has(t.id),
    })
  }

  for (const r of recurringPrograms) {
    listings.push({
      id: `training:${r.id}`,
      type: 'training',
      name: r.name,
      description: clamp(r.description, 280),
      logo: r.logo ?? deriveFaviconFromUrl(r.url),
      url: r.url,
      pageUrl: '/training',
      dateAdded: r.dateAdded ?? undefined,
      lastModified: r.lastModified ?? undefined,
      meta: compact({
        recurring: 'Yes',
        type: r.type.join(', '),
        mode: r.mode,
        location: r.location,
        focus: r.focus.join(', '),
        entryBar: r.entryBar,
        timeCommitment: r.timeCommitment,
        stipend: r.stipend,
        typicalLength: r.typicalLength,
        length: r.lengthBucket,
      }),
      featured: featuredRecurringIds.has(r.id),
    })
  }

  return {
    listings,
    generatedAt: new Date().toISOString(),
  }
}

let cached: { catalog: Catalog; expiresAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

export async function getCatalog(): Promise<Catalog> {
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return cached.catalog
  }
  const catalog = await buildCatalog()
  cached = { catalog, expiresAt: now + CACHE_TTL_MS }
  return catalog
}
