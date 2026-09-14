import { draftMode } from 'next/headers'

/** True when this request carries the Draft Mode cookie, i.e. an admin turned
 *  on preview mode at /admin/preview. Preview requests bypass every data cache
 *  and read Airtable live, so the admin sees an edit immediately on the real
 *  pages; requests without the cookie are completely unaffected and keep
 *  getting the prebuilt static pages. */
export async function isPreviewRequest(): Promise<boolean> {
  try {
    return (await draftMode()).isEnabled
  } catch {
    // draftMode() is only usable in request scope. Outside one (`next build`
    // prerendering pages, generating the sitemap) there is no cookie and so
    // no preview — never a real error to surface.
    return false
  }
}

// One preview page view is several server requests at once — Next fetches
// the page's segments separately, and every refresh prefetches the nav links
// again — and each of them would repeat the page's live Airtable reads.
// Identical reads started within a couple of seconds share one in-flight
// read instead. That is well inside the auto-refresh cadence (polls every
// 2 s, refreshes at least 3.5 s apart), so an edit still shows on the very
// next refresh. A failed read is dropped at once, never handed on.
const SHARE_WINDOW_MS = 2_000
const inFlight = new Map<string, { at: number; result: Promise<unknown> }>()

export function shareLiveRead<T>(
  key: string,
  read: () => Promise<T>
): Promise<T> {
  const now = Date.now()
  for (const [k, entry] of inFlight) {
    if (now - entry.at >= SHARE_WINDOW_MS) inFlight.delete(k)
  }
  const shared = inFlight.get(key)
  if (shared) return shared.result as Promise<T>
  const result = read()
  inFlight.set(key, { at: now, result })
  result.catch(() => {
    if (inFlight.get(key)?.result === result) inFlight.delete(key)
  })
  return result
}
