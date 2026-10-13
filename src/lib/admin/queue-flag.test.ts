import { describe, expect, it } from 'vitest'
import {
  flagShown,
  parseFlag,
  reasonsText,
  type FlagUpdate,
} from './queue-flag'

function ok(input: unknown, type: 'Add' | 'Change' = 'Change'): FlagUpdate {
  const r = parseFlag(input, type)
  if ('error' in r) throw new Error(r.error)
  return r.flag
}

function err(input: unknown, type: 'Add' | 'Change' | 'Rule' = 'Change') {
  const r = parseFlag(input, type)
  return 'error' in r ? r.error : null
}

describe('parseFlag', () => {
  it('takes a verdict and reasons, leaving the rest as they are', () => {
    expect(
      ok({
        verdict: 'Unsure',
        reasons: ['The domain expired on 10 October.'],
      })
    ).toEqual({
      verdict: 'Unsure',
      reasons: ['The domain expired on 10 October.'],
      chips: null,
      title: null,
      changes: null,
    })
  })

  it('cleans each line: one line, no bold, no leading bullet', () => {
    const f = ok({
      verdict: 'Dismiss',
      reasons: ['- **Site gone** –\n the domain\tis parked.', '  ', '• Second'],
      chips: ['  Site is parked  '],
      title: ' Bruin AI Safety:  site gone ',
    })
    expect(f.reasons).toEqual(['Site gone – the domain is parked.', 'Second'])
    expect(f.chips).toEqual(['Site is parked'])
    expect(f.title).toBe('Bruin AI Safety: site gone')
  })

  it('checks the verdict against the kind of item', () => {
    expect(err({ verdict: 'Publish', reasons: ['x'] })).toMatch(/not a verdict/)
    expect(ok({ verdict: 'Publish', reasons: ['x'] }, 'Add').verdict).toBe(
      'Publish'
    )
    expect(err({ verdict: 'Fix', reasons: ['x'] }, 'Rule')).toMatch(/rule/)
  })

  it('refuses rather than trims', () => {
    expect(err({ verdict: 'Fix', reasons: [] })).toMatch(/no reasons/)
    expect(err({ verdict: 'Fix', reasons: 'one' })).toMatch(/no reasons/)
    expect(
      err({ verdict: 'Fix', reasons: ['x'], chips: ['a', 'b', 'c', 'd'] })
    ).toMatch(/More than 3/)
    expect(
      err({ verdict: 'Fix', reasons: ['x'], chips: ['y'.repeat(111)] })
    ).toMatch(/over 110/)
  })

  it('treats an empty list of buttons as none', () => {
    expect(ok({ verdict: 'Fix', reasons: ['x'], chips: [] }).chips).toBeNull()
  })

  it('takes a new list of field changes on a change only', () => {
    const f = ok({
      verdict: 'Fix',
      reasons: ['The club is gone.'],
      changes: [
        { field: 'Hide?', from: false, to: true },
        { field: 'URL', to: 'https://x.org' },
      ],
    })
    expect(f.changes).toEqual([
      { field: 'Hide?', from: false, to: true },
      { field: 'URL', from: null, to: 'https://x.org' },
    ])
    expect(
      ok({ verdict: 'Dismiss', reasons: ['x'], changes: [] }).changes
    ).toEqual([])
    expect(
      err({ verdict: 'Publish', reasons: ['x'], changes: [] }, 'Add')
    ).toMatch(/Only a change/)
    expect(
      err({ verdict: 'Fix', reasons: ['x'], changes: [{ to: 'y' }] })
    ).toMatch(/no field name/)
    expect(
      err({
        verdict: 'Fix',
        reasons: ['x'],
        changes: [{ field: 'Logo', to: [{ url: 'u' }] }],
      })
    ).toMatch(/not text/)
  })
})

describe('parseFlag on what the page sends back', () => {
  it('takes its own output unchanged', () => {
    const f = ok({
      verdict: 'Unsure',
      reasons: ['- **Gone** – parked.'],
      chips: ['Wait'],
      title: 'T',
      changes: [{ field: 'Hide?', to: true }],
    })
    expect(ok(JSON.parse(JSON.stringify(f)))).toEqual(f)
    const bare = ok({ verdict: 'Fix', reasons: ['x'] })
    expect(ok(JSON.parse(JSON.stringify(bare)))).toEqual(bare)
  })
})

describe('reasonsText', () => {
  it('writes one dashed line per reason', () => {
    expect(reasonsText(['One.', 'Two.'])).toBe('– One.\n– Two.')
  })
})

describe('flagShown', () => {
  const item = {
    verdict: 'Dismiss' as const,
    reasons: ['Site gone.', 'Nothing to fix.'],
    rejectChips: ['Site is parked'],
    title: 'Bruin AI Safety: site gone',
    changes: [{ field: 'Logo', from: null, to: 'x' }],
  }
  const flag = ok({
    verdict: 'Dismiss',
    reasons: ['Site gone.', 'Nothing to fix.'],
  })

  it('matches on what the flag gives', () => {
    expect(flagShown(item, flag)).toBe(true)
    expect(flagShown(item, { ...flag, chips: ['Site is parked'] })).toBe(true)
    expect(flagShown(item, { ...flag, title: item.title })).toBe(true)
  })

  it('does not once anything it gives differs', () => {
    expect(flagShown({ ...item, verdict: 'Fix' }, flag)).toBe(false)
    expect(flagShown({ ...item, reasons: ['Site gone.'] }, flag)).toBe(false)
    expect(flagShown(item, { ...flag, chips: ['Other'] })).toBe(false)
    expect(flagShown(item, { ...flag, title: 'Other' })).toBe(false)
    expect(flagShown(item, { ...flag, changes: [] })).toBe(false)
  })

  it('reads a reason the way the page reads the row', () => {
    // queue.ts strips one leading "*" off a line; a reason that starts
    // with one still counts as shown.
    expect(
      flagShown(
        { ...item, reasons: ['emphasis* here', 'Nothing to fix.'] },
        {
          ...flag,
          reasons: ['*emphasis* here', 'Nothing to fix.'],
        }
      )
    ).toBe(true)
  })
})
