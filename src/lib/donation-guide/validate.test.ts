import { describe, expect, it } from 'vitest'
import { SEED_GUIDE } from './seed'
import { validateGuide } from './validate'

/** The seed with one tab's lead swapped for the given text. */
function withLead(lead: string) {
  const guide = JSON.parse(JSON.stringify(SEED_GUIDE))
  guide.tabs[0].lead = lead
  return validateGuide(guide)
}

describe('control characters in text', () => {
  it('allows tabs, newlines and carriage returns', () => {
    const v = withLead('one\ttwo\nthree\r\nfour')
    expect(v.ok, v.ok ? '' : v.error).toBe(true)
  })

  it('rejects the other C0 controls', () => {
    for (const code of [0x00, 0x08, 0x0b, 0x0c, 0x0e, 0x1b, 0x1f]) {
      const v = withLead(`bad${String.fromCharCode(code)}text`)
      expect(
        v.ok,
        `U+${code.toString(16).padStart(4, '0')} should be rejected`
      ).toBe(false)
      if (!v.ok) expect(v.error).toContain('control characters')
    }
  })

  it('leaves ordinary and non-ASCII text alone', () => {
    const v = withLead('café – 日本語, $1,000–10,000')
    expect(v.ok, v.ok ? '' : v.error).toBe(true)
  })
})
