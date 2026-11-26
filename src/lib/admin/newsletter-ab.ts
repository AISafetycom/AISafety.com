/*
  The subject line A/B test (Bryce, 24 November 2026, for two weeks of
  Events and Training). Half the list gets the issue's highlights as the
  subject ("AI Safety Career Fair in SF, PauseAI in Parliament, and 8
  more") with the usual preview line; the other half keeps the plain subject
  ("Week 48, 2026") and gets the highlights as the preview line instead.
  ActiveCampaign splits the list evenly at random (a split campaign).

  The pipeline (~/Newsletter/render.py, AB_TEST) marks a test issue with
  `<!--aisafety-ab:<base64 JSON>-->`: the listings Pen picked for the line
  ({ k: card key, t: short label }), and two click-counter link lists with
  the same links: `p` (the email's own, `ab: 'preview'`) and `s` (`ab:
  'subject'`), so the counter can tell the halves' clicks apart
  (newsletter-clicks.ts). The draft itself is the usual email. At approval
  both halves are made from the draft as it is then: the line counts the
  cards still in it, so a card removed on the page drops out of the line
  and out of "N more". Keep `abLine` in step with render.py `ab_line`.
*/

import { LIST_ID_RE } from '@/lib/newsletter-clicks'

export const AB_MARKER_RE = /<!--aisafety-ab:([A-Za-z0-9+/=]+)-->/

export interface AbPick {
  /** The card's key (Pen's record id). */
  k: string
  /** Pen's short label for it in the line. */
  t: string
}

export interface AbTest {
  picks: AbPick[]
  /** The link list the email uses: its clicks count for the preview half. */
  p: string
  /** The same links, for the subject half. */
  s: string
}

/** What a half gets in the inbox. */
export interface AbHalf {
  subject: string
  preview: string
}

export interface AbVariant {
  subject: string
  html: string
  text: string
}

/** Pure: the email's A/B test, null when it isn't one, 'malformed' when the
 *  marker is there but unreadable (a block: never send half a test). */
export function abTestOf(html: string): AbTest | null | 'malformed' {
  const m = AB_MARKER_RE.exec(html)
  if (!m) return null
  try {
    const d = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) as {
      v?: unknown
      picks?: unknown
      p?: unknown
      s?: unknown
    }
    if (
      d.v !== 1 ||
      typeof d.p !== 'string' ||
      typeof d.s !== 'string' ||
      !LIST_ID_RE.test(d.p) ||
      !LIST_ID_RE.test(d.s) ||
      d.p === d.s ||
      !Array.isArray(d.picks)
    )
      return 'malformed'
    const picks: AbPick[] = []
    for (const raw of d.picks) {
      const x = raw as { k?: unknown; t?: unknown } | null
      if (
        !x ||
        typeof x.k !== 'string' ||
        typeof x.t !== 'string' ||
        !x.k.trim() ||
        !x.t.trim()
      )
        return 'malformed'
      picks.push({ k: x.k, t: x.t.replace(/\s+/g, ' ').trim() })
    }
    if (picks.length === 0) return 'malformed'
    return { picks, p: d.p, s: d.s }
  } catch {
    return 'malformed'
  }
}

/** Pure: "A", "A and B", "A, B, and C": the Oxford comma, as the site
 *  writes lists. */
export function joinLine(labels: string[], more: number): string {
  const parts = more > 0 ? [...labels, `${more} more`] : [...labels]
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

const CARD_MARK_RE = /<!--card:(g\d+):([^>]+?)-->/g

/** Pure: the highlights line for the email as it is now: the picked cards
 *  still in it, in its order, then how many others it holds. Null when
 *  none of the picks is left. */
export function abLine(html: string, test: AbTest): string | null {
  const cards: string[] = []
  const shown: string[] = []
  for (const m of html.matchAll(CARD_MARK_RE)) {
    const id = `${m[1]}:${m[2]}`
    if (cards.includes(id)) continue
    cards.push(id)
    const pick = test.picks.find(p => p.k === m[2])
    if (pick && !shown.includes(pick.t)) shown.push(pick.t)
  }
  if (shown.length === 0) return null
  return joinLine(shown, cards.length - shown.length)
}

const PREHEADER_RE = /(<div style="display:none[^"]*"[^>]*>)([\s\S]*?)(<\/div>)/

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A subject longer than this is a mistake in the picks, not a subject. */
export const MAX_AB_SUBJECT = 150

/** Pure: the two halves made from the draft's message (its content marker
 *  already taken off; the caller stamps each half), or why they can't be. */
export function abVariants(
  msg: { subject: string; html: string; text: string },
  test: AbTest
): { subject: AbVariant; preview: AbVariant; line: string } | string {
  const line = abLine(msg.html, test)
  if (!line)
    return 'none of the listings picked for the A/B test’s highlights line is in the email any more – rebuild the issue'
  if (line.length > MAX_AB_SUBJECT)
    return `the A/B test’s highlights line is ${line.length} characters, more than ${MAX_AB_SUBJECT} – shorten the labels and rebuild`
  const pre = PREHEADER_RE.exec(msg.html)
  if (!pre)
    return 'the email has no preview line for the A/B test to change – rebuild the issue'
  // Keep the invisible padding after the line, as the renderer writes it.
  const pad = pre[2].search(/&nbsp;| /)
  const inner = escapeHtml(line) + (pad >= 0 ? pre[2].slice(pad) : '')
  const previewHtml = msg.html.replace(
    PREHEADER_RE,
    (_all, open: string, _old: string, close: string) => open + inner + close
  )
  const from = `/api/nl/${test.p}/`
  const to = `/api/nl/${test.s}/`
  if (!msg.html.includes(from))
    return `the email’s links don’t use the A/B test’s link list ${test.p} – rebuild the issue`
  return {
    line,
    preview: { subject: msg.subject, html: previewHtml, text: msg.text },
    subject: {
      subject: line,
      html: msg.html.split(from).join(to),
      text: msg.text.split(from).join(to),
    },
  }
}

/** Pure: what each half sees in the inbox, for the page. */
export function abHalves(
  subject: string,
  usualPreview: string | null,
  line: string
): { a: AbHalf; b: AbHalf } {
  return {
    a: { subject: line, preview: usualPreview ?? '' },
    b: { subject, preview: line },
  }
}

/** Pure: whether the two link lists are the A/B test's pair: the same
 *  campaign and links, one per half. `p` and `s` are the parsed lists, or
 *  'missing' / 'unreadable' / 'malformed' (readLinkListRaw). */
export function abListProblems(test: AbTest, p: unknown, s: unknown): string[] {
  if (s === 'missing')
    return [
      `the A/B test’s second link list (${test.s}) isn’t on the Blob store, so half the readers’ links would land on the homepage – rebuild the issue`,
    ]
  if (s === 'unreadable' || p === 'unreadable')
    return [
      'the A/B test’s link lists couldn’t be read just now – try again in a minute',
    ]
  const a = p as { c?: unknown; ab?: unknown; links?: unknown } | null
  const b = s as { c?: unknown; ab?: unknown; links?: unknown } | null
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a.ab !== 'preview' ||
    b.ab !== 'subject' ||
    a.c !== b.c ||
    JSON.stringify(a.links) !== JSON.stringify(b.links)
  )
    return [
      `the A/B test’s link lists (${test.p}, ${test.s}) don’t match – rebuild the issue`,
    ]
  return []
}
