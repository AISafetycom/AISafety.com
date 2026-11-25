'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { onRoute } from '@/lib/recordings/recorder'

/**
 * Session recordings for /admin/analytics: tells the recorder about every
 * page change. It decides whether this tab is in the sample and loads the
 * recording library only if so (src/lib/recordings/recorder.ts). Renders
 * nothing.
 */
export default function SessionRecorder() {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname) onRoute(pathname)
  }, [pathname])
  return null
}
