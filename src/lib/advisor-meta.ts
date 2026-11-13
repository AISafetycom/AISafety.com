// What the Advisors page shows for each advisor: the card's three lines (who
// it's for, focus, applications) and the options behind its three filters.
// Pure, so the card builder, the page's client component and the tests share
// one copy. Lives outside lib/data/ because client components import it (see
// funding-status.ts).

/** The "Who it's for" options in Airtable, in filter order. */
export const WHO_ITS_FOR = ['Newcomers', 'Existing field members'] as const

/** The Focus areas options in Airtable, in filter order. */
export const FOCUS_AREAS = [
  'Career',
  'Research',
  'Founding',
  'Volunteering',
  'Donating',
  'Well-being',
  'Operations',
  'Legal',
  'Visas',
] as const

/**
 * The old Focus value for an advisor's Focus areas: "Career/contribution"
 * when they include Career or Founding, else "Other"; '' with no Focus areas,
 * as an empty field gave. The Advisors table's old Focus field was kept in
 * step this way until it was deleted (28 October 2026), and Data API v1
 * still serves the value as `focus`.
 */
export function legacyFocus(areas: readonly string[]): string {
  if (areas.length === 0) return ''
  return areas.includes('Career') || areas.includes('Founding')
    ? 'Career/contribution'
    : 'Other'
}

/** The Applications options in Airtable, in filter order. */
export const APPLICATIONS = [
  'Application required',
  'Accepts everyone',
] as const

export function isApplications(value: string): boolean {
  return (APPLICATIONS as readonly string[]).includes(value)
}

/** "For: newcomers, existing field members" — lowercase, in the order given
 *  (advisorFromRecord puts them in WHO_ITS_FOR order). */
export function whoItsForLabel(who: string[]): string | null {
  return who.length > 0
    ? `For: ${who.map(w => w.toLowerCase()).join(', ')}`
    : null
}

/** "Focus: career, volunteering" — lowercase, in the order given
 *  (advisorFromRecord puts them in FOCUS_AREAS order). */
export function focusLabel(areas: string[]): string | null {
  return areas.length > 0
    ? `Focus: ${areas.map(a => a.toLowerCase()).join(', ')}`
    : null
}
