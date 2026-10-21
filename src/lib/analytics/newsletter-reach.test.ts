import { describe, expect, it } from 'vitest'
import {
  confirmLandings,
  newsletterConfirmations,
  newsletterCopyViews,
  newsletterLandings,
  newsletterLinkClicks,
  newsletterOfRef,
  newsletterVisits,
  type AnalyticsEvent,
  type NewsletterSignupResults,
} from './events'

// The Analytics Newsletters tab's newer figures: readers who confirmed, the
// issues' web and text versions, the other ways to the newsletters, and
// visits from links in the emails.

const ev = (e: Partial<AnalyticsEvent> & { type: string; ts: string }) =>
  e as AnalyticsEvent
/** Newest first, as the store hands them over. */
const newestFirst = (list: AnalyticsEvent[]) =>
  [...list].sort((a, b) => b.ts.localeCompare(a.ts))

const view = (
  page: string,
  vid: string | undefined,
  ts: string,
  ref?: string
) => ev({ type: 'page_view', page, vid, ts, ref })

describe('confirmations (/subscribed/<key>)', () => {
  const EVENTS = newestFirst([
    view('/subscribed/events', 'a', '2026-10-12T10:00:00Z'),
    // The same reader pressing the link again that day.
    view('/subscribed/events', 'a', '2026-10-12T10:05:00Z'),
    view('/subscribed/events/', 'a', '2026-10-13T09:00:00Z'),
    view('/subscribed/training', 'b', '2026-10-12T11:00:00Z'),
    view('/subscribed/training', undefined, '2026-10-12T11:00:00Z'),
    // Funding's box signs people up on the site since its move too.
    view('/subscribed/funding', 'd', '2026-10-21T12:00:00Z'),
    view('/events', 'a', '2026-10-12T10:06:00Z'),
    view('/subscribed/updates', 'c', '2026-10-12T10:06:00Z'),
  ])

  it('counts a reader once per newsletter per day by default, every landing in total mode', () => {
    expect(confirmLandings(EVENTS, true)).toHaveLength(5)
    expect(confirmLandings(EVENTS, false)).toHaveLength(6)
  })

  it('sets them beside the signups each newsletter’s boxes made', () => {
    const results: NewsletterSignupResults = {
      byPage: [
        { name: 'Events', succeeded: 3, already: 1, failed: 0 },
        { name: '/newsletter/events', succeeded: 1, already: 0, failed: 0 },
        { name: 'Training', succeeded: 4, already: 0, failed: 2 },
        { name: 'Funding', succeeded: 2, already: 0, failed: 1 },
      ],
      errors: [],
    }
    expect(newsletterConfirmations(EVENTS, true, results)).toEqual([
      { name: 'Events', signedUp: 4, confirmed: 2 },
      { name: 'Funding', signedUp: 2, confirmed: 1 },
      { name: 'Training', signedUp: 4, confirmed: 2 },
    ])
    expect(
      newsletterConfirmations([], true, { byPage: [], errors: [] })
    ).toEqual([])
  })
})

describe('newsletterCopyViews', () => {
  const copy = (
    page: string,
    label: string,
    source: string,
    vid: string,
    ts: string
  ) => ev({ type: 'newsletter_copy_view', page, label, source, vid, ts })
  const EVENTS = newestFirst([
    copy('Events', 'week-41-2026', 'web', 'd:1', '2026-10-12T10:00:00Z'),
    copy('Events', 'week-41-2026', 'web', 'd:1', '2026-10-12T10:01:00Z'),
    copy('Events', 'week-41-2026', 'text', 'd:1', '2026-10-12T10:02:00Z'),
    copy('Events', 'week-41-2026', 'web', 'd:2', '2026-10-12T10:00:00Z'),
    copy('Training', 'week-42-2026', 'web', 'd:1', '2026-10-13T10:00:00Z'),
    copy('Training', 'week-42-2026', 'pdf', 'd:1', '2026-10-13T10:00:00Z'),
  ])

  it('counts each issue’s copies, a reader once per copy per day by default', () => {
    expect(newsletterCopyViews(EVENTS, true)).toEqual([
      { newsletter: 'Events', issue: 'week-41-2026', web: 2, text: 1 },
      { newsletter: 'Training', issue: 'week-42-2026', web: 1, text: 0 },
    ])
    expect(newsletterCopyViews(EVENTS, false)[0]).toEqual({
      newsletter: 'Events',
      issue: 'week-41-2026',
      web: 3,
      text: 1,
    })
  })
})

describe('newsletterLinkClicks', () => {
  const EVENTS = newestFirst([
    ev({
      type: 'newsletter_view',
      page: 'Funding',
      vid: 'a',
      ts: '2026-10-12T10:00:00Z',
    }),
    ev({
      type: 'newsletter_view',
      page: 'Funding',
      vid: 'a',
      ts: '2026-10-12T10:02:00Z',
    }),
    ev({
      type: 'footer_click',
      source: 'Newsletters',
      label: 'AI Safety Events',
      url: '/events',
      vid: 'b',
      ts: '2026-10-12T10:00:00Z',
    }),
    ev({
      type: 'footer_click',
      source: 'Newsletters',
      label: 'AI Safety Funding',
      url: 'https://aisafetyfunding.substack.com/',
      vid: 'b',
      ts: '2026-10-12T10:00:00Z',
    }),
    // Another column of the footer.
    ev({
      type: 'footer_click',
      source: 'Help us out',
      label: 'Donate',
      url: '/donate',
      vid: 'b',
      ts: '2026-10-12T10:00:00Z',
    }),
  ])

  it('counts the Funding box’s link to Substack and the footer’s Newsletters column', () => {
    expect(newsletterLinkClicks(EVENTS, true)).toEqual([
      { name: "Funding page's box", to: 'Substack', clicks: 1 },
      { name: 'Footer · AI Safety Events', to: '/events', clicks: 1 },
      { name: 'Footer · AI Safety Funding', to: 'Substack', clicks: 1 },
    ])
    expect(newsletterLinkClicks(EVENTS, false)[0].clicks).toBe(2)
  })
})

const TAGGED =
  'https://aisafety.com/events?utm_source=events-newsletter&utm_medium=email&utm_campaign=events-2026-week-42'

describe('newsletterOfRef', () => {
  it('reads the newsletter and issue off a page’s address', () => {
    expect(newsletterOfRef(TAGGED)).toEqual({
      newsletter: 'Events',
      campaign: 'events-2026-week-42',
    })
    expect(
      newsletterOfRef(
        'https://aisafety.com/funding?utm_source=funding-newsletter&utm_medium=email&utm_campaign=funding-2026-23'
      )
    ).toEqual({ newsletter: 'Funding', campaign: 'funding-2026-23' })
    expect(
      newsletterOfRef(
        'https://aisafety.com/training?utm_source=events-training-newsletter'
      )
    ).toEqual({ newsletter: 'Events & Training', campaign: null })
  })

  it('ignores any other address', () => {
    expect(newsletterOfRef(undefined)).toBeNull()
    expect(newsletterOfRef('https://aisafety.com/events')).toBeNull()
    expect(
      newsletterOfRef('https://aisafety.com/events?utm_source=aisafety.com')
    ).toBeNull()
    expect(newsletterOfRef('not a url utm_source=events-newsletter')).toBeNull()
  })
})

describe('visits from the newsletters', () => {
  const click = (vid: string, ts: string, label: string, page = 'Events') =>
    ev({ type: 'listing_click', page, label, vid, ts })
  const EVENTS = newestFirst([
    // a: lands on /events from the Events issue, reloads it, looks at
    // /training, clicks two listings.
    view('/events', 'a', '2026-10-12T10:00:00Z', TAGGED),
    view('/events', 'a', '2026-10-12T10:10:00Z', TAGGED),
    view('/training', 'a', '2026-10-12T10:12:00Z'),
    click('a', '2026-10-12T10:13:00Z', 'The Big Tent'),
    click('a', '2026-10-12T10:20:00Z', 'MATS', 'Training'),
    // …then comes back an hour later on their own: not the visit's.
    view('/jobs', 'a', '2026-10-12T11:30:00Z'),
    click('a', '2026-10-12T11:31:00Z', 'A job', 'Jobs'),
    // b: lands from Funding and leaves at once.
    view(
      '/funding',
      'b',
      '2026-10-12T10:00:00Z',
      'https://aisafety.com/funding?utm_source=funding-newsletter&utm_campaign=funding-2026-23'
    ),
    // a again the next day, from the same issue: a new visit.
    view('/events', 'a', '2026-10-13T09:00:00Z', TAGGED),
    // No visitor id: the landing counts, nothing after it can be followed.
    view('/events', undefined, '2026-10-13T09:00:00Z', TAGGED),
    // Someone who didn't come from a newsletter.
    view('/events', 'c', '2026-10-12T10:00:00Z'),
    click('c', '2026-10-12T10:01:00Z', 'The Big Tent'),
  ])

  it('starts a visit at each landing, a reload within half an hour excepted', () => {
    expect(
      newsletterLandings(EVENTS.filter(e => e.type === 'page_view')).map(
        e => `${e.vid ?? '-'} ${e.ts}`
      )
    ).toEqual([
      'a 2026-10-13T09:00:00Z',
      '- 2026-10-13T09:00:00Z',
      'a 2026-10-12T10:00:00Z',
      'b 2026-10-12T10:00:00Z',
    ])
  })

  it('follows each visit until the visitor goes quiet', () => {
    const v = newsletterVisits(EVENTS)
    expect(v.byNewsletter).toEqual([
      {
        name: 'Events',
        visits: 3,
        visitors: 1,
        morePages: 1,
        clicked: 1,
        listingClicks: 2,
      },
      {
        name: 'Funding',
        visits: 1,
        visitors: 1,
        morePages: 0,
        clicked: 0,
        listingClicks: 0,
      },
    ])
    expect(v.pages).toEqual([
      { name: 'Events', count: 4 },
      { name: 'Funding', count: 1 },
      { name: 'Training', count: 1 },
    ])
    expect(v.listings).toEqual([
      { name: 'The Big Tent', count: 1 },
      { name: 'MATS', count: 1 },
    ])
    expect(v.issues).toEqual([
      { name: 'events-2026-week-42', count: 3 },
      { name: 'funding-2026-23', count: 1 },
    ])
  })
})
