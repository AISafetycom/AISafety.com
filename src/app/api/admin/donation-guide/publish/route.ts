/*
  POST /api/admin/donation-guide/publish → body { expectedVersion }

  Makes the stored draft the live guide as the next version, clears the
  draft, refreshes the public page, and notes the publish for the owner's
  digest email when someone else did it. 409 when the live version is not
  the one the editor last saw (someone published in between). Edit grant.
*/

import { NextRequest } from 'next/server'
import { publicOrigin } from '@/lib/admin/origin'
import {
  actor,
  ensureGuideAuth,
  json,
  readBody,
} from '@/lib/donation-guide/api'
import { publishGuide } from '@/lib/donation-guide/publish'
import { guideStore } from '@/lib/donation-guide/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await ensureGuideAuth(true)
  if (auth) return auth
  const body = await readBody(req)
  const expected = body.expectedVersion
  if (!Number.isInteger(expected) || (expected as number) < 0) {
    return json({ error: 'expectedVersion must be a whole number' }, 400)
  }
  try {
    const draft = await guideStore.getDraft()
    if (!draft) return json({ error: 'There is no draft to publish.' }, 400)
    const result = await publishGuide(
      draft.guide,
      await actor(),
      expected as number,
      { origin: publicOrigin(req) }
    )
    if (!result.ok) {
      return json(
        {
          error: 'stale',
          current: result.current
            ? {
                version: result.current.version,
                publishedAt: result.current.publishedAt,
                publishedBy: result.current.publishedBy,
              }
            : null,
        },
        409
      )
    }
    const { guide: _guide, ...meta } = result.live.live
    void _guide
    return json({ live: meta, changes: result.changes })
  } catch (err) {
    console.error('[donation-guide] publish failed:', err)
    return json({ error: 'Could not publish; see the server log.' }, 502)
  }
}
