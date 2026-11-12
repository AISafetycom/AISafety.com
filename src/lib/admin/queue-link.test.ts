import { describe, expect, it } from 'vitest'
import { URL_KEYS, linkIn, listingLink } from './queue-link'

const OLD = 'https://forum.example.org/posts/abc/a-new-program'
const NEW = 'https://program.example.org/'

describe('linkIn', () => {
  it('finds the link field, whatever the table calls it', () => {
    expect(linkIn({ Name: 'X', Website: NEW })).toBe(NEW)
    expect(linkIn({ Name: 'X', URL: NEW })).toBe(NEW)
    expect(linkIn({ Name: 'X', Link: NEW })).toBe(NEW)
  })
  it('puts the main link before a join or apply link', () => {
    expect(
      linkIn({ 'Apply link': 'https://apply.example.org', Website: NEW })
    ).toBe(NEW)
    expect(linkIn({ 'Join link': 'https://join.example.org' })).toBe(
      'https://join.example.org'
    )
  })
  it('passes over anything that is not a full address', () => {
    expect(linkIn({ Website: 'program.example' })).toBeNull()
    expect(linkIn({ Website: null, Description: NEW })).toBeNull()
    expect(linkIn(null)).toBeNull()
    expect(linkIn(undefined)).toBeNull()
  })
})

describe('URL_KEYS', () => {
  it('matches the link fields only', () => {
    expect(URL_KEYS.test('Website')).toBe(true)
    expect(URL_KEYS.test('Join link')).toBe(true)
    expect(URL_KEYS.test('Logo')).toBe(false)
    expect(URL_KEYS.test('Website notes')).toBe(false)
  })
})

describe('listingLink', () => {
  // The row keeps the link its listing had the day it was found.
  const item = { url: OLD, fields: { Name: 'X', Website: OLD } }

  it('opens the record as it reads now, not the link the row was born with', () => {
    expect(listingLink(item, { Name: 'X', Website: NEW })).toBe(NEW)
  })
  it('falls back to the row while the record has not been read', () => {
    expect(listingLink(item, undefined)).toBe(OLD)
    expect(listingLink(item, null)).toBe(OLD)
  })
  it('falls back to the row when the record holds no link', () => {
    expect(listingLink(item, { Name: 'X', Website: null })).toBe(OLD)
  })
  it('lets a proposed or typed link win over the record', () => {
    const typed = 'https://typed.example.org'
    expect(
      listingLink(item, { Name: 'X', Website: NEW }, { Website: typed })
    ).toBe(typed)
  })
  it('reads the snapshot when the row has no link of its own', () => {
    expect(listingLink({ url: null, fields: { URL: NEW } }, undefined)).toBe(
      NEW
    )
    expect(listingLink({ url: null, fields: null }, undefined)).toBeNull()
  })
})
