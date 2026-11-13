/** Newsletter subscribers over time, for the Newsletters tab's tiles: the
 *  history from each newsletter's Substack export (how many people each
 *  issue was emailed to) joined to its ActiveCampaign list since the move
 *  (who was on the list at the end of each day). Dependency-free so it can
 *  be unit-tested; src/lib/admin/newsletter-subscribers.ts reads the data. */

const DAY_MS = 86_400_000

/** The newsletters, their ActiveCampaign lists, the day each moved there
 *  (null for one still on Substack) and the Substack publication its export
 *  comes from. */
export const NEWSLETTERS = [
  {
    key: 'events',
    label: 'Events',
    list: '6',
    movedOn: '2026-10-08',
    substack: 'aisafetyeventsandtraining',
  },
  {
    key: 'training',
    label: 'Training',
    list: '7',
    movedOn: '2026-10-08',
    substack: 'aisafetyeventsandtraining',
  },
  // Moved with Issue #24.
  {
    key: 'funding',
    label: 'Funding',
    list: '8',
    movedOn: '2026-10-21',
    substack: 'aisafetyfunding',
  },
] as const

export type NewsletterKey = (typeof NEWSLETTERS)[number]['key']

/** The Substack publications an export can be for, by the name in its
 *  email_list.<publication>.csv. */
export const SUBSTACK_PUBLICATIONS = [
  ...new Set(NEWSLETTERS.map(n => n.substack)),
] as string[]

/** One contact's membership of a list, as ActiveCampaign's contactLists
 *  hold it. */
export interface ListRecord {
  list: string
  /** '0' unconfirmed (a signup that hasn't clicked the link), '1' active,
   *  '2' unsubscribed, '3' bounced. */
  status: string
  /** When they joined, and when they left (unsubscribed or bounced); ISO
   *  with the account's offset. */
  sdate: string | null
  udate: string | null
}

/** A list's size at the end of each UTC day. */
export interface ListDay {
  /** The day's start, epoch ms. */
  t: number
  n: number
}

/** Each list's size at the end of every day from `fromMs` (any time on the
 *  first day) to `toMs`: everyone who had joined by the day's end and not yet
 *  left. Unconfirmed signups never count. A record that has left but carries
 *  no date for it can't be placed, so it's left out and counted in
 *  `unplaced`. */
export function listDays(
  records: ListRecord[],
  lists: string[],
  fromMs: number,
  toMs: number
): { days: Record<string, ListDay[]>; unplaced: number } {
  const first = Math.floor(fromMs / DAY_MS) * DAY_MS
  const last = Math.floor(toMs / DAY_MS) * DAY_MS
  const spans = new Map<string, { join: number; leave: number }[]>(
    lists.map(l => [l, []])
  )
  let unplaced = 0
  for (const r of records) {
    const into = spans.get(r.list)
    if (!into || r.status === '0') continue
    const join = r.sdate ? Date.parse(r.sdate) : NaN
    const leave =
      r.status === '1'
        ? Number.POSITIVE_INFINITY
        : (r.status === '2' || r.status === '3') && r.udate
          ? Date.parse(r.udate)
          : NaN
    if (Number.isNaN(join) || Number.isNaN(leave)) {
      unplaced++
      continue
    }
    into.push({ join, leave })
  }
  const days: Record<string, ListDay[]> = {}
  for (const [list, members] of spans) {
    const out: ListDay[] = []
    for (let t = first; t <= last; t += DAY_MS) {
      const end = t + DAY_MS - 1
      let n = 0
      for (const m of members) if (m.join <= end && m.leave > end) n++
      out.push({ t, n })
    }
    days[list] = out
  }
  return { days, unplaced }
}

/** One Substack issue: when it was emailed and to how many people. */
export interface SubstackIssue {
  /** Epoch ms. */
  t: number
  n: number
}

/** A newsletter's subscribers over time as the chart draws it: one point per
 *  Substack issue up to the move (its day, and how many it was emailed to),
 *  then the list's size at the end of each day since, with `now` (today's
 *  live count, when it could be read) as the last point. */
export function subscriberPoints(
  issues: SubstackIssue[],
  days: ListDay[],
  movedOn: string | null,
  now: { t: number; n: number } | null
): { t: number; v: number; note: string }[] {
  const moved = movedOn ? Date.parse(`${movedOn}T00:00:00Z`) : Infinity
  const out: { t: number; v: number; note: string }[] = []
  for (const i of [...issues].sort((a, b) => a.t - b.t)) {
    if (i.t >= moved) continue
    const t = Math.floor(i.t / DAY_MS) * DAY_MS
    // Two issues on one day are one point: the later one's.
    if (out.length > 0 && out[out.length - 1].t === t) out.pop()
    out.push({ t, v: i.n, note: 'emailed the Substack issue' })
  }
  if (Number.isFinite(moved)) {
    const today = now ? Math.floor(now.t / DAY_MS) * DAY_MS : Infinity
    for (const d of days)
      if (d.t >= moved && d.t < today)
        out.push({ t: d.t, v: d.n, note: 'on the list at the end of the day' })
    if (now) out.push({ t: today, v: now.n, note: 'on the list now' })
  }
  return out
}

/** The figure at a moment: the last point at or before it, or null when
 *  every point is later. */
export function valueAt(
  points: { t: number; v: number }[],
  t: number
): number | null {
  let v: number | null = null
  for (const p of points) {
    if (p.t > t) break
    v = p.v
  }
  return v
}
