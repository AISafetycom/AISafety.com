// The job board's page (a 'jobs' link, src/lib/analytics/org-shares.ts):
// how the jobs on /jobs did in the chosen dates, worded for the board whose
// jobs they are. The figures come from jobsSourceStats() in
// src/lib/analytics/jobs-source.ts.

import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import {
  jobRowsCsv,
  type EmployerRow,
  type FilterRow,
  type JobRow,
  type JobsSourceStats,
  type Quarter,
} from '@/lib/analytics/jobs-source'
import ClicksChart from '../../admin/analytics/ClicksChart'
import SortableTable, {
  type SortColumn,
  type SortValue,
} from '../../admin/analytics/SortableTable'
import {
  MAX_TABLE_ROWS,
  Panel,
  Stat,
  TruncationNote,
  pct1,
  safeHref,
} from '../../admin/analytics/parts'
import type { ResolvedRange } from '../../admin/analytics/range'
import analytics from '../../admin/analytics/analytics.module.css'
import CsvDownload from './CsvDownload'
import styles from './page.module.css'

/** One column of a table: heading, sort value, cell, and Total cell, kept
 *  together so they can't drift apart. */
interface Column<R> {
  head: SortColumn
  value: (r: R) => SortValue
  cell: (r: R) => ReactNode
  foot: ReactNode
}

function countColumn<R>(
  label: string,
  hint: string,
  pick: (r: R) => number,
  total: string | null
): Column<R> {
  return {
    head: { label, className: analytics.numCol, sort: 'number', hint },
    value: pick,
    cell: r => <td className={analytics.numCol}>{pick(r).toLocaleString()}</td>,
    foot: <td className={analytics.numCol}>{total}</td>,
  }
}

function Table<R>({
  rows,
  columns,
  rowKey,
  rowClass,
  withTotal,
}: {
  rows: R[]
  columns: Column<R>[]
  rowKey: (r: R) => string
  rowClass?: (r: R) => string | undefined
  withTotal: boolean
}) {
  return (
    <SortableTable
      columns={columns.map(c => c.head)}
      values={rows.map(r => columns.map(c => c.value(r)))}
      foot={
        withTotal ? (
          <tr>
            {columns.map((c, i) => (
              <Fragment key={i}>{c.foot}</Fragment>
            ))}
          </tr>
        ) : undefined
      }
    >
      {rows.map(r => (
        <tr key={rowKey(r)} className={rowClass?.(r)}>
          {columns.map((c, i) => (
            <Fragment key={i}>{c.cell(r)}</Fragment>
          ))}
        </tr>
      ))}
    </SortableTable>
  )
}

/** The quarters to jump to, under the date boxes. */
function QuarterLinks({
  quarters,
  range,
}: {
  quarters: Quarter[]
  range: ResolvedRange
}) {
  return (
    <p className={styles.quarters}>
      <span className={analytics.dim}>Quarters:</span>
      {quarters.map(q => {
        const active = range.from === q.from && range.to === q.to
        return (
          <Link
            key={q.label}
            href={`?from=${q.from}&to=${q.to}`}
            className={`${analytics.copyBtn}${active ? ` ${styles.quarterActive}` : ''}`}
            aria-current={active ? 'true' : undefined}
          >
            {q.current ? `${q.label} so far` : q.label}
          </Link>
        )
      })}
    </p>
  )
}

export function JobsView({
  stats,
  boardName,
  range,
  quarters,
}: {
  stats: JobsSourceStats
  /** The board's name, as the link was made with ('80,000 Hours'). */
  boardName: string
  range: ResolvedRange
  quarters: Quarter[]
}) {
  const s = stats
  const fromWhere = [
    {
      key: 'jobsPage',
      name: 'The Jobs page (aisafety.com/jobs)',
      count: s.bySource.jobsPage,
    },
    { key: 'search', name: 'The site search', count: s.bySource.search },
    { key: 'chatbot', name: 'The chatbot', count: s.bySource.chatbot },
  ]
  const rows = s.rows.slice(0, MAX_TABLE_ROWS)
  const fileDates =
    range.from && range.to ? `${range.from}-to-${range.to}` : range.key

  const jobColumns: Column<JobRow>[] = [
    {
      head: {
        label: 'Job',
        sort: 'text',
        hint: 'The job as it appears on AISafety.com, linking to its posting. “No longer listed” means it has since come off the page.',
      },
      value: r => r.title,
      cell: r => {
        const href = safeHref(r.url)
        return (
          <td className={analytics.nameCell}>
            <span className={analytics.orgName}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {r.title}
                </a>
              ) : (
                <span>{r.title}</span>
              )}
              {!r.listedNow && (
                <span className={analytics.orgNotes}>No longer listed</span>
              )}
            </span>
          </td>
        )
      },
      foot: <td className={analytics.totalLabel}>Total</td>,
    },
    {
      head: { label: 'Employer', sort: 'text' },
      value: r => r.employer,
      cell: r => <td>{r.employer}</td>,
      foot: <td />,
    },
    countColumn(
      'Clicks',
      'Every click through to the posting, from the Jobs page, the site search, and the chatbot.',
      r => r.clicks,
      s.clicks.toLocaleString()
    ),
    countColumn(
      'People',
      'The browsers behind those clicks, each counted once.',
      r => r.people,
      null
    ),
  ]

  return (
    <>
      <QuarterLinks quarters={quarters} range={range} />

      <Panel title="Summary">
        <div className={analytics.funnel}>
          <Stat label="jobs listed" value={s.listed.toLocaleString()} />
          <Stat
            label="clicks to job postings"
            value={s.clicks.toLocaleString()}
          />
          <Stat label="people who clicked" value={s.people.toLocaleString()} />
          <Stat
            label="Jobs page visitors"
            value={s.pageVisitors.toLocaleString()}
          />
          <Stat
            label="of them clicked a job"
            value={pct1(s.pageClickers, s.pageVisitors)}
          />
        </div>
        <p className={analytics.caption}>
          Every job on aisafety.com/jobs comes from the {boardName} Job Board:
          its vacancies in AI safety and policy. Jobs listed counts the jobs on
          the page at some point in these dates: those still listed that you
          published before the dates ended, plus every other job someone
          clicked. A job that came and went without a single click isn&apos;t
          known, so the true number is a little higher.{' '}
          {s.clickedJobs.toLocaleString()} jobs got at least one click. People
          are browsers, each counted once, so one person on two devices counts
          twice. Since 24 August 2026, links from the Jobs page reach the
          posting tagged utm_source=aisafety.com. Clicks are counted from 1 July
          2026, and Jobs page visitors from 15 July 2026. Days are UTC.
        </p>
      </Panel>

      <div className={analytics.grid}>
        <Panel title="Where the clicks came from">
          <Table
            rows={fromWhere}
            rowKey={r => r.key}
            withTotal={false}
            columns={[
              {
                head: { label: 'Place', sort: 'text' },
                value: r => r.name,
                cell: r => <td className={analytics.nameCell}>{r.name}</td>,
                foot: <td />,
              },
              countColumn<(typeof fromWhere)[number]>(
                'Clicks',
                'Clicks through to a posting from here.',
                r => r.count,
                null
              ),
              {
                head: {
                  label: 'Share',
                  className: analytics.pctCol,
                  sort: 'number',
                },
                value: r => r.count,
                cell: r => (
                  <td className={analytics.pctCol}>
                    {pct1(r.count, s.clicks)}
                  </td>
                ),
                foot: <td />,
              },
            ]}
          />
          <p className={analytics.caption}>
            The site search and the chatbot also suggest jobs, and a click there
            opens the posting just like one on the Jobs page.
          </p>
        </Panel>

        <Panel
          title={`Clicks over time · per ${s.seriesUnit === 'week' ? 'week' : 'day'}`}
        >
          {s.clicks === 0 ? (
            <p className={analytics.dim}>No clicks in these dates.</p>
          ) : (
            <ClicksChart points={s.series} unit={s.seriesUnit} />
          )}
          <p className={analytics.caption}>
            Every click counted above, by UTC day
            {s.seriesUnit === 'week'
              ? ', grouped into weeks from Monday. A lighter column is a week only partly inside these dates'
              : ''}
            .
          </p>
        </Panel>
      </div>

      <Panel title="Jobs">
        {s.rows.length === 0 ? (
          <p className={analytics.dim}>No job was clicked in these dates.</p>
        ) : (
          <>
            <div className={styles.tableTools}>
              <CsvDownload
                csv={jobRowsCsv(s.rows)}
                filename={`aisafety-com-jobs-${fileDates}.csv`}
                label="Download as CSV"
              />
            </div>
            <Table
              rows={rows}
              columns={jobColumns}
              rowKey={r => r.key}
              rowClass={r => (r.listedNow ? undefined : analytics.pastRow)}
              withTotal
            />
            {s.rows.length > rows.length && (
              <TruncationNote shown={rows.length} of={s.rows.length} />
            )}
          </>
        )}
        <p className={analytics.caption}>
          Every job clicked in these dates, most clicked first. The CSV has
          every row, with each posting&apos;s address.
        </p>
      </Panel>

      <div className={analytics.grid}>
        <Panel title="Employers">
          {s.employers.length === 0 ? (
            <p className={analytics.dim}>No job was clicked in these dates.</p>
          ) : (
            <Table
              rows={s.employers.slice(0, MAX_TABLE_ROWS)}
              rowKey={r => r.name}
              withTotal={false}
              columns={[
                {
                  head: { label: 'Employer', sort: 'text' },
                  value: r => r.name,
                  cell: r => <td className={analytics.nameCell}>{r.name}</td>,
                  foot: <td />,
                },
                countColumn<EmployerRow>(
                  'Jobs',
                  'Its jobs that were clicked in these dates.',
                  r => r.jobs,
                  null
                ),
                countColumn<EmployerRow>(
                  'Clicks',
                  'Clicks on all of its jobs.',
                  r => r.clicks,
                  null
                ),
                countColumn<EmployerRow>(
                  'People',
                  'The browsers behind those clicks, each counted once.',
                  r => r.people,
                  null
                ),
              ]}
            />
          )}
        </Panel>

        <Panel title="What job seekers filter for">
          {s.filters.length === 0 ? (
            <p className={analytics.dim}>
              Nobody used the Jobs page&apos;s filters in these dates.
            </p>
          ) : (
            <Table
              rows={s.filters.slice(0, MAX_TABLE_ROWS)}
              rowKey={r => `${r.group}\x00${r.value}`}
              withTotal={false}
              columns={[
                {
                  head: { label: 'Filter', sort: 'text' },
                  value: r => r.group,
                  cell: r => <td>{r.group}</td>,
                  foot: <td />,
                },
                {
                  head: { label: 'Option', sort: 'text' },
                  value: r => r.value,
                  cell: r => <td className={analytics.nameCell}>{r.value}</td>,
                  foot: <td />,
                },
                countColumn<FilterRow>(
                  'People',
                  'Browsers that turned this option on, each counted once.',
                  r => r.people,
                  null
                ),
                countColumn<FilterRow>(
                  'Uses',
                  'Every time it was turned on.',
                  r => r.uses,
                  null
                ),
              ]}
            />
          )}
          <p className={analytics.caption}>
            The options visitors turned on in the Jobs page&apos;s filters
            (skill set, experience, type, remote or on-site, location, and
            degree). Recorded since 29 July 2026.
          </p>
        </Panel>
      </div>
    </>
  )
}
