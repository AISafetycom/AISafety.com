'use client'

import { trackEvent } from '@/lib/analytics'

/** Where a link on a newsletter page leads: an issue's web version, the
 *  feed, the Substack archive, or the resource page (/funding). */
export type ArchiveTarget = 'issue' | 'feed' | 'substack' | 'resource'

/** A link on a newsletter page that records its click
 *  (newsletter_archive_click) for /admin/analytics' Newsletters tab:
 *  `newsletter` is the list's name ("Events"), `label` the issue's address
 *  for an issue. A plain <a>: the targets are route handlers or another
 *  site, and the resource page isn't worth prefetching for one link. */
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
