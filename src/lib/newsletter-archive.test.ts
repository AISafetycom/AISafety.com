import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FEED_ITEMS,
  etagMatches,
  feedEtag,
  feedReader,
  feedXml,
  issueSlug,
  issueTitle,
  mergeIssues,
} from './newsletter-archive'
import { textVersion } from './newsletter-text'

// Training · Week 41, 2026 exactly as it went out (the kept copy).
const WEEK_41 = readFileSync(
  path.join(__dirname, 'admin/__fixtures__/newsletter-training-week-41.html'),
  'utf8'
)

describe('issueSlug / issueTitle', () => {
  it('turns a campaign name into its address, wave suffix and all', () => {
    expect(issueSlug('events', 'Events · Week 41, 2026')).toBe('week-41-2026')
    expect(issueSlug('events', 'Events · Week 41, 2026 · wave 2/4')).toBe(
      'week-41-2026'
    )
    expect(issueSlug('funding', 'Funding · Issue #23, 2026')).toBe(
      'issue-23-2026'
    )
  })

  it("leaves out another newsletter's issues and other names", () => {
    expect(issueSlug('events', 'Training · Week 41, 2026')).toBeNull()
    expect(issueSlug('events', 'Events · Week 041, 2026')).toBeNull()
    expect(issueSlug('events', 'TEST Events')).toBeNull()
  })

  it('gives the subject the email had', () => {
    expect(issueTitle('training', 'week-41-2026')).toBe('Week 41, 2026')
    expect(issueTitle('funding', 'issue-23-2026')).toBe('Issue #23, 2026')
    expect(issueTitle('funding', 'week-41-2026')).toBeNull()
  })
})

describe('mergeIssues', () => {
  it('lists each issue once, newest first, by year then number', () => {
    const merged = mergeIssues(
      'events',
      [
        { slug: 'week-41-2026', sentAt: '2026-10-08T15:32:00.000Z' },
        { slug: 'week-1-2027', sentAt: null },
      ],
      [
        { slug: 'week-52-2026', sentAt: '2026-12-24T15:00:00.000Z' },
        { slug: 'week-41-2026', sentAt: '2026-10-08T15:32:00.000Z' },
        { slug: 'week-9-2026', sentAt: '2026-02-26T15:00:00.000Z' },
      ]
    )
    expect(merged.map(i => i.slug)).toEqual([
      'week-1-2027',
      'week-52-2026',
      'week-41-2026',
      'week-9-2026',
    ])
  })

  it('keeps the earliest date any list gives, and a date over none', () => {
    const merged = mergeIssues(
      'events',
      [{ slug: 'week-41-2026', sentAt: '2026-10-09T15:47:00.000Z' }],
      [{ slug: 'week-41-2026', sentAt: '2026-10-08T15:32:00.000Z' }],
      [{ slug: 'week-41-2026', sentAt: null }],
      [{ slug: 'week-42-2026', sentAt: null }],
      [{ slug: 'week-42-2026', sentAt: '2026-10-15T15:32:00.000Z' }]
    )
    expect(merged).toEqual([
      { slug: 'week-42-2026', sentAt: '2026-10-15T15:32:00.000Z' },
      { slug: 'week-41-2026', sentAt: '2026-10-08T15:32:00.000Z' },
    ])
  })

  it('drops addresses that are not this newsletter’s issues, and bad dates', () => {
    const merged = mergeIssues('training', [
      { slug: 'issue-23-2026', sentAt: null },
      { slug: 'week-041-2026', sentAt: null },
      { slug: 'feed', sentAt: null },
      { slug: 'week-41-2026', sentAt: 'not a date' },
    ])
    expect(merged).toEqual([{ slug: 'week-41-2026', sentAt: null }])
  })

  it('does not change the lists it was given', () => {
    const record = [{ slug: 'week-41-2026', sentAt: '2026-10-09T00:00:00Z' }]
    mergeIssues('events', record, [
      { slug: 'week-41-2026', sentAt: '2026-10-08T00:00:00Z' },
    ])
    expect(record[0].sentAt).toBe('2026-10-09T00:00:00Z')
  })
})

describe('feedXml', () => {
  const tv = textVersion(WEEK_41)

  it('has the text version to work from', () => {
    expect(tv).not.toBeNull()
  })

  const xml = feedXml('training', [
    {
      issue: { slug: 'week-42-2026', sentAt: null },
      text: null,
    },
    {
      issue: { slug: 'week-41-2026', sentAt: '2026-10-08T15:32:00.000Z' },
      text: tv,
    },
  ])

  it('is an RSS 2.0 channel for the newsletter', () => {
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"'
      )
    ).toBe(true)
    expect(xml).toContain('<title>AI Safety Training</title>')
    expect(xml).toContain(
      '<link>https://aisafety.com/newsletter/training</link>'
    )
    expect(xml).toContain(
      '<atom:link href="https://aisafety.com/newsletter/training/feed" rel="self" type="application/rss+xml"/>'
    )
  })

  it('makes each issue an item linking its web version', () => {
    expect(xml.match(/<item>/g)).toHaveLength(2)
    expect(xml).toContain('<title>Week 41, 2026</title>')
    expect(xml).toContain(
      '<guid isPermaLink="true">https://aisafety.com/newsletter/training/week-41-2026</guid>'
    )
    expect(xml).toContain('<pubDate>Thu, 08 Oct 2026 15:32:00 GMT</pubDate>')
  })

  it('dates the feed by its newest dated issue, not the time it was built', () => {
    expect(xml).toContain(
      '<lastBuildDate>Thu, 08 Oct 2026 15:32:00 GMT</lastBuildDate>'
    )
    expect(
      feedXml('training', [
        { issue: { slug: 'week-41-2026', sentAt: null }, text: null },
      ])
    ).not.toContain('lastBuildDate')
  })

  it('carries the text version, escaped, with the email’s own links', () => {
    const item = xml.slice(xml.indexOf('<title>Week 41, 2026</title>'))
    const description = /<description>([\s\S]*?)<\/description>/.exec(item)![1]
    expect(description).not.toMatch(/<(?!\/?description)/)
    expect(description).toContain('&lt;p&gt;')
    expect(description).toContain('https://aisafety.com/api/nl/')
  })

  it('links the web version when an issue has no text version', () => {
    const item = xml.slice(xml.indexOf('<title>Week 42, 2026</title>'))
    expect(item).toContain(
      '&lt;a href=&quot;https://aisafety.com/newsletter/training/week-42-2026&quot;&gt;Read this issue on AISafety.com&lt;/a&gt;'
    )
    expect(item.indexOf('<pubDate>')).toBeGreaterThan(item.indexOf('</item>'))
  })

  it('is well-formed XML with no stray ampersands', () => {
    // Every & starts an entity.
    expect(xml).not.toMatch(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i)
  })

  it('carries at most FEED_ITEMS issues', () => {
    expect(FEED_ITEMS).toBe(20)
  })
})

describe('feedEtag / etagMatches', () => {
  it('changes with the body and matches what it gave', () => {
    const a = feedEtag('<rss>a</rss>')
    expect(a).toMatch(/^"[A-Za-z0-9_-]{27}"$/)
    expect(feedEtag('<rss>a</rss>')).toBe(a)
    expect(feedEtag('<rss>b</rss>')).not.toBe(a)
    expect(etagMatches(a, a)).toBe(true)
    expect(etagMatches(`"x", W/${a}`, a)).toBe(true)
    expect(etagMatches('*', a)).toBe(true)
    expect(etagMatches('"x"', a)).toBe(false)
    expect(etagMatches(null, a)).toBe(false)
  })
})

describe('feedReader', () => {
  it('takes a feed service’s own count of its users', () => {
    expect(
      feedReader(
        'Feedly/1.0 (+http://www.feedly.com/fetcher.html; 12 subscribers; like FeedFetcher-Google)'
      )
    ).toEqual({
      kind: 'service',
      service:
        'Feedly/1.0 (+http://www.feedly.com/fetcher.html; ; like FeedFetcher-Google)',
      readers: 12,
    })
    expect(
      feedReader(
        'Mozilla/5.0 (compatible; Inoreader/1.0; https://www.inoreader.com; 3 subscribers)'
      )
    ).toMatchObject({ kind: 'service', readers: 3 })
    expect(
      feedReader(
        'NewsBlur Feed Fetcher - 1 subscriber - https://www.newsblur.com/site/1 (Mozilla/5.0)'
      )
    ).toMatchObject({ kind: 'service', readers: 1 })
  })

  it('counts a reader app as one person', () => {
    expect(
      feedReader('NetNewsWire (RSS Reader; https://netnewswire.com/)')
    ).toEqual({ kind: 'direct' })
    expect(feedReader('FreshRSS/1.24.3 (Linux; https://freshrss.org)')).toEqual(
      { kind: 'direct' }
    )
  })

  it('counts no search engine, script or empty agent', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'curl/8.7.1',
      'python-requests/2.32.3',
      'Go-http-client/1.1',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      '',
      null,
    ])
      expect(feedReader(ua)).toBeNull()
  })
})
