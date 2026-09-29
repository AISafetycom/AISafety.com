'use client'

import { useLinkStatus } from 'next/link'

/** Goes inside a dashboard <Link>. While the page behind the link loads it
 *  carries data-pending, which analytics.module.css uses to light the link up
 *  and fade the figures below, so a click shows at once even though the new
 *  figures take a moment to work out. Hidden, so it never shifts the layout. */
export default function PendingMark() {
  const { pending } = useLinkStatus()
  return <span hidden data-pending={pending || undefined} />
}
