import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AC_FORMS,
  AC_PROC_URL,
  SIGNUP_USER_AGENT,
  isFormConfigured,
  isSignupNewsletter,
  logSnippet,
  normalizeEmail,
  postSignup,
  readAcAnswer,
  redactEmails,
  signupFields,
} from './newsletter-signup'

// The ActiveCampaign transport for the newsletter signup boxes: which
// newsletters it takes, the address check, reading ActiveCampaign's answer,
// and the one request, with a pretend fetch. Nothing touches the network.

const FORM = { formId: 12, orKey: 'a1b2c3d4e5f6' }
const EMAIL = 'Ada.Lovelace+news@example.org'

const THANK_YOU = `_show_thank_you("12", "Thank you for subscribing!", "https:\\/\\/trackcmp.net\\/visit?actid=1&e=ada.lovelace%2Bnews%40example.org&r=x", "${EMAIL}");`
const INVALID = '_show_error("12", "Please enter a valid email address.", "");'
const CLOUDFLARE_PAGE =
  '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>'
/** A hosted form page: its script defines the callbacks but calls neither. */
const FORM_PAGE = `<!DOCTYPE html><html><body><form action="proc.php"></form><script>
function _show_thank_you(id, message, trackcmp_url, email) { document.title = message }
window._show_error = function(id, message, html) { alert(message) }
</script></body></html>`

function answer(status: number, body: string) {
  return vi.fn<
    (url: string | URL | Request, init?: RequestInit) => Promise<Response>
  >(async () => new Response(body, { status }))
}

let logs: string[] = []

beforeEach(() => {
  logs = []
  const keep = (...args: unknown[]) =>
    void logs.push(args.map(String).join(' '))
  vi.spyOn(console, 'log').mockImplementation(keep)
  vi.spyOn(console, 'warn').mockImplementation(keep)
  vi.spyOn(console, 'error').mockImplementation(keep)
})

afterEach(() => {
  // Whatever happened, the address never reached the log in any form.
  for (const line of logs) {
    expect(line.toLowerCase()).not.toContain(EMAIL.toLowerCase())
    expect(line.toLowerCase()).not.toContain('ada.lovelace')
  }
  vi.restoreAllMocks()
})

describe('which newsletters sign up here', () => {
  it('takes Events and Training only', () => {
    expect(isSignupNewsletter('events')).toBe(true)
    expect(isSignupNewsletter('training')).toBe(true)
    for (const other of ['funding', 'updates', 'Events', '', null, 6]) {
      expect(isSignupNewsletter(other)).toBe(false)
    }
  })

  it('treats a form left at its placeholders as not configured', () => {
    expect(isFormConfigured({ formId: 0, orKey: '' })).toBe(false)
    expect(isFormConfigured({ formId: 12, orKey: ' ' })).toBe(false)
    expect(isFormConfigured({ formId: 0, orKey: 'abc' })).toBe(false)
    expect(isFormConfigured({ formId: 1.5, orKey: 'abc' })).toBe(false)
    expect(isFormConfigured({ ...FORM, u: 0 })).toBe(false)
    expect(isFormConfigured(FORM)).toBe(true)
    expect(isFormConfigured({ ...FORM, u: 3 })).toBe(true)
  })

  it('ships with both forms keyed, however they are filled in', () => {
    expect(Object.keys(AC_FORMS).sort()).toEqual(['events', 'training'])
  })
})

describe('normalizeEmail', () => {
  it('trims, drops invisible characters, and lowercases the domain only', () => {
    expect(normalizeEmail('  Ada@Example.COM \n')).toBe('Ada@example.com')
    expect(normalizeEmail('\u200Bada@example.com\uFEFF')).toBe(
      'ada@example.com'
    )
  })

  it('accepts ordinary addresses', () => {
    for (const ok of [
      'a@b.co',
      'first.last@example.org',
      'ada+news@example.org',
      "o'brien@example.ie",
      'x_y-z@mail.sub.example.co.uk',
      'someone@xn--80ak6aa92e.com',
      'n@example.xn--p1ai',
    ]) {
      expect(normalizeEmail(ok)).toBe(ok)
    }
  })

  it('refuses what cannot be an address', () => {
    for (const bad of [
      '',
      '   ',
      'ada',
      'ada@',
      '@example.com',
      'ada@example',
      'ada@@example.com',
      'ada@b@example.com',
      'ada lovelace@example.com',
      'ada@exa mple.com',
      '.ada@example.com',
      'ada.@example.com',
      'a..da@example.com',
      'ada@example..com',
      'ada@example.com.',
      'ada@-example.com',
      'ada@example.c',
      'ada@example.123',
      '<ada@example.com>',
      'ada@example.com, bob@example.com',
      `${'a'.repeat(65)}@example.com`,
      `ada@${'a'.repeat(250)}.com`,
      42,
      null,
      undefined,
    ]) {
      expect(normalizeEmail(bad)).toBeNull()
    }
  })

  it('caps the whole address at 254 characters', () => {
    const local = 'x'.repeat(64)
    const domain = `${'a'.repeat(61)}.${'b'.repeat(61)}.${'c'.repeat(61)}.com`
    expect(`${local}@${domain}`).toHaveLength(254)
    expect(normalizeEmail(`${local}@${domain}`)).toBe(`${local}@${domain}`)
    expect(normalizeEmail(`${local}@c${domain}`)).toBeNull()
  })
})

describe('readAcAnswer', () => {
  it('counts a clear thank-you as subscribed', () => {
    expect(readAcAnswer(200, THANK_YOU)).toEqual({ kind: 'subscribed' })
    expect(
      readAcAnswer(200, "window._show_thank_you(12,'Thanks!','','')")
    ).toEqual({ kind: 'subscribed' })
  })

  it('reads an error about the address as an invalid email', () => {
    expect(readAcAnswer(200, INVALID)).toEqual({
      kind: 'rejected',
      message: 'Please enter a valid email address.',
      invalidEmail: true,
    })
  })

  it("keeps other errors apart, as they aren't the reader's to fix", () => {
    const a = readAcAnswer(
      200,
      `_show_error('12', 'Please verify you\\'re <b>human</b>.', '')`
    )
    expect(a).toEqual({
      kind: 'rejected',
      message: "Please verify you're human .",
      invalidEmail: false,
    })
  })

  it('never counts a thank-you that also carries an error', () => {
    expect(readAcAnswer(200, `${INVALID}${THANK_YOU}`).kind).toBe('rejected')
  })

  it('reads a Cloudflare check as turned away, whatever the status', () => {
    expect(readAcAnswer(403, CLOUDFLARE_PAGE)).toEqual({ kind: 'blocked' })
    expect(readAcAnswer(503, CLOUDFLARE_PAGE)).toEqual({ kind: 'blocked' })
    expect(readAcAnswer(200, CLOUDFLARE_PAGE)).toEqual({ kind: 'blocked' })
  })

  it('does not mistake a page defining the callbacks for a thank-you', () => {
    expect(readAcAnswer(200, FORM_PAGE)).toEqual({ kind: 'unknown' })
    expect(
      readAcAnswer(
        200,
        `<html><body><script>${THANK_YOU}</script></body></html>`
      )
    ).toEqual({ kind: 'unknown' })
  })

  it('needs a 2xx for a thank-you', () => {
    expect(readAcAnswer(500, THANK_YOU)).toEqual({ kind: 'unknown' })
    expect(readAcAnswer(403, THANK_YOU)).toEqual({ kind: 'blocked' })
  })

  it('reads other answers by status', () => {
    expect(readAcAnswer(200, '')).toEqual({ kind: 'unknown' })
    expect(readAcAnswer(200, '{"success":1}')).toEqual({ kind: 'unknown' })
    expect(readAcAnswer(404, 'Not found')).toEqual({ kind: 'blocked' })
    expect(readAcAnswer(429, 'Slow down')).toEqual({ kind: 'blocked' })
    expect(readAcAnswer(500, 'Server error')).toEqual({ kind: 'unknown' })
    expect(readAcAnswer(302, '')).toEqual({ kind: 'unknown' })
  })
})

describe('keeping the address out of the log', () => {
  it('redacts the address however it is written, and any other address', () => {
    const text = `${THANK_YOU} ADA.LOVELACE+NEWS@EXAMPLE.ORG ${encodeURIComponent(EMAIL)} other@example.net`
    const out = redactEmails(text, EMAIL)
    expect(out.toLowerCase()).not.toContain('lovelace')
    expect(out).not.toContain('other@example.net')
    expect(out).toContain('[email]')
    expect(out).toContain('Thank you for subscribing!')
  })

  it('keeps the log line short and on one line', () => {
    const line = logSnippet(`${'x '.repeat(300)}\n${EMAIL}`, EMAIL)
    expect(line.length).toBeLessThanOrEqual(206)
    expect(line).not.toContain('\n')
    expect(line.endsWith('[cut]')).toBe(true)
    expect(logSnippet('short\n answer', EMAIL)).toBe('short answer')
  })
})

describe('signupFields', () => {
  it("sends the hosted form's fields for the address", () => {
    expect(Object.fromEntries(signupFields(FORM, EMAIL))).toEqual({
      u: '12',
      f: '12',
      s: '',
      c: '0',
      m: '0',
      act: 'sub',
      v: '2',
      or: 'a1b2c3d4e5f6',
      email: EMAIL,
      jsonp: 'true',
    })
    expect(signupFields({ ...FORM, u: 7 }, EMAIL).get('u')).toBe('7')
  })
})

describe('postSignup', () => {
  it("posts the form to ActiveCampaign's endpoint as itself", async () => {
    const fetchImpl = answer(200, THANK_YOU)
    const result = await postSignup('events', FORM, EMAIL, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({ outcome: 'subscribed' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(AC_PROC_URL)
    expect(String(url)).toContain('alignment23684.activehosted.com/proc.php')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('user-agent')).toBe(SIGNUP_USER_AGENT)
    expect(SIGNUP_USER_AGENT).not.toMatch(/Mozilla|Chrome|Safari/)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    const body = init?.body as URLSearchParams
    expect(body.get('email')).toBe(EMAIL)
    expect(body.get('f')).toBe('12')
    expect(body.get('or')).toBe('a1b2c3d4e5f6')
    expect(body.get('act')).toBe('sub')
    expect(body.get('jsonp')).toBe('true')
    expect(logs.some(l => l.includes('took the signup (HTTP 200)'))).toBe(true)
  })

  it('reports an invalid address that ActiveCampaign refused', async () => {
    const result = await postSignup('training', FORM, EMAIL, {
      fetchImpl: answer(200, INVALID) as unknown as typeof fetch,
    })
    expect(result).toEqual({ outcome: 'invalid_email' })
    expect(logs.join('\n')).toContain('refused the signup (HTTP 200)')
  })

  it('fails without a send on any other refusal', async () => {
    const result = await postSignup('events', FORM, EMAIL, {
      fetchImpl: answer(
        200,
        '_show_error("12", "This form is no longer accepting submissions.", "")'
      ) as unknown as typeof fetch,
    })
    expect(result).toEqual({ outcome: 'failed', mayHaveSent: false })
  })

  it('fails on a Cloudflare check, logging the status and the start of it', async () => {
    const result = await postSignup('events', FORM, EMAIL, {
      fetchImpl: answer(403, CLOUDFLARE_PAGE) as unknown as typeof fetch,
    })
    expect(result).toEqual({ outcome: 'failed', mayHaveSent: false })
    const line = logs.find(l => l.includes('HTTP 403'))
    expect(line).toContain('Just a moment')
    expect(line!.length).toBeLessThan(320)
  })

  it('fails on an unclear answer, which may still have been processed', async () => {
    const result = await postSignup('events', FORM, EMAIL, {
      fetchImpl: answer(200, FORM_PAGE) as unknown as typeof fetch,
    })
    expect(result).toEqual({ outcome: 'failed', mayHaveSent: true })
    expect(logs.join('\n')).toContain('unclear answer from ActiveCampaign')
  })

  it('gives up when ActiveCampaign takes too long', async () => {
    // Answers only when the request's own timeout signal fires.
    const slow = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal!.reason)
          )
        })
    )
    const result = await postSignup('events', FORM, EMAIL, {
      fetchImpl: slow as unknown as typeof fetch,
      timeoutMs: 20,
    })
    expect(result).toEqual({ outcome: 'failed', mayHaveSent: true })
    expect(logs.join('\n')).toContain("didn't answer within")
  })

  it('fails without a send when ActiveCampaign is unreachable', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      })
    })
    const result = await postSignup('events', FORM, EMAIL, {
      fetchImpl: down as unknown as typeof fetch,
    })
    expect(result).toEqual({ outcome: 'failed', mayHaveSent: false })
    expect(logs.join('\n')).toContain('ECONNREFUSED')
  })
})
