'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { trackFooterClick } from '@/lib/analytics'

/** An external footer link that records its clicks — outbound, so nothing
 *  else would. The tiny client wrapper keeps Footer itself server-rendered. */
export default function FooterLink({
  href,
  section,
  label,
  airtablePrefillField,
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
}) {
  // Internal links (e.g. /hackathon) navigate in place; external ones open a
  // new tab as before.
  const external = href.startsWith('http')
  const pathname = usePathname()
  const pageValue = pathname.replace(/^\//, '') || 'home'

  const field = airtablePrefillField && encodeURIComponent(airtablePrefillField)
  const finalHref = field
    ? `${href}${href.includes('?') ? '&' : '?'}prefill_${field}=${pageValue}&hide_${field}=true`
    : href

  return (
    <Link
      href={finalHref}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={() => trackFooterClick(section, label, href)}
    >
      {label}
    </Link>
  )
}
