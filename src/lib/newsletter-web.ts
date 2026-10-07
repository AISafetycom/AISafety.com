/* The web version of a sent newsletter issue (30 Sept 2026).

   Each issue's "View in browser" link opens
   aisafety.com/newsletter/<key>/<issue> ("/newsletter/events/week-41-2026",
   "/newsletter/funding/issue-21-2026"): the email as it went out, on a page
   of its own. It replaces ActiveCampaign's web copy, which wrapped the email
   in a share bar, a white frame and "Email Marketing by ActiveCampaign".
   The pipeline writes the link (~/Newsletter/render.py `web_url()`); the two
   must agree on the address, which maps one-to-one onto the campaign name.

   The first view of an issue reads the email from ActiveCampaign, once a
   campaign of it has reached readers on the newsletter's real list
   (sentIssueHtml), and keeps a copy in the Blob store under newsletter/web/,
   so later views need no ActiveCampaign read and links in old emails keep
   working after the campaign drops out of the newest 100. The copy is the
   email as sent; the page leaves out what only works inside an email: the
   footer between the pipeline's <!--web:hide--> markers (Unsubscribe, View
   in browser, the postal address), the content marker and the card
   manifest. The page isn't indexed by search engines.

   This module is the pure part (addresses and the page itself); the reads
   and the kept copy are in src/app/newsletter/[key]/[issue]/route.ts. */

export const WEB_NEWSLETTERS = {
  events: { list: '6', prefix: 'Events', unit: 'week', page: '/events' },
  training: { list: '7', prefix: 'Training', unit: 'week', page: '/training' },
  funding: { list: '8', prefix: 'Funding', unit: 'issue', page: '/funding' },
} as const

export type WebKey = keyof typeof WEB_NEWSLETTERS

/** Where the kept copies live: newsletter/web/<key>/<issue>.html, in the
 *  Blob store that holds the emails' link lists and images (LINKS_BASE in
 *  src/lib/newsletter-clicks.ts). */
export const WEB_BASE =
  'https://vfnmdozpctvdobh7.public.blob.vercel-storage.com/newsletter/web/'

// No leading zeros, so each issue has one address.
const SLUG_RE = /^(week|issue)-([1-9]\d{0,2})-(20\d\d)$/
const NAME_RE =
  /^(Events|Training|Funding) · (Week |Issue #)([1-9]\d{0,2}), (20\d\d)$/

export function isWebKey(key: string): key is WebKey {
  return Object.prototype.hasOwnProperty.call(WEB_NEWSLETTERS, key)
}

/** Pure: the campaign name an address stands for ("events", "week-41-2026"
 *  → "Events · Week 41, 2026"), or null when it isn't an issue address. */
export function issueName(key: string, slug: string): string | null {
  if (!isWebKey(key)) return null
  const m = SLUG_RE.exec(slug)
  const nl = WEB_NEWSLETTERS[key]
  if (!m || m[1] !== nl.unit) return null
  return nl.unit === 'week'
    ? `${nl.prefix} · Week ${m[2]}, ${m[3]}`
    : `${nl.prefix} · Issue #${m[2]}, ${m[3]}`
}

/** Pure: the page's path for a campaign name (any wave suffix ignored), or
 *  null for names the pipeline didn't write. The other direction of
 *  issueName(). */
export function webPath(name: string): string | null {
  const m = NAME_RE.exec(name.replace(/ · wave \d+\/\d+$/, ''))
  if (!m) return null
  const key = m[1].toLowerCase() as WebKey
  const unit = m[2] === 'Week ' ? 'week' : 'issue'
  if (WEB_NEWSLETTERS[key].unit !== unit) return null
  return `/newsletter/${key}/${unit}-${m[3]}-${m[4]}`
}

/** Pure: the sent email as a web page. */
export function webPage(email: string): string {
  return (
    email
      // The pipeline's footer: divider, Unsubscribe · View in browser, address.
      .replace(/<!--web:hide-->[\s\S]*?<!--\/web:hide-->/g, '')
      // Emails built before the markers: the same footer lines, unmarked.
      .replace(
        /<div[^>]*>\s*<a href="%UNSUBSCRIBELINK%"[\s\S]*?<\/div>\s*<div[^>]*>%SENDER-INFO-SINGLELINE%<\/div>/g,
        ''
      )
      // A link that only works in the reader's own email (the migration
      // note's "unsubscribe from this events newsletter"): its words stay,
      // unlinked, so the sentence still reads.
      .replace(/<a\b[^>]*href="%[A-Z][A-Z0-9_-]*%"[^>]*>([\s\S]*?)<\/a>/g, '$1')
      // Anything else of ActiveCampaign's would show as raw text.
      .replace(/%(?:UNSUBSCRIBELINK|WEBCOPY|SENDER-INFO-SINGLELINE)%/g, '')
      .replace(/<!--aisafety-issue:[0-9a-f]{16}-->/g, '')
      .replace(/<!--aisafety-cards:[A-Za-z0-9+/=]*-->/g, '')
      .replace(/<head>/i, '<head>\n<meta name="robots" content="noindex">')
  )
}

/** Pure: the page for an issue that isn't online – not sent yet, or not an
 *  issue at all. In the emails' colours, with the way to sign up. */
export function missingPage(key: string): string {
  const page = isWebKey(key) ? WEB_NEWSLETTERS[key].page : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<title>Issue not found – AISafety.com</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap" rel="stylesheet">
<style>
  body { margin:0; background:#00191b; color:#aab2b3; font-family:Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
  main { max-width:576px; margin:0 auto; padding:96px 32px; }
  h1 { font-size:32px; line-height:40px; font-weight:400; color:#fff; margin:0 0 16px; }
  p { font-size:15px; line-height:25px; font-weight:300; margin:0; }
  a { color:#a6dad9; text-decoration-color:#325354; }
</style>
</head>
<body>
<main>
<h1>This issue isn’t online</h1>
<p>An issue appears here once it has been sent. Everything the newsletter covers is listed on <a href="https://aisafety.com${page}">AISafety.com${page}</a>.</p>
</main>
</body>
</html>`
}
