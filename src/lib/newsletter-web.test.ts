import { describe, expect, it } from 'vitest'
import {
  beforeBodyEnd,
  issueName,
  missingPage,
  seenImage,
  webPage,
  webPath,
} from './newsletter-web'

describe('issue addresses', () => {
  it('turn into the campaign name the pipeline gives the issue', () => {
    expect(issueName('events', 'week-41-2026')).toBe('Events · Week 41, 2026')
    expect(issueName('training', 'week-7-2027')).toBe('Training · Week 7, 2027')
    expect(issueName('funding', 'issue-21-2026')).toBe(
      'Funding · Issue #21, 2026'
    )
  })

  it('refuse anything else: the wrong unit, leading zeros, other newsletters', () => {
    for (const [key, slug] of [
      ['events', 'issue-41-2026'],
      ['funding', 'week-21-2026'],
      ['events', 'week-041-2026'],
      ['events', 'week-0-2026'],
      ['events', 'week-41-1999'],
      ['events', 'Week-41-2026'],
      ['events', 'week-41-2026.html'],
      ['events', '../week-41-2026'],
      ['updates', 'week-41-2026'],
      ['constructor', 'week-41-2026'],
      ['__proto__', 'issue-1-2026'],
    ])
      expect(issueName(key, slug)).toBeNull()
  })

  it('go both ways, waves included', () => {
    expect(webPath('Events · Week 41, 2026')).toBe(
      '/newsletter/events/week-41-2026'
    )
    expect(webPath('Training · Week 41, 2026 · wave 2/4')).toBe(
      '/newsletter/training/week-41-2026'
    )
    expect(webPath('Funding · Issue #21, 2026')).toBe(
      '/newsletter/funding/issue-21-2026'
    )
    expect(webPath('Events & Training · Week 36, 2026')).toBeNull()
    expect(webPath('Funding · Week 21, 2026')).toBeNull()
    for (const name of [
      'Events · Week 1, 2026',
      'Training · Week 52, 2027',
      'Funding · Issue #3, 2026',
    ]) {
      const [, , key, slug] = webPath(name)!.split('/')
      expect(issueName(key, slug)).toBe(name)
    }
  })
})

// The email's footer as ~/Newsletter/render.py writes it (30 Sept 2026).
const LINKS =
  '<div style="margin-top:24px;font-size:13px;">\n' +
  '  <a href="%UNSUBSCRIBELINK%" class="fl" style="color:#aab2b3;">Unsubscribe</a>\n' +
  '  &nbsp;&middot;&nbsp; <a href="%WEBCOPY%" class="fl" style="color:#aab2b3;">View in browser</a>\n' +
  '</div>\n' +
  '<div style="margin-top:8px;font-size:12px;">%SENDER-INFO-SINGLELINE%</div>'
const DIVIDER =
  '<div style="margin-top:24px;border-top:1px solid #1c3334;"></div>\n'

function email(footer: string) {
  return (
    '<!--aisafety-issue:0123456789abcdef--><!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<title>Week 41, 2026</title>\n</head>\n<body>\n<h1>Events</h1>\n' +
    '<a href="https://aisafety.com/api/nl/0123456789abcdef/0">The Big Tent</a>\n' +
    footer +
    '<!--aisafety-cards:eyJ2IjoxfQ==-->\n</body>\n</html>'
  )
}

describe('webPage', () => {
  it('leaves out the marked footer, the marker and the manifest', () => {
    const page = webPage(
      email(`<!--web:hide-->${DIVIDER}${LINKS}<!--/web:hide-->`)
    )
    expect(page).not.toMatch(/%[A-Z]/)
    expect(page).not.toContain('Unsubscribe')
    expect(page).not.toContain('View in browser')
    expect(page).not.toContain('border-top')
    expect(page).not.toContain('aisafety-issue')
    expect(page).not.toContain('aisafety-cards')
    expect(page).toContain('<h1>Events</h1>')
    expect(page).toContain(
      'href="https://aisafety.com/api/nl/0123456789abcdef/0"'
    )
    expect(page).toMatch(/^<!DOCTYPE html>/)
  })

  it('links the text version in place of the footer, once', () => {
    const page = webPage(
      email(
        `<!--web:hide-->${DIVIDER}${LINKS}<!--/web:hide--><!--web:hide-->x<!--/web:hide-->`
      ),
      '/newsletter/events/week-41-2026/text'
    )
    expect(page).not.toContain('Unsubscribe')
    expect(page.match(/>Text version</g)).toHaveLength(1)
    expect(page).toContain(
      '<a href="/newsletter/events/week-41-2026/text" style="color:#aab2b3;text-decoration:underline;text-decoration-color:#325354;">Text version</a>'
    )
    expect(
      webPage(email(`<!--web:hide-->${LINKS}<!--/web:hide-->`))
    ).not.toContain('>Text version<')
  })

  it('loads the image that counts the view at the end of the body', () => {
    const seen = seenImage('events', 'week-41-2026', 'web')
    expect(seen).toBe(
      '<img src="/newsletter/events/week-41-2026/seen?as=web" width="1" height="1" alt="" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">'
    )
    const page = webPage(email(''), undefined, seen)
    expect(page).toMatch(
      /<img src="\/newsletter\/events\/week-41-2026\/seen\?as=web"[^>]*>\s*<\/body>/
    )
    expect(page.match(/seen\?as=/g)).toHaveLength(1)
    // Without one, nothing is added.
    expect(webPage(email(''))).not.toContain('/seen?')
  })

  it('puts an addition before the closing body tag, or at the end without one', () => {
    expect(beforeBodyEnd('<p>a</p></BODY></html>', '<i>')).toBe(
      '<p>a</p><i></BODY></html>'
    )
    expect(beforeBodyEnd('<p>a</p>', '<i>')).toBe('<p>a</p><i>')
    expect(beforeBodyEnd('<p>a</p></body>', '')).toBe('<p>a</p></body>')
  })

  it('keeps the page out of search engines', () => {
    expect(webPage(email(''))).toContain(
      '<head>\n<meta name="robots" content="noindex">\n<meta charset="utf-8">'
    )
  })

  it('also cleans emails built before the markers', () => {
    const page = webPage(email(DIVIDER + LINKS))
    expect(page).not.toMatch(/%[A-Z]/)
    expect(page).not.toContain('Unsubscribe')
    expect(page).not.toContain('View in browser')
    expect(page).not.toContain('&middot;')
  })

  it('never shows one of ActiveCampaign’s tags as text', () => {
    const page = webPage(
      email(
        '<p><a href="%FORWARD2FRIEND%">Forward</a> %UNSUBSCRIBELINK% %WEBCOPY% %SENDER-INFO-SINGLELINE%</p>'
      )
    )
    expect(page).not.toMatch(/%[A-Z]/)
    expect(page).toContain('<p>Forward   </p>')
  })

  it('keeps the words of a link that only works in the email', () => {
    const note =
      '<p>If you only want to receive the training newsletter, you can <a href="%UNSUBSCRIBELINK%" style="color:#a6dad9;">' +
      'unsubscribe from this events newsletter</a>.</p>'
    expect(webPage(email(note))).toContain(
      '<p>If you only want to receive the training newsletter, you can unsubscribe from this events newsletter.</p>'
    )
  })

  it('leaves percentages in the text alone', () => {
    expect(webPage(email('<p>50% of 20% match</p>'))).toContain(
      '<p>50% of 20% match</p>'
    )
  })
})

describe('missingPage', () => {
  it('points at the newsletter’s own page, and at the homepage otherwise', () => {
    expect(missingPage('training')).toContain(
      '<a href="https://aisafety.com/training">AISafety.com/training</a>'
    )
    expect(missingPage('nope')).toContain(
      '<a href="https://aisafety.com">AISafety.com</a>'
    )
    expect(missingPage('<script>')).not.toContain('<script>')
    expect(missingPage('events')).toContain('noindex')
  })
})
