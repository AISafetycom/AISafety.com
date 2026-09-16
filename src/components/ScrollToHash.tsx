'use client'

import { useEffect } from 'react'

// A link like /training?view=recurring#rec… (the admin Queue's "see it on
// the site" link) names a card that only exists once the page has hydrated
// and picked its view, by which time the browser has given up on the hash.
// This keeps looking for the target for a few seconds and scrolls to it
// once. It stands aside whenever the browser could do the job itself (the
// target is already there on the first look) and the moment the visitor
// scrolls, so nobody gets yanked down the page.
export default function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id || document.getElementById(id)) return
    let tries = 0
    let cancelled = false
    const cancel = () => {
      cancelled = true
    }
    const opts = { passive: true, once: true }
    window.addEventListener('wheel', cancel, opts)
    window.addEventListener('touchstart', cancel, opts)
    window.addEventListener('keydown', cancel, opts)
    const timer = window.setInterval(() => {
      const el = document.getElementById(id)
      if (cancelled || ++tries > 40) {
        window.clearInterval(timer)
      } else if (el) {
        window.clearInterval(timer)
        el.scrollIntoView({ block: 'start' })
      }
    }, 150)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchstart', cancel)
      window.removeEventListener('keydown', cancel)
    }
  }, [])
  return null
}
