/*
  GET /api/admin/donation-guide/stamp → { stamp }

  A short string that changes whenever the draft is saved or discarded, or
  a version is published. The preview page polls it every couple of seconds
  and re-renders itself when it changes, so a preview left open in another
  tab follows the editor without a manual refresh. View grant.
*/

import { ensureGuideAuth, json } from '@/lib/donation-guide/api'
import { guideStamp } from '@/lib/donation-guide/stamp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await ensureGuideAuth(false)
  if (auth) return auth
  try {
    return json({ stamp: await guideStamp() })
  } catch (err) {
    console.error('[donation-guide] stamp failed:', err)
    return json({ error: 'Could not read the guide; see the server log.' }, 502)
  }
}
