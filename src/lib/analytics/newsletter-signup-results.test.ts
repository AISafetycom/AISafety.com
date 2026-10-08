import { describe, expect, it } from 'vitest'
import {
  newsletterErrorLabel,
  newsletterSignupResults,
  type AnalyticsEvent,
} from './events'

// The Analytics Newsletters tab's "Signups through the site" panel: how the
// /events and /training boxes' signups ended, per page, and what went wrong.

const ev = (
  type: string,
  page: string,
  vid: string | undefined,
  ts: string,
  source?: string
) => ({ type, page, vid, ts, source }) as AnalyticsEvent

const DAY1 = '2026-10-08T10:00:00Z'
const DAY1_LATER = '2026-10-08T18:00:00Z'
const DAY2 = '2026-10-09T09:00:00Z'

const EVENTS = [
  ev('newsletter_signup_success', 'Events', 'a', DAY1),
  // a again the same day (signed up twice) and the next day.
  ev('newsletter_signup_success', 'Events', 'a', DAY1_LATER),
  ev('newsletter_signup_success', 'Events', 'a', DAY2),
  ev('newsletter_signup_success', 'Training', 'a', DAY1),
  // b: two invalid-address errors, then a network error, then success.
  ev('newsletter_signup_error', 'Events', 'b', DAY1, 'invalid_email'),
  ev('newsletter_signup_error', 'Events', 'b', DAY1_LATER, 'invalid_email'),
  ev('newsletter_signup_error', 'Events', 'b', DAY1_LATER, 'network'),
  ev('newsletter_signup_success', 'Events', 'b', DAY1_LATER),
  // No visitor id (private browsing): always counted.
  ev('newsletter_signup_error', 'Training', undefined, DAY1, 'http_504'),
  ev('newsletter_signup_error', 'Training', undefined, DAY1, 'http_504'),
  // Not results: submits, views, and an event without a page.
  ev('newsletter_signup', 'Events', 'a', DAY1),
  ev('newsletter_view', 'Funding', 'a', DAY1),
  { type: 'newsletter_signup_success', ts: DAY1 } as AnalyticsEvent,
]

describe('newsletterSignupResults', () => {
  it('counts one success a visitor a page a day, and each kind of error', () => {
    expect(newsletterSignupResults(EVENTS, true)).toEqual({
      byPage: [
        { name: 'Events', succeeded: 3, failed: 2 },
        { name: 'Training', succeeded: 1, failed: 2 },
      ],
      errors: [
        { name: 'Site error (HTTP 504)', count: 2 },
        { name: 'Email address not accepted', count: 1 },
        { name: "Couldn't reach the site", count: 1 },
      ],
    })
  })

  it('counts every result in total mode', () => {
    const r = newsletterSignupResults(EVENTS, false)
    expect(r.byPage).toEqual([
      { name: 'Events', succeeded: 4, failed: 3 },
      { name: 'Training', succeeded: 1, failed: 2 },
    ])
    expect(r.errors).toEqual([
      { name: 'Email address not accepted', count: 2 },
      { name: 'Site error (HTTP 504)', count: 2 },
      { name: "Couldn't reach the site", count: 1 },
    ])
  })

  it('is empty with no results', () => {
    expect(newsletterSignupResults([], true)).toEqual({
      byPage: [],
      errors: [],
    })
  })
})

describe('newsletterErrorLabel', () => {
  it("spells out the route's reasons and keeps unknown ones readable", () => {
    expect(newsletterErrorLabel('upstream')).toBe('ActiveCampaign problem')
    expect(newsletterErrorLabel('rate_limited')).toBe(
      'Too many signups from one network'
    )
    expect(newsletterErrorLabel('http_500')).toBe('Site error (HTTP 500)')
    expect(newsletterErrorLabel('something_new')).toBe('something_new')
    expect(newsletterErrorLabel(undefined)).toBe('Unknown')
  })
})
