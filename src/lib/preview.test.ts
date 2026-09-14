import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareLiveRead } from './preview'

// draftMode() only works inside a request; nothing here needs it.
vi.mock('next/headers', () => ({
  draftMode: async () => ({ isEnabled: false }),
}))

describe('shareLiveRead', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands concurrent callers the same in-flight read', async () => {
    let calls = 0
    const read = async () => ++calls
    const [a, b] = await Promise.all([
      shareLiveRead('same', read),
      shareLiveRead('same', read),
    ])
    expect(calls).toBe(1)
    expect(a).toBe(1)
    expect(b).toBe(1)
  })

  it('keeps different keys apart', async () => {
    let calls = 0
    const read = async () => ++calls
    await Promise.all([shareLiveRead('one', read), shareLiveRead('two', read)])
    expect(calls).toBe(2)
  })

  it('reads again once the window has passed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    let calls = 0
    const read = async () => ++calls
    await shareLiveRead('aging', read)
    vi.setSystemTime(new Date('2026-09-04T12:00:01.500Z'))
    expect(await shareLiveRead('aging', read)).toBe(1)
    vi.setSystemTime(new Date('2026-09-04T12:00:02.100Z'))
    expect(await shareLiveRead('aging', read)).toBe(2)
  })

  it('does not hand on a failed read', async () => {
    let calls = 0
    const read = async () => {
      calls++
      if (calls === 1) throw new Error('airtable down')
      return calls
    }
    await expect(shareLiveRead('flaky', read)).rejects.toThrow('airtable down')
    expect(await shareLiveRead('flaky', read)).toBe(2)
  })
})
