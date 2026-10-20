import { ReactNode } from 'react'
import type { SignupNewsletter } from '@/lib/newsletter-signup'
import NewsletterSignup from './NewsletterSignup'
import RelativeDate from './RelativeDate'
import styles from './PageHeader.module.css'

interface PageHeaderProps {
  title: string
  /** ISO date — renders a live "Updated X ago" line under the title. */
  lastUpdatedIso?: string | null
  description: ReactNode
  id?: string
  topPadding?: string
  /** Show the newsletter signup beside the header (stacked below on mobile).
   *  Needs a heading and either `newsletterKey` or `newsletterSubscribeUrl`. */
  newsletter?: boolean
  /** Heading for the signup box. */
  newsletterHeading?: string
  /** The newsletter the box signs people up to on the site, through
   *  ActiveCampaign (/events, /training). */
  newsletterKey?: SignupNewsletter
  /** Or: the Substack subscribe page the box opens (/funding). */
  newsletterSubscribeUrl?: string
  /** Analytics page name for the signup box's submits (e.g. 'Events'). */
  newsletterTrackingPage?: string
  /** Extra content under the description, e.g. a cross-link to a sister page. */
  children?: ReactNode
}

export default function PageHeader({
  title,
  lastUpdatedIso,
  description,
  id,
  topPadding = 'padding-top-56px',
  newsletter,
  newsletterHeading,
  newsletterKey,
  newsletterSubscribeUrl,
  newsletterTrackingPage,
  children,
}: PageHeaderProps) {
  const header = (
    <>
      <h1 className={`${topPadding} padding-bottom-8px`} id={id}>
        {title}
      </h1>
      {lastUpdatedIso && (
        <RelativeDate
          iso={lastUpdatedIso}
          className="paragraph-small color-teal-300 margin-bottom-40px"
        />
      )}
      <h2 className="width-7-col margin-bottom-56px">{description}</h2>
      {children}
    </>
  )

  if (!newsletter) return header

  return (
    <div className={`${styles.heroRow} padding-bottom-56px`}>
      <div className={styles.heroHeader}>{header}</div>
      <div className={styles.newsletterSlot}>
        <NewsletterSignup
          heading={newsletterHeading}
          newsletter={newsletterKey}
          subscribeUrl={newsletterSubscribeUrl}
          trackingPage={newsletterTrackingPage}
        />
      </div>
    </div>
  )
}
