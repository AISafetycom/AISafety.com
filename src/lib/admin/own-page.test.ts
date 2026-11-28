import { describe, expect, it } from 'vitest'
import { notOwnPage, notOwnPageRequest } from './own-page'

const HOSTS = ['aisafety.com']

function check(
  headers: Record<string, string>,
  opts: { json: boolean } = { json: true }
) {
  const h = new Headers(headers)
  return notOwnPage(h, HOSTS, opts)
}
const JSON_TYPE = { 'Content-Type': 'application/json' }

describe("a write from the admin's own page", () => {
  it('is JSON, as the page sends it', () => {
    expect(check(JSON_TYPE)).toBeNull()
    expect(
      check({ 'Content-Type': 'application/json; charset=utf-8' })
    ).toBeNull()
    expect(check({ 'Content-Type': 'Application/JSON' })).toBeNull()
  })
  it('is never one of the types a page elsewhere can send unasked', () => {
    for (const type of [
      'text/plain',
      'text/plain;charset=UTF-8',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/jsonp',
      'text/json',
      '',
    ]) {
      expect(check(type ? { 'Content-Type': type } : {})).toBe('not JSON')
    }
  })
  it('is taken when the browser says it came from this very site', () => {
    expect(check({ ...JSON_TYPE, 'Sec-Fetch-Site': 'same-origin' })).toBeNull()
    expect(
      check({
        ...JSON_TYPE,
        'Sec-Fetch-Site': 'same-origin',
        // Behind a proxy that rewrites the host, the browser's word stands.
        Origin: 'https://www.aisafety.com',
      })
    ).toBeNull()
    expect(check({ ...JSON_TYPE, Origin: 'https://aisafety.com' })).toBeNull()
    expect(check({ ...JSON_TYPE, Origin: 'https://AISafety.com' })).toBeNull()
  })
  it('is refused from another host under the same domain', () => {
    expect(check({ ...JSON_TYPE, 'Sec-Fetch-Site': 'same-site' })).toMatch(
      /another site/
    )
    expect(
      check({ ...JSON_TYPE, Origin: 'https://preview.aisafety.com' })
    ).toMatch(/another origin/)
    expect(
      check({ ...JSON_TYPE, Origin: 'https://aisafety.com.evil.example' })
    ).toMatch(/another origin/)
  })
  it('is refused from another site altogether', () => {
    expect(check({ ...JSON_TYPE, 'Sec-Fetch-Site': 'cross-site' })).toMatch(
      /another site/
    )
    expect(check({ ...JSON_TYPE, Origin: 'https://evil.example' })).toMatch(
      /another origin/
    )
    // A sandboxed frame or a file: its origin is the word "null".
    expect(check({ ...JSON_TYPE, Origin: 'null' })).toMatch(/origin/)
    // What the browser says wins over an Origin that looks right.
    expect(
      check({
        ...JSON_TYPE,
        'Sec-Fetch-Site': 'cross-site',
        Origin: 'https://aisafety.com',
      })
    ).toMatch(/another site/)
  })
  it('passes a caller that is no browser on the content type alone', () => {
    expect(check(JSON_TYPE)).toBeNull()
  })
})

describe("a read from the admin's own page", () => {
  it('needs no content type, but the same word on where it came from', () => {
    const read = { json: false }
    expect(check({}, read)).toBeNull()
    expect(check({ 'Sec-Fetch-Site': 'same-origin' }, read)).toBeNull()
    // Typed into the address bar by the person themselves.
    expect(check({ 'Sec-Fetch-Site': 'none' }, read)).toBeNull()
    expect(check({ 'Sec-Fetch-Site': 'same-site' }, read)).not.toBeNull()
    expect(check({ 'Sec-Fetch-Site': 'cross-site' }, read)).not.toBeNull()
    expect(check({ Origin: 'https://evil.example' }, read)).not.toBeNull()
  })
})

describe('notOwnPageRequest', () => {
  const req = (headers: Record<string, string>, host = 'localhost:3000') => ({
    headers: new Headers(headers),
    nextUrl: { host },
  })
  it('knows the site by its Host header, the forwarded one, or its URL', () => {
    const origin = { ...JSON_TYPE, Origin: 'http://localhost:3000' }
    expect(notOwnPageRequest(req(origin), { json: true })).toBeNull()
    expect(
      notOwnPageRequest(req({ ...origin, Host: 'internal:8080' }), {
        json: true,
      })
    ).toBeNull()
    expect(
      notOwnPageRequest(
        req(
          {
            ...JSON_TYPE,
            Origin: 'https://aisafety.com',
            Host: 'internal:8080',
            'X-Forwarded-Host': 'aisafety.com',
          },
          'internal:8080'
        ),
        { json: true }
      )
    ).toBeNull()
    expect(
      notOwnPageRequest(
        req({ ...JSON_TYPE, Origin: 'http://localhost:3001' }),
        { json: true }
      )
    ).not.toBeNull()
  })
})
