/*
  Card data off the email (16 Nov 2026). Every pipeline email used to end
  with `<!--aisafety-cards:BASE64(JSON)-->`: the manifest /admin/newsletter
  needs to reorder, edit, remove and put back cards, and the text version is
  rebuilt from. Readers never see it, but it went to every one of them and
  counted towards Gmail's ~102 KB clip: 18.9 KB of the week 46 Events
  issue's 120.6 KB, more than its last three cards together. After the
  week 46 oversize trial Bryce chose to move it out (16 Nov 2026), so the
  size limit can measure only what readers see.

  Now the email carries `<!--aisafety-cards-ref:<b>-->` (37 bytes) and the
  manifest's JSON is one file on the site's public Blob store,
  newsletter/cards/<b>.json, named by the first 16 hex characters of its
  SHA-256 like the removal copies (newsletter-removed.ts) and the link
  lists (newsletter-clicks.ts). A file never changes once written: an edit
  writes a new one and points the email at it. ~/Newsletter render.py
  `store_cards()` / `inline_cards()` are the pipeline's side, with the same
  bytes and names.

  In memory everything still works on the inline form: `inlineCards()` puts
  the manifest back right after an email is read from ActiveCampaign, and
  `storeCards()` takes it out again right before one is written. Emails
  built before the move (inline) read as they are. The manifest is no
  secret: titles, the text version and card keys, all in the email itself.
  Never delete anything under newsletter/ in the Blob store: sent issues
  point at it.
*/

import { createHash } from 'node:crypto'
import { put } from '@vercel/blob'

export const CARDS_BASE =
  'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/newsletter/cards/'

const INLINE_RE = /<!--aisafety-cards:([A-Za-z0-9+/=]+)-->/
export const CARDS_REF_RE = /<!--aisafety-cards-ref:([0-9a-f]{16})-->/

/** How long a read waits on the Blob store. */
const READ_TIMEOUT_MS = 8000

/** Card data that couldn't be stored or read back; `detail` is written for
 *  the page. */
export class CardsStoreError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.detail = detail
  }
}

function nameOf(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 16)
}

/** Pure: the email with its inline manifest swapped for a reference, and
 *  the file that reference names. Null when the email has no inline
 *  manifest (already stored, or built before cards had markers). */
export function cardsFile(
  html: string
): { b: string; body: string; html: string } | null {
  const m = INLINE_RE.exec(html)
  if (!m) return null
  const body = Buffer.from(m[1], 'base64').toString('utf8')
  const b = nameOf(body)
  return {
    b,
    body,
    html: html.replace(INLINE_RE, () => `<!--aisafety-cards-ref:${b}-->`),
  }
}

/** Pure: the email with the stored manifest `body` put back inline where
 *  its reference was. */
export function withInlineCards(html: string, body: string): string {
  const encoded = Buffer.from(body, 'utf8').toString('base64')
  return html.replace(CARDS_REF_RE, () => `<!--aisafety-cards:${encoded}-->`)
}

/** Pure: the email without its card data in either form (the web version). */
export function withoutCards(html: string): string {
  return html
    .replace(/<!--aisafety-cards:[A-Za-z0-9+/=]*-->/g, '')
    .replace(/<!--aisafety-cards-ref:[0-9a-f]*-->/g, '')
}

/** Files never change once written: a good read is kept (a few hundred
 *  bytes to ~20 KB each, one per edit of a draft). */
const goodFiles = new Map<string, string>()
const KEEP_MAX = 200

function remember(b: string, body: string): void {
  if (goodFiles.size >= KEEP_MAX) {
    const oldest = goodFiles.keys().next().value
    if (oldest !== undefined) goodFiles.delete(oldest)
  }
  goodFiles.set(b, body)
}

/** The stored manifest `b`, checked against its name. Throws
 *  CardsStoreError when it is missing, unreadable or not what it says. */
export async function readCardsFile(b: string): Promise<string> {
  const hit = goodFiles.get(b)
  if (hit !== undefined) return hit
  let res: Response
  try {
    res = await fetch(`${CARDS_BASE}${b}.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
  } catch (err) {
    console.error(
      `[newsletter] reading card data ${b} failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    throw new CardsStoreError(
      'the email’s card data couldn’t be read just now; try again in a minute'
    )
  }
  if (res.status === 404)
    throw new CardsStoreError(
      'the card data this email points at isn’t there; rebuild the issue'
    )
  if (!res.ok) {
    console.error(`[newsletter] reading card data ${b}: HTTP ${res.status}`)
    throw new CardsStoreError(
      'the email’s card data couldn’t be read just now; try again in a minute'
    )
  }
  const body = await res.text()
  if (nameOf(body) !== b) {
    console.error(`[newsletter] card data ${b} doesn't match its name`)
    throw new CardsStoreError(
      'the email’s card data doesn’t match its name; rebuild the issue'
    )
  }
  remember(b, body)
  return body
}

/** The email as the card code reads it: a reference to stored card data
 *  replaced by the data itself. An email with the data inline, or with
 *  none, comes back unchanged. Throws CardsStoreError. */
export async function inlineCards(html: string): Promise<string> {
  const m = CARDS_REF_RE.exec(html)
  if (!m) return html
  return withInlineCards(html, await readCardsFile(m[1]))
}

/** The email as it is saved to ActiveCampaign: its inline card data stored
 *  on the Blob store and replaced by a reference. An email without inline
 *  data comes back unchanged. Throws CardsStoreError when the data can't be
 *  stored where it is read: the email then must not be written. */
export async function storeCards(html: string): Promise<string> {
  const f = cardsFile(html)
  if (!f) return html
  if (goodFiles.get(f.b) === f.body) return f.html
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    throw new CardsStoreError(
      'the email’s card data couldn’t be saved (BLOB_READ_WRITE_TOKEN isn’t set here)'
    )
  let url: string
  try {
    ;({ url } = await put(`newsletter/cards/${f.b}.json`, f.body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json; charset=utf-8',
    }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Stored before (the same cards in the same order): the name is the
    // content, so the file there is this one.
    if (/already exists/i.test(msg)) {
      remember(f.b, f.body)
      return f.html
    }
    console.error(`[newsletter] storing card data ${f.b} failed: ${msg}`)
    throw new CardsStoreError(
      'the email’s card data couldn’t be saved; try again in a minute'
    )
  }
  if (url !== `${CARDS_BASE}${f.b}.json`) {
    console.error(`[newsletter] card data ${f.b} landed at ${url}`)
    throw new CardsStoreError(
      'the email’s card data was saved somewhere this page doesn’t read'
    )
  }
  remember(f.b, f.body)
  return f.html
}
