'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import styles from './analytics.module.css'

/** The search's shared page, when it has one. */
export interface ShareState {
  token: string
  /** The page leaves out other rows than this view does. */
  leftOutDiffers: boolean
  /** "Opened 3 times, most recently on 12 October 2026", or "Not opened
   *  yet". */
  opened: string
}

/** The Org lookup's "Share with the org" box: makes the org a private page
 *  of these figures (/stats/<token>, src/lib/analytics/org-shares.ts), shows
 *  its link, and switches it off. Only rendered for people with Admin admin's
 *  edit grant; the API checks the same. */
export default function ShareOrgLink({
  query,
  orgName,
  leftOut,
  origin,
  share,
}: {
  query: string
  orgName: string
  /** The rows this view leaves out, which a new or updated page keeps. */
  leftOut: string[]
  origin: string
  /** 'unknown' when the org pages couldn't be read. */
  share: ShareState | null | 'unknown'
}) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const busy = sending || refreshing
  const url =
    share && share !== 'unknown' ? `${origin}/stats/${share.token}` : ''

  const send = async (
    method: 'POST' | 'DELETE',
    body: Record<string, unknown>,
    failed: string
  ) => {
    setError(null)
    setSending(true)
    try {
      const res = await fetch('/api/admin/org-shares', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setConfirming(false)
      startTransition(() => router.refresh())
    } catch (err) {
      console.warn(
        `[analytics] org page: ${err instanceof Error ? err.message : String(err)}`
      )
      setError(failed)
    } finally {
      setSending(false)
    }
  }
  const save = () =>
    send(
      'POST',
      { query, leftOut, orgName },
      'Couldn’t save the link just now. Try again in a moment.'
    )
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopy('copied')
    } catch (err) {
      // No clipboard (an insecure origin, or permission refused): the link
      // stays in its box to select by hand.
      console.warn(
        `[analytics] copy failed: ${err instanceof Error ? err.message : String(err)}`
      )
      setCopy('failed')
    }
    setTimeout(() => setCopy('idle'), 2000)
  }

  if (share === 'unknown')
    return (
      <div className={styles.shareBox}>
        <p className={styles.shareText}>
          Couldn&apos;t check whether {orgName} already has a page of their own.
          Reload the page to try again.
        </p>
      </div>
    )

  return (
    <div className={styles.shareBox}>
      <span hidden data-pending={busy || undefined} />
      {!share ? (
        <>
          <p className={styles.shareText}>
            Give {orgName} a page of their own with these figures. They can pick
            the dates, but not the search or what&apos;s left out.
          </p>
          <button
            type="button"
            className={styles.applyBtn}
            onClick={save}
            disabled={busy}
          >
            Make a link
          </button>
        </>
      ) : (
        <>
          <span className={styles.shareLabel}>{orgName}&apos;s page</span>
          <input
            type="text"
            readOnly
            value={url}
            className={styles.shareLink}
            aria-label={`Link to ${orgName}'s page`}
            onFocus={e => e.currentTarget.select()}
          />
          <button type="button" className={styles.copyBtn} onClick={copyLink}>
            {copy === 'copied'
              ? 'Copied'
              : copy === 'failed'
                ? 'Select it instead'
                : 'Copy link'}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.copyBtn}
          >
            Open
          </a>
          {!confirming && (
            <button
              type="button"
              className={styles.copyBtn}
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              Stop sharing
            </button>
          )}
          <p className={styles.shareNote}>
            {share.opened}.
            {share.leftOutDiffers && (
              <>
                {' '}
                It leaves out different listings from this view.{' '}
                <button
                  type="button"
                  className={styles.shareInline}
                  onClick={save}
                  disabled={busy}
                >
                  Update their page to match
                </button>
              </>
            )}
          </p>
          {confirming && (
            <p className={styles.shareNote}>
              Stop sharing? The link stops working for good, and sharing again
              makes a new one.{' '}
              <button
                type="button"
                className={styles.shareInline}
                onClick={() =>
                  send(
                    'DELETE',
                    { token: share.token },
                    'Couldn’t switch the link off just now. Try again in a moment.'
                  )
                }
                disabled={busy}
              >
                Stop sharing
              </button>{' '}
              <button
                type="button"
                className={styles.shareInline}
                onClick={() => setConfirming(false)}
              >
                Keep it
              </button>
            </p>
          )}
        </>
      )}
      {error && (
        <p className={styles.shareNote} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
