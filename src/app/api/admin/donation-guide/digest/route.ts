/*
  GET /api/admin/donation-guide/digest — the daily Vercel cron (vercel.json,
  08:00 UTC). Emails the owner about publishes still waiting: a publish by
  someone else within a day of the last email is held rather than sent, so
  this sweep is what delivers it. Same auth pattern as the other cron routes:
  enforced only when CRON_SECRET is configured.
*/

import { NextRequest, NextResponse } from 'next/server'
import { publicOrigin } from '@/lib/admin/origin'
import { sendDigestIfDue } from '@/lib/donation-guide/publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  const sent = await sendDigestIfDue(publicOrigin(req))
  return NextResponse.json({ sent })
}
