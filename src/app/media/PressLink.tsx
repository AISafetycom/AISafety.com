'use client'

import type { ReactNode } from 'react'
import { trackPressAction, type PressAction } from '@/lib/analytics'

/** A link on the press page whose clicks are recorded: asset downloads and
 *  the press email. Ordinary in-site links don't need it. */
export default function PressLink({
  href,
  action,
  label,
  className,
  download,
  children,
}: {
  href: string
  action: PressAction
  /** What the click is recorded as, e.g. 'Downloaded press kit'. */
  label: string
  className?: string
  /** Serve the file as a download rather than opening it in the tab. */
  download?: boolean
  children: ReactNode
}) {
  return (
    <a
      href={href}
      className={className}
      download={download || undefined}
      onClick={() => trackPressAction(action, label, href)}
    >
      {children}
    </a>
  )
}
