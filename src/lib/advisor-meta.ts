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
  'Wellbeing',
  'Operations',
  'Legal',
  'Visas',
] as const

/** The Applications options in Airtable, in filter order. */
export const APPLICATIONS = [
  'Application required',
  'Accepts everyone',
] as const

export function isApplications(value: string): boolean {
  return (APPLICATIONS as readonly string[]).includes(value)
}

/** "For: newcomers, existing field members" — lowercase, in Airtable order. */
export function whoItsForLabel(who: string[]): string | null {
  return who.length > 0
    ? `For: ${who.map(w => w.toLowerCase()).join(', ')}`
    : null
}

/** "Focus: career, volunteering" — lowercase, in Airtable order. */
export function focusLabel(areas: string[]): string | null {
  return areas.length > 0
    ? `Focus: ${areas.map(a => a.toLowerCase()).join(', ')}`
    : null
}
