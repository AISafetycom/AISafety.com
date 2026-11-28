import { describe, expect, it } from 'vitest'
import {
  accessChange,
  accessFrom,
  ALL_ACCESS,
  canEdit,
  canOpen,
  canWorkQueue,
  describeAccess,
  parseAccess,
  queueModeOf,
  QUEUE_CHECKS,
  type AccessFlags,
} from './access'
import { ROOT_ADMINS } from './users'

// The Queue's "Bryce checks first" grant ('suggest', queue-suggest.ts): what
// it opens, and that anything unknown gives less, never more.

const withQueue = (queue: unknown): AccessFlags =>
  parseAccess({ analytics: 'view', queue }) as AccessFlags

describe("the Queue's 'suggest' grant", () => {
  it('reads as a third Queue level that opens the tab but is not edit', () => {
    const a = withQueue('suggest')
    expect(a.queue).toBe('suggest')
    expect(canOpen(a, 'queue')).toBe(true)
    // Every existing check for the Queue's writes refuses it.
    expect(canEdit(a, 'queue')).toBe(false)
    expect(queueModeOf(a)).toBe('suggest')
    expect(canWorkQueue(a)).toBe(true)
  })

  it('tells the four Queue modes apart', () => {
    expect(queueModeOf(withQueue('edit'))).toBe('edit')
    expect(queueModeOf(withQueue('view'))).toBe('view')
    expect(queueModeOf(withQueue(false))).toBeNull()
    expect(canWorkQueue(withQueue('edit'))).toBe(true)
    expect(canWorkQueue(withQueue('view'))).toBe(false)
    expect(canWorkQueue(withQueue(false))).toBe(false)
  })

  it('fails closed: an unknown value is no tab at all, never edit', () => {
    // A later "checks after" value, read by code that does not know it yet.
    for (const v of ['after', 'SUGGEST', 'suggest ', 'checks-first', 1, {}]) {
      const a = withQueue(v)
      expect(a.queue).toBe(false)
      expect(canOpen(a, 'queue')).toBe(false)
      expect(canWorkQueue(a)).toBe(false)
    }
  })

  it('is the Queue’s alone: on any other tab it gives nothing', () => {
    const a = parseAccess({
      mapEditor: 'suggest',
      newsletter: 'suggest',
      donationGuide: 'suggest',
      manageUsers: 'suggest',
    }) as AccessFlags
    expect(a.mapEditor).toBe(false)
    expect(a.newsletter).toBe(false)
    expect(a.donationGuide).toBe(false)
    expect(a.manageUsers).toBe(false)
  })

  it('is never what root admins or the flag builders give', () => {
    expect(ALL_ACCESS.queue).toBe('edit')
    for (const root of ROOT_ADMINS) expect(root.access.queue).toBe('edit')
    expect(accessFrom(['queue'], ['queue']).queue).toBe('edit')
  })

  it('leaves a place for the later check-after grant', () => {
    expect([...QUEUE_CHECKS]).toEqual(['suggest'])
  })

  it('is described on the person’s card and in the log', () => {
    expect(describeAccess(withQueue('suggest'))).toEqual([
      'Queue (can edit, Bryce checks first)',
      'Analytics',
    ])
    expect(accessChange(withQueue('edit'), withQueue('suggest'))).toBe(
      'queue:edit→suggest'
    )
    expect(accessChange(withQueue('suggest'), withQueue(false))).toBe(
      'queue:suggest→none'
    )
    expect(accessChange(withQueue('view'), withQueue('view'))).toBe('no change')
    expect(accessChange(null, withQueue('suggest'))).toBe(
      'access=queue:suggest,analytics:view'
    )
  })
})
