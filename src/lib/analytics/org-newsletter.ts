// Newsletter link clicks for the Org lookup tab. Every link in a newsletter
// sent through the site goes through /api/nl, which counts clicks per issue
// and link in Upstash (src/lib/newsletter-clicks.ts). The issues come from
// the site's own record of what went out (newsletter-archive-store.ts), so
// there's no ActiveCampaign read: one Upstash read per newsletter, then one
// pipeline for the counts. Which links are the org's is decided by
// orgNewsletterClicks() in org-lookup.ts.

import { recordedIssues } from '@/lib/newsletter-archive-store'
import { readClicks, type CampaignClicks } from '@/lib/newsletter-clicks'
import { WEB_NEWSLETTERS, issueName, type WebKey } from '@/lib/newsletter-web'
import type { DateRange } from './events'

export interface SentIssueClicks {
  /** The campaign name, "Training · Week 41, 2026". */
  name: string
  sentAt: string | null
  /** Each link's clicks over the issue's whole life so far. */
  links: CampaignClicks['links']
}

export type IssueClicksRead =
  | { status: 'ok'; issues: SentIssueClicks[] }
  /** No Upstash keys (a laptop): clicks are counted on the live site only. */
  | { status: 'local' }
  | { status: 'error' }

/** The click counts of every issue sent within the range. Never throws:
 *  the tab says when the counts couldn't be read. */
export async function readIssueClicks(
  range: DateRange
): Promise<IssueClicksRead> {
  try {
    const keys = Object.keys(WEB_NEWSLETTERS) as WebKey[]
    const lists = await Promise.all(keys.map(k => recordedIssues(k)))
    if (lists.some(l => l === null)) return { status: 'local' }
    const wanted: { name: string; sentAt: string | null }[] = []
    keys.forEach((key, i) => {
      for (const issue of lists[i] ?? []) {
        if (!sentInRange(issue.sentAt, range)) continue
        const name = issueName(key, issue.slug)
        if (name) wanted.push({ name, sentAt: issue.sentAt })
      }
    })
    if (wanted.length === 0) return { status: 'ok', issues: [] }
    const clicks = await readClicks(wanted.map(w => w.name))
    // readClicks answers with nothing when Upstash couldn't be read (and
    // logs why): that's unknown, not zero clicks.
    if (clicks.size === 0) return { status: 'error' }
    return {
      status: 'ok',
      issues: wanted.map(w => ({
        ...w,
        links: clicks.get(w.name)?.links ?? [],
      })),
    }
  } catch (err) {
    console.warn(
      `[analytics] org lookup couldn't read newsletter clicks: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return { status: 'error' }
  }
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
