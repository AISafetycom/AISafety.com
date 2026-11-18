/*
  What Fable checked before its first verdict on a requested change (Bryce,
  18 Nov 2026, on a visitor's correction to AI Safety Brazil: the item said
  "Fix it" on the visitor's word alone, and Fable only looked into it once
  he asked in the chat, "Could you please research to find out?" – "Fable
  Review should do this kind of research automatically without me prompting
  it").

  The Mac now checks what a request claims against public pages before it
  queues the change, and keeps what it found on the row's proposal as
  `checked` = {at, claims: [{claim, found, supports, sources}]}: at most five
  claims, at most four links each. The page lists them under the verdict's
  reasons. The key is absent on rows made before this and on requests with
  nothing to check.

  None of it is trusted: the words came from web pages and a stranger's
  request by way of a model. Text is shown as text, never as markup; a
  source is kept only when it is a plain http(s) link with no login in it,
  and the page names it by its host.
*/

export const CHECKED_KEY = 'checked'

export const MAX_CLAIMS = 5
export const MAX_SOURCES = 4

/** Whether the public pages bear the claim out. */
export type Supports = 'yes' | 'no' | 'partly' | 'unclear'
const SUPPORTS: readonly string[] = ['yes', 'no', 'partly', 'unclear']

export interface CheckedClaim {
  /** What the request asserts, in one line; null when the Mac gave none. */
  claim: string | null
  /** What the public pages say. */
  found: string
  supports: Supports | null
  /** Where it was read: http(s) links, as the browser would write them. */
  sources: string[]
}

function line(v: unknown, max: number): string {
  return typeof v === 'string'
    ? v.replace(/\s+/g, ' ').trim().slice(0, max)
    : ''
}

/** Pure: a source as a link the page may show, or null. Only http and
 *  https, a real host, and no user name or password in it. */
export function sourceLink(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const text = v.trim()
  if (!/^https?:\/\//i.test(text) || text.length > 2000) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password || !url.hostname.includes('.')) return null
  return url.href
}

/** Pure: the host a source link is shown by, without a leading "www.". */
export function sourceHost(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./i, '')
  } catch {
    return href
  }
}

/** Pure: the proposal's `checked` block as the claims to show, [] when it
 *  is absent or malformed. A claim with nothing found is left out, as is
 *  anything that is not text or not a link; the rest stand. */
export function checkedOf(v: unknown): CheckedClaim[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return []
  const claims = (v as Record<string, unknown>).claims
  if (!Array.isArray(claims)) return []
  const out: CheckedClaim[] = []
  for (const x of claims) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue
    const c = x as Record<string, unknown>
    const found = line(c.found, 1000)
    if (!found) continue
    const sources: string[] = []
    for (const s of Array.isArray(c.sources) ? c.sources : []) {
      const href = sourceLink(s)
      if (href && !sources.includes(href)) sources.push(href)
      if (sources.length >= MAX_SOURCES) break
    }
    out.push({
      claim: line(c.claim, 300) || null,
      found,
      supports:
        typeof c.supports === 'string' && SUPPORTS.includes(c.supports)
          ? (c.supports as Supports)
          : null,
      sources,
    })
    if (out.length >= MAX_CLAIMS) break
  }
  return out
}

/** Pure: how a claim fared, in a word or two for its label; null when the
 *  Mac did not say. */
export function supportsWord(s: Supports | null): string | null {
  return s === 'yes'
    ? 'holds up'
    : s === 'no'
      ? 'does not hold up'
      : s === 'partly'
        ? 'partly holds up'
        : s === 'unclear'
          ? 'could not be settled'
          : null
}
