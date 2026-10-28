// An org's own page: the Org lookup's figures for one org, at the private
// link someone with Admin admin's edit grant made for them on the dashboard
// (src/lib/analytics/org-shares.ts). The link fixes the search and what's
// left out; the org picks the dates. A 'jobs' link shows the job board's
// page instead (JobsView), made on the dashboard's Jobs tab. Unknown or
// switched-off links are a plain 404, and nothing here is indexed or passed
// on in a Referer.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { after } from 'next/server'
import { cache } from 'react'
import { isAdmin } from '@/lib/admin/auth'
import { readDashboard, readEventsInRange } from '@/lib/analytics/events'
import { jobsSourceStats, quartersSoFar } from '@/lib/analytics/jobs-source'
import { readIssueClicks } from '@/lib/analytics/org-newsletter'
import {
  countShareView,
  getShare,
  isShareToken,
  type OrgShare,
} from '@/lib/analytics/org-shares'
import { getJobs } from '@/lib/data/jobs'
import DateRangePicker from '../../admin/analytics/DateRangePicker'
import { OrgView, orgNewsletterPanel } from '../../admin/analytics/OrgView'
import { orgSearchSpec } from '../../admin/analytics/org-search'
import { PAGE_NAV } from '../../admin/analytics/page-nav'
import { resolveRange, type SearchParams } from '../../admin/analytics/range'
import analytics from '../../admin/analytics/analytics.module.css'
import { JobsView } from './JobsView'
import styles from './page.module.css'

// Live figures, and a switched-off link must stop at once.
export const dynamic = 'force-dynamic'

/** The range an org's page opens on: a quarter tells more than a month. */
const DEFAULT_RANGE = '90d'

/** The page's heading and browser title. */
function titleOf(share: OrgShare): string {
  return share.kind === 'jobs'
    ? `${share.orgName} jobs on AISafety.com`
    : `${share.orgName} on AISafety.com`
}

/** One store read per request, shared by the metadata and the page. A
 *  malformed token never reaches the store. */
const shareFor = cache(async (token: string) =>
  isShareToken(token) ? getShare(token) : null
)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const share = await shareFor((await params).token)
  return {
    title: share ? titleOf(share) : 'AISafety.com',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  }
}

export default async function OrgStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<SearchParams>
}) {
  const { token } = await params
  const share = await shareFor(token)
  if (!share) notFound()

  // Count the opening once the page is sent: a browser loading the page
  // itself, not a link preview fetching it or a preload, and not the team.
  const h = await headers()
  if (h.get('sec-fetch-dest') === 'document' && !(await isAdmin()))
    after(() => countShareView(token))

  if (share.kind === 'jobs')
    return <JobsPage share={share} searchParams={await searchParams} />

  // Only the dates come from the address; the search and what it leaves out
  // are the link's own.
  const sp = await searchParams
  const range = resolveRange(sp, DEFAULT_RANGE)
  const search = orgSearchSpec(share.query, new Set(share.leftOut))
  const [data, issueClicks] = await Promise.all([
    readDashboard(range, undefined, true, undefined, search),
    readIssueClicks(range),
  ])
  const newsletter = await orgNewsletterPanel(search, issueClicks)

  return (
    <div className="container-default padding-top-56px padding-bottom-80px">
      {/* The name the link was made with, checked by the admin who made it. */}
      <h1 className={`padding-bottom-12px ${styles.title}`}>
        {titleOf(share)}
      </h1>
      <p className="color-teal-300 margin-bottom-32px">
        How visitors to AISafety.com find your listings and click through to
        them. The figures are live, so pick any dates below. Only people with
        this link can see this page.
      </p>
      <div className={analytics.dashboard}>
        {/* Keyed by the range, so Back and Forward refill the date boxes. */}
        <DateRangePicker
          key={`${range.key}|${range.from ?? ''}|${range.to ?? ''}`}
          activeKey={range.key}
          from={range.from}
          to={range.to}
          preloadAll={false}
        />
        {data.error ? (
          <div className={analytics.empty}>
            Couldn&apos;t load the figures just now. Reload the page to try
            again in a moment.
          </div>
        ) : (
          <OrgView
            org={data.org}
            range={range}
            labelByPage={new Map(PAGE_NAV.map(p => [p.name, p.label]))}
            iconByPage={new Map(PAGE_NAV.map(p => [p.name, p.icon]))}
            newsletter={newsletter}
          />
        )}
      </div>
    </div>
  )
}

/** The job board's page. Opens on the last whole quarter, the period boards
 *  report on; the quarter buttons and the date boxes pick any other. */
async function JobsPage({
  share,
  searchParams: sp,
}: {
  share: OrgShare
  searchParams: SearchParams
}) {
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; this stamps that request
  const now = Date.now()
  const quarters = quartersSoFar(now)
  const lastWhole = quarters.filter(q => !q.current).at(-1) ?? quarters.at(-1)
  const chosen = sp.from || sp.to || sp.range
  const range = resolveRange(
    chosen || !lastWhole ? sp : { from: lastWhole.from, to: lastWhole.to },
    DEFAULT_RANGE
  )
  let stats = null
  try {
    const [events, jobs] = await Promise.all([
      readEventsInRange(range),
      getJobs(),
    ])
    stats = jobsSourceStats(events, jobs, range, now)
  } catch (err) {
    console.warn(
      `[stats] job board figures unavailable: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  return (
    <div className="container-default padding-top-56px padding-bottom-80px">
      <h1 className={`padding-bottom-12px ${styles.title}`}>
        {titleOf(share)}
      </h1>
      <p className="color-teal-300 margin-bottom-32px">
        How visitors to AISafety.com find your jobs and click through to them.
        The figures are live, so pick a quarter or any dates below. Only people
        with this link can see this page.
      </p>
      <div className={analytics.dashboard}>
        {/* Keyed by the range, so Back and Forward refill the date boxes. */}
        <DateRangePicker
          key={`${range.key}|${range.from ?? ''}|${range.to ?? ''}`}
          activeKey={range.key}
          from={range.from}
          to={range.to}
          preloadAll={false}
        />
        {stats ? (
          <JobsView
            stats={stats}
            boardName={share.orgName}
            range={range}
            quarters={quarters}
          />
        ) : (
          <div className={analytics.empty}>
            Couldn&apos;t load the figures just now. Reload the page to try
            again in a moment.
          </div>
        )}
      </div>
    </div>
  )
}
