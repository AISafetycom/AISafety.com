/*
  Removal copies (29 Oct 2026): Put back on /admin/newsletter brings a card
  Bryce removed from a draft back where it was (Bryce had removed the AI x
  Epistemics sprint by mistake the day before). What went — the card's block,
  its manifest entry and its plain-text segment — can't ride in the email:
  the manifest goes to every reader, and an Events email is close to its
  96 KB limit. So it is kept as one small JSON file on the site's public
  Blob store, newsletter/removed/<b>.json, named by the first 16 hex
  characters of its SHA-256 like the link lists (newsletter-clicks.ts), and
  the manifest's `removed` entry carries the name. Remove stores it before
  the email changes; a rebuild on the owner's machine stores Pen's fresh card
  when it keeps a removed card out (~/Newsletter issue.py, render.py
  `removal_copy()`). The JSON itself is made in newsletter.ts
  (`removalCopy()`), the same bytes as render.py.

  Card HTML is no secret — it is what the email would have shown — and the
  manifest every reader gets already names the removed cards. Never delete
  anything under newsletter/ in the Blob store.
*/

import { createHash } from 'node:crypto'
import { put } from '@vercel/blob'
import type { RemovalCopy, RemovedCopy } from '@/lib/admin/newsletter'

export const REMOVED_BASE =
  'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/newsletter/removed/'

/** How long Put back waits on the Blob store for a copy. */
const READ_TIMEOUT_MS = 8000

/** A copy that couldn't be stored or read back; `detail` is written for the
 *  page. */
export class RemovalCopyError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

/** Store a card's removal copy. Throws RemovalCopyError when it can't be
 *  stored where Put back reads it: the card then stays in the email. */
export async function keepRemovalCopy(copy: RemovalCopy): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new RemovalCopyError(
      'the copy Put back needs couldn’t be saved (BLOB_READ_WRITE_TOKEN isn’t set here)'
    )
  let url: string
  try {
    ;({ url } = await put(copy.path, copy.body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json; charset=utf-8',
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // The same card removed before, from the same email: the name is the
    // content, so the copy there is this one.
    if (/already exists/i.test(msg)) return
    console.error(`[newsletter] keeping ${copy.path} failed: ${msg}`)
    throw new RemovalCopyError(
      'the copy Put back needs couldn’t be saved; try again in a minute'
    )
  }
  if (url !== `${REMOVED_BASE}${copy.b}.json`) {
    console.error(
      `[newsletter] ${copy.path} landed at ${url}, not ${REMOVED_BASE}`
    )
    throw new RemovalCopyError(
      'the copy Put back needs was saved somewhere this page doesn’t read'
    )
  }
}

/** Read the removal copy `b` of card `gid:key` back, checked against its
 *  name. Throws RemovalCopyError when it is missing, unreadable or not that
 *  card's. */
export async function readRemovalCopy(
  b: string,
  gid: string,
  key: string
): Promise<RemovedCopy> {
  let res: Response
  try {
    res = await fetch(`${REMOVED_BASE}${b}.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
  } catch (err) {
    console.error(
      `[newsletter] reading removal copy ${b} failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    throw new RemovalCopyError(
      'its saved copy couldn’t be read just now; try again in a minute'
    )
  }
  if (res.status === 404)
    throw new RemovalCopyError(
      'its saved copy isn’t there, so this page can’t bring it back; a rebuild with --put-back can'
    )
  if (!res.ok) {
    console.error(`[newsletter] reading removal copy ${b}: HTTP ${res.status}`)
    throw new RemovalCopyError(
      'its saved copy couldn’t be read just now; try again in a minute'
    )
  }
  const body = await res.text()
  const digest = createHash('sha256')
    .update(body, 'utf8')
    .digest('hex')
    .slice(0, 16)
  let copy: RemovedCopy | null = null
  try {
    copy = JSON.parse(body) as RemovedCopy
  } catch {
    copy = null
  }
  if (
    digest !== b ||
    !copy ||
    copy.v !== 1 ||
    copy.g !== gid ||
    copy.key !== key ||
    typeof copy.block !== 'string'
  ) {
    console.error(
      `[newsletter] removal copy ${b} doesn't match its name or card ${gid}:${key}`
    )
    throw new RemovalCopyError('its saved copy doesn’t match this card')
  }
  return copy
}
