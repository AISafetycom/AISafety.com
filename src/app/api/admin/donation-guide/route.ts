/*
  Donation guide editor API.

  GET    /api/admin/donation-guide  → { live, draft, versions, canEdit, me }
  PUT    /api/admin/donation-guide  → body { guide, seenSavedAt }: save the
                                      draft; 409 with the newer draft when
                                      someone else saved since
  DELETE /api/admin/donation-guide  → discard the draft

  GET needs the donationGuide area (canViewDonationGuide); PUT and DELETE
  need its edit grant. Publishing is /api/admin/donation-guide/publish.
*/

import { NextRequest } from 'next/server'
import { canEditDonationGuide } from '@/lib/admin/auth'
import {
  actor,
  ensureGuideAuth,
  json,
  readBody,
} from '@/lib/donation-guide/api'
import { readLiveGuide } from '@/lib/donation-guide/live'
import { guideStore } from '@/lib/donation-guide/store'
import { validateGuide } from '@/lib/donation-guide/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await ensureGuideAuth(false)
  if (auth) return auth
  try {
    const [liveDoc, draft, versions, live, me, canEdit] = await Promise.all([
      guideStore.getLive(),
      guideStore.getDraft(),
      guideStore.listVersions(),
      readLiveGuide(),
      actor(),
      canEditDonationGuide(),
    ])
    return json({
      live: {
        ...live,
        publishedBy: liveDoc?.publishedBy ?? null,
        note: liveDoc?.note ?? null,
      },
      draft,
      versions,
      canEdit,
      me,
    })
  } catch (err) {
    console.error('[donation-guide] read failed:', err)
    return json({ error: 'Could not read the guide; see the server log.' }, 502)
  }
}

export async function PUT(req: NextRequest) {
  const auth = await ensureGuideAuth(true)
  if (auth) return auth
  const body = await readBody(req)
  const v = validateGuide(body.guide)
  if (!v.ok) return json({ error: v.error }, 400)
  const seen = body.seenSavedAt
  if (seen !== null && typeof seen !== 'string') {
    return json({ error: 'seenSavedAt must be a time or null' }, 400)
  }
  try {
    const live = await readLiveGuide()
    const result = await guideStore.saveDraft(
      v.guide,
      await actor(),
      seen ?? null,
      live.version
    )
    if (!result.ok) {
      return json({ error: 'conflict', draft: result.conflict }, 409)
    }
    return json({ draft: result.draft })
  } catch (err) {
    console.error('[donation-guide] draft save failed:', err)
    return json({ error: 'Could not save the draft; see the server log.' }, 502)
  }
}

export async function DELETE() {
  const auth = await ensureGuideAuth(true)
  if (auth) return auth
  try {
    await guideStore.discardDraft()
    return json({ ok: true })
  } catch (err) {
    console.error('[donation-guide] draft discard failed:', err)
    return json(
      { error: 'Could not discard the draft; see the server log.' },
      502
    )
  }
}
