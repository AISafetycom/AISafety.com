// Which suggestions a text box shows for what's typed in it (<TextField
// suggestions>). Pure, so it can be tested without a browser.

export interface Suggestion {
  /** What picking it puts in the box. */
  value: string
  /** A second, quieter line under it, e.g. the page a listing is on. */
  detail?: string
  /** A listing's logo before it (<ListingLogo>): its image, or null for
   *  its initials. Left out, the row has none. */
  logo?: string | null
}

/** The suggestions that contain what's typed, ignoring case: those that
 *  start with it first, then those with a word that does, then the rest,
 *  each group in the list's own order. At most `max`. Nothing for an empty
 *  box. */
export function matchSuggestions(
  suggestions: readonly Suggestion[],
  typed: string,
  max = 8
): Suggestion[] {
  const q = typed.trim().toLowerCase()
  if (!q) return []
  const starts: Suggestion[] = []
  const wordStarts: Suggestion[] = []
  const contains: Suggestion[] = []
  for (const s of suggestions) {
    const v = s.value.toLowerCase()
    const at = v.indexOf(q)
    if (at < 0) continue
    if (at === 0) starts.push(s)
    else if (/[\s(:/-]/.test(v[at - 1])) wordStarts.push(s)
    else contains.push(s)
  }
  return [...starts, ...wordStarts, ...contains].slice(0, max)
}
