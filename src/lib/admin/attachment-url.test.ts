import { describe, expect, it } from 'vitest'
import { attachmentExpiry, isExpiredAttachment } from './attachment-url'

const AT = 1789682400000
const LINK = `https://v5.airtableusercontent.com/v3/u/57/57/${AT}/abc/def/ghi.webp`

describe('attachmentExpiry', () => {
  it('reads the timestamp out of an Airtable attachment link', () => {
    expect(attachmentExpiry(LINK)).toBe(AT)
  })
  it('is null for any other link', () => {
    expect(attachmentExpiry('https://law-ai.org/logo.png')).toBeNull()
    expect(attachmentExpiry('')).toBeNull()
  })
})

describe('isExpiredAttachment', () => {
  it('is fresh well before the timestamp', () => {
    expect(isExpiredAttachment(LINK, 10 * 60 * 1000, AT - 3600_000)).toBe(false)
  })
  it('counts as expired inside the safety margin', () => {
    expect(isExpiredAttachment(LINK, 10 * 60 * 1000, AT - 5 * 60_000)).toBe(
      true
    )
  })
  it('is expired after the timestamp', () => {
    expect(isExpiredAttachment(LINK, 0, AT + 1)).toBe(true)
  })
  it('never expires a link from somewhere else', () => {
    expect(isExpiredAttachment('https://law-ai.org/logo.png', 0, 0)).toBe(false)
  })
})
