/**
 * The Applications filter on /events and /training. Listings announced before
 * their applications open (the "not yet open" tick in Airtable) count as closed
 * everywhere else, but here they get their own choice, so a visitor can find
 * what's coming up apart from what has closed.
 */
export const APPLICATION_FILTER_OPTIONS = ['Open', 'Not yet open', 'Closed']

export function applicationFilterValue(listing: {
  applicationStatus: 'Open' | 'Closed'
  notYetOpen: boolean
}): string {
  return listing.notYetOpen ? 'Not yet open' : listing.applicationStatus
}
