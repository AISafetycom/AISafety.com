'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  readSubstackExport,
  type SubstackHistory,
} from '@/lib/analytics/substack-export'
import { zipEntries } from '@/lib/zip-read'
import styles from './analytics.module.css'
import own from './SubstackUpload.module.css'

/** What each Substack publication is called on the dashboard. */
const PUBLICATION_NAMES: Record<string, string> = {
  aisafetyeventsandtraining: 'Events & Training',
  aisafetyfunding: 'Funding',
}

type State =
  | { at: 'idle' }
  | { at: 'reading' }
  | { at: 'ready'; history: SubstackHistory }
  | { at: 'saving'; history: SubstackHistory }
  | { at: 'done'; text: string }

/** The Newsletters tab's "Add a Substack export": reads the export's .zip
 *  here in the browser and sends the site only how many people each issue
 *  was emailed to, never an address. */
export default function SubstackUpload() {
  const router = useRouter()
  const [state, setState] = useState<State>({ at: 'idle' })

  const choose = async (file: File | undefined) => {
    if (!file) return
    setState({ at: 'reading' })
    try {
      const entries = zipEntries(new Uint8Array(await file.arrayBuffer()))
      setState({ at: 'ready', history: await readSubstackExport(entries) })
    } catch (err) {
      setState({
        at: 'done',
        text: `Couldn’t read that file. ${err instanceof Error ? err.message : ''}`,
      })
    }
  }

  const save = async (history: SubstackHistory) => {
    setState({ at: 'saving', history })
    try {
      const res = await fetch('/api/admin/analytics/substack-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(history),
      })
      if (res.ok) {
        setState({
          at: 'done',
          text: 'Added. The chart now goes back to the first issue.',
        })
        router.refresh()
        return
      }
      setState({
        at: 'done',
        text:
          res.status === 409
            ? 'A newer export of this newsletter is already added, so this one was left out.'
            : `Couldn’t add it (the site answered ${res.status}). Try again in a moment.`,
      })
    } catch {
      setState({
        at: 'done',
        text: 'Couldn’t reach the site. Try again in a moment.',
      })
    }
  }

  if (state.at === 'ready' || state.at === 'saving') {
    const { history: h } = state
    const name = PUBLICATION_NAMES[h.publication] ?? h.publication
    const last = h.issues[h.issues.length - 1]
    return (
      <div className={styles.caption}>
        <p>
          {name}’s export: {h.issues.length.toLocaleString('en-US')} issues from{' '}
          {longDay(h.issues[0].t)} to {longDay(last.t)}; the last was emailed to{' '}
          {last.n.toLocaleString('en-US')} people. Only these counts go to the
          site, never an address.
        </p>
        <p className="flex items-center gap-8px margin-top-8px">
          <button
            type="button"
            className={styles.applyBtn}
            disabled={state.at === 'saving'}
            onClick={() => save(h)}
          >
            {state.at === 'saving' ? 'Adding' : 'Add it'}
          </button>
          <button
            type="button"
            className={styles.copyBtn}
            disabled={state.at === 'saving'}
            onClick={() => setState({ at: 'idle' })}
          >
            Cancel
          </button>
        </p>
      </div>
    )
  }

  return (
    <p className={`${styles.caption} flex items-center gap-8px`}>
      <label className={`${styles.copyBtn} ${own.pick}`}>
        {state.at === 'reading'
          ? 'Reading the export'
          : 'Add a Substack export'}
        <input
          type="file"
          accept=".zip,application/zip"
          className="visually-hidden"
          disabled={state.at === 'reading'}
          onChange={e => {
            void choose(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </label>
      <span>
        {state.at === 'done'
          ? state.text
          : 'The .zip from Substack’s Settings → Exports, to chart a newsletter’s Substack years.'}
      </span>
    </p>
  )
}

/** A moment's UTC day as "1 October 2026". */
function longDay(t: number): string {
  return new Date(t).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
