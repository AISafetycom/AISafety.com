/*
  GET /api/newsletter/pending — a Vercel cron every ten minutes
  (vercel.json) that finishes the several-newsletters signups from
  /newsletter: once a reader has confirmed the first newsletter they
  picked, it adds them to the others (src/lib/newsletter-pending.ts). With
  nothing waiting it is one Upstash read. Like the other crons, it refuses
  every request unless CRON_SECRET is set and matches.
*/

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthorized } from '@/lib/admin/auth'
import { finishPending } from '@/lib/newsletter-pending'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronAuthorized(req.headers.get('authorization'), cronSecret)) {
    if (!cronSecret)
      console.error('[newsletter-pending] CRON_SECRET is not set; not running')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const run = await finishPending()
    if (run.finished || run.failed)
      console.log(`[newsletter-pending] ${JSON.stringify(run)}`)
    return NextResponse.json({ ok: true, ...run })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[newsletter-pending] ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
