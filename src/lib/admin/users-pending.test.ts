import { describe, expect, it } from 'vitest'
import { accessFrom, DEFAULT_NEW_ACCESS } from './access'
import {
  decodePending,
  encodePending,
  PENDING_MAX_AGE_MS,
  type PendingState,
  REQUESTS_API,
  USERS_API,
} from './users-pending'

const NOW = 1_800_000_000_000

const approveEmily: PendingState = {
  at: NOW - 5_000,
  action: {
    method: 'POST',
    url: USERS_API,
    body: {
      email: 'emily@example.com',
      access: accessFrom(['newsletter']),
    },
    okText: 'Emily can now sign in.',
    clearForm: false,
  },
  requestPicks: { 'emily@example.com': accessFrom(['newsletter']) },
  form: { email: 'noah@example.com', access: accessFrom(['analytics']) },
}

describe('Admin admin stash across the Google round trip', () => {
  it('comes back exactly as it went', () => {
    expect(decodePending(encodePending(approveEmily), NOW)).toEqual(
      approveEmily
    )
  })

  it('keeps a dismissal and an add-form submission apart', () => {
    const dismiss: PendingState = {
      ...approveEmily,
      action: {
        method: 'DELETE',
        url: REQUESTS_API,
        body: { email: 'emily@example.com' },
        okText: 'Request from Emily dismissed.',
        clearForm: false,
      },
    }
    expect(decodePending(encodePending(dismiss), NOW)?.action).toEqual(
      dismiss.action
    )
    const add: PendingState = {
      ...approveEmily,
      action: { ...approveEmily.action!, clearForm: true },
    }
    expect(decodePending(encodePending(add), NOW)?.action?.clearForm).toBe(true)
  })

  it('is dropped once it is an hour old, with a minute of clock slack', () => {
    const raw = encodePending(approveEmily)
    expect(decodePending(raw, approveEmily.at + PENDING_MAX_AGE_MS)).not.toBe(
      null
    )
    expect(decodePending(raw, approveEmily.at + PENDING_MAX_AGE_MS + 1)).toBe(
      null
    )
    expect(decodePending(raw, approveEmily.at - 30_000)).not.toBe(null)
    expect(decodePending(raw, approveEmily.at - 61_000)).toBe(null)
  })

  it('ignores what is missing or not JSON', () => {
    expect(decodePending(null, NOW)).toBe(null)
    expect(decodePending(undefined, NOW)).toBe(null)
    expect(decodePending('', NOW)).toBe(null)
    expect(decodePending('{not json', NOW)).toBe(null)
    expect(decodePending('[]', NOW)).toBe(null)
    expect(decodePending('{"at":"yesterday"}', NOW)).toBe(null)
  })

  it('only ever sends the Admin admin API again', () => {
    const elsewhere = {
      ...approveEmily,
      action: { ...approveEmily.action, url: '/api/admin/newsletter' },
    }
    expect(decodePending(JSON.stringify(elsewhere), NOW)?.action).toBe(null)
    const badMethod = {
      ...approveEmily,
      action: { ...approveEmily.action, method: 'PUT' },
    }
    expect(decodePending(JSON.stringify(badMethod), NOW)?.action).toBe(null)
    const noBody = {
      ...approveEmily,
      action: { ...approveEmily.action, body: 'email=x' },
    }
    expect(decodePending(JSON.stringify(noBody), NOW)?.action).toBe(null)
  })

  it('drops ticks and form fields it cannot read, keeping the rest', () => {
    const messy = {
      at: NOW,
      action: null,
      requestPicks: {
        'emily@example.com': { newsletter: 'view', bogus: true },
        'noah@example.com': 'all of them',
      },
      form: { email: 42, access: { analytics: 'yes' } },
    }
    const got = decodePending(JSON.stringify(messy), NOW)
    expect(got?.action).toBe(null)
    expect(got?.requestPicks).toEqual({
      'emily@example.com': accessFrom(['newsletter']),
    })
    expect(got?.form).toEqual({ email: '', access: accessFrom([]) })
    expect(decodePending(JSON.stringify({ at: NOW }), NOW)?.form).toEqual({
      email: '',
      access: DEFAULT_NEW_ACCESS,
    })
  })
})
