// The Org lookup: everything the dashboard holds on one org's listings across
// every page. Two audiences. The dashboard's Org lookup tab (page.tsx) adds
// the search box, Leave out, and the "Share with the org" box. The org's own
// shared page (src/app/stats) shows the same panels with none of those, and
// words them for the org.

import { Fragment, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { OrgListingRow, OrgLookupData } from '@/lib/analytics/events'
import {
  MAX_LEFT_OUT,
  orgNewsletterClicks,
  parseLeftOut,
  type OrgNewsletterRow,
  type OrgSpec,
} from '@/lib/analytics/org-lookup'
import type { IssueClicksRead } from '@/lib/analytics/org-newsletter'
import ClicksChart from './ClicksChart'
import Logo from './Logo'
import SortableTable, { type SortColumn, type SortValue } from './SortableTable'
import { navOrder } from './page-nav'
import {
  CountTable,
  KeyedTable,
  MAX_TABLE_ROWS,
  Panel,
  Stat,
  TruncationNote,
  faviconFor,
  joinList,
  prettyUrl,
  safeHref,
  shareCell,
  withoutUtm,
  type PageBadge,
} from './parts'
import { first, type ResolvedRange, type SearchParams } from './range'
import styles from './analytics.module.css'

/** The Org lookup's newsletter panel: whether the counts could be read, the
 *  issues that went out in the range, and the org's links among them. */
export interface OrgNewsletter {
  status: IssueClicksRead['status']
  /** The issues' names, in the order they were sent. */
  issues: string[]
  /** Every link of every one of those issues is known, so no rows means no
   *  issue linked to the org at all (not just that nobody clicked). */
  complete: boolean
  rows: OrgNewsletterRow[]
}

/** The panel's figures from the sent issues' link clicks. */
export async function orgNewsletterPanel(
  spec: Promise<OrgSpec>,
  read: IssueClicksRead
): Promise<OrgNewsletter> {
  if (read.status !== 'ok')
    return { status: read.status, issues: [], complete: false, rows: [] }
  return {
    status: 'ok',
    issues: read.issues.map(i => i.name),
    complete: read.issues.every(i => i.complete),
    rows: orgNewsletterClicks(await spec, read.issues),
  }
}

/** The dashboard's extras, absent on the org's shared page. The search box
 *  and the share box come from the dashboard, so this file never brings
 *  their code (or the address they write to) to the org's page. */
export interface OrgAdmin {
  query: string
  params: SearchParams
  unique: boolean
  searchBox: ReactNode
  /** The "Share with the org" box for the org the search found, and the
   *  rows this view leaves out; null for someone who can't make links. */
  shareBox: ((orgName: string, leftOut: string[]) => ReactNode) | null
  /** Every org page made so far, listed before a search (SharedOrgPages);
   *  null when there are none, or for someone who can't make them. */
  sharedPages: ReactNode
}

/** How often an org's page has been opened, for the share box and the list:
 *  "Opened 3 times, most recently on 12 October 2026". */
export function openedWords(
  views: number,
  lastViewedAt: string | null
): string {
  if (views <= 0) return 'Not opened yet'
  const times = `Opened ${views.toLocaleString()} ${views === 1 ? 'time' : 'times'}`
  if (!lastViewedAt) return times
  const day = new Date(lastViewedAt).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return views === 1
    ? `${times}, on ${day}`
    : `${times}, most recently on ${day}`
}

/** The Org lookup's panels. `admin` set = the dashboard's tab: a search box,
 *  then the panels following the date range and the count mode like the
 *  other tabs. Unset = the org's own page: the panels only, always counting
 *  each visitor once a day, worded for the org. */
export function OrgView({
  org,
  range,
  labelByPage,
  iconByPage,
  newsletter,
  admin,
}: {
  org: OrgLookupData | undefined
  range: ResolvedRange
  labelByPage: Map<string, string>
  iconByPage: Map<string, string>
  newsletter: OrgNewsletter | null
  admin?: OrgAdmin
}) {
  const shared = !admin
  const box = admin?.searchBox
  if (!org)
    return (
      <>
        {box}
        <div className={styles.empty}>
          {shared
            ? 'There’s nothing to show here just now. Reload the page to try again.'
            : 'Type an org’s name, like Lens Academy, BlueDot, or 80,000 Hours, to see every listing of theirs on the site and how each one is doing.'}
        </div>
        {admin?.sharedPages && (
          <Panel title="Org pages shared so far">
            {admin.sharedPages}
            <p className={styles.caption}>
              Open one to see its figures and update what it leaves out.
            </p>
          </Panel>
        )}
      </>
    )
  // When a page's listings couldn't be read, say so on every outcome: it may
  // be why the search found little or nothing.
  const failed = org.failedPages.length > 0 && (
    <p className={styles.orgWarning}>
      ⚠ Couldn&apos;t read the {joinList(org.failedPages)} listings just now, so
      {shared ? ' some of yours' : ' some of this org’s listings'} may be
      missing. Reload the page to try again.
    </p>
  )
  if (org.tooBroad)
    return (
      <>
        {box}
        {failed}
        <div className={styles.empty}>
          {shared
            ? 'There’s nothing to show here just now.'
            : `“${org.query}” matches ${org.tooBroad.listings.toLocaleString()} listings from ${org.tooBroad.websites.toLocaleString()} websites, so it isn’t one org. Try a fuller name, like Lens Academy.`}
        </div>
      </>
    )

  const inRange = shared ? 'in these dates' : 'in this range'
  // Nothing matched at all (a search that matches only past listings with
  // no activity in range still shows its panels, with a note in the table).
  // (Left-out rows in the address keep the panels, so they stay visible and
  // can be put back.)
  if (
    org.matched === 0 &&
    org.rows.length === 0 &&
    org.leftOut.length === 0 &&
    org.destinations.length === 0 &&
    org.searches.length === 0 &&
    (newsletter?.rows.length ?? 0) === 0 &&
    (!admin || parseLeftOut(first(admin.params.x)).size === 0)
  )
    return (
      <>
        {box}
        {failed}
        <div className={styles.empty}>
          {org.failedPages.length > 0
            ? shared
              ? 'Some of your listings couldn’t be read just now, so reload the page to try again.'
              : `Nothing found for “${org.query}”, but some listings couldn’t be read just now, so reload the page to try again.`
            : shared
              ? range.key === 'all'
                ? 'Nothing to show yet.'
                : `Nothing to show ${inRange}. Try a longer range, like All time.`
              : range.key === 'all'
                ? `Nothing on the site matches “${org.query}”. Try the org’s full name or another spelling.`
                : `Nothing on the site matches “${org.query}” now, and nothing by that name had activity in this range. Try a longer range, like All time, or another spelling.`}
        </div>
      </>
    )

  const pageLabel = (page: string) => labelByPage.get(page) ?? page
  const badgeFor = (page: string): PageBadge => {
    const icon = iconByPage.get(page)
    return {
      icon: icon ? `/images/icons/${icon}` : null,
      label: pageLabel(page),
    }
  }
  // Leave out / Put back links: the same address with one row hash added to
  // or taken off ?x=. Built from the rows actually left out, so stale hashes
  // drop away; past the cap, Leave out is withheld rather than ignored.
  // The rows left out here, plus any in ?x= with no activity in this range
  // (they'd come back on a longer one, so they're kept).
  const shownLeftOut = new Set(org.leftOut.map(l => l.hash))
  const leftOut = admin
    ? [...new Set([...shownLeftOut, ...parseLeftOut(first(admin.params.x))])]
    : []
  const hiddenLeftOut = leftOut.filter(h => !shownLeftOut.has(h)).length
  const canLeaveOut = !!admin && leftOut.length < MAX_LEFT_OUT
  const hrefWithLeftOut = (hashes: string[]) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(admin?.params ?? {})) {
      if (k === 'x' || v == null) continue
      q.set(k, Array.isArray(v) ? (v[0] ?? '') : v)
    }
    if (hashes.length) q.set('x', hashes.join(','))
    return `?${q.toString()}`
  }
  const leaveOutHref = (hash: string) => hrefWithLeftOut([...leftOut, hash])
  const putBackHref = (hash: string) =>
    hrefWithLeftOut(leftOut.filter(h => h !== hash))
  const unique = admin?.unique ?? true
  const usersHead = unique ? 'Users' : undefined
  const newsletterClicks =
    newsletter?.rows.reduce((n, r) => n + r.clicks, 0) ?? 0
  const them = shared ? 'you' : 'them'
  // The column headings' tooltips: what each column measures.
  const dates = shared ? 'these dates' : 'this range'
  const onceADay = unique ? ', each visitor counted once a day' : ''

  return (
    <>
      {box}
      {admin?.shareBox?.(org.orgName, leftOut)}
      {failed}

      <Panel title="Summary">
        <div className={styles.funnel}>
          <Stat
            label={`visitors sent to ${them}`}
            value={org.visitors.toLocaleString()}
          />
          <Stat label="clicks" value={org.clicks.toLocaleString()} />
          <Stat label="listings" value={org.rows.length.toLocaleString()} />
          {newsletter?.status === 'ok' && (
            <Stat
              label="newsletter clicks"
              value={newsletterClicks.toLocaleString()}
            />
          )}
        </div>
        {shared ? (
          <p className={styles.caption}>
            Visitors are the browsers that clicked through to one of your
            listings from a resource page, the site search, or the chatbot, each
            counted once. One person on two devices counts twice. Since 24
            August 2026, links from resource pages reach you tagged
            utm_source=aisafety.com; earlier clicks, and links from the search
            and the chatbot, aren&apos;t tagged, so your own analytics will
            likely show fewer. Newsletter clicks are counted separately, below.
          </p>
        ) : (
          <p className={styles.caption}>
            Visitors = browsers that clicked through to one of these listings
            from a resource page, site search, or the chatbot, counted once each
            whichever count mode is on. One person on two devices counts twice.
            Since 24 August 2026, links from resource pages reach the org tagged
            as coming from AISafety.com; earlier clicks, and links from search
            and the chatbot, aren&apos;t tagged, so the org&apos;s own analytics
            will likely show fewer. Newsletter clicks are counted apart (below):
            they can&apos;t be told apart by reader, so they&apos;re never in
            the visitors.
          </p>
        )}
      </Panel>

      <Panel title={shared ? 'Your listings' : 'Listings'}>
        <OrgListingsTable
          rows={org.rows}
          badgeFor={badgeFor}
          matchNotes={!shared}
          pageLast={shared}
          hints={{
            listing: shared
              ? 'Your listing as it appears on AISafety.com. “No longer listed” means it has since come off the site, and “Featured slot” means it held one of its page’s two featured spots for some of these clicks.'
              : 'The listing as it appears on the site. “No longer listed” means it has since come off the site, “Featured slot” that it held one of its page’s two featured spots for some of these clicks, and “Matched by organizer” or “by website” how the search found it.',
            clicks: unique
              ? `Clicks through to the listing from its own page (its card, featured slot, or map pin)${onceADay}.`
              : 'Every click through to the listing from its own page (its card, featured slot, or map pin).',
            pct: `The share of that page’s visitors in ${dates} who clicked this listing at least once.`,
            page: 'The AISafety.com page the listing is on.',
            hovers: `Times a visitor rested the pointer on the listing’s map pin for half a second, or tapped it on a phone${onceADay}.`,
            picks: `Times a visitor picked the listing from the Field map’s search box${onceADay}.`,
          }}
          leaveOutHref={canLeaveOut ? leaveOutHref : undefined}
          leaveOutColumn={!shared}
          empty={
            admin && (org.leftOut.length > 0 || hiddenLeftOut > 0)
              ? 'Every listing this search found is left out.'
              : org.failedPages.length > 0
                ? `No listings found, but the ${joinList(org.failedPages)} listings couldn’t be read just now; reload the page to try again.`
                : shared
                  ? range.key === 'all'
                    ? 'None of your listings has had any activity yet.'
                    : `None of your listings had any activity ${inRange}. Try a longer range, like All time.`
                  : org.matched === 0
                    ? `No listing on the site matches “${org.query}”; the panels below show only searches that name it.`
                    : range.key === 'all'
                      ? 'None of their listings had any activity since tracking began, and none are on the site now.'
                      : 'None of their listings had any activity in this range, and none are on the site now. Try a longer range, like All time.'
          }
        />
        {admin && !canLeaveOut && (
          <p className={styles.dim}>
            Up to {MAX_LEFT_OUT} listings can be left out. Put one back to leave
            out another.
          </p>
        )}
        {admin && (org.leftOut.length > 0 || hiddenLeftOut > 0) && (
          <ul className={styles.leftOutList}>
            <li>Left out</li>
            {org.leftOut.map(l => (
              <li key={l.hash}>
                <span>
                  {l.name} ({pageLabel(l.page)})
                </span>
                <Link
                  href={putBackHref(l.hash)}
                  scroll={false}
                  className={styles.leaveOut}
                >
                  Put back
                </Link>
              </li>
            ))}
            {hiddenLeftOut > 0 && (
              <li>
                {org.leftOut.length > 0 ? 'and ' : ''}
                {hiddenLeftOut.toLocaleString()}{' '}
                {hiddenLeftOut === 1 ? 'listing' : 'listings'} with no activity
                in this range
              </li>
            )}
          </ul>
        )}
        {shared ? (
          <p className={styles.caption}>
            Every listing of yours on AISafety.com, plus past ones with activity
            in these dates. Clicks are clicks on the listing on its own page
            (cards, featured slots, and map pins), each visitor counted once a
            day. % of visitors is the share of that page&apos;s visitors who
            clicked it.
            {org.rows.some(r => r.hovers || r.picks) &&
              ' Map hovers count a visitor resting the pointer on your pin for half a second (or tapping it on a phone), and map search picks count picks from the Field map’s search box, each once a visitor a day.'}
          </p>
        ) : (
          <p className={styles.caption}>
            Every live listing of theirs, plus past ones with activity in this
            range, matched by name, by organizer (an event&apos;s host, or the
            org behind a job or course), or by website. Clicks = clicks on the
            listing on its own page (cards, featured slots, and map pins),
            counted the same way as that page&apos;s tab. % of visitors = the
            share of that page&apos;s visitors who clicked it.
            {org.rows.some(r => r.hovers || r.picks) &&
              ' Map hovers = the cursor rested on the pin for half a second, or a tap on a phone opened its tooltip; map search picks = picked from the Field map’s search box.'}{' '}
            Leave out anything that isn&apos;t theirs; the choice stays in the
            address, so a bookmark keeps it.
          </p>
        )}
      </Panel>

      <div className={styles.grid}>
        <Panel title={`How visitors reached ${them}`}>
          {org.clicks === 0 ? (
            <p className={styles.dim}>No clicks {inRange}.</p>
          ) : (
            <CountTable
              rows={org.reached}
              labelHead="Way in"
              total={org.clicks}
              hints={{
                label:
                  'Where on AISafety.com the click came from, such as a listing’s card, a featured slot, a map pin, the homepage, the site search, or the chatbot.',
                count: `Clicks that came this way${onceADay}.`,
                pct: 'This way’s share of all the clicks.',
              }}
            />
          )}
          <p className={styles.caption}>
            {shared
              ? 'Featured slot counts clicks on a listing while it held one of the page’s two featured slots (its featured card at the top, or its card in the list when a filter is on). Homepage counts the homepage’s own cards.'
              : 'Featured slot = clicks on a listing while it held one of the page’s two featured slots (its featured card at the top, or its card in the list when a filter is on). Homepage = the homepage’s own cards.'}
            {admin?.unique &&
              ' Site search and chatbot clicks count once per visitor per link per day, so they won’t match the Search and Chatbot tabs, which count once per visitor over the whole range.'}
          </p>
        </Panel>
        <Panel title="Clicked from site search and the chatbot">
          <KeyedTable
            rows={org.destinations.map(d => ({
              key: d.key,
              name: d.name === d.url ? prettyUrl(d.url) : d.name,
              href: d.url,
              logo: faviconFor(d.url),
              where: d.where,
              count: d.count,
            }))}
            labelHead="Result"
            countHead="Clicks"
            hints={{
              label: `The listing ${shared ? 'of yours ' : ''}a visitor opened from a site search result or a chatbot reply.`,
              where:
                'Whether it was opened from the site search or the chatbot.',
              count: `Clicks on it from there${unique ? ', each visitor counted once a day' : ''}.`,
              pct: 'Its share of the clicks in this table.',
            }}
            empty={`No clicks from site search or the chatbot ${inRange}.`}
          />
          <p className={styles.caption}>
            {shared
              ? 'Your listings that visitors opened from a site search result or a chatbot reply.'
              : 'The listings visitors opened from a site search result or a chatbot reply, matched by their web address.'}
          </p>
        </Panel>
      </div>

      {newsletter && (
        <Panel title="Newsletter clicks">
          {newsletter.status === 'local' ? (
            <p className={styles.dim}>
              Newsletter clicks are counted on the live site only, so
              there&apos;s nothing to show here.
            </p>
          ) : newsletter.status === 'error' ? (
            <p className={styles.dim}>
              Couldn&apos;t read the newsletter click counts just now. Reload
              the page to try again.
            </p>
          ) : (
            <KeyedTable
              rows={newsletter.rows.map(r => ({
                key: r.key,
                name: r.label,
                // Opened from here, a link shouldn't count as a newsletter
                // visit in the org's own analytics.
                href: withoutUtm(r.url),
                logo: faviconFor(r.url),
                where: r.issue,
                count: r.clicks,
              }))}
              labelHead="Link"
              whereHead="Issue"
              countHead="Clicks"
              hints={{
                label: `${shared ? 'Your' : 'Their'} link as it appeared in the newsletter email.`,
                where: 'The newsletter issue the link was in.',
                count:
                  'Every click on the link since the issue went out. Readers can’t be told apart, so one person clicking twice counts twice.',
                pct: 'Its share of the clicks in this table.',
              }}
              empty={newsletterEmpty(newsletter, shared)}
            />
          )}
          <p className={styles.caption}>
            {shared ? (
              <>
                Clicks on your links in the AISafety.com email newsletters, for
                the issues sent in these dates. Each count covers the
                issue&apos;s whole life so far and every click, not unique
                readers. Counting began with the issues sent on 8 October 2026,
                and a new issue shows here within a day of going out. Issues of
                the newsletters still sent through Substack aren&apos;t counted.
              </>
            ) : (
              <>
                Clicks on their links in the newsletters sent through the site,
                for the issues that went out in this range. Each count covers
                the issue&apos;s whole life so far and every click, not unique
                readers. Counting began with the issues sent from 8 October
                2026; issues sent through Substack aren&apos;t counted. A newly
                sent issue shows here once the site has filed it, which can take
                up to a day.
              </>
            )}
          </p>
        </Panel>
      )}

      <Panel
        title={`Clicks over time · per ${org.seriesUnit === 'week' ? 'week' : 'day'}`}
      >
        {org.clicks === 0 ? (
          <p className={styles.dim}>No clicks {inRange}.</p>
        ) : (
          <ClicksChart points={org.series} unit={org.seriesUnit} />
        )}
        <p className={styles.caption}>
          Every click counted above, from resource pages, site search, and the
          chatbot, by UTC day
          {org.seriesUnit === 'week' ? ', grouped into weeks from Monday' : ''}.
        </p>
      </Panel>

      <Panel title="What people searched for">
        <KeyedTable
          rows={org.searches.map(r => ({
            key: r.key,
            name: r.term,
            where: r.where,
            count: r.count,
          }))}
          labelHead="Search"
          countHead={shared ? 'Visitors' : (usersHead ?? 'Searches')}
          hints={{
            label: 'What the visitor typed, recorded once they paused typing.',
            where: 'The site search, or the Field map’s search box.',
            count: unique
              ? 'Visitors who searched for this, each counted once.'
              : 'Every time this was searched for.',
            pct: 'Its share of these searches.',
          }}
          empty={`Nobody searched for ${them} ${inRange}.`}
        />
        <p className={styles.caption}>
          Searches in the site search and the Field map&apos;s search box that
          name {them}. A search is recorded once the visitor pauses typing.
          Recording since 16 July 2026 (the map&apos;s box since 5 September
          2026).
        </p>
      </Panel>
    </>
  )
}

/** The newsletter table's empty line. With every issue's links known, no
 *  rows means no issue linked to the org, and it says so, naming them; when
 *  some links are unknown it can only say nobody clicked. */
function newsletterEmpty(n: OrgNewsletter, shared: boolean): string {
  const [them, their, inRange] = shared
    ? ['you', 'your', 'in these dates']
    : ['them', 'their', 'in this range']
  const count = n.issues.length
  if (count === 0)
    return shared
      ? 'No counted newsletter issue went out in these dates.'
      : 'No newsletter went out through the site in this range.'
  if (!n.complete)
    return count === 1
      ? `No clicks on ${their} links in the one issue sent ${inRange}.`
      : `No clicks on ${their} links in the ${count.toLocaleString()} issues sent ${inRange}.`
  // Named only when there are one or two: the names hold commas ("Events ·
  // Week 41, 2026"), and a quarter holds two dozen.
  if (count === 1)
    return `The one issue sent ${inRange} (${n.issues[0]}) had no link to ${them}.`
  if (count === 2)
    return `Neither of the two issues sent ${inRange} (${n.issues[0]} and ${n.issues[1]}) linked to ${them}.`
  return `None of the ${count.toLocaleString()} issues sent ${inRange} linked to ${them}.`
}

/** The Org lookup's listings table. Rows span pages, and one name can be on
 *  two (Lens Academy is on the Field map and Communities), so every detail
 *  comes off the row itself, keyed by page + name, never by name. */
function OrgListingsTable({
  rows: allRows,
  badgeFor,
  matchNotes,
  pageLast,
  hints,
  leaveOutHref,
  leaveOutColumn,
  empty,
}: {
  rows: OrgListingRow[]
  badgeFor: (page: string) => PageBadge
  /** Say why each row matched the search (organizer, website). */
  matchNotes: boolean
  /** The Page column after the figures (the org's page): on a phone the
   *  figures then show without scrolling sideways. */
  pageLast: boolean
  /** What each column measures, for its heading's tooltip. */
  hints: Record<
    'listing' | 'clicks' | 'pct' | 'page' | 'hovers' | 'picks',
    string
  >
  /** Unset once the leave-out cap is reached. */
  leaveOutHref?: (hash: string) => string
  /** Keep the Leave out column, even while its links are withheld. */
  leaveOutColumn: boolean
  empty: string
}) {
  if (allRows.length === 0) return <p className={styles.dim}>{empty}</p>
  // Grouped by resource page in the tabs' order, busiest first within each
  // page (the order the rows arrive in; the sort is stable). The cap keeps
  // the busiest rows, so it's applied before grouping.
  const rows = allRows
    .slice(0, MAX_TABLE_ROWS)
    .sort((a, b) => navOrder(a.page) - navOrder(b.page))
  // Totals cover every row, including any past the display cap.
  const total = (pick: (r: OrgListingRow) => number) =>
    allRows.reduce((n, r) => n + pick(r), 0).toLocaleString()
  // Each column's heading, sort value, cell, and Total cell, so the order
  // can change without the four drifting apart.
  interface Column {
    head: SortColumn
    value: (r: OrgListingRow) => SortValue
    cell: (r: OrgListingRow) => ReactNode
    foot: ReactNode
  }
  const count = (
    label: string,
    hint: string,
    pick: (r: OrgListingRow) => number
  ): Column => ({
    head: { label, className: styles.numCol, sort: 'number', hint },
    value: pick,
    cell: r => <td className={styles.numCol}>{pick(r).toLocaleString()}</td>,
    foot: <td className={styles.numCol}>{total(pick)}</td>,
  })
  const listing: Column = {
    head: { label: 'Listing', sort: 'text', hint: hints.listing },
    value: r => r.name,
    cell: r => {
      const href = safeHref(r.url)
      const notes = [
        r.featured ? 'Featured slot' : null,
        !matchNotes
          ? null
          : r.why === 'organizer'
            ? 'Matched by organizer'
            : r.why === 'website'
              ? 'Matched by website'
              : null,
        r.live ? null : 'No longer listed',
      ].filter(Boolean)
      const logo = r.logo ?? faviconFor(href)
      return (
        <td className={styles.nameCell}>
          {href ? (
            <a
              className={styles.logoLink}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${r.name}`}
            >
              <Logo src={logo} />
            </a>
          ) : (
            <Logo src={logo} />
          )}
          <span className={styles.orgName}>
            <span>{r.name}</span>
            {notes.length > 0 && (
              <span className={styles.orgNotes}>{notes.join(' · ')}</span>
            )}
          </span>
        </td>
      )
    },
    foot: <td className={styles.totalLabel}>Total</td>,
  }
  const page: Column = {
    // Sorts by the pages' tab order, not alphabetically.
    head: { label: 'Page', sort: 'rank', hint: hints.page },
    value: r => navOrder(r.page),
    cell: r => {
      const badge = badgeFor(r.page)
      return (
        <td>
          <span className={styles.pageBadge}>
            {badge.icon && (
              <span className={styles.pageTabIcon}>
                <Image src={badge.icon} alt="" width={12} height={12} />
              </span>
            )}
            {badge.label}
          </span>
        </td>
      )
    },
    foot: <td />,
  }
  const figures: Column[] = [
    count('Clicks', hints.clicks, r => r.clicks),
    {
      head: {
        label: '% of visitors',
        className: styles.pctCol,
        sort: 'number',
        hint: hints.pct,
      },
      value: r =>
        r.share.visitors > 0 ? r.share.active / r.share.visitors : null,
      cell: r => <td className={styles.pctCol}>{shareCell(r.share)}</td>,
      foot: <td className={styles.pctCol} />,
    },
    ...(allRows.some(r => r.hovers > 0)
      ? [count('Map hovers', hints.hovers, r => r.hovers)]
      : []),
    ...(allRows.some(r => r.picks > 0)
      ? [count('Map search picks', hints.picks, r => r.picks)]
      : []),
  ]
  const leaveOut: Column = {
    head: { label: '' },
    value: () => null,
    cell: r => (
      <td>
        {leaveOutHref && (
          <Link
            href={leaveOutHref(r.hash)}
            scroll={false}
            className={styles.leaveOut}
            title="Not theirs? Leave it out of every figure on this tab"
          >
            Leave out
          </Link>
        )}
      </td>
    ),
    foot: <td />,
  }
  const columns = [
    listing,
    ...(pageLast ? [...figures, page] : [page, ...figures]),
    ...(leaveOutColumn ? [leaveOut] : []),
  ]
  return (
    <>
      <SortableTable
        columns={columns.map(c => c.head)}
        values={rows.map(r => columns.map(c => c.value(r)))}
        foot={
          <tr className={styles.totalRow}>
            {columns.map((c, i) => (
              <Fragment key={i}>{c.foot}</Fragment>
            ))}
          </tr>
        }
      >
        {rows.map(r => (
          <tr key={r.key}>
            {columns.map((c, i) => (
              <Fragment key={i}>{c.cell(r)}</Fragment>
            ))}
          </tr>
        ))}
      </SortableTable>
      {allRows.length > rows.length && (
        <TruncationNote shown={rows.length} of={allRows.length} />
      )}
    </>
  )
}
