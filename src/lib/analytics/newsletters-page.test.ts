import { describe, expect, it } from 'vitest'
import {
  newsletterConfirmations,
  newsletterSignupResults,
  newslettersPageStats,
  type AnalyticsEvent,
} from './events'

// The Analytics Newsletters tab and the newsletters page (/newsletter): its
// own panel (visits, settings opened from the emails, what changed), and its
// several-at-once signups credited to the newsletter whose confirmation went
// out.

const ev = (
  type: string,
  vid: string | undefined,
  ts: string,
  extra: Partial<AnalyticsEvent> = {}
) => ({ type, page: '/newsletter', vid, ts, ...extra }) as AnalyticsEvent

const DAY1 = '2026-10-27T10:00:00Z'
const DAY1_LATER = '2026-10-27T18:00:00Z'
const DAY2 = '2026-10-28T09:00:00Z'

const EVENTS = [
  ev('page_view', 'a', DAY1),
  ev('page_view', 'a', DAY1_LATER),
  ev('page_view', 'b', DAY1),
  // Not this page.
  ev('page_view', 'a', DAY1, { page: '/newsletter/events' }),
  ev('newsletter_settings_open', 'a', DAY1, { source: 'ok' }),
  ev('newsletter_settings_open', 'a', DAY1_LATER, { source: 'ok' }),
  ev('newsletter_settings_open', 'b', DAY1, { source: 'link_invalid' }),
  ev('newsletter_settings_open', 'c', DAY1, { source: 'upstream' }),
  ev('newsletter_settings_save', 'a', DAY1, {
    source: 'saved',
    label: '+funding -training',
  }),
  ev('newsletter_settings_save', 'a', DAY2, {
    source: 'saved',
    label: '-funding',
  }),
  ev('newsletter_settings_save', 'c', DAY1, {
    source: 'upstream',
    label: '+events',
  }),
  ev('newsletter_page_click', 'b', DAY1, { label: 'events', source: 'issues' }),
  ev('newsletter_page_click', 'b', DAY1, {
    label: 'updates',
    source: 'substack',
  }),
]

describe('newslettersPageStats', () => {
  it('counts visits, opens, saves and changes once a visitor a day', () => {
    expect(newslettersPageStats(EVENTS, true)).toEqual({
      views: 2,
      opened: 1,
      brokenLinks: 1,
      openFailures: 1,
      saves: 2,
      saveFailures: 1,
      rows: [
        { name: 'Events', added: 0, dropped: 0, clicks: 1 },
        { name: 'Training', added: 0, dropped: 1, clicks: 0 },
        { name: 'Funding', added: 1, dropped: 1, clicks: 0 },
        { name: 'Updates', added: 0, dropped: 0, clicks: 1 },
      ],
    })
  })

  it('counts everything in total mode', () => {
    const stats = newslettersPageStats(EVENTS, false)
    expect(stats.views).toBe(3)
    expect(stats.opened).toBe(2)
  })

  it('is empty with nothing on the page', () => {
    expect(newslettersPageStats([], true).rows).toEqual([])
  })
})

describe('newsletterConfirmations with the newsletters page', () => {
  it('credits each signup to the newsletter whose confirmation went out', () => {
    const events = [
      ev('newsletter_signup_success', 'a', DAY1, { source: 'events' }),
      ev('newsletter_signup_success', 'b', DAY1, { source: 'funding' }),
      // a twice the same day: once in unique mode.
      ev('newsletter_signup_success', 'a', DAY1_LATER, { source: 'events' }),
      // A box's signup, the way it was always counted.
      ev('newsletter_signup_success', 'a', DAY1, { page: 'Funding' }),
      ev('page_view', 'a', DAY1_LATER, { page: '/subscribed/events' }),
    ]
    const results = newsletterSignupResults(events, true)
    expect(newsletterConfirmations(events, true, results)).toEqual([
      { name: 'Events', signedUp: 1, confirmed: 1 },
      { name: 'Funding', signedUp: 2, confirmed: 0 },
    ])
  })
})
