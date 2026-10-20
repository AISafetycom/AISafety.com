// The resource pages in site-nav order, shared by the dashboard and the
// org pages it shares (src/app/stats).

// Resource pages in the same order as the site nav. `name` is the analytics
// `page` value (the string passed to trackListingClick) and the tab key; `label`
// is the page's name on the live site (from Navigation.tsx) so the tabs read the
// way visitors see them — e.g. the 'Founders' page is labelled "Founder toolkit".
// Drives the order, labels, and icons of the page tabs; every page listed here
// always gets a tab (even with no clicks yet). Pages not listed (e.g. Home) sort
// after these, keeping their by-clicks order and showing their raw name.
export const PAGE_NAV: { name: string; label: string; icon: string }[] = [
  { name: 'Training', label: 'Training programs', icon: 'grad-cap.svg' },
  { name: 'Events', label: 'Events', icon: 'calendar.svg' },
  { name: 'Map', label: 'Field map', icon: 'map.svg' },
  { name: 'Communities', label: 'Communities', icon: 'globe.svg' },
  { name: 'Self-study', label: 'Self-study', icon: 'book.svg' },
  { name: 'Jobs', label: 'Jobs', icon: 'briefcase.svg' },
  { name: 'Funding', label: 'Funding', icon: 'coins.svg' },
  { name: 'Media channels', label: 'Media channels', icon: 'megaphone.svg' },
  { name: 'Advisors', label: 'Advisors', icon: 'person.svg' },
  // Volunteer projects has no trackable clicks (its cards are plain text with no
  // links), so it gets no tab. If it's ever tracked, add it back here.
  { name: 'Founders', label: 'Founder toolkit', icon: 'rocket.svg' },
]

const NAV_INDEX = new Map(PAGE_NAV.map((p, i) => [p.name, i]))

/** Where a page sorts among the resource pages: Home first, then site-nav
 *  order, then anything else. The page tabs and the Org lookup's listings
 *  share it. */
export function navOrder(name: string): number {
  return name === 'Home' ? -1 : (NAV_INDEX.get(name) ?? 999)
}
