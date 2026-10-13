import { NextResponse } from 'next/server'
import { canViewAnalytics, cronAuthorized } from '@/lib/admin/auth'
import { refreshQuestionThemes } from '@/lib/analytics/themes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The refresh makes one Claude call over every typed question — give it room.
export const maxDuration = 60

async function refresh(): Promise<Response> {
  try {
    const summary = await refreshQuestionThemes()
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[analytics] theme refresh failed: ${message}`)
    return new Response(`Theme refresh failed: ${message}`, { status: 500 })
  }
}

/** The dashboard's Refresh button — anyone who can see the analytics (owner
 *  or volunteer password) can refresh; the Successif log-only password
 *  can't. */
export async function POST() {
  if (!(await canViewAnalytics())) {
    return new Response('Unauthorized', { status: 401 })
  }
  return refresh()
}

/** The weekly Vercel cron (see vercel.json). Refuses every request unless
 *  CRON_SECRET is set and matches (`cronAuthorized`), like every admin cron
 *  route. */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronAuthorized(request.headers.get('authorization'), cronSecret)) {
    if (!cronSecret)
      console.error('[analytics] CRON_SECRET is not set; not running')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return refresh()
}
