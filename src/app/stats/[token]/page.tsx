// An org's own page: the Org lookup's figures for one org, at the private
// link someone with Admin admin's edit grant made for them on the dashboard
// (src/lib/analytics/org-shares.ts). The link fixes the search and what's
// left out; the org picks the dates. Unknown or switched-off links are a
// plain 404, and nothing here is indexed or passed on in a Referer.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { after } from 'next/server'
import { cache } from 'react'
import { isAdmin } from '@/lib/admin/auth'
import { readDashboard } from '@/lib/analytics/events'
import { readIssueClicks } from '@/lib/analytics/org-newsletter'
import {
  countShareView,
  getShare,
  isShareToken,
} from '@/lib/analytics/org-shares'
import DateRangePicker from '../../admin/analytics/DateRangePicker'
import { OrgView, orgNewsletterPanel } from '../../admin/analytics/OrgView'
import { orgSearchSpec } from '../../admin/analytics/org-search'
import { PAGE_NAV } from '../../admin/analytics/page-nav'
import { resolveRange, type SearchParams } from '../../admin/analytics/range'
import analytics from '../../admin/analytics/analytics.module.css'

// Live figures, and a switched-off link must stop at once.
export const dynamic = 'force-dynamic'

/** The range an org's page opens on: a quarter tells more than a month. */
const DEFAULT_RANGE = '90d'

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
    title: share ? `${share.orgName} on AISafety.com` : 'AISafety.com',
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

  // Count the opening once the page is sent: a browser loading the page
  // itself, not a link preview fetching it or a preload, and not the team.
  const h = await headers()
  if (h.get('sec-fetch-dest') === 'document' && !(await isAdmin()))
    after(() => countShareView(token))

  const orgName = data.org?.orgName ?? share.orgName
  return (
    <div className="container-default padding-top-56px padding-bottom-80px">
      <h1 className="padding-bottom-12px">{orgName} on AISafety.com</h1>
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
