// Plain text out of the guide, for the chatbot, the diff view and the
// digest email. No React here so it runs anywhere.
import type { Guide, Inline, RichText } from './types'

export function inlinesText(inlines: Inline[]): string {
  return inlines.map(i => i.text).join('')
}

/** Inline text with bold and link addresses shown, so a changed link counts
 *  as a change in a diff even when the words stayed the same. */
export function inlinesTextWithLinks(inlines: Inline[]): string {
  return inlines
    .map(i => {
      const t = i.bold ? `**${i.text}**` : i.text
      return i.href ? `${t} (${i.href})` : t
    })
    .join('')
}

/** One string per block, for diffs: paragraphs as they read, list items
 *  one per line with their marker. */
export function richTextLines(rt: RichText, withLinks = false): string[] {
  const text = withLinks ? inlinesTextWithLinks : inlinesText
  return rt.blocks.map(b =>
    b.type === 'paragraph'
      ? text(b.inlines)
      : b.items
          .map(
            (it, i) => `${b.type === 'numbers' ? `${i + 1}.` : '-'} ${text(it)}`
          )
          .join('\n')
  )
}

// ─── Chatbot text ────────────────────────────────────────────────────────────
// Mirrors, line for line, what the extractor produced when the guide was
// React components (src/lib/assistant/donation-guide.ts before 15 September
// 2026): every block-level tag became "\n…\n", then runs of whitespace
// collapsed. seed.test.ts holds that extractor's last output as a fixture.

const wrap = (inner: string) => `\n${inner}\n`

function bodyMarkup(rt: RichText): string {
  return rt.blocks
    .map(b =>
      b.type === 'paragraph'
        ? wrap(inlinesText(b.inlines))
        : wrap(b.items.map(it => wrap(inlinesText(it))).join(''))
    )
    .join('')
}

function tabMarkup(tab: Guide['tabs'][number]): string {
  const parts = [wrap(`${tab.amount} donation`), wrap(tab.lead)]
  tab.sections.forEach((s, i) => {
    if (i > 0) parts.push(wrap('')) // the divider between sections
    parts.push(
      wrap(wrap(wrap('If you have') + wrap(s.time)) + wrap(bodyMarkup(s.body)))
    )
  })
  return parts.join('')
}

/** The guide by amount bracket, in the form the chatbot's prompt carries. */
export function guideChatText(guide: Guide): string {
  const sections = guide.tabs.map(tab => {
    const body = tabMarkup(tab)
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return `## If donating ${tab.amount}\n${body}`
  })
  return (
    'DONATION GUIDE (/donation-guide) — the full content of the donation guide page, by donation amount. Use this to answer donation questions with the guide’s own recommendations, and still link the user to [Donation guide](/donation-guide).\n\n' +
    sections.join('\n\n')
  )
}
