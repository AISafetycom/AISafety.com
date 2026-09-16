// Between the guide's rich text and the editor's document (TipTap JSON).
// Pure JSON in both directions, no editor imports, so it tests on its own.
// The browser runs this before every save and the server still validates
// the result; nothing here is trusted on its own.
import type { Block, Inline, RichText } from './types'

/** The subset of TipTap's JSON the editor is configured to produce. */
export interface TiptapNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: TiptapNode[]
}

function textNode(inline: Inline): TiptapNode {
  const marks: TiptapNode['marks'] = []
  if (inline.bold) marks.push({ type: 'bold' })
  if (inline.href) marks.push({ type: 'link', attrs: { href: inline.href } })
  const node: TiptapNode = { type: 'text', text: inline.text }
  if (marks.length) node.marks = marks
  return node
}

function paragraph(inlines: Inline[]): TiptapNode {
  const node: TiptapNode = { type: 'paragraph' }
  if (inlines.length) node.content = inlines.map(textNode)
  return node
}

export function toTiptap(rt: RichText): TiptapNode {
  const content = rt.blocks.map<TiptapNode>(b =>
    b.type === 'paragraph'
      ? paragraph(b.inlines)
      : {
          type: b.type === 'numbers' ? 'orderedList' : 'bulletList',
          content: b.items.map(item => ({
            type: 'listItem',
            content: [paragraph(item)],
          })),
        }
  )
  return { type: 'doc', content: content.length ? content : [paragraph([])] }
}

function pushInline(out: Inline[], inline: Inline) {
  if (!inline.text) return
  const last = out[out.length - 1]
  if (
    last &&
    Boolean(last.bold) === Boolean(inline.bold) &&
    (last.href ?? '') === (inline.href ?? '')
  ) {
    last.text += inline.text
  } else {
    out.push(inline)
  }
}

/** Every text node under `node`, in order, as inlines; paragraphs inside
 *  (a list item with several) are joined with a space. */
function collectInlines(node: TiptapNode, out: Inline[]): void {
  if (node.type === 'text') {
    let bold = false
    let href: string | undefined
    for (const m of node.marks ?? []) {
      if (m.type === 'bold') bold = true
      if (m.type === 'link' && typeof m.attrs?.href === 'string') {
        href = m.attrs.href
      }
    }
    // Always text, bold, href in that order: the editor reorders marks, and
    // the guide compares saved and unsaved text as JSON strings.
    const inline: Inline = { text: node.text ?? '' }
    if (bold) inline.bold = true
    if (href) inline.href = href
    pushInline(out, inline)
    return
  }
  if (node.type === 'hardBreak') {
    pushInline(out, { text: ' ' })
    return
  }
  const kids = node.content ?? []
  kids.forEach((k, i) => {
    if (i > 0 && k.type === 'paragraph') pushInline(out, { text: ' ' })
    collectInlines(k, out)
  })
}

function trimInlines(inlines: Inline[]): Inline[] {
  const out = inlines.map(i => ({ ...i }))
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, '')
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '')
  }
  return out.filter(i => i.text.length > 0)
}

/** A list item's own text is one item; a list nested inside it becomes
 *  further items after it, so the guide never holds nested lists. */
function listItems(item: TiptapNode, out: Inline[][]) {
  const own: Inline[] = []
  const nested: TiptapNode[] = []
  for (const k of item.content ?? []) {
    if (k.type === 'bulletList' || k.type === 'orderedList') nested.push(k)
    else {
      if (own.length && k.type === 'paragraph') pushInline(own, { text: ' ' })
      collectInlines(k, own)
    }
  }
  const trimmed = trimInlines(own)
  if (trimmed.length) out.push(trimmed)
  for (const list of nested) {
    for (const li of list.content ?? []) listItems(li, out)
  }
}

/** The editor's document as the guide's rich text. Empty paragraphs are
 *  dropped; with `singleParagraph` everything collapses into one paragraph
 *  (the intro). */
export function fromTiptap(
  doc: TiptapNode,
  opts: { singleParagraph?: boolean } = {}
): RichText {
  if (opts.singleParagraph) {
    const all: Inline[] = []
    collectInlines(doc, all)
    return { blocks: [{ type: 'paragraph', inlines: trimInlines(all) }] }
  }
  const blocks: Block[] = []
  for (const node of doc.content ?? []) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const items: Inline[][] = []
      for (const li of node.content ?? []) listItems(li, items)
      if (items.length) {
        blocks.push({
          type: node.type === 'orderedList' ? 'numbers' : 'bullets',
          items,
        })
      }
      continue
    }
    // Paragraphs, and anything else block-shaped that slipped in, read as
    // a paragraph of their text.
    const inlines: Inline[] = []
    collectInlines(node, inlines)
    const trimmed = trimInlines(inlines)
    if (trimmed.length) blocks.push({ type: 'paragraph', inlines: trimmed })
  }
  return { blocks }
}
