import { canViewAnalytics } from '@/lib/admin/auth'
import { migrateLegacyEvents } from '@/lib/analytics/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// One-time migration of the retired single-list analytics store into the
// per-month lists (see migrateLegacyEvents for the full story). Safe to call
// again — a marker key makes repeat calls no-ops — but after the first
// successful run it has no further purpose.

export async function POST() {
  if (!(await canViewAnalytics())) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const result = await migrateLegacyEvents()
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // The detail stays in the server log; the client gets a plain summary.
    console.error('[analytics] migration failed:', err)
    return new Response(
      JSON.stringify({
        error: 'Migration failed; details are in the server log.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
