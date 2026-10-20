/*
  GET /api/admin/newsletter/archive — a Vercel cron once a day (vercel.json)
  that files every sent issue in the site's own record before it drops out
  of ActiveCampaign's newest 100 campaigns, and keeps a copy of its email:
  what the past issues pages and feeds (/newsletter/<key>, …/feed) list
  and show. Their own views do the same, but nothing else makes sure a
  quiet stretch doesn't lose an issue. Reads ActiveCampaign; writes only
  the record and the kept copies, both write-once (see
  src/lib/newsletter-archive-store.ts and src/lib/newsletter-web-copy.ts),
  and only on the live site. Like the send watcher, it refuses every
  request unless CRON_SECRET is set and matches.
*/

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/admin/auth'
import { WEB_NEWSLETTERS, type WebKey } from '@/lib/newsletter-web'
import { sentEmail } from '@/lib/newsletter-web-copy'
import { archiveIssues } from '@/lib/newsletter-archive-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Only issues this recent can still be missing a kept copy: the cron has
 *  run every day since they went out. */
const RECENT_MS = 30 * 86_400_000

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronAuthorized(req.headers.get('authorization'), cronSecret)) {
    if (!cronSecret)
      console.error('[newsletter-archive] CRON_SECRET is not set; not running')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const summary: Record<string, { issues: number; missing: string[] }> = {}
  const failed: string[] = []
  for (const key of Object.keys(WEB_NEWSLETTERS) as WebKey[]) {
    try {
      const issues = await archiveIssues(key)
      const missing: string[] = []
      // One at a time: ActiveCampaign allows five requests a second.
      for (const i of issues) {
        if (i.sentAt && Date.now() - Date.parse(i.sentAt) > RECENT_MS) continue
        if (!(await sentEmail(key, i.slug))) missing.push(i.slug)
      }
      if (missing.length)
        console.warn(
          `[newsletter-archive] ${key}: no email found for ${missing.join(', ')}`
        )
      summary[key] = { issues: issues.length, missing }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[newsletter-archive] ${key}: ${message}`)
      failed.push(key)
    }
  }
  return NextResponse.json(
    failed.length
      ? {
          error: `Failed for ${failed.join(', ')}; details are in the server log.`,
          summary,
        }
      : { summary },
    { status: failed.length ? 500 : 200 }
  )
}
