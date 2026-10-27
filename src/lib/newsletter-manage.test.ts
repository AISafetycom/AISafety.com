import { describe, expect, it } from 'vitest'
import {
  NEWSLETTER_LIST,
  changesFor,
  contactOfKey,
  manageKey,
  maskEmail,
  parsePicks,
  parseWanted,
  subscriptionsFrom,
} from './newsletter-manage'
import { hashHasKeyParam, keyFromHash } from './newsletter-manage-link'

// The newsletters page's pure parts: the settings key in the email link,
// what the page shows of the address, and turning ticks into list changes.

const AC_KEY = 'test-api-key'

describe('manageKey / contactOfKey', () => {
  it('matches the key ~/Newsletter/manage_keys.py makes for the same contact', () => {
    // The same pair is pinned in ~/Newsletter/tests/test_manage_keys.py:
    // ActiveCampaign's field holds what Python wrote, the site checks it.
    expect(manageKey('1234', AC_KEY)).toBe('1234.LvdLTOzS_5tTZ2s9yKkyf4')
    expect(manageKey('6', AC_KEY)).toBe('6.5xwkbaZu5J4cRYBSK9iwuw')
  })

  it('reads the contact back out of a genuine key', () => {
    expect(contactOfKey(manageKey('3034', AC_KEY), AC_KEY)).toBe('3034')
  })

  it('refuses a key made with another secret, or for another contact', () => {
    const key = manageKey('3034', AC_KEY)
    expect(contactOfKey(key, 'another-api-key')).toBeNull()
    const [, sig] = key.split('.')
    expect(contactOfKey(`3035.${sig}`, AC_KEY)).toBeNull()
  })

  it('refuses anything that is not a key', () => {
    const key = manageKey('3034', AC_KEY)
    for (const bad of [
      undefined,
      null,
      42,
      '',
      '3034',
      `${key}x`,
      key.slice(0, -1),
      ` ${key}`,
      key.replace('.', '-'),
      `abc.${key.split('.')[1]}`,
    ]) {
      expect(contactOfKey(bad, AC_KEY)).toBeNull()
    }
  })

  it('needs a contact id and the API key', () => {
    expect(() => manageKey('12a', AC_KEY)).toThrow(/contact id/)
    expect(() => manageKey('12', '')).toThrow(/ActiveCampaign key/)
  })
})

describe('keyFromHash', () => {
  it('takes the key out of the link fragment', () => {
    const key = manageKey('6', AC_KEY)
    expect(keyFromHash(`#k=${key}`)).toBe(key)
    expect(keyFromHash(`k=${key}`)).toBe(key)
  })

  it('finds nothing in an empty, unfilled or odd fragment', () => {
    expect(keyFromHash('')).toBeNull()
    expect(keyFromHash('#')).toBeNull()
    // An email sent before the reader had a key: ActiveCampaign leaves the
    // tag empty.
    expect(keyFromHash('#k=')).toBeNull()
    expect(keyFromHash('#k=%MANAGE_KEY%')).toBeNull()
    expect(keyFromHash('#top')).toBeNull()
  })

  it('still tells a settings link with a missing key from any other fragment', () => {
    expect(hashHasKeyParam('#k=')).toBe(true)
    expect(hashHasKeyParam('#k=broken')).toBe(true)
    expect(hashHasKeyParam('#top')).toBe(false)
    expect(hashHasKeyParam('')).toBe(false)
  })
})

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('ada.lovelace@example.org')).toBe('a•••@example.org')
    expect(maskEmail('b@x.io')).toBe('b•••@x.io')
  })

  it('shows nothing of something that is not an address', () => {
    expect(maskEmail('nobody')).toBe('•••')
    expect(maskEmail('@example.org')).toBe('•••')
  })
})

describe('subscriptionsFrom', () => {
  it('counts only active memberships of the three newsletter lists', () => {
    expect(
      subscriptionsFrom({
        [NEWSLETTER_LIST.events]: '1',
        [NEWSLETTER_LIST.training]: '2',
        [NEWSLETTER_LIST.funding]: '0',
        '5': '1',
      })
    ).toEqual({ events: true, training: false, funding: false })
    expect(subscriptionsFrom({})).toEqual({
      events: false,
      training: false,
      funding: false,
    })
  })
})

describe('parseWanted / changesFor', () => {
  it('turns the ticks into the list changes that differ', () => {
    const current = { events: true, training: true, funding: false }
    expect(
      changesFor(current, { events: true, training: false, funding: true })
    ).toEqual([
      { newsletter: 'training', list: NEWSLETTER_LIST.training, status: 2 },
      { newsletter: 'funding', list: NEWSLETTER_LIST.funding, status: 1 },
    ])
    expect(changesFor(current, { events: true })).toEqual([])
    expect(changesFor(current, {})).toEqual([])
  })

  it('takes only true or false for the three newsletters', () => {
    expect(parseWanted({ events: false })).toEqual({ events: false })
    expect(parseWanted({ updates: true })).toBeNull()
    expect(parseWanted({ events: 'yes' })).toBeNull()
    expect(parseWanted([true])).toBeNull()
    expect(parseWanted(null)).toBeNull()
  })
})

describe('parsePicks', () => {
  it('keeps each known newsletter once, in the usual order', () => {
    expect(parsePicks(['funding', 'events', 'funding'])).toEqual([
      'events',
      'funding',
    ])
  })

  it('refuses an empty list, an unknown newsletter or something else', () => {
    expect(parsePicks([])).toBeNull()
    expect(parsePicks(['events', 'updates'])).toBeNull()
    expect(parsePicks('events')).toBeNull()
    expect(parsePicks(undefined)).toBeNull()
  })
})
