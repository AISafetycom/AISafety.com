import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { formatDate } from '@/lib/format-date'
import { WEB_NEWSLETTERS, isWebKey } from '@/lib/newsletter-web'
import {
  NEWSLETTER_ABOUT,
  RESOURCE_LINK,
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
import PageHeader from '@/components/PageHeader'
import { isSignupNewsletter } from '@/lib/newsletter-signup'
import ArchiveLink from './ArchiveLink'
import styles from './page.module.css'

// /newsletter/events, /newsletter/training, /newsletter/funding: each
// newsletter's own page, the one to link when pointing people at the
// newsletter (its listings on /map and /media-channels, the footer). Under a
// header like the resource pages' – named "<Funding> newsletter" so it isn't
// taken for the resource page itself (Bryce, 23 Oct 2026), with a link on to
// that page – it lists every issue sent through ActiveCampaign, linking each
// one's web version, with the feed and the Substack archive
// (src/lib/newsletter-archive.ts). The header's "Updated" line is the newest
// issue, and the newsletter's signup box sits beside it (its submits
// recorded under the page's path, apart from /events' and /training's).
// Rebuilt at most every
// ten minutes, so a new issue shows within that of reaching its first
// readers. A newsletter with no issue sent that way yet (Funding, until its
// move) is a 404 until its first one. Open to search engines and in the
// sitemap (Bryce, 11 Oct 2026); the issues themselves aren't, since their
// listings go out of date within weeks.
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
  const { prefix, sender } = WEB_NEWSLETTERS[key]
  return {
    title: `${prefix} newsletter – AISafety.com`,
    description: `${sender} ${NEWSLETTER_ABOUT[key]} Sign up, read past issues, or follow its RSS feed.`,
    alternates: {
      canonical: archivePath(key),
      types: {
        'application/rss+xml': [{ url: feedPath(key), title: sender }],
      },
    },
  }
}

export default async function NewsletterPage({ params }: Props) {
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

  const signup = isSignupNewsletter(key) ? key : null
  const newest = issues?.find(i => i.sentAt)?.sentAt ?? null

  return (
    <div className="container-default">
      <PageHeader
        title={`${nl.prefix} newsletter`}
        lastUpdatedIso={newest}
        newsletter={signup != null}
        newsletterKey={signup ?? undefined}
        // The description above names the newsletter (Bryce, 11 Oct 2026).
        newsletterHeading="Get the newsletter"
        newsletterTrackingPage={archivePath(key)}
        description={
          <>
            <span className="color-teal-bright-300">{nl.sender}</span>{' '}
            {NEWSLETTER_ABOUT[key]}
          </>
        }
      >
        <ArchiveLink
          href={nl.page}
          newsletter={nl.prefix}
          target="resource"
          className="paragraph-small color-teal-300"
        >
          {RESOURCE_LINK[key].lead}{' '}
          <span className="color-white">{RESOURCE_LINK[key].name}</span>
          &nbsp;&rarr;
        </ArchiveLink>
      </PageHeader>

      <div className="width-7-col padding-bottom-56px">
        <h3 className="paragraph-small-bold color-teal-300 padding-bottom-16px">
          Past issues
        </h3>
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
            The list of past issues couldn&apos;t be loaded just now. Please try
            again in a few minutes.
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
          .
        </p>
      </div>
    </div>
  )
}
