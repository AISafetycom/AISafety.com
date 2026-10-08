/*
  "Lined up" on /admin/newsletter (Bryce, 8 Oct 2026): how many listings each
  newsletter's next issue would pick up if Pen drafted it now. The rules are
  Pen's own (~/Pen/events/CLAUDE.md step 1, ~/Pen/funding/CLAUDE.md step 2):

  - Events / Training: on the site now (getEvents / getTrainingPrograms:
    published, not hidden, not over or already started, which is also what
    the build keeps), Newsletter not ticked, added in the last month.
  - Funding, new: on the site and accepting applications now, and not
    accepting (or not listed) when the last Funding issue went out. Pen keeps that
    baseline in a file on Bryce's Mac, which the site can't read, so the site
    keeps its own copy: saveFundingBaseline() runs when a Funding issue is
    approved for the real list. Until the first one is (Issue #23), Pen's
    snapshot after Issue #22 stands in (newsletter-funding-seed.json, copied
    8 Oct 2026); delete that file once the site has noted an issue itself.
  - Funding, closing soon (step 3): accepting, with "Applications close
    DATE" in the next two weeks. A funder appears once in an issue, so one
    already counted as new isn't counted again here.

  Listings already in a draft waiting for approval are left out: they're in
  that issue. (Pen ticks Newsletter as it drafts, so this only changes the
  Funding count, but the rule holds for all three.)
*/

import { Redis } from '@upstash/redis'
import { fetchAirtableRecords } from '@/lib/data/airtable'
import { getEvents, TABLE_ID as EVENTS_TABLE } from '@/lib/data/events'
import { getFunders } from '@/lib/data/funding'
import { getTrainingPrograms, TRAINING_TABLE_ID } from '@/lib/data/training'
import { isAcceptingApplications } from '@/lib/funding-status'
import FUNDING_SEED from './newsletter-funding-seed.json'

/** The real Funding list (newsletter.ts REAL_LISTS). */
export const FUNDING_LIST_ID = '8'

/** The "Newsletter" checkbox Pen ticks on every listing it puts in an issue. */
const NEWSLETTER_FIELD = {
  events: 'fldRdDbcWhCsoLrQj',
  training: 'fldirVkgSCVk726Di',
} as const

// The same Upstash database the approval records use (newsletter.ts).
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

/** The Funding listings that were accepting applications when the last
 *  Funding issue was approved. No expiry: it is replaced by the next one. */
const FUNDING_BASELINE_KEY = 'aisafety:newsletter:funding-baseline'

export interface FundingBaseline {
  /** The issue's campaign name, "Funding · Issue #22, 2026". */
  issue: string
  takenAt: string
  /** Record ids of the listings accepting applications then. */
  accepting: string[]
}

export interface LineupItem {
  id: string
  name: string
}

export type LineupSection =
  | {
      items: LineupItem[]
      /** What "new" is measured from: "8 September 2026" (added since) for
       *  Events and Training, the last issue's name for Funding. */
      since: string
      /** Funding only: closing in the next two weeks, not new. */
      closing?: LineupItem[]
    }
  | { error: string }

export interface Lineup {
  events: LineupSection
  training: LineupSection
  funding: LineupSection
}

/** Pure: the same day one month earlier, clamped to the end of a shorter
 *  month ("2026-03-31" → "2026-02-28"). */
export function monthBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const year = m === 1 ? y - 1 : y
  const month = m === 1 ? 12 : m - 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Pure: the listings Pen would take as new events or training — added on
 *  or after `since`, Newsletter not ticked. */
export function pickNewListings(
  listings: Array<{ id: string; name: string; dateAdded: string | null }>,
  ticked: ReadonlySet<string>,
  since: string
): LineupItem[] {
  return listings
    .filter(
      l => l.dateAdded != null && l.dateAdded >= since && !ticked.has(l.id)
    )
    .map(({ id, name }) => ({ id, name }))
}

/** Pure: a Funding status counts as accepting when it is filled in and
 *  isn't one of the closed wordings. */
export function fundingAccepting(status: string): boolean {
  return status.trim() !== '' && isAcceptingApplications(status.trim())
}

/** Pure: the funders Pen would take as new opportunities — accepting now,
 *  not accepting (or not listed) at the baseline. */
export function pickNewFunders(
  funders: Array<{ id: string; name: string; acceptingApplications: string }>,
  baseline: ReadonlySet<string>
): LineupItem[] {
  return funders
    .filter(
      f => fundingAccepting(f.acceptingApplications) && !baseline.has(f.id)
    )
    .map(({ id, name }) => ({ id, name }))
}

/** Funding's "Closing in the next two weeks" section. */
const CLOSING_DAYS = 14

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Pure: the closing day in "Applications close 31 October 2026" as
 *  YYYY-MM-DD; null for any other wording. */
export function closingDay(status: string): string | null {
  const m = /^Applications close (\d{1,2}) ([A-Z][a-z]+) (\d{4})\b/.exec(
    status.trim()
  )
  const month = m ? MONTHS.indexOf(m[2]) + 1 : 0
  if (!m || month === 0) return null
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

/** Pure: the YYYY-MM-DD day `n` days after `day`. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Pure: the funders whose applications close from `today` to two weeks on,
 *  leaving out `isNew` (already counted as new opportunities). */
export function pickClosingFunders(
  funders: Array<{ id: string; name: string; acceptingApplications: string }>,
  today: string,
  isNew: ReadonlySet<string>
): LineupItem[] {
  const last = addDays(today, CLOSING_DAYS)
  return funders
    .filter(f => {
      const day = closingDay(f.acceptingApplications)
      return day != null && day >= today && day <= last && !isNew.has(f.id)
    })
    .map(({ id, name }) => ({ id, name }))
}

/** Pure: `lineup` without the listings in `waiting` (the card keys of the
 *  drafts waiting for approval). */
export function withoutWaiting(
  lineup: Lineup,
  waiting: ReadonlySet<string>
): Lineup {
  const keep = (items: LineupItem[]) => items.filter(i => !waiting.has(i.id))
  const drop = (s: LineupSection): LineupSection =>
    'items' in s
      ? {
          ...s,
          items: keep(s.items),
          ...(s.closing ? { closing: keep(s.closing) } : {}),
        }
      : s
  return {
    events: drop(lineup.events),
    training: drop(lineup.training),
    funding: drop(lineup.funding),
  }
}

/** Pure: "Funding · Issue #22, 2026" → "Issue #22, 2026". */
export function issueLabel(campaignName: string): string {
  return campaignName.replace(/^[^·]*·\s*/, '')
}

/** "8 September 2026" for a YYYY-MM-DD day. */
function longDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Record ids whose Newsletter box is ticked. Same arguments as the data
 *  module's own read, so this is the same cached Airtable result. */
async function tickedIds(table: string, field: string): Promise<Set<string>> {
  const raw = await fetchAirtableRecords({
    tableId: table,
    returnFieldsByFieldId: true,
  })
  return new Set(raw.filter(r => r.fields[field] === true).map(r => r.id))
}

function failed(what: string, err: unknown): LineupSection {
  console.error(
    `[newsletter] counting ${what} failed: ${err instanceof Error ? err.message : String(err)}`
  )
  return { error: 'couldn’t be counted just now' }
}

/** The last noted baseline, or Pen's Issue #22 one before the first. */
export async function readFundingBaseline(): Promise<FundingBaseline> {
  const noted = store
    ? await store.get<FundingBaseline>(FUNDING_BASELINE_KEY)
    : null
  return noted ?? FUNDING_SEED
}

/** Note which Funding listings accept applications as `issue` goes out to
 *  the real list. A later wave or a second approval of the same issue keeps
 *  the first note. (An approval canceled and never sent again still moves
 *  the baseline; the next issue's approval puts it right.) */
export async function saveFundingBaseline(issue: string): Promise<void> {
  if (!store) return
  const current = await store.get<FundingBaseline>(FUNDING_BASELINE_KEY)
  if (current?.issue === issue) return
  const funders = await getFunders()
  const baseline: FundingBaseline = {
    issue,
    takenAt: new Date().toISOString(),
    accepting: funders
      .filter(f => fundingAccepting(f.acceptingApplications))
      .map(f => f.id),
  }
  await store.set(FUNDING_BASELINE_KEY, baseline)
}

/** Each newsletter's lined-up listings, before withoutWaiting(). A section
 *  that can't be read says so; the others still count. */
export async function readLineup(
  today = new Date().toISOString().slice(0, 10)
): Promise<Lineup> {
  const since = monthBefore(today)
  const listingsSince = longDate(since)
  const [events, training, funding] = await Promise.all([
    Promise.all([
      getEvents(),
      tickedIds(EVENTS_TABLE, NEWSLETTER_FIELD.events),
    ]).then(
      ([listings, ticked]): LineupSection => ({
        items: pickNewListings(listings, ticked, since),
        since: listingsSince,
      }),
      err => failed('events', err)
    ),
    Promise.all([
      getTrainingPrograms(),
      tickedIds(TRAINING_TABLE_ID, NEWSLETTER_FIELD.training),
    ]).then(
      ([listings, ticked]): LineupSection => ({
        items: pickNewListings(listings, ticked, since),
        since: listingsSince,
      }),
      err => failed('training', err)
    ),
    Promise.all([getFunders(), readFundingBaseline()]).then(
      ([funders, baseline]): LineupSection => {
        const items = pickNewFunders(funders, new Set(baseline.accepting))
        return {
          items,
          since: issueLabel(baseline.issue),
          closing: pickClosingFunders(
            funders,
            today,
            new Set(items.map(i => i.id))
          ),
        }
      },
      err => failed('funding', err)
    ),
  ])
  return { events, training, funding }
}
