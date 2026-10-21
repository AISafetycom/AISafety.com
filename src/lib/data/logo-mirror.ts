import { createHash } from 'node:crypto'
import sharp from 'sharp'

// Some Airtable fields hold a logo as a web address on another site rather
// than an attachment: the Jobs table's "Org's logo" points at
// 80000hours.org/wp-content/uploads/… for every job. Serving those addresses
// hotlinks the other site (its bandwidth, and its outages: on 20 Oct 2026
// 80k's server timed out and /jobs showed blank logos), and the originals run
// to 600 KB for a logo drawn at 64 px. So each one is copied to Vercel Blob
// once, as a small WebP thumbnail, and the copy's address is served instead.
//
// The Blob store is passed in (airtable.ts supplies it, with its remembered
// listing), so all of this can be tested without Next or a real store.

/** Longest side of a stored thumbnail: 4× the 64 px cards, so crisp on any
 *  screen. Changing it changes LOGO_PREFIX, so every logo is copied again. */
export const LOGO_THUMB_PX = 256

/** Blob prefix for the thumbnails. Never deleted from, like `airtable/`. */
export const LOGO_PREFIX = `logos/${LOGO_THUMB_PX}/`

/** A source bigger than this is refused before it is decoded. */
export const MAX_LOGO_BYTES = 10 * 1024 * 1024

/** Where a source address's thumbnail lives in Blob. Keyed by the address
 *  itself, so every build and every server instance finds the same copy, and
 *  a new address in Airtable (a replaced logo) is copied afresh. */
export function logoPathname(sourceUrl: string): string {
  const hash = createHash('sha256').update(sourceUrl).digest('hex')
  return `${LOGO_PREFIX}${hash.slice(0, 32)}.webp`
}

/** What to do with a logo field's text: copy it (an http(s) address on
 *  another site), leave it ('blob': already a copy in Blob, e.g. pasted in by
 *  hand), or flag it ('invalid': not a web address at all). */
export function logoUrlKind(value: string): 'copy' | 'blob' | 'invalid' {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'invalid'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'invalid'
  return url.hostname.endsWith('.blob.vercel-storage.com') ? 'blob' : 'copy'
}

/** The stored thumbnail: at most LOGO_THUMB_PX on its longest side (never
 *  enlarged), EXIF rotation applied, WebP. Throws when the bytes aren't an
 *  image sharp can read (an HTML error page, an .ico). */
export async function logoThumbnail(source: ArrayBuffer): Promise<Buffer> {
  return sharp(Buffer.from(source))
    .rotate()
    .resize(LOGO_THUMB_PX, LOGO_THUMB_PX, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer()
}

export interface CopyLogosOptions {
  /** Uploads one thumbnail and returns its public address. */
  upload: (pathname: string, body: Buffer) => Promise<string>
  /** Time allowed for the whole run. Every fetch is cut off when it runs out,
   *  and logos not reached by then are left for the next run. */
  budgetMs: number
  concurrency: number
  fetchImpl?: typeof fetch
}

export interface CopyLogosResult {
  /** Source address → Blob address, for every logo copied this run. */
  copied: Map<string, string>
  /** Logos tried this run that couldn't be copied, with the reason. */
  failed: Array<{ url: string; reason: string }>
  /** Logos the time budget ran out before. */
  skipped: string[]
}

async function fetchLogo(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<ArrayBuffer> {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_LOGO_BYTES) {
    throw new Error(`${declared} bytes, over the ${MAX_LOGO_BYTES} limit`)
  }
  const body = await response.arrayBuffer()
  if (body.byteLength > MAX_LOGO_BYTES) {
    throw new Error(
      `${body.byteLength} bytes, over the ${MAX_LOGO_BYTES} limit`
    )
  }
  return body
}

/**
 * Copies each source logo to Blob as a thumbnail, a few at a time, within a
 * fixed time budget. The budget is what keeps a slow or dead source site from
 * holding up a build (Next gives each page 60 s) or a data refresh: one try
 * per logo per run, no retries, since the next run tries again anyway.
 * Never throws; every logo ends up in exactly one of the result's lists.
 */
export async function copyLogos(
  urls: string[],
  { upload, budgetMs, concurrency, fetchImpl = fetch }: CopyLogosOptions
): Promise<CopyLogosResult> {
  const deadline = Date.now() + budgetMs
  const result: CopyLogosResult = { copied: new Map(), failed: [], skipped: [] }
  const queue = [...new Set(urls)]

  async function worker() {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        result.skipped.push(url, ...queue.splice(0))
        return
      }
      try {
        const source = await fetchLogo(url, fetchImpl, remaining)
        const thumbnail = await logoThumbnail(source)
        result.copied.set(url, await upload(logoPathname(url), thumbnail))
      } catch (error) {
        const reason =
          error instanceof Error && error.name === 'TimeoutError'
            ? `no answer within the ${budgetMs / 1000} s time limit`
            : error instanceof Error
              ? error.message
              : String(error)
        result.failed.push({ url, reason })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker)
  )
  return result
}

/** The Blob store as mirrorLogoFields uses it. */
export interface LogoStore {
  /** Pathname → public address of every thumbnail already copied. Copies made
   *  during the run are added to the returned map, so a remembered listing
   *  learns about them too. */
  list: () => Promise<Map<string, string>>
  /** Uploads one thumbnail and returns its public address. */
  put: (pathname: string, body: Buffer) => Promise<string>
}

export interface MirrorLogoFieldsOptions {
  /** null when no store is configured (BLOB_READ_WRITE_TOKEN unset). */
  store: LogoStore | null
  budgetMs: number
  concurrency: number
  fetchImpl?: typeof fetch
}

/**
 * Rewrites each logo address in `fieldIds` to its thumbnail in Blob, in
 * place, copying any logo not copied before. A logo that can't be copied
 * keeps its source address (the page still shows it while the source site is
 * up) and is named in a warning; the next run tries it again. Never throws:
 * unlike an attachment's expiring address, a source address keeps working, so
 * no logo is worth failing a build or a data refresh over.
 */
export async function mirrorLogoFields(
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  fieldIds: string[],
  { store, budgetMs, concurrency, fetchImpl }: MirrorLogoFieldsOptions
): Promise<void> {
  const holders: Array<{ fields: Record<string, unknown>; fieldId: string }> =
    []
  const invalid: string[] = []
  for (const record of records) {
    for (const fieldId of fieldIds) {
      const value = record.fields[fieldId]
      if (typeof value !== 'string' || value === '') continue
      const kind = logoUrlKind(value)
      if (kind === 'copy') {
        holders.push({ fields: record.fields, fieldId })
      } else if (kind === 'invalid') {
        invalid.push(`${fieldId} for ${record.id}: "${value}"`)
      }
    }
  }
  if (invalid.length > 0) {
    console.warn(
      `${invalid.length} logo fields hold something other than a web address and are served as is:\n${invalid.join('\n')}`
    )
  }
  if (holders.length === 0) return

  // Many records share a logo (550 jobs, 166 logos on 20 Oct 2026).
  const sources = new Set(holders.map(h => h.fields[h.fieldId] as string))
  if (!store) {
    console.warn(
      `BLOB_READ_WRITE_TOKEN not set — ${sources.size} logos keep their source addresses`
    )
    return
  }
  let existing: Map<string, string>
  try {
    existing = await store.list()
  } catch (error) {
    console.warn(
      `Blob listing failed — ${sources.size} logos keep their source addresses: ${error}`
    )
    return
  }

  const pending = [...sources].filter(s => !existing.has(logoPathname(s)))
  if (pending.length > 0) {
    console.log(`Copying ${pending.length} logos to Blob...`)
    const { copied, failed, skipped } = await copyLogos(pending, {
      upload: store.put,
      budgetMs,
      concurrency,
      fetchImpl,
    })
    for (const [source, url] of copied) existing.set(logoPathname(source), url)
    if (failed.length > 0 || skipped.length > 0) {
      const lines = [
        ...failed.map(f => `${f.url}: ${f.reason}`),
        ...skipped.map(url => `${url}: not reached before the time ran out`),
      ]
      console.warn(
        `Could not copy ${lines.length} of ${pending.length} new logos to Blob; they keep their source addresses until the next run:\n${lines.join('\n')}`
      )
    }
  }

  for (const { fields, fieldId } of holders) {
    const copy = existing.get(logoPathname(fields[fieldId] as string))
    if (copy) fields[fieldId] = copy
  }
}
