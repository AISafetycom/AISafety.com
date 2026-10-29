// Renders a stored assistant reply the way visitors saw it: markdown
// formatted, [[card:...]] lines as listing pills, [[chip:...]] tokens as
// suggestion chips, [[suggest:...]] tokens as the live "Suggest a listing"
// button (inline, where the bot offered it), and the pre-[[/thinking]] search
// trail dimmed. The stored history has no resolvable citation objects, so card
// pills are label-driven (the text after the | in the token).

import { createContext, Fragment, ReactNode, useContext, useState } from 'react'
import {
  SuggestInline,
  flattenNoteLinks,
  parseSuggestToken,
} from '@/components/assistant/MessageContent'
import { cardTypePage } from '@/components/assistant/cardFallback'
import { suggestFormUrl } from '@/lib/assistant/constants'
import styles from '../admin.module.css'

export interface ListingInfo {
  name: string
  /** The org behind the listing (a job's hiring org, a course's creator). */
  organization?: string
  logo?: string
  /** External listing URL (the live card's destination). */
  url?: string
  /** AISafety.com resource-page link, used when there's no external URL. */
  pageUrl?: string
}

/** id → listing {name, logo}, supplied by the conversations API so card pills
 *  can show which listing they are (the stored token only has the id + note). */
export const ListingInfoContext = createContext<Record<string, ListingInfo>>({})

/** Set of listing ids (full and bare-rec forms) whose cards the visitor
 *  clicked in this conversation, so the viewer can badge them. */
export const ClickedCardsContext = createContext<Set<string>>(new Set())

/** Resolve a card token's id to its listing info: try the full id, then the
 *  bare rec id (handles tokens written without a type prefix). */
export function resolveListing(
  listings: Record<string, ListingInfo>,
  id: string
): ListingInfo | null {
  const cleaned = id.replace(/\s+/g, '')
  if (listings[cleaned]) return listings[cleaned]
  const rec = /rec[A-Za-z0-9]+/.exec(cleaned)?.[0]
  if (rec && listings[rec]) return listings[rec]
  return null
}

// Boundary between the model's reasoning (the dimmed "search trail") and its
// answer. Require the slash and use the LAST occurrence, mirroring the live
// streaming renderer (ChatBody): if the model drafts a reply, searches again,
// and restarts, everything up to the final [[/thinking]] is reasoning and only
// the text after it is the answer — so an abandoned first draft doesn't double
// up in the body.
const THINKING_DONE_RE = /\[\[\s*\/\s*thinking\s*\]\]/gi

function lastThinkingDone(
  text: string
): { index: number; length: number } | null {
  THINKING_DONE_RE.lastIndex = 0
  let last: RegExpExecArray | null = null
  for (
    let m = THINKING_DONE_RE.exec(text);
    m;
    m = THINKING_DONE_RE.exec(text)
  ) {
    last = m
  }
  return last ? { index: last.index, length: last[0].length } : null
}
const CHIP_RE = /\[\[\s*chip\s*:([^\]\n]*)\]\]/gi
const SUGGEST_TOKEN_RE = /^\[\[\s*suggest\s*:([^\]\n]*)\]\]$/i
// Same strict grammar as the live renderer's CARD_LINE (MessageContent): a
// card line must carry a proper rec id. Sloppier tokens (a space inside the
// rec id, no rec at all) were NOT cards in the visitor's chat — the live
// malformed-directive sweep stripped them — so they must not become pills
// here either; they fall through to the paragraph path and render as
// struck-through "stripped" tokens instead. Like the live renderer, the
// |note runs to the closing `]]`, so brackets inside it don't break the card.
const CARD_LINE_RE =
  /^\s*\[\[\s*card\s*:\s*((?:[a-z][a-z-]*\s*:\s*)*rec[A-Za-z0-9]+)(?:\s*\|(.*?))?\s*\]\]\s*$/i
// Anchored well-formedness tests for inline card/id tokens, mirroring the
// live renderer's CARD_TOKEN_RE / ID_TOKEN_RE.
const STRICT_CARD_TOKEN_RE =
  /^\[\[\s*card\s*:\s*(?:[a-z][a-z-]*\s*:\s*)*rec[A-Za-z0-9]+(?:\s*\|.*?)?\s*\]\]$/i
const STRICT_ID_TOKEN_RE =
  /^\[\[\s*id\s*:\s*(?:[a-z][a-z-]*\s*:\s*)*rec[A-Za-z0-9]+\s*\]\]$/i
const INLINE_RE =
  /(\[\[[^\n]*?\]\])|(\[[^\]\n]+\]\(\/?[^)\n]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\baisafety\.info(?:\/[^\s<>),]*)?)/gi

/** Did the visitor get a real card for this token, or a degraded fallback?
 *  Turns logged since fallback tracking (Data.fallbackCards) say exactly
 *  which ids degraded; for older turns, an id that resolves to nothing was
 *  certainly degraded live (the widget had no listing for it either). */
function cardDegraded(
  cardId: string,
  listings: Record<string, ListingInfo>,
  fallbackIds?: Set<string>
): boolean {
  if (fallbackIds) {
    const rec = /rec[A-Za-z0-9]+/.exec(cardId)?.[0]
    return fallbackIds.has(cardId) || (!!rec && fallbackIds.has(rec))
  }
  return !resolveListing(listings, cardId)
}

/** "job:recXXX" → "job"; bare rec ids have no type. */
function cardType(rawId: string): string | null {
  const cleaned = rawId.replace(/\s+/g, '')
  const m = /^([a-z-]+):/i.exec(cleaned)
  return m ? m[1].toLowerCase() : null
}

/** Human label for an inline card/id token: prefer the resolved listing
 *  name, then the |label, then the type prefix, then the bare rec id. */
function inlineCardLabel(
  token: string,
  listings: Record<string, ListingInfo>
): string {
  const m =
    /^\[\[\s*(?:card|id)\s*:\s*([^\]|\n]+?)(?:\s*\|(.*?))?\s*\]\]$/i.exec(token)
  if (!m) return ''
  const info = resolveListing(listings, m[1])
  if (info) return info.name
  const noteLabel = flattenNoteLinks(m[2] ?? '').trim()
  if (noteLabel) return noteLabel
  const type = cardType(m[1])
  const rec = /rec[A-Za-z0-9]+/.exec(m[1])?.[0] ?? m[1].trim()
  return type ? `${type} ${rec}` : rec
}

interface ParsedMessage {
  thinking: string | null
  body: string
  chips: string[]
}

function parseMessage(text: string): ParsedMessage {
  const marker = lastThinkingDone(text)
  const thinking = marker ? text.slice(0, marker.index).trim() || null : null
  let body = marker ? text.slice(marker.index + marker.length) : text

  const chips: string[] = []
  body = body.replace(CHIP_RE, (_, label: string) => {
    const trimmed = label.trim()
    if (trimmed) chips.push(trimmed)
    return ''
  })

  // The [[suggest:...]] token is left in the body so renderInline can render
  // the real button inline, exactly where the bot offered it.
  return { thinking, body: body.trim(), chips }
}

/** Wraps an inline link with a "clicked" badge when the visitor opened it.
 *  Link clicks are stored in the same Clicked set as cards, keyed
 *  `<turnIndex>:link:<href>`. The bare `link:<href>` form is the legacy path
 *  for rows recorded before link clicks were turn-scoped — there every copy
 *  of the href is still badged, matching cards' legacy behaviour. */
function inlineLink(
  href: string,
  text: ReactNode,
  clicked: Set<string>,
  key: string,
  turnIndex?: number
): ReactNode {
  const wasClicked =
    (turnIndex != null && clicked.has(`${turnIndex}:link:${href}`)) ||
    clicked.has(`link:${href}`)
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${styles.convLink}${wasClicked ? ` ${styles.convLinkClicked}` : ''}`}
    >
      {text}
      {wasClicked && (
        <span
          className={styles.convLinkClickedTag}
          title="The user clicked this link"
        >
          ✓
        </span>
      )}
    </a>
  )
}

/** Open the same submission form the live button would, so a reviewer can
 *  confirm which form the visitor was offered. */
function openSuggestForm(_query: string, type?: string) {
  window.open(suggestFormUrl(type), '_blank', 'noopener')
}

// Global scan (vs the anchored, per-token SUGGEST_TOKEN_RE) for finding any
// suggest token within a message.
const SUGGEST_SCAN_RE = /\[\[\s*suggest\s*:([^\]\n]*)\]\]/gi

/** True when this assistant message renders a "Suggest a listing" button —
 *  i.e. it carries a [[suggest:...]] token that parses to a type with a form
 *  (everything except `job`). The conversation list uses this to drop the
 *  now-redundant "NO MATCH" badge once the visitor was offered a suggest form. */
export function hasSuggestButton(text: string): boolean {
  SUGGEST_SCAN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SUGGEST_SCAN_RE.exec(text)) !== null) {
    if (parseSuggestToken(m[1]).type !== 'job') return true
  }
  return false
}

function renderInline(
  text: string,
  listings: Record<string, ListingInfo>,
  clicked: Set<string>,
  fallbackIds?: Set<string>,
  turnIndex?: number
): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null
  INLINE_RE.lastIndex = 0

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const token = match[0]

    if (/^\[\[/.test(token)) {
      const suggest = SUGGEST_TOKEN_RE.exec(token)
      if (suggest) {
        // Render the actual "Suggest a listing" button the visitor saw, inline
        // where the bot offered it, reusing the live chat's own component so it
        // looks identical. Clicking opens the same Airtable form the visitor
        // would have got, so a reviewer can confirm the right form was offered.
        // `job` has no submission form, so the live renderer shows no button
        // there — mirror that.
        const { type, query } = parseSuggestToken(suggest[1])
        if (type !== 'job') {
          // Badge the button when the visitor pressed it (opening the form).
          // Presses are stored in the same Clicked set as cards and links,
          // keyed `<turnIndex>:suggest:<type>` ('listing' when the token has
          // no recognized type — mirroring the live logger's fallback). The
          // bare `suggest:<type>` form is the legacy/unscoped path.
          const suggestKey = `suggest:${type ?? 'listing'}`
          const wasPressed =
            (turnIndex != null && clicked.has(`${turnIndex}:${suggestKey}`)) ||
            clicked.has(suggestKey)
          parts.push(
            <SuggestInline
              key={`s-${key++}`}
              query={query}
              type={type}
              onSuggest={openSuggestForm}
              badge={
                wasPressed ? (
                  <span
                    className={styles.convCardClicked}
                    title="The visitor pressed this button and opened the form"
                  >
                    ✓
                  </span>
                ) : undefined
              }
            />
          )
        }
      } else if (/^\[\[\s*(?:card|id)\s*:/i.test(token)) {
        if (
          STRICT_CARD_TOKEN_RE.test(token) ||
          STRICT_ID_TOKEN_RE.test(token)
        ) {
          const rawId =
            /^\[\[\s*(?:card|id)\s*:\s*([^\]|\n]+?)(?:\s*\|[^\]\n]*)?\s*\]\]$/i
              .exec(token)?.[1]
              ?.replace(/\s+/g, '') ?? ''
          if (cardDegraded(rawId, listings, fallbackIds)) {
            // Live, an inline reference the widget couldn't resolve rendered
            // nothing — mark it so the reviewer knows the visitor saw no link.
            parts.push(
              <s
                key={`c-${key++}`}
                className={styles.convStripped}
                title="This inline reference did not resolve in the visitor's chat — they saw no link here"
              >
                {inlineCardLabel(token, listings) || rawId}
              </s>
            )
          } else {
            parts.push(
              <span key={`c-${key++}`} className={styles.convCardInline}>
                {inlineCardLabel(token, listings)}
              </span>
            )
          }
        } else {
          // Malformed card/id token (e.g. a space inside the rec id): the live
          // renderer's malformed-directive sweep stripped it, so the visitor
          // saw nothing — show it struck-through rather than as a real badge.
          parts.push(
            <s
              key={`c-${key++}`}
              className={styles.convStripped}
              title="Malformed token — stripped from the visitor's view"
            >
              {token}
            </s>
          )
        }
      }
      // Any other [[...]] directive is already handled or defensive-stripped
      // by the live renderer — drop it silently rather than leaking brackets.
    } else if (token.startsWith('[')) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      // Mirror the live renderer's scheme guard: only http(s) and
      // site-relative destinations became links for the visitor; anything
      // else (e.g. javascript:) rendered as plain text.
      if (m && /^(https?:\/\/|\/|#)/.test(m[2])) {
        parts.push(inlineLink(m[2], m[1], clicked, `l-${key++}`, turnIndex))
      } else {
        parts.push(token)
      }
    } else if (token.startsWith('**')) {
      // Recurse so markdown inside bold (e.g. `**[Jobs](/jobs)**`) renders as
      // it did live. INLINE_RE is shared global state — save/restore its
      // cursor around the recursive call.
      const saved = INLINE_RE.lastIndex
      const inner = renderInline(
        token.slice(2, -2),
        listings,
        clicked,
        fallbackIds,
        turnIndex
      )
      INLINE_RE.lastIndex = saved
      parts.push(<strong key={`b-${key++}`}>{inner}</strong>)
    } else if (/^aisafety\.info/i.test(token)) {
      // Auto-linkify bare aisafety.info mentions, matching the live renderer
      // (the bot writes it as plain text rather than a markdown link).
      parts.push(
        inlineLink(`https://${token}`, token, clicked, `u-${key++}`, turnIndex)
      )
    } else {
      const saved = INLINE_RE.lastIndex
      const inner = renderInline(
        token.slice(1, -1),
        listings,
        clicked,
        fallbackIds,
        turnIndex
      )
      INLINE_RE.lastIndex = saved
      parts.push(<em key={`i-${key++}`}>{inner}</em>)
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

interface CardSpec {
  type: string | null
  id: string
  note: string
}

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'ul'; lines: string[] }
  | { kind: 'ol'; lines: string[]; start: number }
  | { kind: 'cards'; cards: CardSpec[] }

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null

  const flush = () => {
    if (
      current &&
      ((current.kind === 'cards' && current.cards.length > 0) ||
        (current.kind !== 'cards' && current.lines.length > 0))
    ) {
      blocks.push(current)
    }
    current = null
  }

  let pendingBlank = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (line === '') {
      // A blank line between two items of the same list is a loose-list
      // separator (normal Markdown), not a list break — defer the decision
      // until we see the next line. Any other blank line ends the block as
      // before. Mirrors the live renderer (MessageContent) so the admin
      // transcript shows the same numbering visitors saw.
      if (current && (current.kind === 'ul' || current.kind === 'ol')) {
        pendingBlank = true
      } else {
        flush()
      }
      continue
    }
    const cardMatch = CARD_LINE_RE.exec(line)
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

    if (cardMatch) {
      if (current?.kind !== 'cards') {
        flush()
        current = { kind: 'cards', cards: [] }
      }
      current.cards.push({
        type: cardType(cardMatch[1]),
        id: cardMatch[1].replace(/\s+/g, ''),
        note: flattenNoteLinks(cardMatch[2] ?? '').trim(),
      })
    } else if (ulMatch) {
      if (current?.kind !== 'ul') {
        flush()
        current = { kind: 'ul', lines: [] }
      }
      current.lines.push(ulMatch[1])
    } else if (olMatch) {
      if (current?.kind !== 'ol') {
        flush()
        // Preserve the item's actual number so a list split across cards or
        // paragraphs (each a separate <ol>) keeps counting up via `start`
        // instead of restarting at 1.
        current = { kind: 'ol', lines: [], start: parseInt(olMatch[1], 10) }
      }
      current.lines.push(olMatch[2])
    } else {
      if (current?.kind !== 'paragraph') {
        flush()
        current = { kind: 'paragraph', lines: [] }
      }
      current.lines.push(line)
    }
  }
  flush()
  return blocks
}

function CardPill({
  card,
  turnIndex,
  fallbackIds,
}: {
  card: CardSpec
  turnIndex?: number
  fallbackIds?: Set<string>
}) {
  const listings = useContext(ListingInfoContext)
  const clicked = useContext(ClickedCardsContext)
  const [imgFailed, setImgFailed] = useState(false)
  const info = resolveListing(listings, card.id)
  const rec = /rec[A-Za-z0-9]+/.exec(card.id)?.[0] ?? card.id

  // The visitor never got this card: the model wrote it without a tool having
  // returned the listing, so the live widget degraded it to a generic
  // "Browse X" link — or, when even the type wasn't parseable, dropped it.
  // Render what the visitor actually saw, annotated with what the model wrote.
  if (cardDegraded(card.id, listings, fallbackIds)) {
    const fb = cardTypePage(card.id)
    const attempted = info?.name ?? card.id
    if (!fb) {
      return (
        <span
          className={styles.convCardGhost}
          title="The model wrote this card without retrieving the listing and its type wasn't parseable, so the visitor's chat dropped it entirely"
        >
          hidden from visitor: {attempted}
        </span>
      )
    }
    const wasClicked =
      (turnIndex != null && clicked.has(`${turnIndex}:link:${fb.path}`)) ||
      clicked.has(`link:${fb.path}`)
    return (
      <span className={styles.convCardDegradedRow}>
        <a
          href={fb.path}
          target="_blank"
          rel="noopener noreferrer"
          className={`${styles.convCard} ${styles.convCardLink} ${styles.convCardFallback}`}
          title="This is what the visitor saw: a generic resource-page link, not a card — the model wrote the card without retrieving the listing"
        >
          <span className={styles.convCardName}>{fb.label}</span>
          {wasClicked && (
            <span className={styles.convCardClicked}>✓ clicked</span>
          )}
        </a>
        <span className={styles.convCardFallbackNote}>
          {info
            ? `shown instead of “${info.name}” — the model carded it without a search`
            : `fabricated id: ${card.id}`}
        </span>
      </span>
    )
  }

  // Prefer the real listing name; fall back to the note, then the raw id, so
  // a card is never blank.
  const primary = info?.name ?? (card.note || rec)
  const showNote = Boolean(card.note) && card.note !== primary
  const showLogo = Boolean(info?.logo) && !imgFailed
  // Turn-scoped match badges only the card the visitor opened. The bare-id
  // match is the legacy path for rows recorded before clicks were turn-scoped
  // (their set has no `<turn>:` entries), where every copy is still badged.
  const wasClicked =
    (turnIndex != null &&
      (clicked.has(`${turnIndex}:${card.id}`) ||
        clicked.has(`${turnIndex}:${rec}`))) ||
    clicked.has(card.id) ||
    clicked.has(rec)
  // Link to the listing's external URL (what the live card opens); fall back
  // to its AISafety.com resource page when there's no usable external URL.
  const href =
    info?.url && /^https?:\/\//.test(info.url) ? info.url : info?.pageUrl
  const className = `${styles.convCard}${wasClicked ? ` ${styles.convCardClickedRow}` : ''}${href ? ` ${styles.convCardLink}` : ''}`
  const inner = (
    <>
      {showLogo ? (
        // Plain <img>: logos are tiny favicons/cdn URLs from third-party
        // hosts, so next/image's pipeline buys us nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={info!.logo}
          alt=""
          width={18}
          height={18}
          className={styles.convCardLogo}
          onError={() => setImgFailed(true)}
        />
      ) : null}
      {card.type && (
        <span className={styles.convCardType}>
          {/* The internal listing type for field-map entries is 'org', but
           *  only about half of them are organizations — label them by their
           *  page instead so the chip doesn't misdescribe the listing. */}
          {card.type === 'org' ? 'map' : card.type}
        </span>
      )}
      <span className={styles.convCardName}>{primary}</span>
      {info?.organization &&
        info.organization !== primary &&
        info.organization !== card.note && (
          <span className="color-teal-grey-300">{info.organization}</span>
        )}
      {showNote && <span className={styles.convCardNote}>{card.note}</span>}
      {wasClicked && <span className={styles.convCardClicked}>✓ clicked</span>}
    </>
  )
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {inner}
    </a>
  ) : (
    <span className={className}>{inner}</span>
  )
}

function MessageBody({
  text,
  turnIndex,
  fallbackIds,
}: {
  text: string
  turnIndex?: number
  fallbackIds?: Set<string>
}) {
  const blocks = parseBlocks(text)
  const listings = useContext(ListingInfoContext)
  const clicked = useContext(ClickedCardsContext)

  // Mirror the live renderer's hiddenBlocks: a cards block where NOTHING was
  // renderable (every card degraded with no "Browse X" fallback either) was
  // hidden from the visitor along with its dangling colon-terminated lead-in
  // sentence. The admin dims those blocks instead of hiding them, so the
  // reviewer sees what the model wrote AND that the visitor never saw it.
  const dimmed = new Set<number>()
  blocks.forEach((block, i) => {
    if (block.kind !== 'cards') return
    const anyRenderable = block.cards.some(
      card =>
        !cardDegraded(card.id, listings, fallbackIds) || cardTypePage(card.id)
    )
    if (anyRenderable) return
    dimmed.add(i)
    const prev = blocks[i - 1]
    if (prev && prev.kind !== 'cards' && prev.lines.length > 0) {
      const lead = prev.lines[prev.lines.length - 1]
        .trimEnd()
        .replace(/[*_`]+$/, '')
        .trimEnd()
      if (
        lead.endsWith(':') &&
        (prev.kind === 'paragraph' || prev.lines.length === 1)
      ) {
        dimmed.add(i - 1)
      }
    }
  })

  const wrap = (i: number, node: ReactNode) =>
    dimmed.has(i) ? (
      <div
        key={i}
        className={styles.convNotShown}
        title="Hidden from the visitor — their chat dropped this block (no card in it could render)"
      >
        {node}
      </div>
    ) : (
      node
    )

  return (
    <>
      {blocks.map((block, i) => {
        if (block.kind === 'cards') {
          return wrap(
            i,
            <div key={i} className={styles.convCards}>
              {block.cards.map((card, j) => (
                <CardPill
                  key={j}
                  card={card}
                  turnIndex={turnIndex}
                  fallbackIds={fallbackIds}
                />
              ))}
            </div>
          )
        }
        if (block.kind === 'paragraph') {
          return wrap(
            i,
            <p key={i}>
              {renderInline(
                block.lines.join(' '),
                listings,
                clicked,
                fallbackIds,
                turnIndex
              )}
            </p>
          )
        }
        const items = block.lines.map((item, j) => (
          <li key={j}>
            <Fragment>
              {renderInline(item, listings, clicked, fallbackIds, turnIndex)}
            </Fragment>
          </li>
        ))
        return wrap(
          i,
          block.kind === 'ol' ? (
            <ol key={i} start={block.start}>
              {items}
            </ol>
          ) : (
            <ul key={i}>{items}</ul>
          )
        )
      })}
    </>
  )
}

export default function TranscriptMessage({
  text,
  turnIndex,
  fallbackCardIds,
}: {
  text: string
  /** This reply's position in the VISITOR's message list (data.historyIndices
   *  — the indexing the turn-scoped click keys use), so clicked-card badges
   *  can be matched to the exact turn. Omitted when the mapping is unknown
   *  (legacy rows without stored history, or with dropped messages). */
  turnIndex?: number
  /** Card ids in THIS turn that degraded to a "Browse X" link (or nothing) in
   *  the visitor's chat, from Data.fallbackCards. Undefined when the turn
   *  predates fallback tracking — then unresolvability is used as the signal. */
  fallbackCardIds?: Set<string>
}) {
  // The reasoning/search trail before the [[/thinking]] boundary is dropped
  // here: it's never shown to visitors (the live chat hides it), and it adds
  // noise to the admin transcript. parseMessage still splits it off so it
  // stays out of the body below.
  const { body, chips } = parseMessage(text)
  return (
    <div className={styles.convMsg}>
      <MessageBody
        text={body}
        turnIndex={turnIndex}
        fallbackIds={fallbackCardIds}
      />
      {chips.length > 0 && (
        <div className={styles.convChips}>
          {chips.map((chip, i) => (
            <span key={i} className={styles.convChip}>
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
