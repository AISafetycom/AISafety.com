/*
  Which picture each side of a queue change shows. A proposal names a
  picture in several shapes: Airtable's own ({id, filename, url}, the old
  side often without its url), the site's snapshot (a list of links),
  Broom's proposal ({url, filename}), or just the file's name as text
  ("arcadia_impact_logo-min.webp", sometimes with a note after it). And
  Airtable's links run out after a few hours.

  A name or a dead link is never handed to an <img>: the page showed a
  broken picture where the old logo should be (Bryce, 30 Sept 2026, BASE
  Fellowship: Fall 2026, whose old side was a bare file name). The
  record's own picture, from the live read, stands in when it is the same
  file.
*/

import { isExpiredAttachment } from './attachment-url'

const IMAGE_URL =
  /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)|airtableusercontent\.com|blob\.vercel-storage\.com/i

// Something a browser can load: a web link, a path on this site, or a
// picture held in the page itself.
const LOADABLE = /^(https?:\/\/|\/|blob:|data:image\/)/i

// A picture's file name at the start of a text: "logo.webp", "1 (1).png",
// "game-night.webp (old tree-in-circle badge)".
const FILE_NAME = /^([^/\\\n]*?\.(?:png|jpe?g|webp|gif|svg|avif))(?=\s|$)/i

// The first web link in a text: "new Substack logo – https://…/mark.png".
const LINK_IN_TEXT = /https?:\/\/[^\s]+?(?=[.,;)]*(\s|$))/i

// Fields that hold pictures, by name: Logo, Logo (for cards), Image…
const PICTURE_FIELD = /\b(logo|image|picture|photo|icon|avatar)\b/i

/** True when a field's name says it holds pictures. */
export function isPictureField(name: string): boolean {
  return PICTURE_FIELD.test(name)
}

/** True for a loadable link to a picture; false for a bare file name. */
export function isImageLink(s: string): boolean {
  return LOADABLE.test(s) && IMAGE_URL.test(s)
}

/** The picture link in an attachment value, if it holds one. */
export function pictureUrl(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? pictureUrl(v[0]) : null
  if (typeof v === 'string') return isImageLink(v) ? v : null
  if (v && typeof v === 'object' && 'url' in v) {
    const url = (v as { url: unknown }).url
    return typeof url === 'string' && LOADABLE.test(url) ? url : null
  }
  return null
}

export function looksLikeAttachment(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0 && v.every(looksLikeAttachment)
  return Boolean(
    v && typeof v === 'object' && ('url' in v || 'filename' in v || 'id' in v)
  )
}

/** The file a text names when it is a file name rather than a link. */
export function namedFile(v: unknown): string | null {
  if (typeof v !== 'string' || LOADABLE.test(v.trim())) return null
  return FILE_NAME.exec(v.trim())?.[1] ?? null
}

/** The file name of a picture: its `filename`, the name a text gives, or
 *  the last part of its link. Airtable's links end in a code, not the
 *  name, so they give none. */
export function fileNameOf(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? fileNameOf(v[0]) : null
  if (v && typeof v === 'object' && 'filename' in v) {
    const f = (v as { filename: unknown }).filename
    return typeof f === 'string' ? f : null
  }
  if (typeof v !== 'string') return null
  const named = namedFile(v)
  if (named) return named
  if (/airtableusercontent\.com/i.test(v)) return null
  try {
    // A resizing service can carry the original link in its path, so the
    // name is the last part after decoding too.
    const last = new URL(v).pathname.split('/').pop() ?? ''
    return decodeURIComponent(last).split('/').pop() || null
  } catch {
    return null
  }
}

function idOf(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? idOf(v[0]) : null
  if (v && typeof v === 'object' && 'id' in v) {
    const id = (v as { id: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}

function sameName(a: string, b: string): boolean {
  const norm = (s: string) => {
    let out = s
    try {
      out = decodeURIComponent(s)
    } catch {
      // a stray % – compare as it is
    }
    return out.replace(/\+/g, ' ').trim().toLowerCase()
  }
  return norm(a) === norm(b)
}

/** Whether the old side is the record's picture now: 'same' when the
 *  attachment id or file name matches, 'other' when it names a different
 *  file, 'unknown' when it names none. */
function matchLive(
  v: unknown,
  liveValue: unknown
): 'same' | 'other' | 'unknown' {
  const id = idOf(v)
  const liveId = idOf(liveValue)
  if (id && liveId) return id === liveId ? 'same' : 'other'
  const name = fileNameOf(v)
  const liveName = fileNameOf(liveValue)
  if (name && liveName) return sameName(name, liveName) ? 'same' : 'other'
  return 'unknown'
}

export interface PictureSide {
  /** What to show first; null shows the plain box. */
  url: string | null
  /** What to show if `url` does not load. */
  fallback: string | null
  name: string | null
}

/**
 * The picture behind one side of a change to a logo or image field, or
 * null when the value is not a picture.
 *
 * `liveValue` is the record's field now (from the live read). It stands in
 * for the value's own link when that is missing, expired or fails to load
 * – but only when it is the same file: after an Apply the record holds the
 * new picture, which must not show as the old one. When the old side names
 * no file, the record's picture stands in only while the item is `open`
 * (it is still what Accept would replace).
 *
 * `pictureField` says the field holds pictures (the other side is one), so
 * a bare file name or any link on this side is a picture too.
 */
export function pictureOf(
  v: unknown,
  liveValue: unknown,
  { pictureField = false, open = true } = {}
): PictureSide | null {
  const own =
    pictureUrl(v) ??
    (pictureField && typeof v === 'string'
      ? (LINK_IN_TEXT.exec(v)?.[0] ?? null)
      : null)
  const isPicture =
    own !== null ||
    looksLikeAttachment(v) ||
    (namedFile(v) !== null && (pictureField || looksLikeAttachment(liveValue)))
  if (!isPicture) return null

  const usable = own && !isExpiredAttachment(own) ? own : null
  const liveUrl = pictureUrl(liveValue)
  const live = liveUrl && !isExpiredAttachment(liveUrl) ? liveUrl : null
  const match = matchLive(v, liveValue)
  const standIn =
    live && (match === 'same' || (match === 'unknown' && open)) ? live : null

  return {
    url: usable ?? standIn,
    fallback: usable && standIn !== usable ? standIn : null,
    name:
      fileNameOf(v) ??
      (own ? fileNameOf(own) : null) ??
      (standIn ? fileNameOf(liveValue) : null),
  }
}

/** True when a change swaps a picture, so its card needs the live read. */
export function touchesPicture(c: {
  field?: string
  from: unknown
  to: unknown
}): boolean {
  return (
    (c.field !== undefined && isPictureField(c.field)) ||
    looksLikeAttachment(c.from) ||
    looksLikeAttachment(c.to) ||
    pictureUrl(c.from) !== null ||
    pictureUrl(c.to) !== null
  )
}

/** True when any picture link in a record's fields has run out, so the
 *  live read has to be made again before its pictures can show. */
export function hasExpiredPicture(fields: Record<string, unknown>): boolean {
  const links = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.flatMap(links)
      : typeof v === 'string'
        ? [v]
        : v && typeof v === 'object' && 'url' in v
          ? links((v as { url: unknown }).url)
          : []
  return Object.values(fields).some(v =>
    links(v).some(url => isExpiredAttachment(url))
  )
}
