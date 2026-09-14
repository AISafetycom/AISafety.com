import { describe, expect, it } from 'vitest'
import { approvedMail, requestMail, sendAdminMail } from './mail'

describe('requestMail', () => {
  it('names the person, the time and the approval link in both bodies', () => {
    const m = requestMail({
      email: 'someone@example.com',
      name: 'Some One',
      at: '2026-09-04T16:30:00.000Z',
      count: 2,
      adminUrl: 'https://aisafety.com/admin/users',
    })
    expect(m.subject).toBe('Admin access requested by Some One')
    for (const body of [m.text, m.html]) {
      expect(body).toContain('someone@example.com')
      expect(body).toContain('4 September 2026')
      expect(body).toContain('try number 2')
      expect(body).toContain('https://aisafety.com/admin/users')
    }
  })

  it('falls back to the email when Google sent no name and escapes HTML', () => {
    const m = requestMail({
      email: 'a<b@example.com',
      name: null,
      at: '2026-09-04T16:30:00.000Z',
      count: 1,
      adminUrl: 'https://aisafety.com/admin/users',
    })
    expect(m.subject).toBe('Admin access requested by a<b@example.com')
    expect(m.html).toContain('a&lt;b@example.com')
    expect(m.text).toContain('first try')
  })
})

describe('approvedMail', () => {
  it('gives the sign-in link, greeting by first name, without listing tabs', () => {
    const m = approvedMail({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      loginUrl: 'https://aisafety.com/admin/login',
    })
    expect(m.text).toContain('Hi Ada,')
    expect(m.text).not.toContain('Tabs you can open')
    expect(m.text).not.toContain('Bryce')
    expect(m.html).toContain('https://aisafety.com/admin/login')
  })
})

describe('sendAdminMail', () => {
  const mail = approvedMail({
    email: 'x@example.com',
    name: null,
    loginUrl: 'https://aisafety.com/admin/login',
  })

  it('does nothing without configuration and never throws', async () => {
    delete process.env.ADMIN_MAIL_SCRIPT_URL
    delete process.env.ADMIN_MAIL_SECRET
    expect(await sendAdminMail('approved', 'x@example.com', mail)).toBe(false)
  })

  it('posts kind, recipient and the shared secret to the script', async () => {
    process.env.ADMIN_MAIL_SCRIPT_URL = 'https://script.example/exec'
    process.env.ADMIN_MAIL_SECRET = 'shared-secret'
    let seen: { url: string; init: RequestInit } | null = null
    const fakeFetch = (async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      seen = { url: String(url), init: init ?? {} }
      return new Response('{"ok":true,"emailed":true}', { status: 200 })
    }) as typeof fetch
    const ok = await sendAdminMail('approved', 'x@example.com', mail, fakeFetch)
    expect(ok).toBe(true)
    expect(seen!.url).toBe('https://script.example/exec')
    const body = JSON.parse(String(seen!.init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      secret: 'shared-secret',
      kind: 'approved',
      to: 'x@example.com',
      subject: mail.subject,
    })
  })

  it('reports false when the script refuses or fails to send', async () => {
    process.env.ADMIN_MAIL_SCRIPT_URL = 'https://script.example/exec'
    process.env.ADMIN_MAIL_SECRET = 'shared-secret'
    const refusing = (async () =>
      new Response('{"ok":false,"error":"unauthorized"}', {
        status: 200,
      })) as typeof fetch
    expect(
      await sendAdminMail('request', 'o@example.com', mail, refusing)
    ).toBe(false)
    const notSent = (async () =>
      new Response('{"ok":true,"emailed":false}', {
        status: 200,
      })) as typeof fetch
    expect(await sendAdminMail('request', 'o@example.com', mail, notSent)).toBe(
      false
    )
    delete process.env.ADMIN_MAIL_SCRIPT_URL
    delete process.env.ADMIN_MAIL_SECRET
  })
})
