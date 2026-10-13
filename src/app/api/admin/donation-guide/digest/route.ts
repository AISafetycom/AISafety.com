/*
  GET /api/admin/donation-guide/digest — the daily Vercel cron (vercel.json,
  08:00 UTC). Emails the owner about publishes still waiting: a publish by
  someone else within a day of the last email is held rather than sent, so
  this sweep is what delivers it. Refuses every request unless CRON_SECRET
  is set and matches (`cronAuthorized`), like every admin cron route.
*/

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/admin/auth'
import { publicOrigin } from '@/lib/admin/origin'
import { sendDigestIfDue } from '@/lib/donation-guide/publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronAuthorized(req.headers.get('authorization'), cronSecret)) {
    if (!cronSecret)
      console.error('[donation-guide] CRON_SECRET is not set; not running')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sent = await sendDigestIfDue(publicOrigin(req))
  return NextResponse.json({ sent })
}
