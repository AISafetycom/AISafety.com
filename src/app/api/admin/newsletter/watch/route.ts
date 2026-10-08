/*
  GET /api/admin/newsletter/watch — the newsletter send watcher, a Vercel
  cron every 10 minutes (vercel.json). Reads ActiveCampaign, emails the
  owner once per problem and keeps the open alerts for the banner on
  /admin/newsletter. Its only writes to ActiveCampaign: canceling a wave
  that is still scheduled after a red verdict, or about to start without a
  verdict on the wave before it, and deleting an issue's draft once every
  wave of it has gone. The rules are in src/lib/admin/newsletter-watch.ts.
  Unlike the other cron routes, it refuses every request unless CRON_SECRET
  is set and matches (`cronAuthorized`); to try it on a laptop, set
  CRON_SECRET in .env.local and send the same Bearer header.

  Outside production (a preview, a laptop) a run is a dry run: it reads and
  reports what it would raise or cancel, but emails nobody and changes
  nothing, since every environment shares the one Upstash database and the
  one ActiveCampaign account.
*/

import { NextRequest, NextResponse } from 'next/server'
import { publicOrigin } from '@/lib/admin/origin'
import { cronAuthorized, runWatch } from '@/lib/admin/newsletter-watch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// ActiveCampaign can take 10+ seconds a request; the run stops reading at
// 35 seconds, starts no cancel after 50, saves what it has, then emails
// (none started after 95).
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronAuthorized(req.headers.get('authorization'), cronSecret)) {
    if (!cronSecret)
      console.error('[newsletter-watch] CRON_SECRET is not set; not running')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const production = process.env.VERCEL_ENV === 'production'
  try {
    const summary = await runWatch({
      dry: !production,
      origin: production ? undefined : publicOrigin(req),
    })
    return NextResponse.json(summary)
  } catch (err) {
    // The stored state or the lock couldn't be read or written (Upstash):
    // nothing was emailed. The next run tries again.
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter-watch] run failed: ${message}`)
    return NextResponse.json(
      { error: 'The watcher run failed; details are in the server log.' },
      { status: 500 }
    )
  }
}
