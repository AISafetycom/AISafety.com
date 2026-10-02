import { describe, expect, it } from 'vitest'
import {
  approvedMail,
  newsletterApprovalMail,
  requestMail,
  sendAdminMail,
} from './mail'

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

describe('newsletterApprovalMail', () => {
  const base = {
    name: 'Events · Week 41, 2026 · wave 2/4',
    listId: '6',
    listName: 'AISafety.com Events',
    wave: 2,
    waves: 4,
    expected: 986,
    approver: 'plex',
    sendAt: '2026-10-09T14:10:00.000Z',
    campaignId: '212',
    held: false,
    maybe: false,
    override: null,
    adminUrl: 'https://aisafety.com/admin/newsletter',
  }

  it('says what, which wave, how many, when (UTC), who, and where to stop it', () => {
    const m = newsletterApprovalMail(base)
    expect(m.subject).toBe(
      'Newsletter approved: Events · Week 41, 2026 · wave 2/4 (986 people)'
    )
    expect(m.text).toBe(
      [
        '“Events · Week 41, 2026 · wave 2/4” was approved by plex and is scheduled to send.',
        '',
        'Wave: 2 of 4',
        'To: 986 people on AISafety.com Events (list 6)',
        'Sends: 9 October 2026, 14:10 UTC',
        'Approved by: plex',
        'Campaign: 212',
        '',
        'To cancel it before it sends, or pause or stop it while it’s sending: https://aisafety.com/admin/newsletter',
        '',
        'This email was sent by the admin itself, about an approval of a real newsletter list.',
      ].join('\n')
    )
    expect(m.html).toContain('<li><strong>Approved by:</strong> plex</li>')
  })

  it('covers a whole-list send, a held one, an early wave and an unclear approval, escaping HTML', () => {
    const whole = newsletterApprovalMail({
      ...base,
      name: 'Events · Week 41, 2026',
      wave: null,
      waves: null,
      expected: 3,
    })
    expect(whole.text).toContain('Wave: none – the whole list')
    expect(whole.subject).toContain('(3 people)')
    const held = newsletterApprovalMail({ ...base, held: true })
    expect(held.text).toContain(
      'ActiveCampaign is holding it for its own review'
    )
    expect(held.text).toContain('Sends: once ActiveCampaign approves it')
    const early = newsletterApprovalMail({
      ...base,
      override: 'Deadline <Friday>',
    })
    expect(early.text).toContain(
      'Sent before its wave was due, because: Deadline <Friday>'
    )
    expect(early.html).toContain('Deadline &lt;Friday&gt;')
    const maybe = newsletterApprovalMail({
      ...base,
      maybe: true,
      campaignId: null,
      expected: null,
    })
    expect(maybe.subject).toBe(
      'Newsletter: “Events · Week 41, 2026 · wave 2/4” may have been scheduled – check'
    )
    expect(maybe.text).toContain('Campaign: unknown')
    expect(maybe.text).toContain('an unknown number of people')
    expect(maybe.text).toContain('Check Recent sends, and cancel it there')
  })
})
