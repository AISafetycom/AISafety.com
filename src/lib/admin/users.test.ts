import { describe, expect, it } from 'vitest'
import {
  ACCESS_AREAS,
  ACCESS_KEYS,
  accessFrom,
  ALL_ACCESS,
  canEdit,
  canOpen,
  DEFAULT_NEW_ACCESS,
  describeAccess,
  hasAnyAccess,
  isEditableArea,
  NO_ACCESS,
  parseAccess,
} from './access'
import {
  findAdminUser,
  isRootAdmin,
  ROOT_ADMINS,
  validateUserInput,
} from './users'
import { adminHomeHref, adminTabs } from '@/app/admin/nav'

describe('access flags', () => {
  it('lists every area once with a tab href', () => {
    expect(new Set(ACCESS_KEYS).size).toBe(ACCESS_KEYS.length)
    for (const a of ACCESS_AREAS) expect(a.href).toMatch(/^\/admin\//)
  })

  it('builds grants from keys: view, and edit only where the tab writes', () => {
    const a = accessFrom(['analytics', 'queue'], ['newsletter'])
    expect(a.analytics).toBe('view')
    expect(a.queue).toBe('view')
    expect(a.newsletter).toBe('edit')
    expect(a.mapEditor).toBe(false)
    expect(canOpen(a, 'newsletter') && canEdit(a, 'newsletter')).toBe(true)
    expect(canOpen(a, 'queue') && !canEdit(a, 'queue')).toBe(true)
    // A view-only area can't be raised to edit.
    expect(accessFrom([], ['analytics']).analytics).toBe('view')
    expect(isEditableArea('analytics')).toBe(false)
    expect(isEditableArea('queue')).toBe(true)
    expect(hasAnyAccess(ALL_ACCESS)).toBe(true)
    expect(hasAnyAccess(NO_ACCESS)).toBe(false)
  })

  it('gives root admins the top grant everywhere', () => {
    for (const area of ACCESS_AREAS) {
      expect(ALL_ACCESS[area.key]).toBe(area.edit ? 'edit' : 'view')
    }
  })

  it('starts a new person with nothing ticked', () => {
    expect(hasAnyAccess(DEFAULT_NEW_ACCESS)).toBe(false)
  })

  it('shows the same tab whether a session may edit or only look', () => {
    const viewer = adminTabs(accessFrom(['newsletter']))
    const editor = adminTabs(accessFrom([], ['newsletter']))
    expect(viewer).toEqual([
      { href: '/admin/newsletter', label: 'Newsletters', group: 'newsletter' },
    ])
    expect(editor).toEqual(viewer)
    expect(adminHomeHref(accessFrom(['newsletter']))).toBe('/admin/newsletter')
    expect(adminHomeHref(NO_ACCESS)).toBe('/admin/login')
  })

  it('parses untrusted input strictly', () => {
    expect(
      parseAccess({
        analytics: 'view',
        queue: 'edit',
        bogus: true,
        newsletter: 'yes',
        mapEditor: 'EDIT',
      })
    ).toEqual(accessFrom(['analytics'], ['queue']))
    // 'edit' on a view-only area is clamped to view.
    expect(parseAccess({ analytics: 'edit' })).toEqual(
      accessFrom(['analytics'])
    )
    expect(parseAccess(null)).toBeNull()
    expect(parseAccess('x')).toBeNull()
  })

  it('reads the booleans stored before grants had levels', () => {
    // A tick used to mean everything the tab could do.
    expect(parseAccess({ queue: true, analytics: true })).toEqual(
      accessFrom(['analytics'], ['queue'])
    )
    // Newsletters was two booleans: send, or look only.
    expect(parseAccess({ newsletterPreview: true })).toEqual(
      accessFrom(['newsletter'])
    )
    expect(parseAccess({ newsletter: true, newsletterPreview: true })).toEqual(
      accessFrom([], ['newsletter'])
    )
  })

  it('describes grants in tab order', () => {
    expect(
      describeAccess(accessFrom(['analytics', 'queue'], ['newsletter']))
    ).toEqual(['Queue', 'Analytics', 'Newsletters (can edit)'])
  })
})

describe('ROOT_ADMINS / findAdminUser', () => {
  it('lists every root email once, lower-case, with full access', () => {
    const emails = ROOT_ADMINS.map(u => u.email)
    expect(new Set(emails).size).toBe(emails.length)
    for (const u of ROOT_ADMINS) {
      expect(u.email).toBe(u.email.trim().toLowerCase())
      expect(u.access).toEqual(ALL_ACCESS)
    }
  })

  it('finds root admins case-insensitively without the store', async () => {
    const first = ROOT_ADMINS[0]
    expect((await findAdminUser(first.email.toUpperCase()))?.email).toBe(
      first.email
    )
    expect(isRootAdmin(` ${first.email} `)).toBe(true)
  })

  it('returns null for anyone unknown', async () => {
    expect(await findAdminUser('nobody@example.invalid')).toBeNull()
    expect(await findAdminUser('')).toBeNull()
  })
})

describe('validateUserInput', () => {
  it('accepts an email plus tabs and lower-cases the email', () => {
    expect(
      validateUserInput({
        email: ' Someone@Example.com ',
        access: { analytics: true },
      })
    ).toEqual({
      ok: true,
      value: {
        email: 'someone@example.com',
        access: accessFrom(['analytics']),
      },
    })
  })

  it('rejects bad emails, no tabs and root emails', () => {
    const bad = [
      { email: 'not-an-email', access: { analytics: true } },
      { email: 'a@b.c', access: {} },
      { email: 'a@b.c', access: 'all' },
      { email: ROOT_ADMINS[0].email, access: { analytics: true } },
      null,
      'string',
    ]
    for (const input of bad) expect(validateUserInput(input).ok).toBe(false)
  })
})
