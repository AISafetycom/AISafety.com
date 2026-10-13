'use client'

import { useState } from 'react'
import styles from './analytics.module.css'

/** One ready-to-send sentence with a Copy button, for quoting a figure back
 *  to an org. */
export default function CopySentence({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch (err) {
      // No clipboard (an insecure origin, or permission refused): the text
      // stays on screen to select by hand.
      console.warn(
        `[analytics] copy failed: ${err instanceof Error ? err.message : String(err)}`
      )
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2000)
  }
  return (
    <div className={styles.copySentence}>
      <p className={styles.copySentenceText}>{text}</p>
      <button type="button" className={styles.copyBtn} onClick={copy}>
        {state === 'copied'
          ? 'Copied'
          : state === 'failed'
            ? 'Select it instead'
            : 'Copy'}
      </button>
    </div>
  )
}
