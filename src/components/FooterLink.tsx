'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { trackFooterClick, trackedPath } from '@/lib/analytics'
import { isPlainClick, openFeedbackForm } from '@/lib/feedback-form'

/** A footer link that records its clicks — the outbound ones especially,
 *  which nothing else would. The tiny client wrapper keeps Footer itself
 *  server-rendered. */
export default function FooterLink({
  href,
  section,
  label,
  airtablePrefillField,
  form,
}: {
  href: string
  /** The footer column's heading, e.g. 'Help us out'. */
  section: string
  /** The link text, also what the click is recorded as. */
  label: string
  /** If set, appends `?prefill_<field>=<current path>&hide_<field>=true` to
   *  href so Airtable records which page the link was clicked from, without
   *  showing the field on the form. */
  airtablePrefillField?: string
  /** Opens the site's own correction or feedback form (FeedbackPopover) by
   *  the link instead of following it. A Cmd-click or middle click still
   *  opens href, the Airtable form, in a new tab. */
  form?: 'correction' | 'feedback'
}) {
  // Internal links (e.g. /hackathon) navigate in place; external ones open a
  // new tab as before.
  const external = href.startsWith('http')
  const pathname = usePathname()
  // An org's private page is recorded as 'stats', never its token.
  const pageValue = trackedPath(pathname).replace(/^\//, '') || 'home'

  const field = airtablePrefillField && encodeURIComponent(airtablePrefillField)
  const finalHref = field
    ? `${href}${href.includes('?') ? '&' : '?'}prefill_${field}=${pageValue}&hide_${field}=true`
    : href

  return (
    <Link
      href={finalHref}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      aria-haspopup={form ? 'dialog' : undefined}
      onClick={e => {
        trackFooterClick(section, label, href)
        if (!form || !isPlainClick(e)) return
        e.preventDefault()
        openFeedbackForm({
          kind: form,
          entry: 'footer',
          trigger: e.currentTarget,
          fallbackHref: finalHref,
        })
      }}
    >
      {label}
    </Link>
  )
}
