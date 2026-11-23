import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FIELD,
  buildPositionFields,
  buildScaleFields,
  compareEditorRecords,
  isScaleBody,
  rowToEditorRecord,
  samePosition,
  SCALE_OPTIONS,
  sortEditorRecords,
  validateMoveBody,
  validateScaleBody,
  ValidationError,
  type EditorRecord,
} from './map-editor-core'

// ─── Field IDs must match the public map's data layer ──────────────────────

describe('FIELD ids mirror src/lib/data/map.ts', () => {
  const mapTs = readFileSync(join(process.cwd(), 'src/lib/data/map.ts'), 'utf8')
  it.each(Object.entries(FIELD))('%s → %s', (name, id) => {
    expect(mapTs).toContain(`${name}: '${id}',`)
  })
  it('table id', () => {
    expect(mapTs).toContain("const TABLE_ID = 'tblvzbGL9q9dOO9Nc'")
  })
})

// ─── validateMoveBody ──────────────────────────────────────────────────────

const ID = 'recG0nDieDK49nRr2'

describe('validateMoveBody', () => {
  it('accepts a minimal move and rounds to 0.1', () => {
    expect(validateMoveBody({ id: ID, x: 22.24, y: 17.16 })).toEqual({
      id: ID,
      x: 22.2,
      y: 17.2,
    })
  })
  it('accepts expected with numbers or nulls', () => {
    expect(
      validateMoveBody({ id: ID, x: 1, y: 2, expected: { x: null, y: null } })
    ).toEqual({ id: ID, x: 1, y: 2, expected: { x: null, y: null } })
    expect(
      validateMoveBody({ id: ID, x: 1, y: 2, expected: { x: 3.3, y: 4 } })
        .expected
    ).toEqual({ x: 3.3, y: 4 })
  })
  it.each([
    [null, 'body must be a JSON object'],
    [[], 'body must be a JSON object'],
    ['{}', 'body must be a JSON object'],
    [{ x: 1, y: 2 }, 'id must be an Airtable record id'],
    [{ id: 'foo', x: 1, y: 2 }, 'id must be an Airtable record id'],
    [{ id: 'rec123', x: 1, y: 2 }, 'id must be an Airtable record id'],
    [{ id: ID, x: '12', y: 2 }, 'x must be a finite number'],
    [{ id: ID, x: NaN, y: 2 }, 'x must be a finite number'],
    [{ id: ID, x: 1, y: Infinity }, 'y must be a finite number'],
    [{ id: ID, x: 60.1, y: 2 }, 'x/y outside the map'],
    [{ id: ID, x: -0.06, y: 2 }, 'x/y outside the map'],
    [{ id: ID, x: 1, y: 32.75 }, 'x/y outside the map'],
    [{ id: ID, x: 1, y: 2, fields: {} }, 'unexpected key: fields'],
    [{ id: ID, x: 1, y: 2, publish: true }, 'unexpected key: publish'],
    [
      { id: ID, x: 1, y: 2, [FIELD.hide]: true },
      `unexpected key: ${FIELD.hide}`,
    ],
    [{ id: ID, x: 1, y: 2, typecast: true }, 'unexpected key: typecast'],
    [{ id: ID, x: 1, y: 2, expected: null }, 'expected must be an object'],
    [
      { id: ID, x: 1, y: 2, expected: { x: 1, y: 2, scale: 'Large' } },
      'unexpected key in expected: scale',
    ],
    [
      { id: ID, x: 1, y: 2, expected: { x: '1', y: 2 } },
      'expected.x/y must be numbers or null',
    ],
  ])('rejects %j', (body, message) => {
    expect(() => validateMoveBody(body)).toThrow(ValidationError)
    expect(() => validateMoveBody(body)).toThrow(message)
  })
  it('accepts the exact edges', () => {
    expect(validateMoveBody({ id: ID, x: 0, y: 0 })).toEqual({
      id: ID,
      x: 0,
      y: 0,
    })
    expect(validateMoveBody({ id: ID, x: 60, y: 32.7 })).toEqual({
      id: ID,
      x: 60,
      y: 32.7,
    })
    // -0.04 rounds to 0, which is inside the map.
    expect(validateMoveBody({ id: ID, x: -0.04, y: 1 }).x).toBe(0)
  })
})

describe('buildPositionFields', () => {
  it('writes exactly x and y by field id', () => {
    const fields = buildPositionFields(22.2, 17.2)
    expect(Object.keys(fields).sort()).toEqual([FIELD.x, FIELD.y].sort())
    expect(fields[FIELD.x]).toBe(22.2)
    expect(fields[FIELD.y]).toBe(17.2)
  })
})

// ─── Scale change bodies ───────────────────────────────────────────────────

describe('isScaleBody', () => {
  it('tells a Scale change from a move by the scale key', () => {
    expect(isScaleBody({ id: ID, scale: 'Large' })).toBe(true)
    expect(isScaleBody({ id: ID, x: 1, y: 2 })).toBe(false)
    expect(isScaleBody(null)).toBe(false)
    expect(isScaleBody([])).toBe(false)
    expect(isScaleBody('scale')).toBe(false)
  })
})

describe('validateScaleBody', () => {
  it('accepts each Scale option, with or without expected', () => {
    for (const s of SCALE_OPTIONS) {
      expect(validateScaleBody({ id: ID, scale: s })).toEqual({
        id: ID,
        scale: s,
      })
    }
    expect(
      validateScaleBody({ id: ID, scale: 'Small', expected: 'Large' })
    ).toEqual({ id: ID, scale: 'Small', expected: 'Large' })
    expect(
      validateScaleBody({ id: ID, scale: 'Small', expected: null })
    ).toEqual({ id: ID, scale: 'Small', expected: null })
  })
  it.each([
    [null, 'body must be a JSON object'],
    [{ scale: 'Large' }, 'id must be an Airtable record id'],
    [{ id: 'foo', scale: 'Large' }, 'id must be an Airtable record id'],
    [{ id: ID, scale: 'Huge' }, 'scale must be one of Small, Medium, Large'],
    [{ id: ID, scale: 'large' }, 'scale must be one of Small, Medium, Large'],
    [{ id: ID, scale: null }, 'scale must be one of Small, Medium, Large'],
    [{ id: ID, scale: '' }, 'scale must be one of Small, Medium, Large'],
    // A Scale change can never carry a move, a publish flag or raw fields.
    [{ id: ID, scale: 'Large', x: 1, y: 2 }, 'unexpected key: x'],
    [{ id: ID, scale: 'Large', publish: true }, 'unexpected key: publish'],
    [{ id: ID, scale: 'Large', fields: {} }, 'unexpected key: fields'],
    [
      { id: ID, scale: 'Large', [FIELD.hide]: true },
      `unexpected key: ${FIELD.hide}`,
    ],
    [{ id: ID, scale: 'Large', typecast: true }, 'unexpected key: typecast'],
    [
      { id: ID, scale: 'Large', expected: { scale: 'Small' } },
      'expected must be a string or null',
    ],
    [
      { id: ID, scale: 'Large', expected: 1 },
      'expected must be a string or null',
    ],
  ])('rejects %j', (body, message) => {
    expect(() => validateScaleBody(body)).toThrow(ValidationError)
    expect(() => validateScaleBody(body)).toThrow(message)
  })
})

describe('buildScaleFields', () => {
  it('writes exactly Scale by field id', () => {
    const fields = buildScaleFields('Large')
    expect(Object.keys(fields)).toEqual([FIELD.scale])
    expect(fields[FIELD.scale]).toBe('Large')
  })
  it('refuses anything that is not a Scale option', () => {
    // @ts-expect-error – guarding the runtime path too
    expect(() => buildScaleFields('Huge')).toThrow(ValidationError)
  })
})

describe('samePosition', () => {
  it('compares at Airtable precision and treats null strictly', () => {
    expect(samePosition({ x: 1.04, y: 2 }, { x: 1, y: 2 })).toBe(true)
    expect(samePosition({ x: 1.06, y: 2 }, { x: 1, y: 2 })).toBe(false)
    expect(samePosition({ x: null, y: null }, { x: null, y: null })).toBe(true)
    expect(samePosition({ x: null, y: 2 }, { x: 0, y: 2 })).toBe(false)
  })
})

// ─── rowToEditorRecord + ordering ──────────────────────────────────────────

function row(fields: Record<string, unknown>, id = ID) {
  return { id, fields }
}

describe('rowToEditorRecord', () => {
  it('maps fields by id with the same fallbacks as /map', () => {
    const r = rowToEditorRecord(
      row({
        [FIELD.longName]: 'Center on Long-Term Risk: Fellowship',
        [FIELD.longNameForCards]: 'Center on Long-Term Risk (CLR): Fellowship',
        [FIELD.shortName]: 'CLR Fellowship',
        [FIELD.description]: 'desc',
        [FIELD.categoryText]: 'Training and education, Governance',
        [FIELD.status]: 'Active',
        [FIELD.logoForMap]: [{ url: 'https://x/logo.png' }],
        [FIELD.x]: 22.2,
        [FIELD.y]: 17.2,
        [FIELD.scale]: 'Medium',
        [FIELD.publish]: true,
      })
    )
    expect(r.title).toBe('Center on Long-Term Risk (CLR): Fellowship')
    expect(r.tooltipTitle).toBe('Center on Long-Term Risk: Fellowship')
    expect(r.labelName).toBe('CLR Fellowship')
    expect(r.area).toBe('Training Town')
    expect(r.mapLogo).toBe('https://x/logo.png')
    expect(r.x).toBe(22.2)
    expect(r.published).toBe(true)
    expect(r.isMagic).toBe(false)
  })
  it('handles sparse drafts instead of dropping them', () => {
    const r = rowToEditorRecord(
      row({ [FIELD.category]: ['Governance'] }, 'recAAAAAAAAAAAAAA')
    )
    expect(r.title).toBe('Untitled (recAAAAAAAAAAAAAA)')
    expect(r.labelName).toBe(r.title)
    expect(r.category).toBe('Governance')
    expect(r.area).toBe('Governance Grove')
    expect(r.x).toBeNull()
    expect(r.published).toBe(false)
    expect(r.status).toBe('Active')
    expect(r.description).toBeNull()
  })
  it('puts a shut-down org in the Graveyard whatever its categories', () => {
    const r = rowToEditorRecord(
      row({
        [FIELD.categoryText]: 'Funding, Resource',
        [FIELD.status]: 'Inactive',
      })
    )
    expect(r.category).toBe('Funding, Resource')
    expect(r.area).toBe('Gone Graveyard')
  })
  it('flags furniture rows and unknown areas', () => {
    const r = rowToEditorRecord(
      row({
        [FIELD.longNameForCards]: 'Last updated',
        [FIELD.categoryText]: 'Nope',
      })
    )
    expect(r.isMagic).toBe(true)
    expect(r.area).toBeNull()
  })
})

function rec(over: Partial<EditorRecord>): EditorRecord {
  return {
    id: 'rec',
    title: 'T',
    tooltipTitle: 'T',
    shortName: null,
    labelName: 'T',
    description: null,
    category: '',
    area: null,
    status: 'Active',
    scale: null,
    mapLogo: null,
    x: null,
    y: null,
    published: true,
    isMagic: false,
    createdTime: null,
    order: 0,
    ...over,
  }
}

describe('ordering (same as /map)', () => {
  it('magic last, Active first, Large before Small, then category, then title', () => {
    const magic = rec({
      id: 'm',
      title: 'Merch',
      isMagic: true,
      scale: 'Large',
    })
    const inactive = rec({
      id: 'i',
      title: 'A',
      status: 'Inactive',
      scale: 'Large',
    })
    const small = rec({
      id: 's',
      title: 'A',
      scale: 'Small',
      category: 'Advocacy',
    })
    const largeGov = rec({
      id: 'lg',
      title: 'Z',
      scale: 'Large',
      category: 'Governance',
    })
    const largeAdv = rec({
      id: 'la',
      title: 'B',
      scale: 'Large',
      category: 'Advocacy',
    })
    const largeAdv2 = rec({
      id: 'la2',
      title: 'A',
      scale: 'Large',
      category: 'Advocacy',
    })
    const sorted = sortEditorRecords([
      magic,
      inactive,
      small,
      largeGov,
      largeAdv,
      largeAdv2,
    ])
    expect(sorted.map(r => r.id)).toEqual(['la2', 'la', 'lg', 's', 'i', 'm'])
    expect(sorted.map(r => r.order)).toEqual([0, 1, 2, 3, 4, 5])
    expect(compareEditorRecords(largeAdv, largeAdv2)).toBeGreaterThan(0)
  })
})
