'use client'

import type { MouseEvent, ReactNode } from 'react'
import { trackPressAction } from '@/lib/analytics'

/** How long the glide takes. Short on purpose: it should read as a quick move
 *  down the page, not a scroll the visitor has to wait for. */
const DURATION_MS = 400

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** A link to a section further down the press page that glides there quickly
 *  instead of jumping. Without JavaScript it is an ordinary #anchor link. */
export default function JumpLink({
  targetId,
  label,
  className,
  children,
}: {
  /** The id of the section to go to, without the #. */
  targetId: string
  /** What the click is recorded as, e.g. 'Jumped to the boilerplate'. */
  label: string
  className?: string
  children: ReactNode
}) {
  function jump(event: MouseEvent<HTMLAnchorElement>) {
    // Leave new-tab and other modified clicks to the browser.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    const target = document.getElementById(targetId)
    if (!target) return
    event.preventDefault()
    trackPressAction('jump', label)

    // Land where a plain #anchor would: the section's top, less its
    // scroll-margin (which keeps the heading clear of the nav).
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0
    const from = window.scrollY
    const furthest = document.documentElement.scrollHeight - window.innerHeight
    const to = Math.max(
      0,
      Math.min(furthest, target.getBoundingClientRect().top + from - margin)
    )

    const finish = () => {
      // Keep the address shareable, and move keyboard focus with the view.
      history.pushState(null, '', `#${targetId}`)
      target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.scrollTo(0, to)
      finish()
      return
    }

    // The visitor's own scroll wins: stop gliding the moment they take over.
    let interrupted = false
    const interrupt = () => {
      interrupted = true
    }
    window.addEventListener('wheel', interrupt, { passive: true, once: true })
    window.addEventListener('touchstart', interrupt, {
      passive: true,
      once: true,
    })

    const startedAt = performance.now()
    const step = (now: number) => {
      if (interrupted) return
      const progress = Math.min(1, (now - startedAt) / DURATION_MS)
      window.scrollTo(0, from + (to - from) * easeInOutCubic(progress))
      if (progress < 1) {
        requestAnimationFrame(step)
      } else {
        window.removeEventListener('wheel', interrupt)
        window.removeEventListener('touchstart', interrupt)
        finish()
      }
    }
    requestAnimationFrame(step)
  }

  return (
    <a href={`#${targetId}`} className={className} onClick={jump}>
      {children}
    </a>
  )
}
