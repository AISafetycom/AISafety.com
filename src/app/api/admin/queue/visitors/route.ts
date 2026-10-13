/*
  Visitors per resource page last month, for the Queue's Urgent order
  (sessions with both the queue and the analytics area).

  GET /api/admin/queue/visitors
    → { month: "2026-09", pages: { "/jobs": 5864, … } }
    → { month: null, pages: null } when there are no figures, or the
      session may not see the analytics

  The Urgent section puts items on busier pages first (queue-urgent.ts).
  The figure is worked out once per month and then kept in the analytics
  store (readLastMonthPageVisitors), so after the month's first ask this is
  one read. Without it the list keeps its date-only order.
*/

import { canViewAnalytics, canViewQueue } from '@/lib/admin/auth'
import { readLastMonthPageVisitors } from '@/lib/analytics/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The month's first ask reads that whole month of events.
export const maxDuration = 60

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET() {
  if (!(await canViewQueue())) return json({ error: 'unauthorized' }, 401)
  if (!(await canViewAnalytics())) return json({ month: null, pages: null })
  const figures = await readLastMonthPageVisitors()
  return json(figures ?? { month: null, pages: null })
}
