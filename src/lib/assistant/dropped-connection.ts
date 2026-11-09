/** How long the chat waits before its one automatic re-send. A phone coming
 *  back from another app often has no network for the first moment. */
const AUTO_RETRY_PAUSE_MS = 1000

/** True when a chat request died because the connection dropped before any of
 *  the reply arrived: a phone switching apps, a flaky network, a VPN. Browsers
 *  reject fetch and stream reads with a TypeError for this ("Load failed" in
 *  Safari, "Failed to fetch" or "network error" in Chrome, "NetworkError…" in
 *  Firefox). HTTP failures, the rate limit, and Stop are other kinds of error,
 *  and a reply that had started arriving is the visitor's to re-send. */
export function isDroppedBeforeReply(
  err: unknown,
  arrivedChars: number
): boolean {
  return err instanceof TypeError && arrivedChars === 0
}

/** Waits before the automatic re-send. Rejects with an AbortError if the
 *  visitor presses Stop or clears the chat during the wait, the same error an
 *  aborted fetch gives, so the caller treats both alike. */
export function pauseBeforeRetry(
  signal: AbortSignal,
  ms: number = AUTO_RETRY_PAUSE_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}
