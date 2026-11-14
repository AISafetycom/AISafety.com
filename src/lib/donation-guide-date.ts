// Single source of truth for the donation guide's "last updated" date.
// The seed's date: what the page shows until the first publish from
// /admin/donation-guide, whose time then takes over (src/lib/donation-guide/live.ts).
export const DONATION_GUIDE_LAST_UPDATED = '2025-06-12T00:00:00.000Z'

// Publishes whose time is not the date to show, each with the date the site
// shows instead. The publish of 15 September 2026 moved the guide into the
// editor word for word, so the site keeps an older date until the next
// publish. The editor's history still shows the real publish time.
const SHOWN_DATES: Record<string, string> = {
  '2026-09-15T17:07:16.521Z': '2025-12-01T00:00:00.000Z',
}

/** The "last updated" date the site shows for the guide published at
 *  `publishedAt`: that time, unless the publish has a date set above. */
export function guideShownDate(publishedAt: string): string {
  return Object.hasOwn(SHOWN_DATES, publishedAt)
    ? SHOWN_DATES[publishedAt]
    : publishedAt
}
