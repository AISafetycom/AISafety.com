// Org pages: private links that show one org its own Org lookup figures,
// outside the admin, at /stats/<token>. Someone with Admin admin's edit grant
// makes one from the Org lookup tab. The link keeps that tab's search and the
// rows left out of it; the figures stay live, and the org picks the dates. A
// link works until it's switched off on the same tab, which deletes it at
// once.
//
// One link per search (compared by its words, normText), so sharing the same
// search again keeps the address and only updates what's left out. The token
// is the only key: 16 random bytes, so links can't be guessed or listed, and
// nothing else about them is public.
//
// Production and preview keep them in the same Upstash database as the
// events; a laptop without those keys keeps them in .analytics-dev/ instead.

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Redis } from '@upstash/redis'
import { MAX_LEFT_OUT, MAX_QUERY, normText, parseLeftOut } from './org-lookup'

export interface OrgShare {
  token: string
  /** The Org lookup search the page shows, as it was typed. */
  query: string
  /** Row hashes left out of it, as in the tab's ?x=. */
  leftOut: string[]
  /** The org's name as the tab showed it, for the page title and the list
   *  of shared links. */
  orgName: string
  /** ISO timestamps, and the name of the admin who made the link. */
  createdAt: string
  createdBy: string
  updatedAt: string
}

export interface ListedShare extends OrgShare {
  /** Page loads in a browser, not counting the team's own. */
  views: number
  lastViewedAt: string | null
}

/** One hash field per link: token → the OrgShare as JSON. */
const SHARES_KEY = 'aisafety:analytics:org-shares'
/** token → page loads; token → ISO time of the latest. */
const VIEWS_KEY = 'aisafety:analytics:org-share-views'
const LAST_VIEW_KEY = 'aisafety:analytics:org-share-last-view'

/** Org names come from listing titles, which are short; this only bounds a
 *  request that isn't the tab's own. */
export const MAX_ORG_NAME = 120

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/

/** Pure: whether a string can be a link's token at all, checked before any
 *  read so a malformed address costs nothing. */
export function isShareToken(s: string): boolean {
  return TOKEN_RE.test(s)
}

function newToken(): string {
  return randomBytes(16).toString('base64url')
}

/** Pure: a stored link, checked. Null when the value isn't one. */
export function parseShare(token: string, raw: unknown): OrgShare | null {
  let v: unknown = raw
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw)
    } catch {
      return null
    }
  }
  const s = v as Partial<OrgShare> | null
  if (
    !s ||
    typeof s !== 'object' ||
    typeof s.query !== 'string' ||
    !Array.isArray(s.leftOut) ||
    typeof s.orgName !== 'string' ||
    typeof s.createdAt !== 'string' ||
    typeof s.createdBy !== 'string' ||
    typeof s.updatedAt !== 'string'
  )
    return null
  return {
    token,
    query: s.query,
    leftOut: [...parseLeftOut(s.leftOut.join(','))],
    orgName: s.orgName,
    createdAt: s.createdAt,
    createdBy: s.createdBy,
    updatedAt: s.updatedAt,
  }
}

/** Pure: whether two left-out lists hold the same rows, in any order. */
export function sameLeftOut(a: string[], b: string[]): boolean {
  const sa = new Set(a)
  const sb = new Set(b)
  return sa.size === sb.size && [...sa].every(h => sb.has(h))
}

/** Pure: a new link's input, checked. Null when it isn't usable: a search
 *  must have at least two letters or digits, like the tab's own. */
export function checkShareInput(body: Record<string, unknown>): {
  query: string
  leftOut: string[]
  orgName: string
} | null {
  const query =
    typeof body.query === 'string' ? body.query.trim().slice(0, MAX_QUERY) : ''
  const orgName =
    typeof body.orgName === 'string'
      ? body.orgName.trim().slice(0, MAX_ORG_NAME)
      : ''
  if (normText(query).length < 2 || !orgName) return null
  if (
    !Array.isArray(body.leftOut) ||
    body.leftOut.length > MAX_LEFT_OUT ||
    !body.leftOut.every(h => typeof h === 'string')
  )
    return null
  return {
    query,
    leftOut: [...parseLeftOut((body.leftOut as string[]).join(','))],
    orgName,
  }
}

// ─── Storage ────────────────────────────────────────────────────────────────

const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
const store =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

const DEV_FILE = path.join(process.cwd(), '.analytics-dev', 'org-shares.json')

interface DevDoc {
  shares: Record<string, OrgShare>
  views: Record<string, number>
  lastView: Record<string, string>
}

async function readDev(): Promise<DevDoc> {
  try {
    const d = JSON.parse(await fs.readFile(DEV_FILE, 'utf8')) as DevDoc
    return {
      shares: d.shares ?? {},
      views: d.views ?? {},
      lastView: d.lastView ?? {},
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { shares: {}, views: {}, lastView: {} }
    throw err
  }
}

async function writeDev(doc: DevDoc): Promise<void> {
  await fs.mkdir(path.dirname(DEV_FILE), { recursive: true })
  await fs.writeFile(DEV_FILE, JSON.stringify(doc, null, 2))
}

/** The link with this token, or null when there's none (never made, or
 *  switched off). Throws when the store can't be read. */
export async function getShare(token: string): Promise<OrgShare | null> {
  if (!isShareToken(token)) return null
  const raw = store
    ? await store.hget<unknown>(SHARES_KEY, token)
    : (await readDev()).shares[token]
  return raw == null ? null : parseShare(token, raw)
}

/** Every link, newest first, with how often each has been opened. Throws
 *  when the store can't be read. */
export async function listShares(): Promise<ListedShare[]> {
  let shares: Record<string, unknown>
  let views: Record<string, unknown>
  let lastView: Record<string, unknown>
  if (store) {
    const p = store.pipeline()
    p.hgetall(SHARES_KEY)
    p.hgetall(VIEWS_KEY)
    p.hgetall(LAST_VIEW_KEY)
    const [a, b, c] = (await p.exec()) as (Record<string, unknown> | null)[]
    shares = a ?? {}
    views = b ?? {}
    lastView = c ?? {}
  } else {
    ;({ shares, views, lastView } = await readDev())
  }
  return Object.entries(shares)
    .flatMap(([token, raw]) => {
      const s = parseShare(token, raw)
      if (!s) {
        console.warn(`[org-shares] link ${token} isn't readable; skipped`)
        return []
      }
      const n = Number(views[token] ?? 0)
      const last = lastView[token]
      return [
        {
          ...s,
          views: Number.isFinite(n) ? n : 0,
          lastViewedAt: typeof last === 'string' ? last : null,
        },
      ]
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** The link for this search, if there is one. */
export function shareForQuery<T extends OrgShare>(
  shares: T[],
  query: string
): T | undefined {
  const norm = normText(query)
  return shares.find(s => normText(s.query) === norm)
}

/** Makes the search's link, or updates what it leaves out when it already
 *  has one (the address stays the same). */
export async function saveShare(
  input: { query: string; leftOut: string[]; orgName: string },
  by: string
): Promise<OrgShare> {
  const now = new Date().toISOString()
  const existing = shareForQuery(await listShares(), input.query)
  // Only the link's own fields: the listing's view counts live apart.
  const share: OrgShare = existing
    ? {
        token: existing.token,
        query: existing.query,
        leftOut: input.leftOut,
        orgName: input.orgName,
        createdAt: existing.createdAt,
        createdBy: existing.createdBy,
        updatedAt: now,
      }
    : {
        token: newToken(),
        ...input,
        createdAt: now,
        createdBy: by,
        updatedAt: now,
      }
  const { token, ...stored } = share
  if (store) await store.hset(SHARES_KEY, { [token]: JSON.stringify(stored) })
  else {
    const doc = await readDev()
    doc.shares[token] = share
    await writeDev(doc)
  }
  return share
}

/** Switches a link off for good: the address stops working at once. False
 *  when there was no such link. */
export async function removeShare(token: string): Promise<boolean> {
  if (!isShareToken(token)) return false
  if (store) {
    const p = store.pipeline()
    p.hdel(SHARES_KEY, token)
    p.hdel(VIEWS_KEY, token)
    p.hdel(LAST_VIEW_KEY, token)
    const [removed] = (await p.exec()) as number[]
    return removed > 0
  }
  const doc = await readDev()
  if (!doc.shares[token]) return false
  delete doc.shares[token]
  delete doc.views[token]
  delete doc.lastView[token]
  await writeDev(doc)
  return true
}

/** Counts one opening of a link. Never throws: it runs after the page has
 *  been sent (via after()), and like the rest of the analytics a failed
 *  count must not matter to the reader. */
export async function countShareView(token: string): Promise<void> {
  try {
    const at = new Date().toISOString()
    if (store) {
      const p = store.pipeline()
      p.hincrby(VIEWS_KEY, token, 1)
      p.hset(LAST_VIEW_KEY, { [token]: at })
      await p.exec()
      return
    }
    const doc = await readDev()
    if (!doc.shares[token]) return
    doc.views[token] = (doc.views[token] ?? 0) + 1
    doc.lastView[token] = at
    await writeDev(doc)
  } catch (err) {
    console.warn(
      `[org-shares] view count failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
