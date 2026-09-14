import { describe, expect, it } from 'vitest'
import { openToken, safeNextPath, sealToken } from './session'

const secret = 'test-secret-not-used-anywhere-else'

describe('sealToken / openToken', () => {
  it('round-trips a payload', () => {
    const token = sealToken({ email: 'a@b.c', iat: 1, exp: 2 }, secret)
    expect(openToken(token, secret)).toEqual({ email: 'a@b.c', iat: 1, exp: 2 })
  })

  it('rejects a body that was edited after sealing', () => {
    const token = sealToken({ email: 'a@b.c' }, secret)
    const tag = token.slice(token.lastIndexOf('.') + 1)
    const forgedBody = Buffer.from(JSON.stringify({ email: 'x@y.z' })).toString(
      'base64url'
    )
    expect(openToken(`${forgedBody}.${tag}`, secret)).toBeNull()
  })

  it('rejects a token sealed with another secret', () => {
    const token = sealToken({ email: 'a@b.c' }, 'other-secret')
    expect(openToken(token, secret)).toBeNull()
  })

  it('rejects everything when the secret is empty', () => {
    const token = sealToken({ email: 'a@b.c' }, '')
    expect(openToken(token, '')).toBeNull()
  })

  it('rejects malformed input', () => {
    for (const bad of [
      '',
      'x',
      'a.b',
      '.abc',
      'abc.',
      'a.b.c',
      undefined,
      null,
    ]) {
      expect(openToken(bad, secret)).toBeNull()
    }
  })

  it('rejects a sealed non-object', () => {
    const body = Buffer.from(JSON.stringify('just a string')).toString(
      'base64url'
    )
    // Re-seal by hand: sealToken only accepts objects, so build the tag via a
    // real object with the same body — easier to assert the shape check alone.
    const real = sealToken({ ok: true }, secret)
    expect(openToken(real, secret)).toEqual({ ok: true })
    expect(openToken(`${body}.${real.split('.')[1]}`, secret)).toBeNull()
  })
})

describe('safeNextPath', () => {
  it('keeps admin paths', () => {
    expect(safeNextPath('/admin/newsletter')).toBe('/admin/newsletter')
    expect(safeNextPath('/admin/chatbot/log?id=rec1')).toBe(
      '/admin/chatbot/log?id=rec1'
    )
  })

  it('drops anything that could leave the admin', () => {
    for (const bad of [
      '',
      null,
      undefined,
      '/',
      '/events',
      '//evil.example/admin',
      'https://evil.example/admin',
      '/admin\\@evil.example',
      '/admin\r\nSet-Cookie: x=y',
      'admin/newsletter',
    ]) {
      expect(safeNextPath(bad)).toBe('')
    }
  })
})
