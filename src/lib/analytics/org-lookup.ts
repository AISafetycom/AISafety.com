// The Org lookup tab's matching rules: which listings belong to the org a
// search names. A leaf module (type-only imports) so events.ts can import it
// without a cycle; the counting itself lives in events.ts (orgLookup), next
// to the helpers the per-page tabs use, so the numbers reconcile with them.
//
// How a search becomes a set of listings:
// 1. Seeds: catalog listings (every page's live listings plus past training
//    and event rounds) whose name, or org field (event host, job org, course
//    organizer, map long and short names), contains the search as whole
//    words. Jobs match on their org only, never their title.
// 2. Websites: a seed's website pulls in the other listings on it when the
//    org's live listings make up at least half of that website's, and it
//    isn't a host many groups share (discord.gg, lesswrong.com, luma.com,
//    airtable.com). Jobs never spread a website or get pulled in by one, and
//    aisafety.com never spreads. See step 2 in orgSpec.
// 3. Events then match by record id, exact web address, a spread website,
//    or (for listings that have left the site) their tracked label.

import type { Advisor } from '@/lib/data/advisors'
import type { Community } from '@/lib/data/communities'
import type { EventListing } from '@/lib/data/events'
import type { FounderResource } from '@/lib/data/founders'
import type { Funder } from '@/lib/data/funding'
import type { Job } from '@/lib/data/jobs'
import type { MapOrg } from '@/lib/data/map'
import type { MediaChannel } from '@/lib/data/media-channels'
import type { Course } from '@/lib/data/self-study'
import type {
  ProgramRound,
  RecurringProgram,
  TrainingProgram,
} from '@/lib/data/training'

/** One listing the site knows about, as the dashboard tracks it. */
export interface CatalogEntry {
  /** Analytics page name ('Training', 'Map', …), as listing clicks carry it. */
  page: string
  /** The label clicks are tracked under: Jobs = "Title – Org", Map = the
   *  card title. */
  name: string
  /** Airtable record id. */
  id: string
  url: string
  logo: string | null
  /** The fields naming the org behind the listing, when the page has any. */
  orgText: string[]
  /** On the site right now (false for past training and event rounds). */
  live: boolean
}

export type MatchReason = 'name' | 'organizer' | 'website'

/** A matched catalog listing, keyed by page + name like a dashboard row. */
export interface MatchedEntry {
  page: string
  name: string
  why: MatchReason
  live: boolean
  logo: string | null
  url: string
}

export interface OrgSpec {
  /** The search as typed (trimmed, capped). */
  query: string
  /** The search normalized (see normText) and with its spaces removed. */
  norm: string
  compact: string
  /** What to call the org in the summary sentence: the long name of the one
   *  matched Field map org, else the search as typed. */
  orgName: string
  /** Matched catalog listings by row key (page + '\0' + name). */
  entries: Map<string, MatchedEntry>
  /** Record ids of the matched listings → why each matched. */
  ids: Map<string, MatchReason>
  /** Cleaned web addresses of the matched listings. */
  urls: Set<string>
  /** Websites that spread (hostnames without www), with their subdomains
   *  except `excludedHosts` — see spreadsTo. */
  hosts: Set<string>
  excludedHosts: Set<string>
  /** Row hashes Bryce left out (?x=), and the left-out listings' addresses
   *  and record ids, so search and chatbot clicks on them stay out too. */
  leftOut: Set<string>
  leftOutUrls: Set<string>
  leftOutIds: Set<string>
  /** Left-out catalog listings, so they can be listed with a Put back link
   *  even when they had no clicks. */
  leftOutEntries: { key: string; page: string; name: string }[]
  /** Every live listing's row key and record id — "no longer listed" is any
   *  matched row in neither. */
  liveKeys: Set<string>
  liveIds: Set<string>
  /** Logos for every catalog listing by row key and by record id, so rows
   *  that only match through their events still get a real logo. */
  logoByKey: Map<string, string>
  logoById: Map<string, string>
  /** Set when the search matches too much to be one org; nothing else is
   *  computed then. */
  tooBroad: { listings: number; websites: number } | null
  /** Pages whose listings couldn't be read: the numbers may be incomplete. */
  failedPages: string[]
}

/** Longest search kept, in characters. */
export const MAX_QUERY = 100
/** Searches matching more listings, or spreading to more websites, than
 *  this aren't one org. */
export const TOO_BROAD_LISTINGS = 60
export const TOO_BROAD_WEBSITES = 5
/** Left-out rows kept from ?x=. */
export const MAX_LEFT_OUT = 50

/** Lowercase, accents stripped, '&' read as 'and', and every run of other
 *  characters collapsed to one space — so "AISafety.info", "80,000 Hours",
 *  "Q&A" and "Søren" compare by their words. */
export function normText(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      // Letters NFKD leaves whole ("Søren" would otherwise lose its ø).
      .replace(/[øæœßłđþ]/g, c => FOLD[c] ?? c)
      .replace(/&/g, ' and ')
      // Letters and digits in any script stay; everything else splits words.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  )
}

const FOLD: Record<string, string> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  þ: 'th',
}

/** Does `text` (already normalized) contain the search as whole words? Two
 *  ways: the normalized search as a phrase ("lens" in "lens academy", never
 *  "lenses"), or the search without its spaces equal to a run of the text's
 *  words joined up ("blue dot" finds "bluedot", "80000 hours" finds
 *  "80 000 hours"). A one-word search only joins words at the start of the
 *  text ("bluedot" finds "Blue Dot Impact", but "longview" doesn't find
 *  "Cambridge Long View Initiative"). Plain string work, never a RegExp
 *  built from the search. */
export function matchesNorm(
  text: string,
  norm: string,
  compact: string
): boolean {
  if (!norm || !text) return false
  if (` ${text} `.includes(` ${norm} `)) return true
  const words = text.split(' ')
  const starts = norm.includes(' ') ? words.length : 1
  for (let i = 0; i < starts; i++) {
    let run = ''
    for (let j = i; j < words.length && run.length < compact.length; j++) {
      run += words[j]
      if (run === compact) return true
    }
  }
  return false
}

/** The org half of a tracked Jobs label ("Co-Founder – Lens Academy" →
 *  "Lens Academy"), or the whole label when it has no " – ". */
export function jobOrg(label: string): string {
  const i = label.lastIndexOf(' – ')
  return i === -1 ? label : label.slice(i + 3)
}

/** Does a tracked label belong to the search? Jobs labels match on their
 *  org half only, like the catalog's Jobs seeds. */
export function labelMatches(
  page: string,
  label: string,
  norm: string,
  compact: string
): boolean {
  return matchesNorm(
    normText(page === 'Jobs' ? jobOrg(label) : label),
    norm,
    compact
  )
}

const OWN_HOST = 'aisafety.com'

/** An http(s) address's hostname, lowercase and without www., or null for
 *  anything else ('#', '', mailto:, a site path) and for aisafety.com, which
 *  is never an org's website. */
export function hostOf(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (!host || host === OWN_HOST || host.endsWith(`.${OWN_HOST}`)) return null
    return host
  } catch {
    return null
  }
}

/** hostOf for event addresses, by plain string work instead of a URL
 *  parse: the beacon's addresses can be anything, so the ones that can't
 *  be the org's should cost next to nothing. Lowercase, without www., the
 *  user part or the port; null for non-http(s) addresses and aisafety.com. */
export function quickHost(url: string | undefined): string | null {
  if (!url) return null
  const scheme = /^https?:\/\//i.exec(url)
  if (!scheme) return null
  let host = url.slice(scheme[0].length)
  const end = host.search(/[/?#\\]/)
  if (end !== -1) host = host.slice(0, end)
  // Non-ASCII (an internationalized name) or %-escaped hosts: let the URL
  // parser turn them into the form hostOf gives.
  if (/[^\x21-\x7e]|%/.test(host)) return hostOf(url)
  host = host
    .slice(host.lastIndexOf('@') + 1)
    .replace(/:\d*$/, '')
    .toLowerCase()
    .replace(/^www\./, '')
  if (!host || host === OWN_HOST || host.endsWith(`.${OWN_HOST}`)) return null
  return host
}

/** An address cleaned for comparing: hostname as hostOf, path without a
 *  trailing slash, utm_ tags and the #fragment dropped, other parameters
 *  kept. Null when hostOf is. */
export function cleanUrl(url: string | undefined): string | null {
  const host = hostOf(url)
  if (!host || !url) return null
  try {
    const u = new URL(url)
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !k.toLowerCase().startsWith('utm_'))
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
    const path = u.pathname.replace(/\/+$/, '')
    return `${host}${path}${params ? `?${params}` : ''}`
  } catch {
    return null
  }
}

/** Platforms where many unrelated groups share one host and are told apart
 *  by the path (forms, job boards, chat, video, social, forums, events): a
 *  listing there says nothing about who else there belongs to the org, so
 *  the host and every subdomain of it never spread. */
const PATH_SHARED_HOSTS = new Set([
  'airtable.com',
  'google.com',
  'forms.gle',
  'tally.so',
  'jotform.com',
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'gem.com',
  'discord.gg',
  'discord.com',
  't.me',
  'whatsapp.com',
  'luma.com',
  'lu.ma',
  'eventbrite.com',
  'eventbrite.co.uk',
  'meetup.com',
  'gather.town',
  'youtube.com',
  'youtu.be',
  'spotify.com',
  'apple.com',
  'twitch.tv',
  'x.com',
  'twitter.com',
  'bsky.app',
  'mastodon.social',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'reddit.com',
  'github.com',
  'lesswrong.com',
  'alignmentforum.org',
  'forum.effectivealtruism.org',
  'goodreads.com',
  'linktr.ee',
  'manifund.org',
  'patreon.com',
  'gofundme.com',
  'mailchi.mp',
  'calendly.com',
  'bit.ly',
  'is.gd',
  'tinyurl.com',
])

/** Platforms that give each group a subdomain of its own
 *  (helentoner.substack.com): the platform's own hosts are shared, but a
 *  group's subdomain is theirs and goes through the usual vote. */
const TENANT_PLATFORM_HOSTS = new Set([
  'substack.com',
  'open.substack.com',
  'medium.com',
  'wordpress.com',
  'blogspot.com',
  'beehiiv.com',
  'ghost.io',
  'notion.site',
  'notion.so',
  'itch.io',
  'slack.com',
  'join.slack.com',
  'typeform.com',
  'form.typeform.com',
  'workable.com',
  'apply.workable.com',
  'zoom.us',
])

/** Is a website one many unrelated groups share? */
function isSharedHost(h: string): boolean {
  return onHosts(h, PATH_SHARED_HOSTS) || TENANT_PLATFORM_HOSTS.has(h)
}

/** Does a spread website cover `host` (itself, or a subdomain that wasn't
 *  kept out)? */
export function spreadsTo(spec: OrgSpec, host: string | null): boolean {
  return onHosts(host, spec.hosts) && !onHosts(host, spec.excludedHosts)
}

function addTo(map: Map<string, Set<string>>, key: string, value: string) {
  const set = map.get(key) ?? new Set<string>()
  set.add(value)
  map.set(key, set)
}

/** Is `host` one of `hosts`, or a subdomain of one? */
export function onHosts(host: string | null, hosts: Set<string>): boolean {
  if (!host || hosts.size === 0) return false
  if (hosts.has(host)) return true
  for (let i = host.indexOf('.'); i !== -1; i = host.indexOf('.', i + 1))
    if (hosts.has(host.slice(i + 1))) return true
  return false
}

/** A dashboard row's key: page + label, the grouping every per-page table
 *  uses. */
export function rowKey(page: string, name: string): string {
  return `${page}\x00${name}`
}

/** A short stable id for a row (FNV-1a, 32-bit, base36), for ?x= — labels
 *  carry commas and run to 300 characters, so they can't go in the url as
 *  they are. */
export function rowHash(page: string, name: string): string {
  const s = rowKey(page, name)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** The ?x= value, read safely: comma-separated row hashes, at most
 *  MAX_LEFT_OUT, anything malformed dropped. */
export function parseLeftOut(raw: string | undefined): Set<string> {
  const out = new Set<string>()
  for (const part of (raw ?? '').split(',')) {
    const h = part.trim().toLowerCase()
    if (/^[0-9a-z]{1,8}$/.test(h)) out.add(h)
    if (out.size >= MAX_LEFT_OUT) break
  }
  return out
}

/** A chatbot card's listing id without its type prefix ('job:rec…' →
 *  'rec…'). */
export function stripIdPrefix(id: string): string {
  return id.slice(id.indexOf(':') + 1)
}

/** What each page's getter returned; a page that couldn't be read is left
 *  out (and named in the spec's failedPages by the caller). */
export interface CatalogSources {
  training?: TrainingProgram[]
  recurring?: RecurringProgram[]
  trainingRounds?: ProgramRound[]
  events?: EventListing[]
  eventRounds?: ProgramRound[]
  map?: MapOrg[]
  communities?: Community[]
  courses?: Course[]
  jobs?: Job[]
  funders?: Funder[]
  media?: MediaChannel[]
  advisors?: Advisor[]
  founders?: FounderResource[]
}

/** Every listing as the dashboard tracks it, one entry per record. Past
 *  training and event rounds (no longer on the site, but their clicks are
 *  still in the store) join as not live; a round that's still live keeps
 *  its live entry. Pure. */
export function catalogFrom(s: CatalogSources): CatalogEntry[] {
  const out: CatalogEntry[] = []
  const seen = new Set<string>()
  const add = (e: CatalogEntry) => {
    const key = `${e.page}\x00${e.id}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(e)
  }
  const plain = (
    page: string,
    items: { id: string; name: string; url: string; logo: string | null }[]
  ) => {
    for (const i of items)
      add({
        page,
        name: i.name,
        id: i.id,
        url: i.url,
        logo: i.logo,
        orgText: [],
        live: true,
      })
  }
  plain('Training', s.training ?? [])
  plain('Training', s.recurring ?? [])
  for (const e of s.events ?? [])
    add({
      page: 'Events',
      name: e.name,
      id: e.id,
      url: e.url,
      logo: e.logo,
      orgText: e.host ? [e.host] : [],
      live: true,
    })
  for (const m of s.map ?? []) {
    if (m.isMagic) continue
    add({
      page: 'Map',
      name: m.title,
      id: m.id,
      url: m.link,
      logo: m.logo,
      orgText: [m.tooltipTitle, m.shortName ?? ''].filter(Boolean),
      live: true,
    })
  }
  for (const c of s.communities ?? [])
    add({
      page: 'Communities',
      name: c.name,
      id: c.id,
      url: c.joinLink,
      logo: c.logo,
      orgText: [],
      live: true,
    })
  for (const c of s.courses ?? [])
    add({
      page: 'Self-study',
      name: c.name,
      id: c.id,
      url: c.url,
      logo: c.image,
      orgText: c.organizer ? [c.organizer] : [],
      live: true,
    })
  for (const j of s.jobs ?? [])
    add({
      page: 'Jobs',
      // Jobs clicks are tracked as "Title – Org" (JobsClient).
      name: j.organization ? `${j.name} – ${j.organization}` : j.name,
      id: j.id,
      url: j.url,
      logo: j.logo,
      orgText: j.organization ? [j.organization] : [],
      live: true,
    })
  plain('Funding', s.funders ?? [])
  plain('Media channels', s.media ?? [])
  plain('Advisors', s.advisors ?? [])
  for (const f of s.founders ?? [])
    add({
      page: 'Founders',
      name: f.name,
      id: f.id,
      url: f.website,
      logo: f.image,
      orgText: [],
      live: true,
    })
  // Past rounds last, so a live entry for the same record wins.
  for (const r of s.trainingRounds ?? [])
    add({
      page: 'Training',
      name: r.name,
      id: r.id,
      url: r.url,
      logo: null,
      orgText: [],
      live: false,
    })
  for (const r of s.eventRounds ?? [])
    add({
      page: 'Events',
      name: r.name,
      id: r.id,
      url: r.url,
      logo: null,
      orgText: r.host ? [r.host] : [],
      live: false,
    })
  return out
}

/** Builds the spec for a search from the catalog. Pure. */
export function orgSpec(
  catalog: CatalogEntry[],
  rawQuery: string,
  leftOut: Set<string>,
  failedPages: string[] = []
): OrgSpec {
  const query = rawQuery.trim().slice(0, MAX_QUERY)
  const norm = normText(query)
  const compact = norm.replace(/ /g, '')
  const liveKeys = new Set<string>()
  const liveIds = new Set<string>()
  const logoByKey = new Map<string, string>()
  const logoById = new Map<string, string>()
  for (const e of catalog) {
    if (e.live) {
      liveKeys.add(rowKey(e.page, e.name))
      liveIds.add(e.id)
    }
    if (e.logo) {
      if (!logoByKey.has(rowKey(e.page, e.name)))
        logoByKey.set(rowKey(e.page, e.name), e.logo)
      if (!logoById.has(e.id)) logoById.set(e.id, e.logo)
    }
  }
  const spec: OrgSpec = {
    query,
    norm,
    compact,
    orgName: query,
    entries: new Map(),
    ids: new Map(),
    urls: new Set(),
    hosts: new Set(),
    excludedHosts: new Set(),
    leftOut,
    leftOutUrls: new Set(),
    leftOutIds: new Set(),
    leftOutEntries: [],
    liveKeys,
    liveIds,
    logoByKey,
    logoById,
    tooBroad: null,
    failedPages,
  }
  if (!norm) return spec

  // 1. Seeds.
  const seeds: { e: CatalogEntry; why: MatchReason }[] = []
  const leftOutSeen = new Set<string>()
  const leftOutMapSeeds: CatalogEntry[] = []
  for (const e of catalog) {
    const byName =
      e.page !== 'Jobs' && matchesNorm(normText(e.name), norm, compact)
    const byOrg =
      !byName && e.orgText.some(t => matchesNorm(normText(t), norm, compact))
    if (!byName && !byOrg) continue
    if (leftOut.has(rowHash(e.page, e.name))) {
      noteLeftOut(spec, e, leftOutSeen)
      if (e.page === 'Map') leftOutMapSeeds.push(e)
      continue
    }
    seeds.push({ e, why: byName ? 'name' : 'organizer' })
  }

  // 2. Websites that spread. Each website is judged on its own listings:
  //    it spreads when the org's live listings are at least half of the live
  //    (non-Jobs) listings on it, and it isn't a host many groups share
  //    (isSharedHost, or live jobs from two or more employers). Past rounds
  //    don't vote, so an old round that once linked somewhere can't pull in
  //    whoever is there now. A subdomain of a spread website comes along
  //    unless it carries listings of its own that fail the same vote and
  //    aren't one sub-brand (newsletter.safe.ai joins CAIS; the EA Forum's
  //    many groups stay out of CEA).
  const liveOn = new Map<string, number>()
  const namesOn = new Map<string, Set<string>>()
  const employersOn = new Map<string, Set<string>>()
  for (const e of catalog) {
    if (!e.live) continue
    const h = hostOf(e.url)
    if (!h) continue
    if (e.page === 'Jobs') {
      addTo(employersOn, h, normText(e.orgText[0] ?? ''))
      continue
    }
    liveOn.set(h, (liveOn.get(h) ?? 0) + 1)
    addTo(namesOn, h, normText(e.name))
  }
  const seedOn = new Map<string, number>()
  for (const { e } of seeds) {
    if (e.page === 'Jobs' || !e.live) continue
    const h = hostOf(e.url)
    if (h) seedOn.set(h, (seedOn.get(h) ?? 0) + 1)
  }
  const shared = (h: string) =>
    isSharedHost(h) || (employersOn.get(h)?.size ?? 0) >= 2
  const passes = (h: string) => {
    const n = seedOn.get(h) ?? 0
    return n > 0 && n * 2 >= (liveOn.get(h) ?? 0) && !shared(h)
  }
  for (const h of seedOn.keys()) if (passes(h)) spec.hosts.add(h)
  for (const h of liveOn.keys()) {
    if (spec.hosts.has(h) || !onHosts(h, spec.hosts)) continue
    const subBrand = (namesOn.get(h)?.size ?? 0) === 1 && !shared(h)
    if (!passes(h) && !subBrand) spec.excludedHosts.add(h)
  }

  // Every listing on a spread website joins, past rounds included (they
  // just don't count toward how broad the search is).
  const matched: { e: CatalogEntry; why: MatchReason }[] = [...seeds]
  const seeded = new Set(seeds.map(s => s.e))
  if (spec.hosts.size) {
    for (const e of catalog) {
      if (e.page === 'Jobs' || seeded.has(e)) continue
      if (!spreadsTo(spec, hostOf(e.url))) continue
      if (leftOut.has(rowHash(e.page, e.name))) {
        noteLeftOut(spec, e, leftOutSeen)
        continue
      }
      matched.push({ e, why: 'website' })
    }
  }

  const websites = new Set(
    matched.map(m => hostOf(m.e.url)).filter((h): h is string => !!h)
  )
  // One employer's many jobs count once: an org with sixty openings is still
  // one org.
  const jobOrgs = new Set(
    matched
      .filter(m => m.e.page === 'Jobs')
      .map(m => normText(m.e.orgText[0] ?? m.e.name))
  )
  // Past rounds are history, not breadth: an org that has run forty rounds
  // is still one org.
  const breadth =
    matched.filter(m => m.e.page !== 'Jobs' && m.e.live).length + jobOrgs.size
  if (breadth > TOO_BROAD_LISTINGS || spec.hosts.size > TOO_BROAD_WEBSITES) {
    spec.tooBroad = { listings: matched.length, websites: websites.size }
    return spec
  }

  for (const { e, why } of matched) {
    const key = rowKey(e.page, e.name)
    const had = spec.entries.get(key)
    // Two rounds under one name are one row; a live round's details win.
    if (!had || (!had.live && e.live))
      spec.entries.set(key, {
        page: e.page,
        name: e.name,
        why: had && rank(had.why) < rank(why) ? had.why : why,
        live: e.live || !!had?.live,
        logo: e.logo ?? had?.logo ?? null,
        url: e.url,
      })
    if (!spec.ids.has(e.id)) spec.ids.set(e.id, why)
    const u = cleanUrl(e.url)
    if (u) spec.urls.add(u)
  }

  // The org's name for the summary sentence: the one Field map org matched
  // by name, when there's exactly one. Leaving that row out of the figures
  // doesn't rename the org, as long as a kept listing still carries its name
  // (Lens Academy's courses do).
  const mapOrgs = matched.filter(m => m.e.page === 'Map' && m.why !== 'website')
  const mapName = (e: CatalogEntry) => e.orgText[0] || e.name
  if (mapOrgs.length === 1) spec.orgName = mapName(mapOrgs[0].e)
  else if (mapOrgs.length === 0 && leftOutMapSeeds.length === 1) {
    const name = normText(mapName(leftOutMapSeeds[0]))
    const backed = seeds.some(({ e }) =>
      [e.name, ...e.orgText].some(t =>
        matchesNorm(normText(t), name, name.replace(/ /g, ''))
      )
    )
    if (backed) spec.orgName = mapName(leftOutMapSeeds[0])
  }
  return spec
}

function rank(why: MatchReason): number {
  return why === 'name' ? 0 : why === 'organizer' ? 1 : 2
}

function noteLeftOut(spec: OrgSpec, e: CatalogEntry, seen: Set<string>): void {
  const u = cleanUrl(e.url)
  if (u) spec.leftOutUrls.add(u)
  spec.leftOutIds.add(e.id)
  const key = rowKey(e.page, e.name)
  if (seen.has(key)) return
  seen.add(key)
  spec.leftOutEntries.push({ key, page: e.page, name: e.name })
}

/** The pages the newsletters' cards come from. */
const NEWSLETTER_PAGES = ['Events', 'Training', 'Funding']

/** One of the org's links in a sent newsletter, with its clicks. */
export interface OrgNewsletterRow {
  key: string
  /** The issue's campaign name, "Training · Week 41, 2026". */
  issue: string
  label: string
  url: string
  clicks: number
}

/** The org's links among the newsletters' counted clicks: a link is theirs
 *  when its address is one of their listings' (tracking tags aside), it's on
 *  a website that spread, or its card title names them. A link only on
 *  listings left out stays out. Busiest first. Pure. */
export function orgNewsletterClicks(
  spec: OrgSpec,
  issues: {
    name: string
    links: { label: string; url: string; clicks: number }[]
  }[]
): OrgNewsletterRow[] {
  if (spec.tooBroad || !spec.norm) return []
  const rows: OrgNewsletterRow[] = []
  for (const issue of issues)
    for (const link of issue.links) {
      if (link.clicks <= 0) continue
      const c = cleanUrl(link.url)
      const known = c != null && spec.urls.has(c)
      if (c != null && spec.leftOutUrls.has(c) && !known) continue
      // A card whose title is a left-out row stays out too, even when that
      // listing has since left the catalog.
      if (
        !known &&
        NEWSLETTER_PAGES.some(p => spec.leftOut.has(rowHash(p, link.label)))
      )
        continue
      const byUrl = known || spreadsTo(spec, hostOf(link.url))
      const byLabel = matchesNorm(normText(link.label), spec.norm, spec.compact)
      if (!byUrl && !byLabel) continue
      rows.push({
        key: `${issue.name}\x00${link.url}\x00${link.label}`,
        issue: issue.name,
        label: link.label,
        url: link.url,
        clicks: link.clicks,
      })
    }
  return rows.sort(
    (a, b) => b.clicks - a.clicks || a.issue.localeCompare(b.issue)
  )
}
