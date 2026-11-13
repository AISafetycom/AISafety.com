/*
  GET /api/admin/analytics/subscriber-history — a Vercel cron every three
  hours (vercel.json) that works out the Newsletters tab's subscriber
  figures again: each moved newsletter's ActiveCampaign list at the end of
  every day since its move (src/lib/admin/newsletter-subscribers.ts). The
  tab does it too after a load that finds them old, but that load still
  shows the old copy, so a quiet week left days off the chart. The run just
  after midnight UTC settles the day before. Reads ActiveCampaign; writes
  only the kept figures. Like the other admin crons, it refuses every
  request unless CRON_SECRET is set and matches.
*/

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/admin/auth'
import { refreshSubscriberHistory } from '@/lib/admin/newsletter-subscribers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Reading every list membership takes over a minute and grows with the
// lists.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronAuthorized(req.headers.get('authorization'), cronSecret)) {
    if (!cronSecret)
      console.error(
        '[analytics] CRON_SECRET is not set; subscriber history not refreshed'
      )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const outcome = await refreshSubscriberHistory()
  if (outcome === 'failed')
    return NextResponse.json(
      { error: 'Refresh failed; details are in the server log.' },
      { status: 502 }
    )
  return NextResponse.json({ outcome })
}
