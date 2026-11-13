import { describe, expect, it } from 'vitest'
import { newsletterArchiveStats, type AnalyticsEvent } from './events'

// The Analytics Newsletters tab's "Past issues and feeds" panel: views of
// /newsletter/<key> and where the page's clicks went (an issue, the feed,
// Substack, the resource page).

const view = (page: string, vid: string | undefined, ts: string) =>
  ({ type: 'page_view', page, vid, ts }) as AnalyticsEvent

const click = (
  page: string,
  source: string,
  vid: string | undefined,
  ts: string,
  label?: string
) =>
  ({
    type: 'newsletter_archive_click',
    page,
    source,
    label,
    vid,
    ts,
  }) as AnalyticsEvent

const DAY1 = '2026-10-12T10:00:00Z'
const DAY1_LATER = '2026-10-12T18:00:00Z'
const DAY2 = '2026-10-13T09:00:00Z'

const EVENTS = [
  view('/newsletter/events', 'a', DAY1),
  view('/newsletter/events/', 'a', DAY1_LATER),
  view('/newsletter/events', 'a', DAY2),
  view('/newsletter/events', 'b', DAY1),
  view('/newsletter/training', 'a', DAY1),
  // Not the past issues pages.
  view('/events', 'a', DAY1),
  view('/newsletter/events/week-41-2026', 'a', DAY1),
  view('/newsletter/events/feed', 'a', DAY1),
  click('Events', 'issue', 'a', DAY1, 'week-41-2026'),
  click('Events', 'issue', 'a', DAY1_LATER, 'week-41-2026'),
  click('Events', 'issue', 'a', DAY1, 'week-42-2026'),
  click('Events', 'feed', 'b', DAY1),
  click('Training', 'substack', 'a', DAY1),
  click('Events', 'resource', 'a', DAY1),
  click('Events', 'resource', 'a', DAY1_LATER),
  click('Training', 'resource', 'c', DAY2),
  // No visitor id: always counted.
  click('Training', 'feed', undefined, DAY1),
  click('Training', 'feed', undefined, DAY1),
]

describe('newsletterArchiveStats', () => {
  it('counts once per visitor per page or link per day by default', () => {
    expect(newsletterArchiveStats(EVENTS, true)).toEqual([
      {
        name: 'Events',
        views: 3,
        issueClicks: 2,
        feedClicks: 1,
        substackClicks: 0,
        resourceClicks: 1,
      },
      {
        name: 'Training',
        views: 1,
        issueClicks: 0,
        feedClicks: 2,
        substackClicks: 1,
        resourceClicks: 1,
      },
    ])
  })

  it('counts every view and click in total mode', () => {
    expect(newsletterArchiveStats(EVENTS, false)).toEqual([
      {
        name: 'Events',
        views: 4,
        issueClicks: 3,
        feedClicks: 1,
        substackClicks: 0,
        resourceClicks: 2,
      },
      {
        name: 'Training',
        views: 1,
        issueClicks: 0,
        feedClicks: 2,
        substackClicks: 1,
        resourceClicks: 1,
      },
    ])
  })

  it('leaves out views of the 404 page that stood at the address', () => {
    // Before the pages went live (about 12:30 UTC on 11 October 2026, and
    // Funding's at about 17:16 UTC on 21 October 2026, after its move).
    expect(
      newsletterArchiveStats(
        [
          view('/newsletter/events', 'a', '2026-10-11T12:00:00Z'),
          view('/newsletter/funding', 'b', DAY1),
          view('/newsletter/training', 'c', '2026-10-11T12:45:00Z'),
          view('/newsletter/funding', 'd', '2026-10-21T17:00:00Z'),
          view('/newsletter/funding', 'e', '2026-10-21T17:30:00Z'),
        ],
        true
      )
    ).toEqual([
      {
        name: 'Training',
        views: 1,
        issueClicks: 0,
        feedClicks: 0,
        substackClicks: 0,
        resourceClicks: 0,
      },
      {
        name: 'Funding',
        views: 1,
        issueClicks: 0,
        feedClicks: 0,
        substackClicks: 0,
        resourceClicks: 0,
      },
    ])
  })

  it('is empty with nothing to count', () => {
    expect(newsletterArchiveStats([view('/events', 'a', DAY1)], true)).toEqual(
      []
    )
  })
})
