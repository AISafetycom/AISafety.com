'use client'

import { usePathname } from 'next/navigation'
import Navigation from './Navigation'
import Footer from './Footer'
import Assistant from './assistant/Assistant'
import MapPreload from './MapPreload'

// Routes that render without Navigation/Footer/Assistant
const standaloneRoutes = ['/poster-map', '/admin']

export default function LayoutShell({
  children,
  counts,
  preview,
}: {
  children: React.ReactNode
  counts: Partial<Record<string, number>>
  /** This browser is in preview mode (see PreviewBanner). */
  preview: boolean
}) {
  const pathname = usePathname()
  const isStandalone = standaloneRoutes.some(
    route => pathname === route || pathname.startsWith(`${route}/`)
  )

  if (isStandalone) {
    return <>{children}</>
  }

  return (
    <>
      <Navigation counts={counts} preview={preview} />
      {children}
      <Footer />
      <Assistant />
      <MapPreload />
    </>
  )
}
