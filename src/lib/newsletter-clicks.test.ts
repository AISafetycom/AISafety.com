import { describe, expect, it } from 'vitest'
import {
  HOMEPAGE,
  isBurst,
  isLikelyBot,
  LIST_ID_RE,
  matchesListId,
  parseLinkList,
  summariseClicks,
} from './newsletter-clicks'

// The shape ~/Newsletter/render.py track_links() saves to the Blob store.
const list = {
  v: 1,
  c: 'Training · Week 39, 2026',
  links: [
    {
      u: 'https://www.aisafety.com?utm_source=x',
      k: 'page',
      t: 'aisafety.com',
    },
    {
      u: 'https://lensacademy.org/courses/theory?utm_source=aisafety.com',
      k: 'recfEPy5dMqKPzLAc',
      t: 'Lens Academy: Alignment Theory of Deep Learning',
    },
  ],
}

describe('parseLinkList', () => {
  it('reads the list the pipeline writes', () => {
    const parsed = parseLinkList(list)
    expect(parsed?.c).toBe('Training · Week 39, 2026')
    expect(parsed?.links[1].k).toBe('recfEPy5dMqKPzLAc')
  })

  it('sends only a bad entry to the homepage, keeping every link in its place', () => {
    const parsed = parseLinkList({
      ...list,
      links: [
        list.links[0],
        { u: 'javascript:alert(1)', k: 'recA', t: 'Bad scheme' },
        { u: 'not a url', k: 'recB', t: 'Not a URL' },
        { u: 'data:text/html,hi', k: 'recC', t: 'Data' },
        { u: 'mailto:x@y.z', k: 'recD', t: 'Mail' },
        null,
        42,
        { k: 'recE', t: 'No link' },
        list.links[1],
      ],
    })
    expect(parsed?.links).toHaveLength(9)
    expect(parsed?.links[0].u).toBe('https://www.aisafety.com/?utm_source=x')
    for (const i of [1, 2, 3, 4, 5, 6, 7]) {
      expect(parsed?.links[i].u).toBe(HOMEPAGE)
      expect(parsed?.links[i].fallback).toBe(true)
    }
    // Its label stays, so the count still says which card it was.
    expect(parsed?.links[1]).toMatchObject({ k: 'recA', t: 'Bad scheme' })
    expect(parsed?.links[8]).toEqual({
      u: 'https://lensacademy.org/courses/theory?utm_source=aisafety.com',
      k: 'recfEPy5dMqKPzLAc',
      t: 'Lens Academy: Alignment Theory of Deep Learning',
    })
  })

  it('keeps a good link whose labels are missing', () => {
    expect(
      parseLinkList({ ...list, links: [{ u: 'https://a.b' }] })?.links
    ).toEqual([{ u: 'https://a.b/', k: 'page', t: 'aisafety.com' }])
  })

  it('refuses lists that are not ours at all', () => {
    expect(parseLinkList(null)).toBeNull()
    expect(parseLinkList('x')).toBeNull()
    expect(parseLinkList({ ...list, v: 2 })).toBeNull()
    expect(parseLinkList({ ...list, c: 3 })).toBeNull()
    expect(parseLinkList({ ...list, links: 'x' })).toBeNull()
  })
})

describe('matchesListId', () => {
  // The pipeline's own name for `list` (Python: json.dumps(ensure_ascii=
  // False, separators=(',', ':')), SHA-256, first 16 hex characters).
  const raw = new TextEncoder().encode(JSON.stringify(list))

  it('agrees with the name the pipeline gives a list', () => {
    expect(matchesListId('cedf00e8e8cef64c', raw)).toBe(true)
  })

  it('refuses a list whose content changed after it was named', () => {
    const edited = new TextEncoder().encode(
      JSON.stringify(list).replace('lensacademy.org', 'lensacademy.example')
    )
    expect(matchesListId('cedf00e8e8cef64c', edited)).toBe(false)
  })
})

describe('LIST_ID_RE', () => {
  it('accepts the pipeline’s 16-character content hashes only', () => {
    expect(LIST_ID_RE.test('9f2508f0afd61145')).toBe(true)
    expect(LIST_ID_RE.test('../../etc/passwd')).toBe(false)
    expect(LIST_ID_RE.test('9F2508F0AFD61145')).toBe(false)
  })
})

describe('isLikelyBot', () => {
  it('lets ordinary browsers through', () => {
    expect(
      isLikelyBot(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
      )
    ).toBe(false)
    expect(
      isLikelyBot(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
      )
    ).toBe(false)
  })

  it('skips link checkers, prefetchers and scripts', () => {
    for (const ua of [
      'Googlebot/2.1',
      'Mozilla/5.0 (compatible; Barracuda Sentinel)',
      'curl/8.7.1',
      'python-requests/2.31',
      'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0)',
      '',
      null,
    ]) {
      expect(isLikelyBot(ua)).toBe(true)
    }
  })

  it('skips link previews, Office link checks and mail security gateways', () => {
    for (const ua of [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0 A',
      'Microsoft Office Word 2014',
      'Mozilla/4.0 (compatible; ms-office; MSOffice 16)',
      'MSOffice 16',
      'Outlook-Android/2.0',
      'Google-Safety',
      'Iframely/1.3.1 (+https://iframely.com/docs/about)',
      'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)',
      'libwww-perl/6.72',
      'Mozilla/5.0 zgrab/0.x',
      'Zscaler/6.2',
      'Cisco-IronPort-WSA/12.5',
    ]) {
      expect(isLikelyBot(ua)).toBe(true)
    }
  })

  it('still lets phones and other browsers through', () => {
    for (const ua of [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0',
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
    ]) {
      expect(isLikelyBot(ua)).toBe(false)
    }
  })
})

describe('isBurst', () => {
  const S = 1000

  it('catches a scanner opening several links at once, every click of it', () => {
    const times = [0, 120, 250, 400, 610]
    for (const at of times) expect(isBurst(times, at)).toBe(true)
  })

  it('catches three links inside ten seconds', () => {
    expect(isBurst([0, 5 * S, 9.9 * S], 0)).toBe(true)
    expect(isBurst([0, 5 * S, 9.9 * S], 9.9 * S)).toBe(true)
  })

  it('leaves a reader opening links a few seconds apart alone', () => {
    const times = [0, 9 * S, 18 * S]
    for (const at of times) expect(isBurst(times, at)).toBe(false)
    expect(isBurst([0, 2 * S], 2 * S)).toBe(false)
    expect(isBurst([0], 0)).toBe(false)
  })
})

describe('summariseClicks', () => {
  it('turns a campaign’s stored counts into a total and links, most clicked first', () => {
    const s = summariseClicks({
      __total: '5',
      [JSON.stringify({ t: 'Lens Academy', u: 'https://lensacademy.org/' })]:
        '4',
      [JSON.stringify({ t: 'aisafety.com', u: 'https://www.aisafety.com/' })]:
        1,
      'not ours': '9',
    })
    expect(s.total).toBe(5)
    expect(s.links.map(l => [l.label, l.clicks])).toEqual([
      ['Lens Academy', 4],
      ['aisafety.com', 1],
    ])
  })

  it('is empty for a campaign nobody clicked', () => {
    expect(summariseClicks(null)).toEqual({ total: 0, links: [] })
  })
})
