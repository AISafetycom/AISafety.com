/*
  The old picture behind an applied change, kept so Undo can put it back
  (Bryce, 3 Nov 2026: AISUM26 was accepted and undone, and its listing kept
  the new logo). A proposal names the old side of a picture only by its
  file name ("aisum26.svg"), which Airtable cannot be written with, so Undo
  used to leave the field as Accept had made it and say nothing. Airtable's
  own link to the old file lasts a few hours at most, and Undo stays on
  offer all day from Done today.

  So Accept copies each picture it is about to replace to the site's public
  Blob store, under queue/before/ and named by its content (the first 16
  hex characters of its SHA-256, like the newsletter's link lists), and the
  row's Edits keep the copy's link under "(before)". Undo writes that link
  back; Airtable fetches the file from there. The pictures are listing logos
  the site already shows to everyone. When a copy cannot be made, Airtable's
  own link is kept instead, good for the few hours it lasts; past that,
  Undo says the picture could not be put back.
*/

import { createHash } from 'node:crypto'
import { put } from '@vercel/blob'
import { isExpiredAttachment } from './attachment-url'

/** A picture as Undo writes it back: what Airtable takes for a new
 *  attachment. */
export interface KeptPicture {
  url: string
  filename: string
}

const MAX_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8000
const AIRTABLE_HOST = /(^|\.)airtableusercontent\.com$|(^|\.)airtable\.com$/

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

/** Where a picture's copy goes in the Blob store, named by its bytes, so
 *  the same file accepted twice is one copy. */
export function beforePath(bytes: Uint8Array, contentType: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const ext = EXTENSIONS[contentType.split(';')[0].trim().toLowerCase()]
  return `queue/before/${hash}${ext ? `.${ext}` : ''}`
}

/** The pictures an attachment field holds, as Airtable reads them back
 *  (`{id, url, filename, …}`), in order. Anything else in the list is
 *  dropped; an empty field is an empty list. */
export function storedPictures(
  value: unknown
): { url: string; filename: string; type?: string; size?: number }[] {
  if (!Array.isArray(value)) return []
  const out: { url: string; filename: string; type?: string; size?: number }[] =
    []
  for (const x of value) {
    if (!x || typeof x !== 'object') continue
    const a = x as Record<string, unknown>
    if (typeof a.url !== 'string') continue
    out.push({
      url: a.url,
      filename:
        typeof a.filename === 'string' && a.filename ? a.filename : 'image',
      type: typeof a.type === 'string' ? a.type : undefined,
      size: typeof a.size === 'number' ? a.size : undefined,
    })
  }
  return out
}

/** True when a kept picture can no longer be written back: an Airtable
 *  link that has run out (a copy that could not be made at Accept). */
export function isSpent(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      x =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as { url?: unknown }).url === 'string' &&
        isExpiredAttachment((x as { url: string }).url)
    )
  )
}

/** A lasting copy of the pictures an attachment field holds, for Undo.
 *  Never throws: a picture that cannot be copied is kept by Airtable's own
 *  link, with a warning in the log. */
export async function keepPictures(value: unknown): Promise<KeptPicture[]> {
  const out: KeptPicture[] = []
  for (const p of storedPictures(value)) {
    const url = await copyToBlob(p).catch((e: unknown) => {
      console.warn(
        `[admin-queue] kept "${p.filename}" by its Airtable link only, for a few hours: ${e instanceof Error ? e.message : String(e)}`
      )
      return p.url
    })
    out.push({ url, filename: p.filename })
  }
  return out
}

async function copyToBlob(p: {
  url: string
  filename: string
  type?: string
  size?: number
}): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set here')
  }
  // Only Airtable's own links are fetched.
  if (!AIRTABLE_HOST.test(new URL(p.url).hostname)) {
    throw new Error('not an Airtable link')
  }
  if (typeof p.size === 'number' && p.size > MAX_BYTES) {
    throw new Error('over 5 MB')
  }
  const res = await fetch(p.url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Airtable answered ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES) throw new Error('over 5 MB')
  const type = (p.type ?? res.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
  // Named by its bytes, so writing it again is writing the same file.
  const { url } = await put(beforePath(bytes, type), Buffer.from(bytes), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: type || undefined,
  })
  return url
}
