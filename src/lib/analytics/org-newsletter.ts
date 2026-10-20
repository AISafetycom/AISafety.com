// Newsletter link clicks for the Org lookup tab. Every link in a newsletter
// sent through the site goes through /api/nl, which counts clicks per issue
// and link in Upstash (src/lib/newsletter-clicks.ts). The issues come from
// the site's own record of what went out (newsletter-archive-store.ts), so
// there's no ActiveCampaign read: one Upstash read per newsletter, then one
// pipeline for the counts. Which links are the org's is decided by
// orgNewsletterClicks() in org-lookup.ts.
//
// The counts only hold links someone clicked, so each issue's full link list
// is read as well (13 Oct 2026): without it, an issue that linked the org but
// got no clicks on that link looks the same as one that never linked them.
// Nothing records which list an issue's links were saved in, but the issue's
// kept web copy (the email as sent, filed by the daily archive cron, see
// src/lib/newsletter-web-copy.ts) points every counted link at
// /api/nl/<list>/<n>, so the list ids are read from that. An issue whose copy
// or list can't be read in time keeps only its clicked links, and says so.

import { recordedIssues } from '@/lib/newsletter-archive-store'
import {
  LIST_ID_RE,
  loadLinkList,
  readClicks,
  within,
  type CampaignClicks,
  type NewsletterLink,
} from '@/lib/newsletter-clicks'
import {
  WEB_BASE,
  WEB_NEWSLETTERS,
  issueName,
  type WebKey,
} from '@/lib/newsletter-web'
import type { DateRange } from './events'

export interface SentIssueClicks {
  /** The campaign name, "Training · Week 41, 2026". */
  name: string
  sentAt: string | null
  /** Each link's clicks over the issue's whole life so far, most-clicked
   *  first. Every link of the issue (0 for one nobody clicked) when
   *  `complete`; otherwise only the links someone clicked. */
  links: CampaignClicks['links']
  /** Whether every link of the issue is known. False when its link list
   *  couldn't be found or read, so a link nobody clicked may be missing. */
  complete: boolean
}

export type IssueClicksRead =
  | {
      status: 'ok'
      /** Every issue sent within the range, in the order they went out. */
      issues: SentIssueClicks[]
      /** Whether every one of those issues is complete (true with none). */
      complete: boolean
    }
  /** No Upstash keys (a laptop): clicks are counted on the live site only. */
  | { status: 'local' }
  | { status: 'error' }

/** How long an issue's kept copy may take to read, and then its whole link
 *  read (the copy and the lists it names): past either, the issue shows its
 *  clicked links only, so a slow Blob store never holds the page for long. */
const WEB_COPY_TIMEOUT_MS = 2500
const LINKS_TIMEOUT_MS = 5000

interface WantedIssue {
  key: WebKey
  slug: string
  name: string
  sentAt: string | null
}

/** The click counts of every issue sent within the range, with every link
 *  of each issue where its link list can be read. Never throws: the tab says
 *  when the counts couldn't be read. */
export async function readIssueClicks(
  range: DateRange
): Promise<IssueClicksRead> {
  try {
    const keys = Object.keys(WEB_NEWSLETTERS) as WebKey[]
    const lists = await Promise.all(keys.map(k => recordedIssues(k)))
    if (lists.some(l => l === null)) return { status: 'local' }
    const wanted: WantedIssue[] = []
    keys.forEach((key, i) => {
      for (const issue of lists[i] ?? []) {
        if (!sentInRange(issue.sentAt, range)) continue
        const name = issueName(key, issue.slug)
        if (name)
          wanted.push({ key, slug: issue.slug, name, sentAt: issue.sentAt })
      }
    })
    if (wanted.length === 0) return { status: 'ok', issues: [], complete: true }
    wanted.sort(bySendTime)
    const [clicks, listed] = await Promise.all([
      readClicks(wanted.map(w => w.name)),
      Promise.all(wanted.map(listedLinks)),
    ])
    // readClicks answers with nothing when Upstash couldn't be read (and
    // logs why): that's unknown, not zero clicks.
    if (clicks.size === 0) return { status: 'error' }
    const issues = wanted.map((w, i): SentIssueClicks => {
      const clicked = clicks.get(w.name)?.links ?? []
      const all = listed[i]
      return {
        name: w.name,
        sentAt: w.sentAt,
        links: all ? withListedLinks(clicked, all) : clicked,
        complete: all !== null,
      }
    })
    return { status: 'ok', issues, complete: issues.every(i => i.complete) }
  } catch (err) {
    console.warn(
      `[analytics] org lookup couldn't read newsletter clicks: ${reason(err)}`
    )
    return { status: 'error' }
  }
}

/** Every link of an issue, or null (with a warning naming the issue) when
 *  they can't all be read in time. Never throws. */
async function listedLinks(w: WantedIssue): Promise<NewsletterLink[] | null> {
  try {
    const links = await within(readLinks(w.key, w.slug), LINKS_TIMEOUT_MS)
    if (links) return links
    console.warn(
      `[analytics] org lookup: ${w.name}'s links took over ${LINKS_TIMEOUT_MS / 1000} s to read; showing its clicked links only`
    )
  } catch (err) {
    console.warn(
      `[analytics] org lookup: ${w.name}'s links couldn't be read (${reason(err)}); showing its clicked links only`
    )
  }
  return null
}

/** Every link of an issue: the lists its kept copy's counted links point
 *  into. Throws when the copy or any of its lists can't be read. */
async function readLinks(key: WebKey, slug: string): Promise<NewsletterLink[]> {
  const file = `${key}/${slug}.html`
  // A kept copy never changes once filed, so Next's fetch cache may keep it
  // for good (it keeps only a 200, so a copy not yet filed is asked for
  // again next time). Timed as a whole, like the list reads, since a stall
  // in that cache ignores the signal.
  const read = fetch(WEB_BASE + file, {
    cache: 'force-cache',
    signal: AbortSignal.timeout(WEB_COPY_TIMEOUT_MS),
  }).then(res => {
    if (!res.ok) throw new Error(`its kept copy ${file} answered ${res.status}`)
    return res.text()
  })
  const copy = await within(read, WEB_COPY_TIMEOUT_MS)
  if (copy === null)
    throw new Error(
      `its kept copy ${file} took over ${WEB_COPY_TIMEOUT_MS / 1000} s`
    )
  const ids = listIdsIn(copy)
  if (ids.length === 0)
    throw new Error(`its kept copy ${file} has no counted links`)
  const lists = await Promise.all(ids.map(id => loadLinkList(id)))
  const unread = ids.filter((_, i) => !lists[i])
  if (unread.length) throw new Error(`list ${unread.join(', ')} unreadable`)
  return lists.flatMap(l => l?.links ?? [])
}

/** A counted link as the pipeline writes it into an email:
 *  https://aisafety.com/api/nl/<list>/<n>. */
const COUNTED_LINK_RE =
  /https?:\/\/(?:www\.)?aisafety\.com\/api\/nl\/([^/"'\s<>?#]+)\/\d/g

/** Pure: the ids of the link lists an email's counted links point into,
 *  each once, in the order they first appear. Anything in the id's place
 *  that isn't a list id is skipped. Exported for the unit test. */
export function listIdsIn(html: string): string[] {
  const ids = new Set<string>()
  for (const m of html.matchAll(COUNTED_LINK_RE))
    if (LIST_ID_RE.test(m[1])) ids.add(m[1])
  return [...ids]
}

/** Pure: an issue's clicked links merged with every link of its list, so a
 *  link nobody clicked shows with 0. Clicks are counted per label and
 *  address (recordClick), so list entries sharing both are one link; a
 *  clicked link the list lacks still shows. Most-clicked first, ties in the
 *  email's order. Exported for the unit test. */
export function withListedLinks(
  clicked: CampaignClicks['links'],
  listed: Pick<NewsletterLink, 't' | 'u'>[]
): CampaignClicks['links'] {
  const field = (t: string, u: string) => JSON.stringify({ t, u })
  const out = new Map<string, CampaignClicks['links'][number]>()
  for (const { t, u } of listed) {
    const f = field(t, u)
    if (!out.has(f)) out.set(f, { label: t, url: u, clicks: 0 })
  }
  for (const l of clicked) {
    const f = field(l.label, l.url)
    const known = out.get(f)
    if (known) known.clicks += l.clicks
    else out.set(f, { ...l })
  }
  return [...out.values()].sort((a, b) => b.clicks - a.clicks)
}

/** Issues in the order they went out; one with no recorded send time last. */
function bySendTime(a: WantedIssue, b: WantedIssue): number {
  const at = (s: string | null) => {
    const t = s ? Date.parse(s) : NaN
    return Number.isNaN(t) ? Infinity : t
  }
  return at(a.sentAt) - at(b.sentAt) || a.name.localeCompare(b.name)
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Was an issue sent within the range? One with no recorded send time only
 *  counts toward an open range (All time). Exported for the unit test. */
export function sentInRange(
  sentAt: string | null,
  { startMs, endMs }: DateRange
): boolean {
  const t = sentAt ? Date.parse(sentAt) : NaN
  if (Number.isNaN(t)) return startMs == null && endMs == null
  return (startMs == null || t >= startMs) && (endMs == null || t <= endMs)
}
