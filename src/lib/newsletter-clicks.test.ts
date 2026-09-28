import { describe, expect, it } from 'vitest'
import {
  isLikelyBot,
  LIST_ID_RE,
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

  it('refuses anything that is not a plain http(s) link, so nothing else is ever redirected to', () => {
    for (const u of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'mailto:x@y.z',
      'not a url',
    ]) {
      expect(
        parseLinkList({ ...list, links: [{ u, k: 'page', t: 'x' }] })
      ).toBeNull()
    }
  })

  it('refuses malformed lists', () => {
    expect(parseLinkList(null)).toBeNull()
    expect(parseLinkList({ ...list, v: 2 })).toBeNull()
    expect(parseLinkList({ ...list, links: 'x' })).toBeNull()
    expect(parseLinkList({ ...list, links: [{ u: 'https://a.b' }] })).toBeNull()
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
