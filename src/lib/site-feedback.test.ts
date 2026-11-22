import { describe, expect, it } from 'vitest'
import {
  SITE_CORRECTIONS,
  SITE_FEEDBACK,
  airtableFields,
  messageText,
  ownerMail,
  pageLink,
  parseSubmission,
  type Submission,
} from './site-feedback'

const fromCard = {
  kind: 'correction',
  text: 'The deadline moved to 3 December.',
  quote: 'Apply by 1 December',
  path: '/events',
  listingName: 'AI Safety Camp',
  listingId: 'recAbCdEfGhIjKlMn',
  resource: 'Events',
  email: 'ada@example.org',
}

function parsed(body: unknown): Submission {
  const result = parseSubmission(body)
  if (!result.ok) throw new Error(result.error)
  return result.submission
}

describe('parseSubmission', () => {
  it('accepts a correction from a card, trimmed', () => {
    expect(
      parsed({ ...fromCard, text: '  The deadline moved to 3 December.\n' })
    ).toEqual(fromCard)
  })

  it('accepts feedback with only text and a page, and drops a resource', () => {
    expect(
      parsed({
        kind: 'feedback',
        text: 'Love the site',
        path: '/',
        resource: 'Events',
      })
    ).toEqual({ kind: 'feedback', text: 'Love the site', path: '/' })
  })

  it('puts a multi-line quote on one line', () => {
    expect(parsed({ ...fromCard, quote: 'Apply\n  by 1 December' }).quote).toBe(
      'Apply by 1 December'
    )
  })

  it.each([
    ['an unknown kind', { kind: 'spam' }],
    ['no text', { text: '   ' }],
    ['text over 5,000 characters', { text: 'x'.repeat(5001) }],
    ['a path that is a full address', { path: 'https://evil.example/' }],
    ['a path with a query', { path: '/events?x=1' }],
    ['an odd view', { view: 'Recurring<script>' }],
    ['a listing id that is not a record id', { listingId: 'rec123' }],
    ['a resource Airtable has no choice for', { resource: 'Jobs' }],
    ['an email without a domain', { email: 'ada@' }],
    ['a quote over 600 characters', { quote: 'x'.repeat(601) }],
  ])('refuses %s', (_why, change) => {
    expect(parseSubmission({ ...fromCard, ...change }).ok).toBe(false)
  })

  it('refuses something that is not an object', () => {
    expect(parseSubmission('hello').ok).toBe(false)
    expect(parseSubmission(null).ok).toBe(false)
  })
})

describe('what a submission becomes', () => {
  const card = parsed(fromCard)

  it('links back to the card, on the live site', () => {
    expect(pageLink(card)).toBe('https://aisafety.com/events#recAbCdEfGhIjKlMn')
    expect(
      pageLink(parsed({ ...fromCard, path: '/training', view: 'recurring' }))
    ).toBe('https://aisafety.com/training?view=recurring#recAbCdEfGhIjKlMn')
  })

  it('starts the message with the quote and link, as the prefilled Airtable form did', () => {
    expect(messageText(card)).toBe(
      '"Apply by 1 December"\nhttps://aisafety.com/events#recAbCdEfGhIjKlMn\n\nThe deadline moved to 3 December.'
    )
    expect(messageText(parsed({ ...fromCard, quote: undefined }))).toBe(
      'The deadline moved to 3 December.'
    )
  })

  it('fills the Site corrections fields by id, with the page the visitor was on', () => {
    expect(airtableFields(card)).toEqual({
      table: SITE_CORRECTIONS.table,
      fields: {
        [SITE_CORRECTIONS.correction]: messageText(card),
        [SITE_CORRECTIONS.page]: 'events',
        [SITE_CORRECTIONS.resource]: 'Events',
        [SITE_CORRECTIONS.listingName]: 'AI Safety Camp',
        [SITE_CORRECTIONS.email]: 'ada@example.org',
      },
    })
  })

  it('fills the Site feedback fields by id, with the page as the footer link recorded it', () => {
    const feedback = parsed({ kind: 'feedback', text: 'Hi', path: '/' })
    expect(airtableFields(feedback)).toEqual({
      table: SITE_FEEDBACK.table,
      fields: {
        [SITE_FEEDBACK.feedback]: 'Hi',
        [SITE_FEEDBACK.page]: 'home',
      },
    })
  })

  it('emails the owner what was sent and the Airtable row', () => {
    const url = 'https://airtable.com/appX/tblKm44KngUDniaDR/recZZZZZZZZZZZZZZ'
    const mail = ownerMail(card, url)
    expect(mail.subject).toBe('Correction (site form): AI Safety Camp')
    expect(mail.text).toContain('The deadline moved to 3 December.')
    expect(mail.text).toContain('Email: ada@example.org')
    expect(mail.text).toContain(url)
    expect(mail.html).toContain(url)
  })

  it('escapes what the visitor typed in the HTML email', () => {
    const mail = ownerMail(
      parsed({ ...fromCard, text: '<img src=x onerror=alert(1)>' }),
      'https://airtable.com/x'
    )
    expect(mail.html).not.toContain('<img')
    expect(mail.html).toContain('&lt;img')
  })
})
