import { canViewAnalytics } from '@/lib/admin/auth'
import { backfillFirstSeen } from '@/lib/analytics/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Reads every stored month, like an "All time" dashboard load, then writes the
// first-seen hash in batches — comfortably inside a minute at current volume.
export const maxDuration = 60

// One-time backfill of the visitor first-seen hash from the month lists (see
// backfillFirstSeen for the full story). Safe to call again — a repeat run
// finds nothing earlier and writes nothing — but after the first successful
// run it has no further purpose.

export async function POST() {
  if (!(await canViewAnalytics())) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const result = await backfillFirstSeen()
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // The detail stays in the server log; the client gets a plain summary.
    console.error('[analytics] first-seen backfill failed:', err)
    return new Response(
      JSON.stringify({
        error: 'Backfill failed; details are in the server log.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
