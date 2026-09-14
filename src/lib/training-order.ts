// Ordering for the /training Upcoming tab. Kept in its own module (no React
// or server-only imports) so the client component and the unit test can both
// use it — same pattern as placements.ts and featured.ts.
//
// Applications close well before programs start, so the tab is ordered by
// deadline rather than start date: open programs soonest-closing first
// (open-ended ones, with no deadline, after the dated ones), then programs
// whose applications haven't opened yet, then closed ones — those two blocks
// by start date. This is where /training parts ways with /events, which
// keeps start-date order under month-of-start headings because the date you
// attend is what matters for an event. The data layer and the public API
// keep the start-date order; only the page re-sorts.

/** The fields the ordering reads — a TrainingProgram satisfies this. */
export interface Orderable {
  applicationStatus: 'Open' | 'Closed'
  applicationsClose: string | null
  notYetOpen: boolean
  startDate: string | null
}

export type Section = 'open' | 'notYetOpen' | 'closed'

/** Display order of the blocks. */
export const SECTIONS: Section[] = ['open', 'notYetOpen', 'closed']

export const SECTION_LABELS: Record<Section, string> = {
  open: 'Applications open',
  notYetOpen: 'Applications not yet open',
  closed: 'Applications closed',
}

export function sectionFor(program: Orderable): Section {
  if (program.notYetOpen) return 'notYetOpen'
  return program.applicationStatus === 'Open' ? 'open' : 'closed'
}

/** ISO dates ascending, with missing dates last. */
function compareDates(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
}

export function compareByDeadline(a: Orderable, b: Orderable): number {
  const bySection =
    SECTIONS.indexOf(sectionFor(a)) - SECTIONS.indexOf(sectionFor(b))
  if (bySection !== 0) return bySection
  if (sectionFor(a) === 'open') {
    const byDeadline = compareDates(a.applicationsClose, b.applicationsClose)
    if (byDeadline !== 0) return byDeadline
  }
  return compareDates(a.startDate, b.startDate)
}
