/* The text version of a sent newsletter issue (10 Oct 2026).

   aisafety.com/newsletter/<key>/<issue>/text: the issue as simple text with
   links, and a "Copy text version" button, so a reader can paste it into a
   chat or a doc. The card emails don't paste well (tables, logo tiles); the
   Substack emails did, and community organizers reposted them that way
   (Yanni Kyriacos, TARA, 10 Oct 2026). The email's footer links here, and so
   does the web version's.

   Everything comes from the email as sent, which already carries it:
   - the intro: the email's own paragraphs, links kept, styles dropped;
   - the cards: the card manifest's plain-text blocks (kept in step with
     every edit, reorder and removal on /admin/newsletter), in its order;
   - each card's link: the email's own link for that card
     (/api/nl/<list>/<n>), so a click from a pasted copy counts as the
     newsletter's, like any other click on the issue (Bryce's call).
   The migration note sits in the email's header, not its intro, so it never
   comes along; nor does the footer.

   This module is pure; the read is src/lib/newsletter-web-copy.ts, the
   route src/app/newsletter/[key]/[issue]/text/route.ts. */

import { createHash } from 'node:crypto'
import { WEB_NEWSLETTERS, type WebKey } from '@/lib/newsletter-web'

export interface TextCard {
  title: string
  /** The email's link for the card, else the plain text's own. */
  href: string | null
  /** The lines under the title, as the plain text has them. */
  lines: string[]
}

export interface TextGroup {
  label: string
  notes: string[]
  cards: TextCard[]
}

/** The line a copy starts with, so a paste says where it's from:
 *  "AI Safety Training · Week 41, 2026", linking the issue's web version. */
export interface TextTitle {
  text: string
  href: string
}

export interface TextVersion {
  /** The intro paragraphs as safe HTML: text, links, bold, italics. */
  intro: string[]
  groups: TextGroup[]
}

interface Manifest {
  groups: { id: string; label: string; cards: { key: string }[] }[]
  text: { c?: string; t: string }[]
}

const MANIFEST_RE = /<!--aisafety-cards:([A-Za-z0-9+/=]+)-->/
const CARD_RE = /<!--card:(g\d+):([A-Za-z0-9_-]+)-->([\s\S]*?)<!--\/card-->/g
const URL_LINE_RE = /^https?:\/\/\S+$/
const HEADING_RE = /^== .+ ==$/

/** Pure: the manifest, or null when there's none or it doesn't read. */
function manifest(email: string): Manifest | null {
  const m = MANIFEST_RE.exec(email)
  if (!m) return null
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'))
  } catch {
    return null
  }
  const man = raw as Partial<Manifest> | null
  if (!man || !Array.isArray(man.groups) || !Array.isArray(man.text))
    return null
  const groupsOk = man.groups.every(
    g =>
      g &&
      typeof g.id === 'string' &&
      typeof g.label === 'string' &&
      Array.isArray(g.cards) &&
      g.cards.every(c => c && typeof c.key === 'string')
  )
  const textOk = man.text.every(s => s && typeof s.t === 'string')
  return groupsOk && textOk ? (man as Manifest) : null
}

/** Pure: "<a href="x">" style attribute text back to the address. */
function unescapeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
}

/** Pure: HTML text to plain characters. */
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ent: string) => {
    if (ent[0] === '#') {
      const n =
        ent[1] === 'x' || ent[1] === 'X'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : all
    }
    return NAMED[ent.toLowerCase()] ?? all
  })
}

/** Pure: an email paragraph's inside, keeping only text, links (http(s)
 *  only; one to an ActiveCampaign tag keeps just its words), bold, italics
 *  and line breaks. */
export function safeInline(html: string): string {
  let open = 0
  return (
    html.replace(
      /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
      (_, close, tag: string, attrs: string) => {
        const t = tag.toLowerCase()
        if (t === 'a') {
          if (close) {
            if (!open) return ''
            open--
            return '</a>'
          }
          const href = /\bhref\s*=\s*"([^"]*)"/i.exec(attrs)
          const url = href ? unescapeAttr(href[1]) : ''
          if (!/^https?:\/\//i.test(url)) return ''
          open++
          return `<a href="${esc(url)}">`
        }
        if (t === 'br') return close ? '' : '<br>'
        const norm = { strong: 'strong', b: 'strong', em: 'em', i: 'em' }[t]
        return norm ? `<${close}${norm}>` : ''
      }
    ) + '</a>'.repeat(open)
  )
}

/** Pure: the intro paragraphs of the email (render.py intro_paragraphs():
 *  the <p>s that open the body cell, before its first section or card). */
function introOf(email: string): string[] {
  const cell = /<td\b[^>]*class="inner"[^>]*>/.exec(email)
  if (!cell) return []
  const from = cell.index + cell[0].length
  const ends = ['<div', '<!--card:', '</td>']
    .map(s => email.indexOf(s, from))
    .filter(i => i >= 0)
  const region = email.slice(from, ends.length ? Math.min(...ends) : undefined)
  return [...region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
    .map(m => safeInline(m[1]).trim())
    .filter(p => decode(p.replace(/<[^>]*>/g, '')).trim())
}

/** Pure: each card's own link in the email, by "gN:KEY". */
function cardLinks(email: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of email.matchAll(CARD_RE)) {
    const href = /\bhref="(https?:\/\/[^"]+)"/i.exec(m[3])
    if (href) out.set(`${m[1]}:${m[2]}`, unescapeAttr(href[1]))
  }
  return out
}

/** Pure: a card's plain-text block (render.py render_text(): "* Title", the
 *  lines under it indented by two, the link last). */
function cardOf(block: string, href: string | undefined): TextCard | null {
  const lines = block
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  if (!lines.length || !lines[0].startsWith('* ')) return null
  const rest = lines.slice(1)
  const own = rest.length && URL_LINE_RE.test(rest[rest.length - 1])
  return {
    title: lines[0].slice(2).trim(),
    href: href ?? (own ? rest[rest.length - 1] : null),
    lines: own ? rest.slice(0, -1) : rest,
  }
}

/** Pure: the text version of a sent email, or null when it has no card
 *  manifest to build one from. */
export function textVersion(email: string): TextVersion | null {
  const man = manifest(email)
  if (!man) return null
  const links = cardLinks(email)
  const blocks = new Map<string, string>()
  const notes: string[][] = man.groups.map(() => [])
  let heading = -1
  for (const seg of man.text) {
    if (seg.c) {
      blocks.set(seg.c, seg.t)
      continue
    }
    // A section's own notes follow its "== LABEL ==" line, up to the next
    // card; what comes before the first heading is the title and intro, and
    // a segment without a heading is the footer.
    let inSection = false
    for (const line of seg.t.split('\n').map(l => l.trim())) {
      if (HEADING_RE.test(line)) {
        heading++
        inSection = true
      } else if (inSection && line && heading < notes.length)
        notes[heading].push(line)
    }
  }
  const groups = man.groups
    .map((g, i) => ({
      label: g.label,
      notes: notes[i],
      cards: g.cards
        .map(c => {
          const id = `${g.id}:${c.key}`
          const block = blocks.get(id)
          return block === undefined ? null : cardOf(block, links.get(id))
        })
        .filter((c): c is TextCard => c !== null),
    }))
    .filter(g => g.cards.length)
  return groups.length ? { intro: introOf(email), groups } : null
}

/** Pure: bare addresses in a line of plain text as links (funding's
 *  sub-programs carry theirs inline). */
function linkify(line: string): string {
  return esc(line).replace(
    /https?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g,
    url => `<a href="${url}">${url}</a>`
  )
}

/** Pure: the text version as simple HTML — what the page shows and the
 *  button copies. The title first, in bold; one paragraph per card, so a
 *  paste keeps each listing together; detail rows (joined with " · ") in
 *  italics, like the Substack emails had them. */
export function textHtml(tv: TextVersion, title?: TextTitle): string {
  const out: string[] = title
    ? [
        `<p><strong><a href="${esc(title.href)}">${esc(title.text)}</a></strong></p>`,
      ]
    : []
  out.push(...tv.intro.map(p => `<p><em>${p}</em></p>`))
  for (const g of tv.groups) {
    out.push(`<p><strong>${esc(g.label)}</strong></p>`)
    for (const n of g.notes) out.push(`<p>${linkify(n)}</p>`)
    for (const c of g.cards) {
      const title = c.href
        ? `<a href="${esc(c.href)}">${esc(c.title)}</a>`
        : esc(c.title)
      const rows = c.lines.map(l =>
        l.includes(' · ') ? `<em>${linkify(l)}</em>` : linkify(l)
      )
      out.push(`<p>• ${[title, ...rows].join('<br>')}</p>`)
    }
  }
  return out.join('\n')
}

/** Pure: an intro paragraph as plain text. A link whose words are already
 *  its address ("AISafety.com/training") stays as the words; any other
 *  gets its address after it in brackets. */
function plainInline(html: string): string {
  return decode(
    html
      .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (_, href, inner) => {
        const words = decode(inner.replace(/<[^>]*>/g, '')).trim()
        return /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(words)
          ? inner
          : `${inner} (${unescapeAttr(href)})`
      })
      .replace(/<br>/g, '\n')
      .replace(/<[^>]*>/g, '')
  ).trim()
}

/** Pure: the text version as plain text, for apps that paste no
 *  formatting: the same title and listings, each link written out under
 *  its line. */
export function textPlain(tv: TextVersion, title?: TextTitle): string {
  const out: string[] = title ? [`${title.text}\n${title.href}`] : []
  out.push(...tv.intro.map(plainInline))
  for (const g of tv.groups) {
    out.push(g.label, ...g.notes)
    for (const c of g.cards)
      out.push(
        [`• ${c.title}`, ...c.lines, ...(c.href ? [c.href] : [])].join('\n')
      )
  }
  return out.join('\n\n') + '\n'
}

/* The button: copies the HTML and the plain text together, so each app
   pastes the one it takes. The copy event works in every browser in a
   click; the Clipboard API is the second try. Allowed by its hash in the
   page's policy, which allows no other script. */
export const TEXT_SCRIPT = `(function () {
  var button = document.getElementById('copy')
  var shown = document.getElementById('text')
  var plain = document.getElementById('plain')
  var label = button.textContent
  var timer
  function say(words) {
    button.textContent = words
    clearTimeout(timer)
    timer = setTimeout(function () { button.textContent = label }, 2500)
  }
  button.addEventListener('click', function () {
    var html = '<meta charset="utf-8">' + shown.innerHTML
    var copied = false
    function onCopy(e) {
      e.clipboardData.setData('text/html', html)
      e.clipboardData.setData('text/plain', plain.value)
      e.preventDefault()
      copied = true
    }
    document.addEventListener('copy', onCopy)
    try { document.execCommand('copy') } catch (e) {}
    document.removeEventListener('copy', onCopy)
    if (copied) return say('Copied')
    var failed = function () { say('Select the text below to copy it') }
    if (!navigator.clipboard || !window.ClipboardItem) return failed()
    navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain.value], { type: 'text/plain' })
    })]).then(function () { say('Copied') }, failed)
  })
})()`

export const TEXT_SCRIPT_HASH =
  'sha256-' + createHash('sha256').update(TEXT_SCRIPT).digest('base64')

/** Pure: the text version's page. `emailHref` is the issue's web version
 *  (a path on the site); the copy's title links it in full. */
export function textPage(
  tv: TextVersion,
  key: WebKey,
  subject: string,
  emailHref: string
): string {
  const sender = WEB_NEWSLETTERS[key].sender
  const title = {
    text: `${sender} · ${subject}`,
    href: `https://aisafety.com${emailHref}`,
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<title>${esc(subject)} – text version – ${esc(sender)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap" rel="stylesheet">
<style>
  body { margin:0; background:#00191b; color:#aab2b3; font-family:Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
  main { max-width:576px; margin:0 auto; padding:72px 32px 96px; }
  .label { font-size:13px; line-height:22px; margin:0 0 8px; color:#8e999a; }
  h1 { font-size:32px; line-height:40px; font-weight:400; letter-spacing:-1px; color:#fff; margin:0 0 12px; }
  .lede { font-size:15px; line-height:25px; font-weight:300; margin:0 0 24px; }
  .actions { display:flex; flex-wrap:wrap; align-items:center; gap:12px 24px; margin:0 0 40px; }
  button { height:48px; padding:0 20px; border:none; border-radius:24px; background:#fff; color:#00191b; font-family:inherit; font-size:15px; font-weight:600; letter-spacing:-0.3px; cursor:pointer; }
  button:hover { background:#f3f3f3; }
  button:focus-visible, a:focus-visible { outline:2px solid #a6dad9; outline-offset:3px; }
  .actions a { font-size:14px; }
  a { color:#a6dad9; text-decoration-color:#325354; text-underline-offset:2px; }
  .text { border-top:1px solid #1c3334; padding-top:32px; font-size:15px; line-height:25px; font-weight:300; color:#e3e5e6; overflow-wrap:anywhere; }
  .text p { margin:0 0 20px; }
  .text strong { font-weight:600; color:#fff; }
  textarea { display:none; }
  @media (max-width:660px) { main { padding:48px 16px 72px; } }
</style>
</head>
<body>
<main>
<p class="label">${esc(sender)} · Text version</p>
<h1>${esc(subject)}</h1>
<p class="lede">This issue as simple text with links, ready to paste anywhere.</p>
<div class="actions">
<button type="button" id="copy">Copy text version</button>
<a href="${esc(emailHref)}">View the email</a>
</div>
<div class="text" id="text">
${textHtml(tv, title)}
</div>
<textarea id="plain" readonly aria-hidden="true" tabindex="-1">${esc(textPlain(tv, title))}</textarea>
</main>
<script>${TEXT_SCRIPT}</script>
</body>
</html>`
}
