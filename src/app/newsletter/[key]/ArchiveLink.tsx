'use client'

import { trackEvent } from '@/lib/analytics'

/** Where a link on a past issues page leads: an issue's web version, the
 *  feed, or the Substack archive. */
export type ArchiveTarget = 'issue' | 'feed' | 'substack'

/** A link on a past issues page that records its click
 *  (newsletter_archive_click) for /admin/analytics' Newsletters tab:
 *  `newsletter` is the list's name ("Events"), `label` the issue's address
 *  for an issue. A plain <a>: every target is a route handler or another
 *  site, not a page to prefetch. */
export default function ArchiveLink({
  href,
  newsletter,
  target,
  label,
  className,
  children,
}: {
  href: string
  newsletter: string
  target: ArchiveTarget
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() =>
        trackEvent('newsletter_archive_click', {
          page: newsletter,
          source: target,
          label,
        })
      }
    >
      {children}
    </a>
  )
}
