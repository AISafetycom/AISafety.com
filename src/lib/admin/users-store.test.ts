import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { accessFrom } from './access'
import { createUsersStore, type ManagedUser } from './users-store'

const dir = mkdtempSync(path.join(tmpdir(), 'admin-users-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const user = (email: string): ManagedUser => ({
  email,
  name: null,
  access: accessFrom(['playground', 'analytics']),
  addedAt: '2026-09-04T12:00:00.000Z',
  addedBy: 'Bryce',
})

describe('users store (file backend)', () => {
  const store = createUsersStore({ file: path.join(dir, 'users.json') })

  it('starts empty and round-trips an added user', async () => {
    expect(await store.list()).toEqual([])
    await store.add(user('a@example.com'))
    expect(await store.list()).toEqual([user('a@example.com')])
  })

  it('refuses a duplicate email', async () => {
    await expect(store.add(user('a@example.com'))).rejects.toThrow('duplicate')
    expect(await store.list()).toHaveLength(1)
  })

  it('updates name and access, and reports unknown emails', async () => {
    const updated = await store.update('a@example.com', {
      access: accessFrom([], ['newsletter']),
    })
    expect(updated?.access.newsletter).toBe('edit')
    expect(updated?.access.playground).toBe(false)
    expect(updated?.name).toBeNull()
    expect(await store.update('nobody@example.com', { name: 'x' })).toBeNull()
  })

  it('records sign-ins and picks up the name Google reports', async () => {
    await store.recordSignIn('a@example.com', '2026-09-04T13:00:00.000Z')
    expect(await store.lastSignIns()).toEqual({
      'a@example.com': '2026-09-04T13:00:00.000Z',
    })
    expect((await store.list())[0].name).toBeNull()
    await store.recordSignIn('a@example.com', '2026-09-04T14:00:00.000Z', 'Ada')
    expect((await store.list())[0].name).toBe('Ada')
    // Unknown emails (root admins, or someone since removed) are not added.
    await store.recordSignIn(
      'root@example.com',
      '2026-09-04T15:00:00.000Z',
      'R'
    )
    expect(await store.list()).toHaveLength(1)
  })

  it('removes a user once and only once', async () => {
    expect(await store.remove('a@example.com')).toBe(true)
    expect(await store.remove('a@example.com')).toBe(false)
    expect(await store.list()).toEqual([])
  })

  it('survives a missing or corrupt file', async () => {
    const broken = createUsersStore({
      file: path.join(dir, 'missing', 'users.json'),
    })
    expect(await broken.list()).toEqual([])
    expect(await broken.lastSignIns()).toEqual({})
  })
})

describe('access requests', () => {
  const store = createUsersStore({ file: path.join(dir, 'requests.json') })

  it('records a request once per email and counts repeats', async () => {
    expect(
      await store.recordRequest(
        'x@example.com',
        'X',
        '2026-09-04T10:00:00.000Z'
      )
    ).toBe(true)
    expect(
      await store.recordRequest(
        'x@example.com',
        null,
        '2026-09-04T11:00:00.000Z'
      )
    ).toBe(true)
    const [r] = await store.listRequests()
    expect(r).toEqual({
      email: 'x@example.com',
      name: 'X',
      firstAt: '2026-09-04T10:00:00.000Z',
      lastAt: '2026-09-04T11:00:00.000Z',
      count: 2,
    })
  })

  it('removes a request once and only once', async () => {
    expect(await store.removeRequest('x@example.com')).toBe(true)
    expect(await store.removeRequest('x@example.com')).toBe(false)
    expect(await store.listRequests()).toEqual([])
  })

  it('stops recording new strangers when the list is full', async () => {
    const { MAX_ACCESS_REQUESTS } = await import('./users-store')
    for (let i = 0; i < MAX_ACCESS_REQUESTS; i++) {
      expect(await store.recordRequest(`p${i}@example.com`, null, 't')).toBe(
        true
      )
    }
    expect(
      await store.recordRequest('one-too-many@example.com', null, 't')
    ).toBe(false)
    // …but a repeat from someone already listed is still counted.
    expect(await store.recordRequest('p0@example.com', 'P Zero', 't2')).toBe(
      true
    )
    expect(
      (await store.listRequests()).find(r => r.email === 'p0@example.com')
        ?.count
    ).toBe(2)
  })
})
