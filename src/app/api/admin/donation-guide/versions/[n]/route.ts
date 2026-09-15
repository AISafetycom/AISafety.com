/*
  GET  /api/admin/donation-guide/versions/<n>  → the snapshot of version n
       and what restoring it would change against what is live (view grant)
  POST /api/admin/donation-guide/versions/<n>  → body { expectedVersion }:
       restore = publish that snapshot as a new version (edit grant)
*/

import { NextRequest } from 'next/server'
import { publicOrigin } from '@/lib/admin/origin'
import {
  actor,
  ensureGuideAuth,
  json,
  readBody,
} from '@/lib/donation-guide/api'
import { describeChanges } from '@/lib/donation-guide/diff'
import { readLiveGuide } from '@/lib/donation-guide/live'
import { publishGuide } from '@/lib/donation-guide/publish'
import { guideStore } from '@/lib/donation-guide/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ n: string }> }

function versionNumber(raw: string): number | null {
  return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : null
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await ensureGuideAuth(false)
  if (auth) return auth
  const n = versionNumber((await ctx.params).n)
  if (n === null) return json({ error: 'bad version' }, 400)
  try {
    const [snapshot, live] = await Promise.all([
      guideStore.getVersion(n),
      readLiveGuide(),
    ])
    if (!snapshot) return json({ error: 'not found' }, 404)
    return json({
      version: snapshot,
      changesIfRestored: describeChanges(live.guide, snapshot.guide),
      liveVersion: live.version,
    })
  } catch (err) {
    console.error(`[donation-guide] version ${n} read failed:`, err)
    return json(
      { error: 'Could not read that version; see the server log.' },
      502
    )
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await ensureGuideAuth(true)
  if (auth) return auth
  const n = versionNumber((await ctx.params).n)
  if (n === null) return json({ error: 'bad version' }, 400)
  const body = await readBody(req)
  const expected = body.expectedVersion
  if (!Number.isInteger(expected) || (expected as number) < 0) {
    return json({ error: 'expectedVersion must be a whole number' }, 400)
  }
  try {
    const snapshot = await guideStore.getVersion(n)
    if (!snapshot) return json({ error: 'not found' }, 404)
    const result = await publishGuide(
      snapshot.guide,
      await actor(),
      expected as number,
      { note: `Restored version ${n}`, origin: publicOrigin(req) }
    )
    if (!result.ok) {
      return json(
        { error: 'stale', current: result.current?.version ?? 0 },
        409
      )
    }
    const { guide: _guide, ...meta } = result.live.live
    void _guide
    return json({ live: meta, changes: result.changes })
  } catch (err) {
    console.error(`[donation-guide] restore of ${n} failed:`, err)
    return json({ error: 'Could not restore; see the server log.' }, 502)
  }
}
