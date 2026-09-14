/**
 * Stable analytics names for relabelled filters.
 *
 * A filter_apply event records the filter group's title and the option's
 * label. Renaming either would split its history in the analytics dashboard
 * and in Matomo, so a renamed filter keeps logging its ORIGINAL name and this
 * table holds the mapping, per analytics page (`trackingPage`):
 *
 *   groups:  { visible title: logged title }
 *   options: { logged group title: { visible label: logged value } }
 *
 * The filter components look the logged names up on write; the dashboard's
 * aggregation translates them back to the visible names on read, so old and
 * new clicks show as one row under the current wording. Anything not listed
 * logs and displays its visible name, as before.
 *
 * To rename a filter title or option: change the label in the page, then add
 * one line here mapping the new wording to the value that was logged so far.
 * Option maps are keyed by the LOGGED group title, so a group that was itself
 * renamed keeps its options under its original name.
 */
interface PageRelabels {
  groups?: Record<string, string>
  options?: Record<string, Record<string, string>>
}

const RELABELLED_FILTERS: Record<string, PageRelabels> = {
  Funding: {
    options: {
      // Was "Yes" / "No" until 6 September 2026.
      'Application status': { Open: 'Yes', Closed: 'No' },
    },
  },
  Jobs: {
    groups: {
      // Was "Work location" until the /jobs page upgrades (August 2026).
      'Remote or on-site': 'Work location',
    },
  },
}

/** The group title to log for a visible filter title. */
export function trackedFilterGroup(page: string, title: string): string {
  return RELABELLED_FILTERS[page]?.groups?.[title] ?? title
}

/** The value to log for a visible option, given the LOGGED group title. */
export function trackedFilterValue(
  page: string,
  loggedGroup: string,
  option: string
): string {
  return RELABELLED_FILTERS[page]?.options?.[loggedGroup]?.[option] ?? option
}

function invert(map: Record<string, string>, logged: string): string {
  for (const [visible, value] of Object.entries(map)) {
    if (value === logged) return visible
  }
  return logged
}

/** The current visible title for a logged group title. */
export function displayFilterGroup(page: string, loggedGroup: string): string {
  const groups = RELABELLED_FILTERS[page]?.groups
  return groups ? invert(groups, loggedGroup) : loggedGroup
}

/** The current visible label for a logged option value under a logged group
 *  title: a logged "Yes" under Funding › Application status reads as "Open". */
export function displayFilterValue(
  page: string,
  loggedGroup: string,
  loggedValue: string
): string {
  const options = RELABELLED_FILTERS[page]?.options?.[loggedGroup]
  return options ? invert(options, loggedValue) : loggedValue
}
