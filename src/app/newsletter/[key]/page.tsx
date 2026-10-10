import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate } from '@/lib/format-date'
import { WEB_NEWSLETTERS, isWebKey } from '@/lib/newsletter-web'
import {
  NEWSLETTER_ABOUT,
  SUBSTACK_ARCHIVES,
  SUBSTACK_NOTE,
  archivePath,
  feedPath,
  issuePath,
  issueTitle,
  type ArchiveIssue,
} from '@/lib/newsletter-archive'
import { archiveIssues } from '@/lib/newsletter-archive-store'
import { withUtm } from '@/lib/utm'
import ArchiveLink from './ArchiveLink'
import styles from './page.module.css'

// /newsletter/events, /newsletter/training: every issue sent through
// ActiveCampaign, linking each one's web version, with the feed and the
// Substack archive (src/lib/newsletter-archive.ts). Rebuilt at most every
// ten minutes, so a new issue shows within that of reaching its first
// readers. A newsletter with no issue sent that way yet (Funding, until its
// move) is a 404 until its first one. Kept out of search results, like the
// issues themselves.
//
// force-static: the reads behind the list (Upstash, ActiveCampaign) are
// uncached fetches, which would otherwise make Next render the page on
// every visit instead of every ten minutes.

export const dynamic = 'force-static'
export const revalidate = 600
export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(WEB_NEWSLETTERS).map(key => ({ key }))
}

type Props = { params: Promise<{ key: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params
  if (!isWebKey(key)) return {}
  const { sender } = WEB_NEWSLETTERS[key]
  return {
    title: `Past issues of ${sender} – AISafety.com`,
    description: `Every issue of ${sender}, the AISafety.com newsletter, with its RSS feed.`,
    alternates: {
      canonical: archivePath(key),
      types: {
        'application/rss+xml': [{ url: feedPath(key), title: sender }],
      },
    },
    robots: { index: false, follow: true },
  }
}

export default async function PastIssuesPage({ params }: Props) {
  const { key } = await params
  if (!isWebKey(key)) notFound()
  const nl = WEB_NEWSLETTERS[key]

  let issues: ArchiveIssue[] | null
  try {
    issues = await archiveIssues(key)
  } catch (err) {
    // Neither the record nor ActiveCampaign answered. After the build, a
    // failed rebuild keeps the last good page up: let it fail. During the
    // build (several a day, after Airtable edits), say so on the page
    // until the first rebuild rather than fail the whole site's deploy.
    if (process.env.NEXT_PHASE !== 'phase-production-build') throw err
    console.error(
      `[newsletter-archive] /newsletter/${key} at build: ${err instanceof Error ? err.message : String(err)}`
    )
    issues = null
  }
  if (issues?.length === 0) notFound()

  return (
    <div className="container-narrow">
      <div className="flex justify-center">
        <div className="width-9-col-narrow padding-bottom-56px">
          <h1 className="padding-top-56px padding-bottom-40px">Past issues</h1>
          <h2 className="padding-bottom-40px">
            <span className="color-light-teal">{nl.sender}</span>{' '}
            {NEWSLETTER_ABOUT[key]}
          </h2>

          {issues ? (
            <ul className={`paragraph-small ${styles.issues}`}>
              {issues.map(issue => (
                <li
                  key={issue.slug}
                  className={`${styles.issue} gap-16px padding-top-12px padding-bottom-12px`}
                >
                  <span className="color-teal-400">
                    {issue.sentAt ? formatDate(new Date(issue.sentAt)) : ''}
                  </span>
                  <ArchiveLink
                    href={issuePath(key, issue.slug)}
                    newsletter={nl.prefix}
                    target="issue"
                    label={issue.slug}
                    className={`color-white ${styles.title}`}
                  >
                    {issueTitle(key, issue.slug)}
                  </ArchiveLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="color-teal-300">
              The list of past issues couldn&apos;t be loaded just now. Please
              try again in a few minutes.
            </p>
          )}

          <p className="paragraph-small color-teal-300 padding-top-24px">
            {SUBSTACK_NOTE[key]}{' '}
            <ArchiveLink
              href={withUtm(SUBSTACK_ARCHIVES[key], 'Newsletter')}
              newsletter={nl.prefix}
              target="substack"
              className="color-light-teal"
            >
              Substack
            </ArchiveLink>
            .
          </p>
          <p className="paragraph-small color-teal-300 padding-top-16px">
            To follow new issues in a feed reader, use the{' '}
            <ArchiveLink
              href={feedPath(key)}
              newsletter={nl.prefix}
              target="feed"
              className="color-light-teal"
            >
              RSS feed
            </ArchiveLink>
            . To get them by email, sign up on{' '}
            <Link href={nl.page} className="color-light-teal">
              AISafety.com{nl.page}
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
