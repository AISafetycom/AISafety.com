import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The local Queue demo's stand-in for Airtable: it must never load with a
// real token, must answer every Airtable request itself, and must let
// every other request through untouched.

let dir
let passed

beforeEach(() => {
  vi.resetModules()
  dir = mkdtempSync(path.join(tmpdir(), 'queue-demo-'))
  passed = []
  vi.stubGlobal('fetch', async url => {
    passed.push(String(url))
    return new Response('through')
  })
  vi.stubEnv('QUEUE_DEMO_STATE', path.join(dir, 'state.json'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

describe('the demo Airtable', () => {
  it('refuses to load unless the token is the demo placeholder', async () => {
    vi.stubEnv('AIRTABLE_TOKEN', 'patREALLOOKINGTOKEN')
    await expect(import('./fake-airtable.mjs')).rejects.toThrow(
      'refusing to start'
    )
  })

  it('answers Airtable from its file and lets anything else through', async () => {
    vi.stubEnv('AIRTABLE_TOKEN', 'demo-placeholder-token')
    await import('./fake-airtable.mjs')
    const base = 'https://api.airtable.com/v0/appQUEUEDEMO00000'
    const list = await (
      await fetch(`${base}/tblonlKwIFJ7Aa8QN?filterByFormula=OR(1)`)
    ).json()
    expect(list.records.map(r => r.id)).toEqual([
      'recDEMOQUEUE00001',
      'recDEMOQUEUE00002',
      'recDEMOQUEUE00003',
      'recDEMOQUEUE00004',
      'recDEMOQUEUE00005',
      'recDEMOQUEUE00006',
    ])
    const res = await fetch(`${base}/tblonlKwIFJ7Aa8QN/recDEMOQUEUE00001`, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: {
          fldWFnmC0u06GNC6B: '{"kind":"ask"}',
          fld8lCAVyjDEVZ8VV: null,
        },
      }),
    })
    expect(res.status).toBe(200)
    const saved = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8'))
    const fields = saved.queue.recDEMOQUEUE00001.fields
    expect(fields.fldWFnmC0u06GNC6B).toBe('{"kind":"ask"}')
    expect('fld8lCAVyjDEVZ8VV' in fields).toBe(false)
    expect(
      (await fetch(`${base}/tblXbN9swwldwq8f7/recNOTINTHEDEMO01`)).status
    ).toBe(404)
    // Nothing above left the process; this does.
    await fetch('https://example.org/elsewhere')
    expect(passed).toEqual(['https://example.org/elsewhere'])
  })
})
