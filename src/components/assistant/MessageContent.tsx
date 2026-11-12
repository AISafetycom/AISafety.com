'use client'

import { Fragment, ReactNode, useMemo } from 'react'
import type { CitationRef } from '@/lib/assistant/types'
import { SUGGEST_TYPES } from '@/lib/assistant/constants'
import { cleanCardNote } from '@/lib/assistant/card-note'
import CitationCard from './CitationCard'
import { cardTypePage } from './cardFallback'
import Icon from '@/components/Icon'
import styles from './Assistant.module.css'

const SUGGEST_TYPE_SET = new Set<string>(SUGGEST_TYPES)

/** `community:are there groups in Amman` → {type:'community', query:'are…'}.
 *  Only treats the leading segment as a type when it's a known listing type, so
 *  a query containing a colon — or an older type-less token — still parses as a
 *  plain query (type undefined → default form). */
export function parseSuggestToken(raw: string): {
  type?: string
  query: string
} {
  const text = raw.trim()
  const colon = text.indexOf(':')
  if (colon > -1) {
    const head = text.slice(0, colon).trim().toLowerCase()
    if (SUGGEST_TYPE_SET.has(head)) {
      return { type: head, query: text.slice(colon + 1).trim() }
    }
  }
  return { query: text }
}

interface Props {
  text: string
  citations: CitationRef[]
  onSuggest?: (query: string, type?: string) => void
  onCitationClick?: (citation: CitationRef) => void
  onLinkClick?: (href: string, label: string) => void
  isStreaming?: boolean
}

// Token-matching regexes are deliberately tolerant of:
//   - canonical form `[[card:type:recXXX|note]]`
//   - bare rec id (missing prefix): `[[card:recXXX]]`
//   - doubled prefixes (re-prefixing mistake): `[[card:type:type:recXXX]]`
//   - whitespace inside brackets / around colons / around the pipe
//   - capitalization on the keyword itself: `[[Card:...]]`
//   - brackets inside the |note (e.g. a Markdown link the model wasn't
//     supposed to write there) — the note runs to the closing `]]`
// resolveCitation handles the actual lookup with suffix matching on the
// underlying rec id when the full id doesn't resolve directly.
const INLINE_REGEX =
  /(\[\[\s*id\s*:\s*(?:[a-z][a-z-]*\s*:\s*)*rec[A-Za-z0-9]+\s*\]\])|(\[\[\s*suggest\s*:[^\]\n]*\]\])|(\[\[\s*chip\s*:[^\]\n]*\]\])|(\[\[\s*card\s*:\s*(?:[a-z][a-z-]*\s*:\s*)*rec[A-Za-z0-9]+(?:\s*\|[^\n]*?)?\s*\]\])|(\[[^\]\n]+\]\([^)\n]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\baisafety\.info(?:\/[^\s<>),]*)?)/gi

const CARD_LINE =
  /^\s*\[\[\s*card\s*:\s*((?:[a-z][a-z-]*\s*:\s*)*rec[A-Za-z0-9]+)(?:\s*\|(.*?))?\s*\]\]\s*$/i

// Per-token regexes used to extract pieces from a matched token. Anchored
// so they only match if the whole token is well-formed.
const ID_TOKEN_RE =
  /^\[\[\s*id\s*:\s*((?:[a-z][a-z-]*\s*:\s*)*rec[A-Za-z0-9]+)\s*\]\]$/i
const CARD_TOKEN_RE =
  /^\[\[\s*card\s*:\s*((?:[a-z][a-z-]*\s*:\s*)*rec[A-Za-z0-9]+)(?:\s*\|(.*?))?\s*\]\]$/i
const SUGGEST_TOKEN_RE = /^\[\[\s*suggest\s*:([^\]\n]*)\]\]$/i
const CHIP_TOKEN_RE = /^\[\[\s*chip\s*:([^\]\n]*)\]\]$/i

/** Normalises a captured listing id (e.g. " advisor : recXXX ") by removing
 *  all internal whitespace. */
function normaliseListingId(rawId: string): string {
  return rawId.replace(/\s+/g, '')
}

/** Look up a citation by its full id (e.g. "community:recXXX") with two
 *  fallbacks for common model slip-ups: bare "recXXX" (missing prefix) and
 *  doubled prefixes like "advisor:advisor:recXXX". Both fall back to a
 *  suffix match on the underlying rec id. */
function resolveCitation(
  rawId: string,
  citationsById: Map<string, CitationRef>
): CitationRef | undefined {
  const direct = citationsById.get(rawId)
  if (direct) return direct
  const recMatch = rawId.match(/rec[A-Za-z0-9]+$/)
  if (recMatch) {
    const rec = recMatch[0]
    for (const cit of citationsById.values()) {
      if (cit.id.endsWith(`:${rec}`)) return cit
    }
  }
  return undefined
}

/** While streaming, hide any in-progress `[[...]]` directive token at the
 *  end of the buffer so users don't see raw `[[card:` / `[[chip:` /
 *  `[[/think...` flicker before the renderer can replace them with UI. */
function maskStreamingTail(text: string): string {
  const lastDouble = text.lastIndexOf('[[')
  if (lastDouble !== -1 && !text.slice(lastDouble).includes(']]')) {
    return text.slice(0, lastDouble)
  }
  if (text.endsWith('[')) return text.slice(0, -1)
  return text
}

// Anything that LOOKS like a directive — we use this to detect tokens that
// failed the strict parsers (e.g. the model fabricated `[[card:community:
// recAlignment Jams|...]]` with a space in the rec id) and silently strip
// them, rather than leaking the raw text to the user.
const MALFORMED_DIRECTIVE_SWEEP =
  /\[\[\s*(?:card|id|chip|suggest)\b[^\n]*?\]\]/gi

function stripMalformedDirectives(text: string): string {
  return text.replace(MALFORMED_DIRECTIVE_SWEEP, m => {
    if (
      CARD_TOKEN_RE.test(m) ||
      ID_TOKEN_RE.test(m) ||
      CHIP_TOKEN_RE.test(m) ||
      SUGGEST_TOKEN_RE.test(m)
    ) {
      return m
    }
    return ''
  })
}

interface CardSpec {
  id: string
  note?: string
}

function parseCardLine(line: string): CardSpec | null {
  const m = CARD_LINE.exec(line)
  if (!m) return null
  const note = m[2] ? cleanCardNote(m[2]) : ''
  return { id: normaliseListingId(m[1]), note: note || undefined }
}

function renderInline(
  text: string,
  citationsById: Map<string, CitationRef>,
  onSuggest?: (query: string, type?: string) => void,
  onCitationClick?: (c: CitationRef) => void,
  onLinkClick?: (href: string, label: string) => void
): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null
  INLINE_REGEX.lastIndex = 0

  while ((match = INLINE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]

    let m: RegExpExecArray | null
    if ((m = ID_TOKEN_RE.exec(token))) {
      const id = normaliseListingId(m[1])
      const cit = resolveCitation(id, citationsById)
      if (cit) {
        const isExt = /^https?:\/\//.test(cit.url)
        parts.push(
          <a
            key={`c-${key++}`}
            href={cit.url}
            target={isExt ? '_blank' : undefined}
            rel={isExt ? 'noopener noreferrer' : undefined}
            className={styles.inlineCitation}
            title={`Open ${cit.name}`}
            aria-label={`Open ${cit.name}`}
            onClick={() => onCitationClick?.(cit)}
          >
            <Icon src="/images/icons/arrow-up-right-small.svg" size={12} />
          </a>
        )
      }
    } else if ((m = CARD_TOKEN_RE.exec(token))) {
      // Cards inside a paragraph are rendered as just an inline reference.
      // Block-level card lines are handled by the block parser separately.
      const id = normaliseListingId(m[1])
      const cit = resolveCitation(id, citationsById)
      if (cit) {
        const isExt = /^https?:\/\//.test(cit.url)
        parts.push(
          <a
            key={`c-${key++}`}
            href={cit.url}
            target={isExt ? '_blank' : undefined}
            rel={isExt ? 'noopener noreferrer' : undefined}
            className={styles.inlineCitation}
            title={`Open ${cit.name}`}
            aria-label={`Open ${cit.name}`}
            onClick={() => onCitationClick?.(cit)}
          >
            <Icon src="/images/icons/arrow-up-right-small.svg" size={12} />
          </a>
        )
      }
    } else if (CHIP_TOKEN_RE.test(token)) {
      // Chip tokens are stripped from visible text; rendered separately
    } else if ((m = SUGGEST_TOKEN_RE.exec(token))) {
      const { type, query } = parseSuggestToken(m[1])
      // Jobs come from 80,000 Hours, not curated here — never offer to submit
      // one, even if the bot emits the token against instructions.
      if (type !== 'job') {
        parts.push(
          <SuggestInline
            key={`s-${key++}`}
            query={query}
            type={type}
            onSuggest={onSuggest}
          />
        )
      }
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      // Only http(s) and site-relative destinations become links. The model's
      // context includes untrusted webpage text (read_listing_page), so a
      // scheme like javascript: must render as plain text, never as an <a>.
      if (linkMatch && /^(https?:\/\/|\/|#)/.test(linkMatch[2])) {
        const href = linkMatch[2]
        const label = linkMatch[1]
        const isExternal = /^https?:\/\//.test(href)
        parts.push(
          <a
            key={`l-${key++}`}
            href={href}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            onClick={() => onLinkClick?.(href, label)}
          >
            {label}
          </a>
        )
      } else {
        parts.push(token)
      }
    } else if (token.startsWith('**')) {
      // Recurse so markdown inside bold (e.g. a link, `**[Jobs](/jobs)**`) is
      // processed rather than shown raw. INLINE_REGEX is shared global state,
      // so save/restore its cursor around the recursive call.
      const saved = INLINE_REGEX.lastIndex
      const inner = renderInline(
        token.slice(2, -2),
        citationsById,
        onSuggest,
        onCitationClick,
        onLinkClick
      )
      INLINE_REGEX.lastIndex = saved
      parts.push(<strong key={`b-${key++}`}>{inner}</strong>)
    } else if (token.startsWith('*')) {
      const saved = INLINE_REGEX.lastIndex
      const inner = renderInline(
        token.slice(1, -1),
        citationsById,
        onSuggest,
        onCitationClick,
        onLinkClick
      )
      INLINE_REGEX.lastIndex = saved
      parts.push(<em key={`i-${key++}`}>{inner}</em>)
    } else if (/^aisafety\.info/i.test(token)) {
      // Auto-linkify bare aisafety.info mentions (the bot writes it as plain
      // text). Scoped to this one domain to avoid false positives.
      const href = `https://${token}`
      parts.push(
        <a
          key={`u-${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onLinkClick?.(href, token)}
        >
          {token}
        </a>
      )
    }

    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

export function SuggestInline({
  query,
  type,
  onSuggest,
  badge,
}: {
  query: string
  type?: string
  onSuggest?: (query: string, type?: string) => void
  /** Rendered inside the button, after the label — the admin log viewer uses
   *  this to badge a button the visitor pressed. The live chat passes none. */
  badge?: React.ReactNode
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    onSuggest?.(query, type)
  }
  const label =
    type === 'correction'
      ? 'Suggest a correction'
      : type === 'contact'
        ? 'Contact the team'
        : type === 'feedback'
          ? 'Send feedback'
          : 'Suggest a listing'
  return (
    <span className={styles.suggest}>
      <a href="#" className={styles.suggestButton} onClick={handleClick}>
        {label}
        <Icon src="/images/icons/arrow-up-right.svg" size={16} />
        {badge}
      </a>
    </span>
  )
}

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'ul'; lines: string[] }
  | { kind: 'ol'; lines: string[]; start: number }
  | { kind: 'cards'; cards: CardSpec[] }

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let current: Block | null = null

  const flush = () => {
    if (current) {
      if (current.kind === 'cards' && current.cards.length === 0) {
        // skip empty
      } else if (
        (current.kind === 'paragraph' ||
          current.kind === 'ul' ||
          current.kind === 'ol') &&
        current.lines.length === 0
      ) {
        // skip empty
      } else {
        blocks.push(current)
      }
    }
    current = null
  }

  let pendingBlank = false
  for (const raw of lines) {
    const line = raw.trimEnd()

    if (line === '') {
      // A blank line between two items of the same list is a loose-list
      // separator (normal Markdown), not a list break — defer the decision
      // until we see the next line. Any other blank line ends the block as
      // before. Without this, blank-separated `1.`/`2.` items each became
      // their own single-item <ol> and every item restarted numbering at 1.
      if (current && (current.kind === 'ul' || current.kind === 'ol')) {
        pendingBlank = true
      } else {
        flush()
      }
      continue
    }

    const cardSpec = parseCardLine(line)
    const ulMatch = /^\s*[-•]\s+(.+)$/.exec(line)
    const olMatch = /^\s*(\d+)\.\s+(.+)$/.exec(line)

    // Resolve a deferred blank: keep the list open only if it continues with
    // another item of the same kind; otherwise the blank really did end it.
    if (pendingBlank) {
      const continues =
        (!!ulMatch && current?.kind === 'ul') ||
        (!!olMatch && current?.kind === 'ol')
      if (!continues) flush()
      pendingBlank = false
    }

    if (cardSpec) {
      if (!current || current.kind !== 'cards') {
        flush()
        current = { kind: 'cards', cards: [] }
      }
      current.cards.push(cardSpec)
    } else if (ulMatch) {
      if (!current || current.kind !== 'ul') {
        flush()
        current = { kind: 'ul', lines: [] }
      }
      current.lines.push(ulMatch[1])
    } else if (olMatch) {
      if (!current || current.kind !== 'ol') {
        flush()
        // Preserve the item's actual number so a list split across cards or
        // paragraphs (each a separate <ol>) keeps counting up via `start`
        // instead of restarting at 1.
        current = { kind: 'ol', lines: [], start: parseInt(olMatch[1], 10) }
      }
      current.lines.push(olMatch[2])
    } else {
      if (!current || current.kind !== 'paragraph') {
        flush()
        current = { kind: 'paragraph', lines: [] }
      }
      current.lines.push(line)
    }
  }
  flush()
  return blocks
}

export default function MessageContent({
  text,
  citations,
  onSuggest,
  onCitationClick,
  onLinkClick,
  isStreaming,
}: Props) {
  const citationsById = useMemo(
    () => new Map(citations.map(c => [c.id, c])),
    [citations]
  )
  const masked = isStreaming ? maskStreamingTail(text) : text
  const visibleText = stripMalformedDirectives(masked)
  const blocks = useMemo(() => parseBlocks(visibleText), [visibleText])

  // A cards block whose every card fails to resolve (e.g. the model wrote a
  // card for a listing it never actually retrieved, so the id matches no
  // citation) renders nothing. That orphans its lead-in — a colon-terminated
  // sentence like "And this fellowship is open to entry-level applicants:"
  // pointing at a card that vanished. Hide both the empty cards block and that
  // dangling lead-in so the visitor never sees a sentence trailing into
  // nothing. Only applied once streaming has finished, when every citation is
  // in, so there's no mid-stream flicker.
  const hiddenBlocks = useMemo(() => {
    const hidden = new Set<number>()
    if (isStreaming) return hidden
    blocks.forEach((block, i) => {
      if (block.kind !== 'cards') return
      // A card renders if it resolves to a real listing, OR (failing that) its
      // type is known — in which case it degrades to a "Browse X" fallback link
      // rather than vanishing. Only when NOTHING in the block can render do we
      // hide the block and its now-orphaned lead-in.
      const anyRenderable = block.cards.some(
        spec => resolveCitation(spec.id, citationsById) || cardTypePage(spec.id)
      )
      if (anyRenderable) return
      hidden.add(i)
      const prev = blocks[i - 1]
      if (prev && prev.kind !== 'cards' && prev.lines.length > 0) {
        // Strip trailing emphasis/code markers so a lead-in ending "…momentum:"
        // is caught even when written "…**momentum:**" (colon inside bold).
        const lead = prev.lines[prev.lines.length - 1]
          .trimEnd()
          .replace(/[*_`]+$/, '')
          .trimEnd()
        if (
          lead.endsWith(':') &&
          // Any paragraph, or a single-item list that's purely the lead-in.
          // Don't nuke a genuine multi-item list because its last item ends ':'.
          (prev.kind === 'paragraph' || prev.lines.length === 1)
        ) {
          hidden.add(i - 1)
        }
      }
    })
    return hidden
  }, [blocks, citationsById, isStreaming])

  return (
    <div className={styles.assistantMessage}>
      {blocks.map((block, i) => {
        if (hiddenBlocks.has(i)) return null
        if (block.kind === 'cards') {
          return (
            <div key={i} className={styles.citationStack}>
              {block.cards.map((spec, j) => {
                const cit = resolveCitation(spec.id, citationsById)
                if (cit) {
                  return (
                    <CitationCard
                      key={`${spec.id}-${j}`}
                      citation={cit}
                      note={spec.note}
                      onClick={onCitationClick}
                    />
                  )
                }
                // The card's id doesn't resolve — the model fabricated it, or
                // it's a real listing it never retrieved this turn. Rather than
                // silently dropping it (which orphans the lead-in sentence),
                // degrade to an honest link to the matching resource page. The
                // label stays generic — never the model's note, which has no
                // backing. If the type isn't parseable, render nothing and let
                // hiddenBlocks hide the dangling lead-in instead.
                const fb = cardTypePage(spec.id)
                if (!fb) return null
                return (
                  <a
                    key={`fb-${spec.id}-${j}`}
                    href={fb.path}
                    className={styles.citationFallback}
                    onClick={() => onLinkClick?.(fb.path, fb.label)}
                  >
                    <span>{fb.label}</span>
                    <Icon src="/images/icons/arrow-up-right.svg" size={16} />
                  </a>
                )
              })}
            </div>
          )
        }
        if (block.kind === 'paragraph') {
          const paragraphText = block.lines.join(' ')
          return (
            <p key={i}>
              {renderInline(
                paragraphText,
                citationsById,
                onSuggest,
                onCitationClick,
                onLinkClick
              )}
              {isStreaming && i === blocks.length - 1 && (
                <span className={styles.cursor} />
              )}
            </p>
          )
        }
        const items = block.lines.map((item, j) => (
          <li key={j}>
            <Fragment>
              {renderInline(
                item,
                citationsById,
                onSuggest,
                onCitationClick,
                onLinkClick
              )}
            </Fragment>
          </li>
        ))
        return block.kind === 'ol' ? (
          <ol key={i} start={block.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        )
      })}
      {isStreaming && blocks.length === 0 && (
        <p>
          <span className={styles.cursor} />
        </p>
      )}
    </div>
  )
}
