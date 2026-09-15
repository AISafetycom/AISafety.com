'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const POLL_MS = 2000

/** Keeps a preview in step with the editor: polls the guide's stamp and
 *  re-renders the page (a soft refresh, keeping the open tab and scroll
 *  position) as soon as the draft is saved, discarded or published. */
export default function PreviewAutoRefresh({ stamp }: { stamp: string }) {
  const router = useRouter()
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      if (document.hidden) return
      try {
        const res = await fetch('/api/admin/donation-guide/stamp', {
          cache: 'no-store',
        })
        if (!res.ok) return
        const body = (await res.json()) as { stamp?: string }
        if (!stopped && body.stamp && body.stamp !== stamp) router.refresh()
      } catch {
        // A missed poll just means the next one catches up.
      }
    }
    const t = setInterval(tick, POLL_MS)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [stamp, router])
  return null
}
