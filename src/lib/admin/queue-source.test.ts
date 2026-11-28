import { describe, expect, it } from 'vitest'
import {
  HOME_DISCORD_SERVER,
  addressIn,
  discordServer,
  formSearchHref,
  savedWords,
  sourceView,
  workMailbox,
} from './queue-source'

const GMAIL = 'https://mail.google.com/mail/?authuser=x@example.com#all/1a2b'
const SLACK =
  'https://aisafetyfundamentals.slack.com/archives/C0252D6BMUP/p1795550026714199'
const OTHER_DISCORD =
  'https://discord.com/channels/1341252116940849192/1341280076498731050/1569902073443647548'
const HOME_DISCORD = `https://discord.com/channels/${HOME_DISCORD_SERVER}/1573482259263000688/1574129621471993910`
const DM =
  'https://discord.com/channels/@me/1394718709762756659/1555854648395694161'
const WEB = 'https://www.lesswrong.com/posts/abc/some-post'
const AIRTABLE = 'https://airtable.com/appX/tblY/recZ'

const base = {
  owner: false,
  source: 'Comb',
  sourceText: null,
  said: null,
  airtableLink: null,
}

describe('sourceView', () => {
  it('opens the link for the owner, whatever it is', () => {
    for (const href of [GMAIL, SLACK, DM, WEB]) {
      expect(
        sourceView({ ...base, owner: true, href, sourceText: 'x' })
      ).toEqual({
        kind: 'link',
        href,
      })
    }
  })

  it('has nothing without a link', () => {
    expect(sourceView({ ...base, href: null, sourceText: 'x' })).toBeNull()
  })

  it('shows a teammate the saved email, never the Gmail link', () => {
    expect(
      sourceView({
        ...base,
        source: 'Email',
        href: GMAIL,
        sourceText: 'From: A\n\nHi',
      })
    ).toEqual({
      kind: 'saved',
      place: 'email',
      text: 'From: A\n\nHi',
      href: null,
    })
  })

  it('falls back to what they wrote, and says when nothing was saved', () => {
    expect(
      sourceView({
        ...base,
        source: 'Email',
        href: GMAIL,
        said: 'Can you update the link?',
      })
    ).toMatchObject({ kind: 'saved', text: 'Can you update the link?' })
    expect(sourceView({ ...base, source: 'Email', href: GMAIL })).toMatchObject(
      {
        kind: 'saved',
        place: 'email',
        text: null,
      }
    )
  })

  it('calls a Comb find in Bryce’s inbox a newsletter', () => {
    expect(
      sourceView({ ...base, href: GMAIL, sourceText: 'Issue 12' })
    ).toMatchObject({
      place: 'newsletter',
      href: null,
    })
  })

  it('sends a form’s viewer to its record in Airtable', () => {
    expect(
      sourceView({
        ...base,
        source: 'Form',
        href: GMAIL,
        airtableLink: AIRTABLE,
      })
    ).toEqual({ kind: 'saved', place: 'form', text: null, href: AIRTABLE })
  })

  it('never offers a link to a direct message to Bryce', () => {
    expect(
      sourceView({
        ...base,
        source: 'Discord',
        href: DM,
        said: 'Please update',
      })
    ).toEqual({
      kind: 'saved',
      place: 'dm',
      text: 'Please update',
      href: null,
    })
  })

  it('shows the saved post for Slack and other Discord servers, with the link', () => {
    expect(
      sourceView({ ...base, href: SLACK, sourceText: 'We are hiring' })
    ).toEqual({
      kind: 'saved',
      place: 'slack',
      text: 'We are hiring',
      href: SLACK,
    })
    expect(
      sourceView({ ...base, href: OTHER_DISCORD, sourceText: 'Event' })
    ).toMatchObject({
      place: 'discord',
      href: OTHER_DISCORD,
    })
  })

  it('just opens a Slack or Discord post when no copy was saved', () => {
    expect(sourceView({ ...base, href: SLACK })).toEqual({
      kind: 'link',
      href: SLACK,
    })
  })

  it('opens the AISafety.com Discord and public pages as links', () => {
    expect(
      sourceView({ ...base, href: HOME_DISCORD, sourceText: 'x' })
    ).toEqual({
      kind: 'link',
      href: HOME_DISCORD,
    })
    expect(sourceView({ ...base, href: WEB, sourceText: 'x' })).toEqual({
      kind: 'link',
      href: WEB,
    })
  })
})

describe('discordServer', () => {
  it('reads the server, or @me for a direct message', () => {
    expect(discordServer(DM)).toBe('@me')
    expect(discordServer(HOME_DISCORD)).toBe(HOME_DISCORD_SERVER)
    expect(discordServer(WEB)).toBeNull()
  })
})

describe('savedWords', () => {
  it('gives a link label only where the person may open it', () => {
    expect(savedWords('email').linkLabel).toBeNull()
    expect(savedWords('dm').linkLabel).toBeNull()
    expect(savedWords('slack').linkLabel).toBe('Open in Slack')
    expect(savedWords('form').linkLabel).toBe('Open the record in Airtable')
  })
})

describe('a form, for a teammate with a work mailbox', () => {
  it('opens their own copy of the form email in their Gmail', () => {
    const view = sourceView({
      ...base,
      source: 'Form',
      href: GMAIL,
      airtableLink: AIRTABLE,
      mailbox: 'rob@aisafety.com',
      formWords: 'sam@example.org',
    })
    expect(view).toEqual({
      kind: 'link',
      href: formSearchHref('rob@aisafety.com', 'sam@example.org'),
    })
    const href = formSearchHref('rob@aisafety.com', 'sam@example.org')
    expect(href).toContain('authuser=rob%40aisafety.com')
    expect(decodeURIComponent(href.split('#search/')[1])).toBe(
      'from:noreply@airtable.com sam@example.org'
    )
  })

  it('searches by the listing name when there is no address', () => {
    const href = formSearchHref('rob@aisafety.com', 'Evals "Circle"')
    expect(decodeURIComponent(href.split('#search/')[1])).toBe(
      'from:noreply@airtable.com "Evals Circle"'
    )
  })

  it('keeps the saved view without a work mailbox', () => {
    expect(
      sourceView({
        ...base,
        source: 'Form',
        href: GMAIL,
        airtableLink: AIRTABLE,
        mailbox: null,
        formWords: 'sam@example.org',
      })
    ).toMatchObject({ kind: 'saved', place: 'form' })
  })

  it('knows a work mailbox and a reply address when it sees one', () => {
    expect(workMailbox('Rob@AISafety.com')).toBe('rob@aisafety.com')
    expect(workMailbox('robert.samuel.grayson@gmail.com')).toBeNull()
    expect(workMailbox(null)).toBeNull()
    expect(addressIn('Sam Demo <sam@example.org>')).toBe('sam@example.org')
    expect(addressIn('nobody')).toBeNull()
  })
})
