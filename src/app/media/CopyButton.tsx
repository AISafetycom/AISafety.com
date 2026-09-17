'use client'

import { useEffect, useState } from 'react'
import { trackPressAction } from '@/lib/analytics'
import styles from './page.module.css'

/** Copies a block of text to the clipboard and says so for a moment. */
export default function CopyButton({
  text,
  label,
}: {
  /** What gets copied. */
  text: string
  /** Names the block in analytics, e.g. 'Short boilerplate'. */
  label: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        // Older browsers and insecure contexts: a hidden textarea + execCommand.
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      }
      setCopied(true)
      trackPressAction('copy', `Copied ${label}`)
    } catch {
      // Selection still works; nothing to do.
    }
  }

  return (
    <button
      type="button"
      className={styles.copyBtn}
      onClick={copy}
      data-copied={copied}
      aria-live="polite"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
