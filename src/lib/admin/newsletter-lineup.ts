/*
  "Lined up" on /admin/newsletter (Bryce, 8 Oct 2026): how many listings each
  newsletter's next issue would pick up if Pen drafted it now. The rules are
  Pen's own (~/Pen/events/CLAUDE.md step 1, ~/Pen/funding/CLAUDE.md step 2):

  - Events / Training: on the site now (getEvents / getTrainingPrograms:
    published, not hidden, not over, which is also what the build keeps),
    added in the last month, not started yet, and not in an issue: Newsletter
    not ticked, or ticked but in no issue sent (Bryce, 22 Oct 2026: "These
    numbers should reflect exactly how many would go into an issue if Pen
    created an issue right now").
  - Funding, new: on the site and accepting applications now, and not
    accepting (or not listed) when the last Funding issue went out. Pen keeps that
    baseline in a file on Bryce's Mac, which the site can't read, so the site
    keeps its own copy: saveFundingBaseline() runs when a Funding issue is
    approved for the real list, first for Issue #23 (14 Oct 2026). Without
    a noted baseline (a laptop has no store) Funding isn't counted.
  - Funding, closing soon (step 3): accepting, with "Applications close
    DATE" in the next two weeks. A funder appears once in an issue, so one
    already counted as new isn't counted again here. Nor is one an issue
    has already reminded readers of (Bryce, 20 Oct 2026: the panel shows
    what goes out next): it was under "Closing in the next two weeks" in a
    Funding issue sent in the last two weeks (remindedFunders). One featured
    only as new can still come back as a reminder, as Pen's rules say.

  Listings already in a draft waiting for approval are left out: they're in
  that issue. (Pen ticks Newsletter as it drafts, so this only changes the
  Funding count, but the rule holds for all three.)
*/

import { Redis } from '@upstash/redis'
import { cardGroups, sentIssuesOn } from '@/lib/admin/newsletter'
import { fetchAirtableRecords } from '@/lib/data/airtable'
import { getEvents, TABLE_ID as EVENTS_TABLE } from '@/lib/data/events'
import { getFunders } from '@/lib/data/funding'
import { getTrainingPrograms, TRAINING_TABLE_ID } from '@/lib/data/training'
import { isAcceptingApplications } from '@/lib/funding-status'
import { MIN_READERS, issueSlug } from '@/lib/newsletter-archive'
import { WEB_NEWSLETTERS } from '@/lib/newsletter-web'
import { sentEmail } from '@/lib/newsletter-web-copy'

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

/** Pure: the listing has started by `today`, the day an issue Pen drafted
 *  now would carry. Pen leaves those out, competitions included (Bryce,
 *  8 Oct 2026, of week 41's Spillover Prediction Challenge: "Please remove
 *  this, it's already started"), and the issue's own day counts: an event
 *  on 8 October stayed out of that day's week 41. A training program with
 *  only rough timing ("October 2026") hasn't visibly started: the site keeps
 *  it until that period is over, and week 41 kept DISPATCH. */
export function hasStarted(
  listing: { startDate: string | null; startDateApprox?: string | null },
  today: string
): boolean {
  return (
    !listing.startDateApprox &&
    listing.startDate != null &&
    listing.startDate <= today
  )
}

/** The last Events & Training issue sent through Substack (week 40). The
 *  site can't read what those issues carried, so a listing added by then
 *  with Newsletter ticked counts as sent. From 1 November 2026 the month
 *  Pen looks back over starts after this and it no longer matters. */
const LAST_SUBSTACK_ISSUE = '2026-10-01'

/** Pure: the ticked listings an issue really carried. Pen also takes a
 *  listing added inside the month whose tick no issue explains: a record
 *  copied from an earlier round can arrive ticked (Foresight Fellowship:
 *  2028, created 15 September 2026 with the 2027 round's tick, never sent).
 *  `sentKeys` is every record id in the issues sent in that month, or null
 *  when they couldn't be read, and every tick then counts as sent. */
export function inAnIssue(
  listings: ReadonlyArray<{ id: string; dateAdded: string | null }>,
  ticked: ReadonlySet<string>,
  sentKeys: ReadonlySet<string> | null
): Set<string> {
  return new Set(
    listings
      .filter(
        l =>
          ticked.has(l.id) &&
          (sentKeys == null ||
            l.dateAdded == null ||
            l.dateAdded <= LAST_SUBSTACK_ISSUE ||
            sentKeys.has(l.id))
      )
      .map(l => l.id)
  )
}

/** Pure: the listings Pen would take as new events or training — added on
 *  or after `since`, not started by `today`, not in an issue (`sent`, from
 *  inAnIssue). */
export function pickNewListings(
  listings: Array<{
    id: string
    name: string
    dateAdded: string | null
    startDate: string | null
    startDateApprox?: string | null
  }>,
  sent: ReadonlySet<string>,
  since: string,
  today: string
): LineupItem[] {
  return listings
    .filter(
      l =>
        l.dateAdded != null &&
        l.dateAdded >= since &&
        !sent.has(l.id) &&
        !hasStarted(l, today)
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
 *  leaving out `skip` (already counted as new opportunities, or already
 *  reminded of). */
export function pickClosingFunders(
  funders: Array<{ id: string; name: string; acceptingApplications: string }>,
  today: string,
  skip: ReadonlySet<string>
): LineupItem[] {
  const last = addDays(today, CLOSING_DAYS)
  return funders
    .filter(f => {
      const day = closingDay(f.acceptingApplications)
      return day != null && day >= today && day <= last && !skip.has(f.id)
    })
    .map(({ id, name }) => ({ id, name }))
}

/** Pure: the record ids an issue listed as closing soon: its "Closing in
 *  the next two weeks" section ("Closing soon" before 7 September 2026). */
export function closingKeys(
  groups: ReadonlyArray<{
    label: string
    cards: ReadonlyArray<{ key: string }>
  }>
): string[] {
  return groups
    .filter(g => /^closing\b/i.test(g.label.trim()))
    .flatMap(g => g.cards.map(c => c.key))
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

/** The baseline noted when the last Funding issue was approved. */
export async function readFundingBaseline(): Promise<FundingBaseline> {
  const noted = store
    ? await store.get<FundingBaseline>(FUNDING_BASELINE_KEY)
    : null
  if (!noted) throw new Error(`no ${FUNDING_BASELINE_KEY} to count from`)
  return noted
}

/** The funders a Funding issue sent in the last CLOSING_DAYS days listed
 *  as closing soon, read from the emails as sent (the kept copy, else
 *  ActiveCampaign). A reminder sent before that was for a deadline that
 *  has passed by now. An issue whose email can't be read is logged and
 *  skipped: the panel is a count, not the issue. */
async function remindedFunders(today: string): Promise<Set<string>> {
  const from = addDays(today, -CLOSING_DAYS)
  const recent = (await sentIssuesOn(FUNDING_LIST_ID)).filter(
    i => i.sentAt == null || i.sentAt.slice(0, 10) >= from
  )
  const reminded = new Set<string>()
  await Promise.all(
    recent.map(async i => {
      const slug = issueSlug('funding', i.name)
      const email = slug ? await sentEmail('funding', slug) : null
      const groups = email ? cardGroups(email) : null
      if (!groups) {
        console.warn(
          `[newsletter] ${i.name}: no email with cards to read its closing-soon funders from`
        )
        return
      }
      for (const key of closingKeys(groups)) reminded.add(key)
    })
  )
  return reminded
}

/** Every record id in the Events and Training issues sent since `since`,
 *  read from the emails as sent. Null, logged, when one of them can't be
 *  read: counting its listings as never sent would count them again. */
async function sentListingKeys(since: string): Promise<Set<string> | null> {
  try {
    const issues = (
      await Promise.all(
        (['events', 'training'] as const).map(async key =>
          (await sentIssuesOn(WEB_NEWSLETTERS[key].list))
            .filter(
              i =>
                i.readers >= MIN_READERS &&
                (i.sentAt == null || i.sentAt.slice(0, 10) >= since)
            )
            .map(i => ({ key, name: i.name }))
        )
      )
    ).flat()
    const keys = new Set<string>()
    for (const { key, name } of issues) {
      const slug = issueSlug(key, name)
      const email = slug ? await sentEmail(key, slug) : null
      const groups = email ? cardGroups(email) : null
      if (!groups) {
        console.warn(
          `[newsletter] ${name}: no email with cards, so Newsletter ticks count as sent`
        )
        return null
      }
      for (const g of groups) for (const c of g.cards) keys.add(c.key)
    }
    return keys
  } catch (err) {
    console.warn(
      `[newsletter] reading the sent Events and Training issues failed, so Newsletter ticks count as sent: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
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
  const sentKeys = sentListingKeys(since)
  const [events, training, funding] = await Promise.all([
    Promise.all([
      getEvents(),
      tickedIds(EVENTS_TABLE, NEWSLETTER_FIELD.events),
      sentKeys,
    ]).then(
      ([listings, ticked, sent]): LineupSection => ({
        items: pickNewListings(
          listings,
          inAnIssue(listings, ticked, sent),
          since,
          today
        ),
        since: listingsSince,
      }),
      err => failed('events', err)
    ),
    Promise.all([
      getTrainingPrograms(),
      tickedIds(TRAINING_TABLE_ID, NEWSLETTER_FIELD.training),
      sentKeys,
    ]).then(
      ([listings, ticked, sent]): LineupSection => ({
        items: pickNewListings(
          listings,
          inAnIssue(listings, ticked, sent),
          since,
          today
        ),
        since: listingsSince,
      }),
      err => failed('training', err)
    ),
    Promise.all([
      getFunders(),
      readFundingBaseline(),
      remindedFunders(today),
    ]).then(
      ([funders, baseline, reminded]): LineupSection => {
        const items = pickNewFunders(funders, new Set(baseline.accepting))
        return {
          items,
          since: issueLabel(baseline.issue),
          closing: pickClosingFunders(
            funders,
            today,
            new Set([...items.map(i => i.id), ...reminded])
          ),
        }
      },
      err => failed('funding', err)
    ),
  ])
  return { events, training, funding }
}
