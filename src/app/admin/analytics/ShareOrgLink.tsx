'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'
import PendingMark from './PendingMark'
import styles from './analytics.module.css'

// The Org lookup's org pages (/stats/<token>, src/lib/analytics/org-shares.ts):
// the "Share with the org" box above a search's panels, and the list of
// every page shared so far before a search. Only rendered for people with
// Admin admin's edit grant; /api/admin/org-shares checks the same.

/** The search's shared page, when it has one. */
export interface ShareState {
  token: string
  /** The name its page shows. */
  orgName: string
  /** The page leaves out other rows than this view does. */
  leftOutDiffers: boolean
  /** "Opened 3 times, most recently on 12 October 2026", or "Not opened
   *  yet". */
  opened: string
}

/** One org page in the list before a search. */
export interface SharedPageRow {
  token: string
  orgName: string
  /** The Org lookup showing its search and left-out rows. */
  lookupHref: string
  /** openedWords() plus who made it. */
  note: string
}

/** Sends one change to /api/admin/org-shares, then refreshes the page so
 *  the box and the list show it. `busy` covers both steps. */
function useShareRequest() {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const send = async (
    method: 'POST' | 'DELETE',
    body: Record<string, unknown>,
    failed: string
  ): Promise<boolean> => {
    setError(null)
    setSending(true)
    try {
      const res = await fetch('/api/admin/org-shares', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      startTransition(() => router.refresh())
      return true
    } catch (err) {
      console.warn(
        `[analytics] org page: ${err instanceof Error ? err.message : String(err)}`
      )
      setError(failed)
      return false
    } finally {
      setSending(false)
    }
  }
  return { busy: sending || refreshing, error, send }
}

function CopyLinkButton({ url }: { url: string }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopy('copied')
    } catch (err) {
      // No clipboard (an insecure origin, or permission refused): the link
      // is on screen to select by hand.
      console.warn(
        `[analytics] copy failed: ${err instanceof Error ? err.message : String(err)}`
      )
      setCopy('failed')
    }
    setTimeout(() => setCopy('idle'), 2000)
  }
  return (
    <button type="button" className={styles.copyBtn} onClick={copyLink}>
      {copy === 'copied'
        ? 'Copied'
        : copy === 'failed'
          ? 'Select it instead'
          : 'Copy link'}
    </button>
  )
}

/** Stop sharing, after a second click: the link stops working for good. */
function StopSharing({ token }: { token: string }) {
  const { busy, error, send } = useShareRequest()
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <span hidden data-pending={busy || undefined} />
      {confirming ? (
        <span className={styles.shareConfirm}>
          The link stops working for good, and sharing again makes a new one.{' '}
          <button
            type="button"
            className={styles.shareInline}
            onClick={async () => {
              if (
                await send(
                  'DELETE',
                  { token },
                  'Couldn’t switch the link off just now. Try again in a moment.'
                )
              )
                setConfirming(false)
            }}
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
        </span>
      ) : (
        <button
          type="button"
          className={styles.copyBtn}
          onClick={() => setConfirming(true)}
          disabled={busy}
        >
          Stop sharing
        </button>
      )}
      {error && (
        <span className={styles.shareConfirm} role="alert">
          {error}
        </span>
      )}
    </>
  )
}

/** The "Share with the org" box above a search's panels. */
export default function ShareOrgLink({
  query,
  orgName,
  leftOut,
  origin,
  share,
}: {
  query: string
  /** What the lookup calls the org; the name field starts from it. */
  orgName: string
  /** The rows this view leaves out, which a new or updated page keeps. */
  leftOut: string[]
  origin: string
  /** 'unknown' when the org pages couldn't be read. */
  share: ShareState | null | 'unknown'
}) {
  const { busy, error, send } = useShareRequest()
  // The page's heading. The lookup's name is the search as typed unless one
  // Field map org matched, so it can be fixed here first.
  const [name, setName] = useState(orgName)

  if (share === 'unknown')
    return (
      <div className={styles.shareBox}>
        <p className={styles.shareText}>
          Couldn&apos;t check whether {orgName} already has a page of their own.
          Reload the page to try again.
        </p>
      </div>
    )

  const url = share ? `${origin}/stats/${share.token}` : ''
  return (
    <div className={styles.shareBox}>
      <span hidden data-pending={busy || undefined} />
      {!share ? (
        <>
          <p className={styles.shareText}>
            Give them a page of their own with these figures. They can pick the
            dates, but not the search or what&apos;s left out.
          </p>
          <label className={styles.shareName}>
            Their name
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={120}
              className={styles.shareLink}
            />
          </label>
          <button
            type="button"
            className={styles.applyBtn}
            onClick={() =>
              send(
                'POST',
                { query, leftOut, orgName: name.trim() },
                'Couldn’t make the link just now. Try again in a moment.'
              )
            }
            disabled={busy || !name.trim()}
          >
            Make a link
          </button>
        </>
      ) : (
        <>
          <span className={styles.shareLabel}>{share.orgName}&apos;s page</span>
          <input
            type="text"
            readOnly
            value={url}
            className={styles.shareLink}
            aria-label={`Link to ${share.orgName}'s page`}
            onFocus={e => e.currentTarget.select()}
          />
          <CopyLinkButton url={url} />
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.copyBtn}
          >
            Open
          </a>
          <StopSharing token={share.token} />
          <p className={styles.shareNote}>
            {share.opened}. Leave out and Put back here update their page too.
            {share.leftOutDiffers && (
              <>
                {' '}
                It leaves out different listings from this view.{' '}
                <button
                  type="button"
                  className={styles.shareInline}
                  onClick={() =>
                    send(
                      'POST',
                      { query, leftOut, orgName: share.orgName },
                      'Couldn’t update the link just now. Try again in a moment.'
                    )
                  }
                  disabled={busy}
                >
                  Update their page to match
                </button>
              </>
            )}
          </p>
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

/** The search's shared page, for Leave out and Put back to keep in step. */
export interface ShareSync {
  query: string
  /** The name the page shows, kept as it is. */
  orgName: string
}

/** The Org lookup's Leave out and Put back. When the search has a shared
 *  page (and the viewer may change it), a click first saves the new left-out
 *  rows to that page, then loads the view without (or with) the row, so the
 *  org's page always matches. Otherwise it's a plain link. Either way the
 *  link lights up and its row fades at once (data-pending). */
export function LeaveOutLink({
  href,
  leftOut,
  sync,
  title,
  children,
}: {
  href: string
  /** The rows left out once this link is followed. */
  leftOut: string[]
  sync: ShareSync | null
  title?: string
  children: ReactNode
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [loading, startTransition] = useTransition()
  if (!sync)
    return (
      <Link
        href={href}
        scroll={false}
        className={styles.leaveOut}
        title={title}
      >
        {children}
        <PendingMark />
      </Link>
    )
  return (
    <a
      href={href}
      className={styles.leaveOut}
      title={title}
      onClick={async e => {
        // A new tab or window gets the plain view; only this one saves.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
          return
        e.preventDefault()
        if (saving || loading) return
        setSaving(true)
        try {
          const res = await fetch('/api/admin/org-shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...sync, leftOut }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
        } catch (err) {
          // Their page keeps its old rows; the share box then says so and
          // offers "Update their page to match".
          console.warn(
            `[analytics] org page not updated: ${err instanceof Error ? err.message : String(err)}`
          )
        } finally {
          setSaving(false)
        }
        startTransition(() => router.push(href, { scroll: false }))
      }}
    >
      {children}
      <span hidden data-pending={saving || loading || undefined} />
    </a>
  )
}

/** Every org page shared so far, listed before a search, each with its own
 *  Copy link and Stop sharing: a page stays reachable here even when its
 *  search no longer finds the org. */
export function SharedOrgPages({
  pages,
  origin,
}: {
  pages: SharedPageRow[]
  origin: string
}) {
  return (
    <ul className={styles.sharedPages}>
      {pages.map(p => (
        <li key={p.token}>
          <Link href={p.lookupHref}>{p.orgName}</Link>
          <span className={styles.sharedPagesNote}>{p.note}</span>
          <span className={styles.sharedPagesActions}>
            <CopyLinkButton url={`${origin}/stats/${p.token}`} />
            <StopSharing token={p.token} />
          </span>
        </li>
      ))}
    </ul>
  )
}
