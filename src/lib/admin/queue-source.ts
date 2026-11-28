/*
 * What Q does for someone who isn't the owner (Bryce, 28 Nov 2026, on Rob's
 * trial: "pressing Q opens the source of a thing, for example a Slack channel
 * or an email. That works for me fine, but is that going to work for him?").
 *
 * For the owner Q opens the source link, as before. Most of those links are
 * his own: an email in his Gmail, a Discord message to him, a form's
 * notification email. Others are posts in a Slack workspace or Discord server
 * the teammate may not be in. For those, the Queue keeps a copy of what the
 * source said on the row (Source text, written by the Mac and Comb), and Q
 * shows that copy on the item instead. A public web page, and the
 * AISafety.com Discord every teammate is in, still open as links.
 *
 * Pure: no React, no fetch. Tested in queue-source.test.ts.
 */

/** Where a copy shown in place of the link came from. */
export type SavedPlace =
  | 'email'
  | 'newsletter'
  | 'dm'
  | 'form'
  | 'slack'
  | 'discord'

export type SourceView =
  /** Q opens this link in a new tab. */
  | { kind: 'link'; href: string }
  /** Q shows the saved copy on the item. `href` is a link the person may
   *  still be able to open (a Slack or Discord post, a form's record in
   *  Airtable); null when only the owner can open it. `text` is null when
   *  nothing was saved. */
  | {
      kind: 'saved'
      place: SavedPlace
      text: string | null
      href: string | null
    }

/** The AISafety.com Discord server: every teammate is in it. */
export const HOME_DISCORD_SERVER = '986243767424139294'

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function onHost(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`)
}

/** The Discord server a discord.com/channels link is in ('@me' for a
 *  direct message), or null for any other link. */
export function discordServer(url: string): string | null {
  if (!onHost(hostOf(url), 'discord.com')) return null
  const m = /\/channels\/([^/]+)\//.exec(new URL(url).pathname + '/')
  return m ? m[1] : null
}

/** A teammate's own work mailbox: their sign-in, when it is an
 *  @aisafety.com address (Google Workspace, so Gmail), else null. Every
 *  Airtable form's notification goes to it too (Bryce, 28 Nov 2026: "when
 *  it's him that's pressing Q, it would open his Gmail link"). */
export function workMailbox(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return /^[^@\s]+@aisafety\.com$/.test(e) ? e : null
}

/** A Gmail search in `mailbox` for a form's notification email: from
 *  Airtable, with the submitter's address (or the listing's name) in it. */
export function formSearchHref(mailbox: string, words: string): string {
  const term = words.includes('@') ? words : `"${words.replace(/"/g, '')}"`
  const query = `from:noreply@airtable.com ${term}`
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#search/${encodeURIComponent(query)}`
}

/** The address in a reply line such as "Sam Demo <sam@example.org>". */
export function addressIn(line: string | null | undefined): string | null {
  const m = /[^\s<>]+@[^\s<>]+\.[^\s<>]+/.exec(line ?? '')
  return m ? m[0] : null
}

export function sourceView(args: {
  /** What Q opens for the owner (the page's sourceHref), or null. */
  href: string | null
  /** The owner: the person whose chat is the one on his Mac. */
  owner: boolean
  /** The row's Source (Email, Form, Comb, Discord …). */
  source: string
  /** The row's saved copy of the source (Source text), if any. */
  sourceText: string | null
  /** The words that opened the item ("What they wrote"), never Comb's
   *  where-it-was-found line. Used when there is no saved copy. */
  said: string | null
  /** The row's own link when it is the form's record in Airtable, which
   *  every teammate with the Queue can open. */
  airtableLink: string | null
  /** The viewer's own work mailbox (workMailbox), which gets every form's
   *  notification email, or null. */
  mailbox?: string | null
  /** What finds a form's notification in that mailbox: the submitter's
   *  address, else the listing's name. */
  formWords?: string | null
}): SourceView | null {
  const { href, owner, source } = args
  if (!href) return null
  if (owner) return { kind: 'link', href }
  const text =
    (args.sourceText ?? '').trim() || (args.said ?? '').trim() || null
  const host = hostOf(href)
  if (onHost(host, 'mail.google.com')) {
    if (source === 'Form') {
      // Their own copy of the form's email, in their own Gmail.
      if (args.mailbox && args.formWords) {
        return {
          kind: 'link',
          href: formSearchHref(args.mailbox, args.formWords),
        }
      }
      return { kind: 'saved', place: 'form', text, href: args.airtableLink }
    }
    const place = source === 'Comb' ? 'newsletter' : 'email'
    return { kind: 'saved', place, text, href: null }
  }
  const server = discordServer(href)
  if (server === '@me') return { kind: 'saved', place: 'dm', text, href: null }
  if (server && server !== HOME_DISCORD_SERVER) {
    return text
      ? { kind: 'saved', place: 'discord', text, href }
      : { kind: 'link', href }
  }
  if (onHost(host, 'slack.com')) {
    return text
      ? { kind: 'saved', place: 'slack', text, href }
      : { kind: 'link', href }
  }
  return { kind: 'link', href }
}

/** What the saved copy's heading, note and link say, by where it came
 *  from. */
export function savedWords(place: SavedPlace): {
  heading: string
  note: string
  linkLabel: string | null
} {
  switch (place) {
    case 'email':
      return {
        heading: 'The email',
        note: 'A copy of the thread, since it is in Bryce’s inbox.',
        linkLabel: null,
      }
    case 'newsletter':
      return {
        heading: 'The newsletter',
        note: 'A copy, since it is in Bryce’s inbox.',
        linkLabel: null,
      }
    case 'dm':
      return {
        heading: 'The Discord message',
        note: 'A copy, since it was a direct message to Bryce.',
        linkLabel: null,
      }
    case 'form':
      return {
        heading: 'The form',
        note: 'The form’s answers are this listing’s fields. Its notification email is in Bryce’s inbox.',
        linkLabel: 'Open the record in Airtable',
      }
    case 'slack':
      return {
        heading: 'The Slack post',
        note: 'A copy. To open it in Slack you need to be in that workspace.',
        linkLabel: 'Open in Slack',
      }
    case 'discord':
      return {
        heading: 'The Discord post',
        note: 'A copy. To open it on Discord you need to be in that server.',
        linkLabel: 'Open on Discord',
      }
  }
}
