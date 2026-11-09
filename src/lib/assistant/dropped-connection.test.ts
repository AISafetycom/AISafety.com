import { describe, expect, it } from 'vitest'
import { isDroppedBeforeReply, pauseBeforeRetry } from './dropped-connection'

describe('isDroppedBeforeReply', () => {
  it('is true for a browser network error with nothing arrived', () => {
    expect(isDroppedBeforeReply(new TypeError('Load failed'), 0)).toBe(true)
    expect(isDroppedBeforeReply(new TypeError('network error'), 0)).toBe(true)
  })

  it('is false once any of the reply has arrived', () => {
    expect(isDroppedBeforeReply(new TypeError('network error'), 12)).toBe(false)
  })

  it('is false for HTTP failures and the rate limit', () => {
    expect(isDroppedBeforeReply(new Error('HTTP 500: oops'), 0)).toBe(false)
    expect(
      isDroppedBeforeReply(new Error("You've hit the message limit."), 0)
    ).toBe(false)
  })

  it('is false for Stop', () => {
    expect(
      isDroppedBeforeReply(new DOMException('Aborted', 'AbortError'), 0)
    ).toBe(false)
  })
})

describe('pauseBeforeRetry', () => {
  it('resolves after the wait', async () => {
    await expect(
      pauseBeforeRetry(new AbortController().signal, 1)
    ).resolves.toBeUndefined()
  })

  it('rejects with an AbortError when aborted during the wait', async () => {
    const controller = new AbortController()
    const pause = pauseBeforeRetry(controller.signal, 60_000)
    controller.abort()
    await expect(pause).rejects.toMatchObject({ name: 'AbortError' })
  })
})
