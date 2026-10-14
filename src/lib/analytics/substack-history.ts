// The Substack histories added on the Newsletters tab (SubstackUpload): one
// per publication, the counts from its latest export (substack-export.ts),
// no addresses. Production and preview keep them in the same Upstash
// database as the events; a laptop without those keys keeps them in
// .analytics-dev/ instead.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Redis } from '@upstash/redis'
import { parseSubstackHistory, type SubstackHistory } from './substack-export'

export interface SavedSubstackHistory extends SubstackHistory {
  /** ISO time it was added, and the admin who added it. */
  savedAt: string
  savedBy: string
}

/** One hash field per publication: publication → SavedSubstackHistory as
 *  JSON. */
const KEY = 'aisafety:analytics:substack-history'

const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

const DEV_FILE = path.join(
  process.cwd(),
  '.analytics-dev',
  'substack-history.json'
)

async function readDev(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(DEV_FILE, 'utf8')) as Record<
      string,
      unknown
    >
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

/** Every saved history, by publication. A stored value that doesn't parse
 *  is left out with a warning. Throws when the store can't be read. */
export async function readSubstackHistories(): Promise<
  Map<string, SavedSubstackHistory>
> {
  const raw = store
    ? ((await store.hgetall<Record<string, unknown>>(KEY)) ?? {})
    : await readDev()
  const out = new Map<string, SavedSubstackHistory>()
  for (const [publication, value] of Object.entries(raw)) {
    let v: unknown = value
    if (typeof value === 'string') {
      try {
        v = JSON.parse(value)
      } catch {
        v = null
      }
    }
    const h = parseSubstackHistory(v)
    const saved = v as Partial<SavedSubstackHistory> | null
    if (
      !h ||
      h.publication !== publication ||
      typeof saved?.savedAt !== 'string' ||
      typeof saved?.savedBy !== 'string'
    ) {
      console.warn(
        `[analytics] stored Substack history for ${publication} doesn't parse`
      )
      continue
    }
    out.set(publication, {
      ...h,
      savedAt: saved.savedAt,
      savedBy: saved.savedBy,
    })
  }
  return out
}

/** Save a publication's history, replacing the one before. An export older
 *  than the saved one is refused (`'older'`) so a stale download can't wind
 *  the history back. */
export async function saveSubstackHistory(
  h: SubstackHistory,
  savedBy: string
): Promise<'saved' | 'older'> {
  const current = (await readSubstackHistories()).get(h.publication)
  if (current && h.asOf < current.asOf) return 'older'
  const saved: SavedSubstackHistory = {
    ...h,
    savedAt: new Date().toISOString(),
    savedBy,
  }
  if (store) {
    await store.hset(KEY, { [h.publication]: JSON.stringify(saved) })
  } else {
    const doc = await readDev()
    doc[h.publication] = saved
    await fs.mkdir(path.dirname(DEV_FILE), { recursive: true })
    await fs.writeFile(DEV_FILE, JSON.stringify(doc, null, 2))
  }
  return 'saved'
}
