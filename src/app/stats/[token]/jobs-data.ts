// What the job board's page and its data file (data.json/route.ts) share:
// the dates they cover, and the figures for them.

import { readEventsInRange } from '@/lib/analytics/events'
import { readJobsSeen } from '@/lib/analytics/jobs-seen'
import { jobsSourceStats, quartersSoFar } from '@/lib/analytics/jobs-source'
import { getJobs } from '@/lib/data/jobs'
import {
  resolveRange,
  type ResolvedRange,
  type SearchParams,
} from '../../admin/analytics/range'

/** The dates in the address, or else the last whole quarter, the period
 *  boards report on. */
export function jobsPageRange(sp: SearchParams, now: number) {
  const quarters = quartersSoFar(now)
  const lastWhole = quarters.filter(q => !q.current).at(-1) ?? quarters.at(-1)
  const chosen = sp.from || sp.to || sp.range
  const range = resolveRange(
    chosen || !lastWhole ? sp : { from: lastWhole.from, to: lastWhole.to },
    '90d'
  )
  return { range, quarters }
}

/** The figures for `range`. Throws when the events or the jobs can't be
 *  read; without the record of jobs listed, the count of them falls back to
 *  a floor. */
export async function loadJobsStats(range: ResolvedRange, now: number) {
  const [events, jobs, seen] = await Promise.all([
    readEventsInRange(range),
    getJobs(),
    readJobsSeen().catch(err => {
      console.warn(
        `[stats] record of jobs listed unavailable: ${err instanceof Error ? err.message : String(err)}`
      )
      return undefined
    }),
  ])
  return jobsSourceStats(events, jobs, range, now, seen)
}
