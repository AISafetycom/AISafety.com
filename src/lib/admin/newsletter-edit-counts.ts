/*
  How often cards are taken out of a newsletter draft on /admin/newsletter
  and put back (29 Oct 2026, with Put back): whether the undo gets used, and
  from where (the Undo link in the Removed line, or Put back in the list of
  removed cards later on). Admin pages load no visitor analytics, so the
  routes count here, server-side: one Upstash hash per UTC day, a count per
  kind, nothing about who pressed what. A local file without Upstash, like
  the newsletter click counts. Shown on /admin/analytics' Newsletters tab.
*/

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Redis } from '@upstash/redis'

export type CardEditKind = 'remove' | 'put-back' | 'put-back-undo'

const KINDS: CardEditKind[] = ['remove', 'put-back', 'put-back-undo']

/** The first day counted (UTC midnight). */
export const CARD_EDITS_SINCE_MS = Date.UTC(2026, 9, 29)

const KEY_PREFIX = 'aisafety:newsletter:card-edits:'

// The same Upstash database the site's analytics use.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

const DEV_FILE = path.join(
  process.cwd(),
  '.analytics-dev',
  'newsletter-card-edits.json'
)

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

async function readDevCounts(): Promise<
  Record<string, Record<string, number>>
> {
  try {
    return JSON.parse(await fs.readFile(DEV_FILE, 'utf8'))
  } catch {
    return {}
  }
}

/** Count one Remove or Put back. Never throws: the edit has gone through by
 *  then, and a lost count must not turn it into an error (analytics are
 *  fire-and-forget). */
export async function countCardEdit(
  kind: CardEditKind,
  now = Date.now()
): Promise<void> {
  const day = dayOf(now)
  try {
    if (store) {
      await store.hincrby(KEY_PREFIX + day, kind, 1)
      return
    }
    const all = await readDevCounts()
    const d = (all[day] ??= {})
    d[kind] = (d[kind] ?? 0) + 1
    await fs.mkdir(path.dirname(DEV_FILE), { recursive: true })
    await fs.writeFile(DEV_FILE, JSON.stringify(all))
  } catch (err) {
    console.warn(
      `[newsletter] card edit count failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export type CardEditCounts = Record<CardEditKind, number>

/** The UTC days from `startMs` (or the first day counted) to `endMs`. */
export function daysBetween(startMs: number | null, endMs: number): string[] {
  const out: string[] = []
  const from = Math.max(startMs ?? CARD_EDITS_SINCE_MS, CARD_EDITS_SINCE_MS)
  const first = Date.UTC(
    new Date(from).getUTCFullYear(),
    new Date(from).getUTCMonth(),
    new Date(from).getUTCDate()
  )
  for (let t = first; t <= endMs; t += 86_400_000) out.push(dayOf(t))
  return out
}

/** The counts over a range of days; null when they couldn't be read. */
export async function readCardEdits(range: {
  startMs: number | null
  endMs: number | null
}): Promise<CardEditCounts | null> {
  const days = daysBetween(range.startMs, range.endMs ?? Date.now())
  const out: CardEditCounts = { remove: 0, 'put-back': 0, 'put-back-undo': 0 }
  if (days.length === 0) return out
  try {
    let hashes: Array<Record<string, unknown> | null>
    if (store) {
      const p = store.pipeline()
      for (const d of days) p.hgetall(KEY_PREFIX + d)
      hashes = (await p.exec()) as Array<Record<string, unknown> | null>
    } else {
      const all = await readDevCounts()
      hashes = days.map(d => all[d] ?? null)
    }
    for (const h of hashes)
      for (const k of KINDS) {
        const n = Number(h?.[k] ?? 0)
        if (Number.isFinite(n)) out[k] += n
      }
    return out
  } catch (err) {
    console.warn(
      `[newsletter] card edit counts unavailable: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}
