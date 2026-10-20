import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A stand-in for the base: records by id, each in one table, with only its
 *  filled fields (as Airtable answers with returnFieldsByFieldId). */
interface FakeRecord {
  table: string
  fields: Record<string, unknown>
  comments: string[]
}
const base = new Map<string, FakeRecord>()
const writes: string[] = []
let refuseWrites: number | null = null

vi.mock('@/lib/admin/airtable', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/admin/airtable')>()),
  airtableRequest: async (path: string, init: RequestInit = {}) => {
    const [table, id, rest] = path.split('?')[0].split('/')
    const record = base.get(id)
    const method = init.method ?? 'GET'
    if (method === 'GET') {
      // Airtable reads a record through ANY table of the base.
      return record
        ? Response.json({ id, fields: record.fields })
        : new Response('not found', { status: 404 })
    }
    writes.push(`${method} ${path}`)
    if (!record || record.table !== table)
      return new Response('wrong table', { status: 422 })
    if (refuseWrites) return new Response('refused', { status: refuseWrites })
    const body = JSON.parse(String(init.body)) as {
      fields?: Record<string, unknown>
      text?: string
    }
    if (rest === 'comments') record.comments.push(body.text ?? '')
    else
      for (const [k, v] of Object.entries(body.fields ?? {}))
        if (v === false || v === '') delete record.fields[k]
        else record.fields[k] = v
    return Response.json({ id })
  },
}))

const { untickNewsletter, updateListingDescription } =
  await import('./newsletter-listing')

const EVENTS = 'tblXbN9swwldwq8f7'
const TRAINING = 'tbli1YSCpIuNY2DvL'
const FUNDING = 'tblzMTLDZWZKqTxrq'
const MAP = 'tblvzbGL9q9dOO9Nc'

function add(id: string, table: string, fields: Record<string, unknown>) {
  base.set(id, { table, fields, comments: [] })
}

beforeEach(() => {
  base.clear()
  writes.length = 0
  refuseWrites = null
  add('recEventTicked001', EVENTS, {
    fldHDwWtiBFYN9fgf: 'Spillover Prediction Challenge',
    fldRdDbcWhCsoLrQj: true,
  })
  add('recTrainingClear1', TRAINING, { fldNq08J2QqQ8SreD: 'A course' })
  add('recTrainingTick01', TRAINING, {
    fldNq08J2QqQ8SreD: 'Another course',
    fldirVkgSCVk726Di: true,
  })
  add('recFundingRecord1', FUNDING, { fldsFpgVduYnNuYkN: 'A fund' })
  add('recMapOrganizat01', MAP, { fldIL5rLAwlbvdhtg: 'CBT Lab' })
})

describe('untickNewsletter (a card removed from a draft)', () => {
  it('clears the tick of an Events listing and says so on the record', async () => {
    expect(await untickNewsletter('recEventTicked001')).toEqual({
      status: 'unticked',
    })
    const record = base.get('recEventTicked001')!
    expect(record.fields.fldRdDbcWhCsoLrQj).toBeUndefined()
    expect(record.comments).toEqual([
      'Newsletter unticked: its card was removed from a newsletter draft',
    ])
    expect(writes).toEqual([
      `PATCH ${EVENTS}/recEventTicked001`,
      `POST ${EVENTS}/recEventTicked001/comments`,
    ])
  })
  it('writes through the listing’s own table (a Training one here)', async () => {
    expect(await untickNewsletter('recTrainingTick01')).toEqual({
      status: 'unticked',
    })
    expect(writes[0]).toBe(`PATCH ${TRAINING}/recTrainingTick01`)
  })
  it('leaves a listing alone when there is nothing to clear', async () => {
    for (const id of [
      'recTrainingClear1', // not ticked
      'recFundingRecord1', // Funding has no tick
      'recMapOrganizat01', // a callout card's /map organization
      'u1a2b3c4d5e', // a card with no record id
    ])
      expect((await untickNewsletter(id)).status).toBe('none')
    expect(writes).toEqual([])
  })
  it('reports a listing it can’t find or can’t write', async () => {
    expect(await untickNewsletter('recMissingRecord1')).toEqual({
      status: 'failed',
      reason: 'the listing wasn’t found in Airtable',
    })
    refuseWrites = 429
    const refused = await untickNewsletter('recEventTicked001')
    expect(refused.status).toBe('failed')
    expect(base.get('recEventTicked001')!.fields.fldRdDbcWhCsoLrQj).toBe(true)
  })
})

describe('updateListingDescription (still the same after the shared lookup)', () => {
  it('writes the Description through the listing’s own table', async () => {
    expect(
      await updateListingDescription('recTrainingClear1', 'New text')
    ).toEqual({ ok: true, table: TRAINING })
    expect(base.get('recTrainingClear1')!.fields.fldIRngvk0vjSwjh8).toBe(
      'New text'
    )
    expect(base.get('recTrainingClear1')!.comments).toEqual([
      'Description updated from the newsletter editor',
    ])
  })
  it('refuses cards that aren’t a newsletter listing', async () => {
    expect(await updateListingDescription('u1a2b3c4d5e', 'x')).toEqual({
      ok: false,
      reason: 'this card isn’t linked to a listing',
    })
    expect(await updateListingDescription('recMapOrganizat01', 'x')).toEqual({
      ok: false,
      reason: 'the listing isn’t in the Events, Training or Funding table',
    })
    expect(writes).toEqual([])
  })
})
