import { describe, expect, it } from 'vitest'
import { createGuideStore, DIGEST_GAP_MS, MAX_VERSIONS } from './store'
import { SEED_GUIDE } from './seed'
import type { Guide } from './types'

const bryce = { name: 'Bryce', email: 'bryce@example.com' }
const plex = { name: 'plex', email: 'plex@example.com' }

function edited(lead: string): Guide {
  const g = JSON.parse(JSON.stringify(SEED_GUIDE)) as Guide
  g.tabs[0].lead = lead
  return g
}

describe('drafts', () => {
  it('saves, reports, and refuses a save that has not seen the newer draft', async () => {
    const s = createGuideStore({ memory: true })
    expect(await s.getDraft()).toBeNull()

    const first = await s.saveDraft(
      edited('one'),
      plex,
      null,
      0,
      '2026-09-15T10:00:00.000Z'
    )
    expect(first.ok).toBe(true)
    const draft = await s.getDraft()
    expect(draft?.savedBy).toEqual(plex)
    expect(draft?.guide.tabs[0].lead).toBe('one')

    // Bryce loaded before plex saved: his save is refused with plex's draft.
    const stale = await s.saveDraft(edited('two'), bryce, null, 0)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.conflict.savedBy).toEqual(plex)
    expect((await s.getDraft())?.guide.tabs[0].lead).toBe('one')

    // Having seen it, he may overwrite.
    const seen = await s.saveDraft(
      edited('two'),
      bryce,
      '2026-09-15T10:00:00.000Z',
      0
    )
    expect(seen.ok).toBe(true)
    expect((await s.getDraft())?.guide.tabs[0].lead).toBe('two')

    await s.discardDraft()
    expect(await s.getDraft()).toBeNull()
  })
})

describe('publish and history', () => {
  it('numbers versions, clears the draft, keeps snapshots and refuses stale publishes', async () => {
    const s = createGuideStore({ memory: true })
    expect(await s.getLive()).toBeNull()
    await s.saveDraft(edited('v1'), plex, null, 0)

    const p1 = await s.publish(edited('v1'), plex, 0, {
      now: '2026-09-15T11:00:00.000Z',
    })
    expect(p1.ok).toBe(true)
    if (p1.ok) {
      expect(p1.live.version).toBe(1)
      expect(p1.live.publishedBy).toEqual(plex)
    }
    expect(await s.getDraft()).toBeNull()
    expect((await s.getLive())?.guide.tabs[0].lead).toBe('v1')

    // Someone who still thinks the seed is live may not publish over v1.
    const stale = await s.publish(edited('x'), bryce, 0)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.current?.version).toBe(1)

    const p2 = await s.publish(edited('v2'), bryce, 1, {
      note: 'Restored version 1',
    })
    expect(p2.ok).toBe(true)
    const list = await s.listVersions()
    expect(list.map(v => v.version)).toEqual([2, 1])
    expect(list[0].note).toBe('Restored version 1')
    expect(list[0].publishedBy.name).toBe('Bryce')
    expect((await s.getVersion(1))?.guide.tabs[0].lead).toBe('v1')
    expect((await s.getVersion(2))?.guide.tabs[0].lead).toBe('v2')
    expect(await s.getVersion(3)).toBeNull()
    expect(await s.getVersion(0)).toBeNull()
  })

  it(`keeps the last ${MAX_VERSIONS} snapshots`, async () => {
    const s = createGuideStore({ memory: true })
    for (let i = 0; i < MAX_VERSIONS + 3; i++) {
      const r = await s.publish(edited(`v${i + 1}`), plex, i)
      expect(r.ok).toBe(true)
    }
    const list = await s.listVersions()
    expect(list).toHaveLength(MAX_VERSIONS)
    expect(list[0].version).toBe(MAX_VERSIONS + 3)
    expect(list[list.length - 1].version).toBe(4)
    expect(await s.getVersion(3)).toBeNull()
    expect(await s.getVersion(4)).not.toBeNull()
  })
})

describe('digest', () => {
  const entry = (version: number, at: string) => ({
    version,
    by: plex,
    at,
    changes: [`Changed: tab ${version}`],
  })

  it('sends the first publish at once, batches the next within a day, sends the sweep', async () => {
    const s = createGuideStore({ memory: true })
    expect(await s.takeDigestIfDue('2026-09-15T09:00:00.000Z')).toEqual([])

    await s.queueDigest(entry(1, '2026-09-15T09:00:00.000Z'))
    const first = await s.takeDigestIfDue('2026-09-15T09:00:00.000Z')
    expect(first.map(e => e.version)).toEqual([1])

    // Two more publishes within the day wait.
    await s.queueDigest(entry(2, '2026-09-15T12:00:00.000Z'))
    expect(await s.takeDigestIfDue('2026-09-15T12:00:00.000Z')).toEqual([])
    await s.queueDigest(entry(3, '2026-09-15T20:00:00.000Z'))
    expect(await s.takeDigestIfDue('2026-09-15T20:00:00.000Z')).toEqual([])

    // The daily sweep a day later sends both in one go.
    const later = new Date(
      Date.parse('2026-09-15T09:00:00.000Z') + DIGEST_GAP_MS
    ).toISOString()
    const swept = await s.takeDigestIfDue(later)
    expect(swept.map(e => e.version)).toEqual([2, 3])
    expect(await s.takeDigestIfDue(later)).toEqual([])
  })
})

describe('file backend', () => {
  it('round-trips through a JSON file', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const dir = mkdtempSync(path.join(tmpdir(), 'guide-store-'))
    const s = createGuideStore({ file: path.join(dir, 'guide.json') })
    await s.saveDraft(edited('file'), plex, null, 0)
    const again = createGuideStore({ file: path.join(dir, 'guide.json') })
    expect((await again.getDraft())?.guide.tabs[0].lead).toBe('file')
    expect(await again.getLive()).toBeNull()
  })
})
