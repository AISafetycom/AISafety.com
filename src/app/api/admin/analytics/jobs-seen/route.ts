/*
  GET /api/admin/analytics/jobs-seen — a Vercel cron every hour
  (vercel.json) that notes which jobs are on /jobs now
  (src/lib/analytics/jobs-seen.ts), so the job board's page can count every
  job listed in its dates, clicked or not. Reads the Jobs view; writes only
  that record. Like the other admin crons, it refuses every request unless
  CRON_SECRET is set and matches.
*/

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/admin/auth'
import { recordJobsSeen } from '@/lib/analytics/jobs-seen'
import { getJobs } from '@/lib/data/jobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronAuthorized(req.headers.get('authorization'), cronSecret)) {
    if (!cronSecret)
      console.error('[analytics] CRON_SECRET is not set; jobs not recorded')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const jobs = await getJobs()
    const changed = await recordJobsSeen(jobs, Date.now())
    return NextResponse.json({ listed: jobs.length, changed })
  } catch (err) {
    console.error(
      `[analytics] jobs seen not recorded: ${err instanceof Error ? err.message : String(err)}`
    )
    return NextResponse.json(
      { error: 'Recording failed; details are in the server log.' },
      { status: 502 }
    )
  }
}
