/** A newsletter's history from its Substack export (Settings → Exports on
 *  Substack: a .zip), for the Newsletters tab's subscriber tiles. The
 *  export lists everyone on the list with their signup date, and, for every
 *  issue, everyone it was emailed to; what's kept is how many people each
 *  issue reached. Read in the browser (SubstackUpload), so only those
 *  counts are ever sent to the site, never an address. */

import { csvRecords } from '@/lib/csv'
import type { ZipEntry } from '@/lib/zip-read'
import { SUBSTACK_PUBLICATIONS, type SubstackIssue } from './subscribers'

export interface SubstackHistory {
  /** The publication it's for, as in email_list.<publication>.csv. */
  publication: string
  /** The newest moment it covers (its latest signup or send), epoch ms. */
  asOf: number
  /** People on the list when it was exported, app-only readers included. */
  onList: number
  /** Every emailed issue, oldest first. */
  issues: SubstackIssue[]
}

/** The history in an export's files. Throws, saying what's wrong in plain
 *  words, when they aren't a Substack export of one of the site's
 *  newsletters. */
export async function readSubstackExport(
  entries: ZipEntry[]
): Promise<SubstackHistory> {
  const text = async (e: ZipEntry) => new TextDecoder().decode(await e.read())
  const list = entries.find(e => /^email_list\.[a-z0-9-]+\.csv$/.test(e.name))
  if (!list)
    throw new Error(
      'This isn’t a Substack export (it has no email_list file in it).'
    )
  const publication = list.name.slice('email_list.'.length, -'.csv'.length)
  if (!SUBSTACK_PUBLICATIONS.includes(publication))
    throw new Error(
      `This export is for ${publication}, which isn’t one of the site’s newsletters.`
    )
  const postsFile = entries.find(e => e.name === 'posts.csv')
  if (!postsFile)
    throw new Error(
      'This export has no posts.csv, so its issues can’t be dated.'
    )
  const sentAt = new Map<string, number>()
  for (const p of csvRecords(await text(postsFile)))
    if (p.email_sent_at)
      sentAt.set(p.post_id.split('.')[0], Date.parse(p.email_sent_at))
  const issues: SubstackIssue[] = []
  for (const e of entries) {
    const id = /^posts\/(\d+)\.delivers\.csv$/.exec(e.name)?.[1]
    const t = id ? sentAt.get(id) : undefined
    if (t == null || Number.isNaN(t)) continue
    const emails = new Set<string>()
    for (const r of csvRecords(await text(e)))
      if (r.email) emails.add(r.email.trim().toLowerCase())
    issues.push({ t, n: emails.size })
  }
  if (issues.length === 0)
    throw new Error('This export has no emailed issues in it.')
  issues.sort((a, b) => a.t - b.t)
  const subscribers = csvRecords(await text(list))
  let asOf = issues[issues.length - 1].t
  for (const s of subscribers) {
    const t = Date.parse(s.created_at)
    if (t > asOf) asOf = t
  }
  return { publication, asOf, onList: subscribers.length, issues }
}

/** Most issues a history may hold: about 40 years of weekly ones. */
const MAX_ISSUES = 2000

/** Pure: a history as the site receives or stores it, checked. Null when
 *  it isn't one. */
export function parseSubstackHistory(raw: unknown): SubstackHistory | null {
  const h = raw as Partial<SubstackHistory> | null
  const isCount = (n: unknown): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 10_000_000
  const isTime = (t: unknown): t is number =>
    typeof t === 'number' &&
    Number.isFinite(t) &&
    t > Date.UTC(2015, 0, 1) &&
    t < Date.now() + 86_400_000
  if (
    !h ||
    typeof h !== 'object' ||
    typeof h.publication !== 'string' ||
    !SUBSTACK_PUBLICATIONS.includes(h.publication) ||
    !isTime(h.asOf) ||
    !isCount(h.onList) ||
    !Array.isArray(h.issues) ||
    h.issues.length === 0 ||
    h.issues.length > MAX_ISSUES
  )
    return null
  const issues: SubstackIssue[] = []
  for (const i of h.issues as unknown[]) {
    const issue = i as Partial<SubstackIssue> | null
    if (!issue || !isTime(issue.t) || !isCount(issue.n)) return null
    issues.push({ t: issue.t, n: issue.n })
  }
  issues.sort((a, b) => a.t - b.t)
  return { publication: h.publication, asOf: h.asOf, onList: h.onList, issues }
}
