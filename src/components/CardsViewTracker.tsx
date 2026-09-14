'use client'

import { useEffect, useRef } from 'react'
import { trackCardsView } from '@/lib/analytics'

/**
 * Records a visitor reaching the listings below a page's map. Renders an
 * empty marker and watches its PARENT — the cards section — so it can sit
 * inside server-rendered markup without wrapping it. Fires once per page
 * load, the moment the section's top enters the upper half of the viewport:
 * listings merely peeking in below the fold on a tall screen don't count; the
 * "View cards" button, a hand scroll, and a link straight to the section do.
 */
export default function CardsViewTracker({ page }: { page: string }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const section = ref.current?.parentElement
    if (!section || typeof IntersectionObserver === 'undefined') return
    let fired = false
    const observer = new IntersectionObserver(
      entries => {
        if (fired || !entries.some(e => e.isIntersecting)) return
        fired = true
        trackCardsView(page)
        observer.disconnect()
      },
      // Shrink the root to the top half of the viewport. The section is tall,
      // so it keeps intersecting from the moment its top crosses the middle of
      // the screen until it has scrolled out the top — no gaps a fast scroll
      // could jump over.
      { rootMargin: '0px 0px -50% 0px', threshold: 0 }
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [page])

  return <span ref={ref} hidden aria-hidden="true" />
}
