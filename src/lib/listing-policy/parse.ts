/** A tiny parser for the listing policy's Markdown subset (see text.ts). It
 *  only has to handle that one document, so it stays deliberately small. */

export type PolicyBlock =
  | { kind: 'h1' | 'h2' | 'h3' | 'p'; text: string }
  | { kind: 'ul'; items: string[] }

export function parsePolicy(md: string): PolicyBlock[] {
  const blocks: PolicyBlock[] = []
  let para: string[] = []
  let list: string[] | null = null

  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') })
    para = []
    if (list) blocks.push({ kind: 'ul', items: list })
    list = null
  }

  for (const raw of md.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line)
    if (heading) {
      flush()
      const kind = (['h1', 'h2', 'h3'] as const)[heading[1].length - 1]
      blocks.push({ kind, text: heading[2] })
      continue
    }
    if (line.startsWith('- ')) {
      // A bullet directly under a paragraph line ends that paragraph.
      if (para.length) {
        blocks.push({ kind: 'p', text: para.join(' ') })
        para = []
      }
      list = list ?? []
      list.push(line.slice(2))
      continue
    }
    if (list) flush()
    para.push(line)
  }
  flush()
  return blocks
}

export type InlinePart =
  | { kind: 'text' | 'bold'; text: string }
  | { kind: 'link'; text: string; href: string }

/** Splits a line into plain text, **bold** runs and [links](url). */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last)
      parts.push({ kind: 'text', text: text.slice(last, m.index) })
    if (m[1] !== undefined) parts.push({ kind: 'bold', text: m[1] })
    else parts.push({ kind: 'link', text: m[2], href: m[3] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
