/*
  The Markdown Fable writes in the Queue's chat, read into a small tree the
  panel draws (Chat.tsx). Bryce, 18 Nov 2026, on a reply where bold and
  bullets showed but a link read `a [meetup for people building AI
  products](saopaulo.aitinkerers.org/), with live demos`: "please make
  Markdown come through properly, like links."

  Until then the panel knew paragraphs, flat bullets, fenced code, **bold**,
  `code` and bare https:// links, and showed the rest as typed. This reads
  what Fable's replies in ~/Queue/chat actually hold (415 of them on that
  day: links with a label, a fifth of them wrapped in bold or brackets;
  addresses with no https://; links to files on the Mac; bullets inside
  bullets, numbered steps under a bullet, block quotes, the odd table) and
  what it may reasonably write next: italics, headings, rules, strike.

  Pure, no DOM and no React: `parseMarkdown` gives blocks, `parseInline` the
  marks inside one, and `markdownOf` turns a piece of the drawn panel back
  into Markdown for the Reply quote, so a quoted link keeps its address.

  A link is only ever a web address: http or https, or a bare domain as
  Fable writes them (https:// is put in front), with no login in it.
  javascript:, data:, mailto: and anything else stay the words that were
  typed. A link to a file on the Mac cannot open from a web page, so it is
  shown as its label and path, never as a link. No image is ever fetched.
*/

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'br' }
  | { t: 'code'; text: string }
  | { t: 'strong' | 'em' | 'del'; kids: Inline[] }
  /** `auto`: an address written bare, shown without its scheme. */
  | { t: 'link'; href: string; kids: Inline[]; auto?: boolean }
  /** A link to a file on the Mac: its label and the path, never a link. */
  | { t: 'file'; path: string; kids: Inline[] }

export type Align = 'left' | 'right' | 'center' | null

export type Block =
  | { t: 'p'; kids: Inline[] }
  | { t: 'head'; level: number; kids: Inline[] }
  | { t: 'code'; text: string; lang: string }
  | { t: 'quote'; blocks: Block[] }
  /** Each item is its own blocks: a paragraph, then any list under it. */
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { t: 'rule' }
  | { t: 'table'; head: Inline[][]; align: Align[]; rows: Inline[][][] }

// ---------------------------------------------------------------- addresses

/** Names that end like a domain but are files: `chat.py` is not Paraguay. */
const FILE_ENDINGS = new Set([
  'py', 'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'html',
  'htm', 'txt', 'sh', 'zsh', 'yml', 'yaml', 'toml', 'plist', 'log', 'csv',
  'tsv', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'lock', 'env',
  'bak', 'mp4', 'mov', 'wav', 'zip',
]) // prettier-ignore

const BARE_DOMAIN_RE =
  /^((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,24})|localhost)(:\d{1,5})?([/?#].*)?$/i

/** Pure: a link's target as an address a browser may open, or null. An
 *  http(s) address is taken as it is; a bare domain ("example.org/page",
 *  as Fable often writes them) gets https://. Anything else is refused:
 *  another scheme, a login in the address, spaces, a file name. */
export function webAddress(raw: string): string | null {
  let s = raw.trim()
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1).trim()
  if (!s || s.length > 2000 || /\s/.test(s)) return null
  let text: string
  if (/^https?:\/\//i.test(s)) {
    text = s
  } else {
    const m = BARE_DOMAIN_RE.exec(s)
    if (!m) return null
    // "notes.md" and "chat.py" are files unless a path follows.
    if (!m[4] && m[2] && FILE_ENDINGS.has(m[2].toLowerCase())) return null
    text = (m[1].toLowerCase() === 'localhost' ? 'http://' : 'https://') + s
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password || !url.hostname) return null
  return url.href
}

/** Pure: a link's target as a path on the Mac ("~/Queue/chat.py"), or
 *  null. file:// links and absolute paths under a home or temp folder. */
export function localPath(raw: string): string | null {
  let s = raw.trim()
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1).trim()
  if (!s || s.length > 1000) return null
  if (/^file:\/\//i.test(s)) {
    s = s.replace(/^file:\/\/(localhost)?/i, '')
    try {
      s = decodeURIComponent(s)
    } catch {
      // not percent-encoded after all
    }
  }
  if (/[\n\r]/.test(s)) return null
  if (s.startsWith('~/')) return s
  if (!/^\/(Users|home|private|tmp|var|Volumes|Applications)\//.test(s)) {
    return null
  }
  return s.replace(/^\/(?:Users|home)\/[^/]+\//, '~/')
}

// ------------------------------------------------------------------ inline

const PUNCT_RE = /[!-/:-@[-`{-~]/

function runOf(s: string, i: number): number {
  let n = 1
  while (s[i + n] === s[i]) n++
  return n
}

function count(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}

/** Where a bare address starting at `i` ends: up to the next space or
 *  angle bracket, less the punctuation that closes the sentence, the
 *  emphasis or the brackets around it. A bracket that the address opened
 *  itself stays (…/Safety_(AI)). */
function urlEnd(s: string, i: number): number {
  let j = i
  while (j < s.length && !/[\s<>]/.test(s[j])) j++
  for (;;) {
    const c = s[j - 1]
    const body = s.slice(i, j)
    if (/[.,;:!?'"*_~`|”’»…]/.test(c)) j--
    else if (c === ')' && count(body, '(') < count(body, ')')) j--
    else if (c === ']' && count(body, '[') < count(body, ']')) j--
    else break
    if (j <= i) break
  }
  return j
}

/** The end of the code span opened by `run` backticks at `i`, or -1. */
function codeEnd(s: string, i: number, run: number): number {
  let j = i + run
  while (j < s.length) {
    if (s[j] === '`') {
      const n = runOf(s, j)
      if (n === run) return j
      j += n
    } else j++
  }
  return -1
}

/** `[label](target)` starting at the `[` at `i`: the label, the target as
 *  written (a "title" after it dropped) and where it ends; or null. The
 *  label may hold brackets that pair up; the target may hold parentheses
 *  that pair up, and no spaces. */
function readLink(
  s: string,
  i: number
): { label: string; dest: string; end: number } | null {
  let depth = 0
  let j = i
  for (; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') j++
    else if (c === '`') {
      const run = runOf(s, j)
      const end = codeEnd(s, j, run)
      j = end < 0 ? j + run - 1 : end + run - 1
    } else if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) break
    }
    if (j - i > 600) return null
  }
  if (j >= s.length || s[j + 1] !== '(') return null
  const label = s.slice(i + 1, j)
  if (!label.trim()) return null
  let k = j + 2
  let open = 0
  for (; k < s.length; k++) {
    const c = s[k]
    if (c === '\n') return null
    if (c === '\\') k++
    else if (c === '(') open++
    else if (c === ')') {
      if (open === 0) break
      open--
    }
  }
  if (k >= s.length) return null
  let dest = s.slice(j + 2, k).trim()
  // [label](address "a title")
  const titled = /^(\S+)\s+(?:"[^"]*"|'[^']*'|\([^)]*\))$/.exec(dest)
  if (titled) dest = titled[1]
  if (!dest || /\s/.test(dest)) return null
  return { label, dest, end: k + 1 }
}

/** Where the emphasis opened with `len` of `ch` closes, searching from
 *  `from`; -1 when it never does. Code, links and bare addresses are
 *  stepped over, so a mark inside one closes nothing. */
function closerOf(s: string, from: number, ch: string, len: number): number {
  let j = from
  while (j < s.length) {
    const c = s[j]
    if (c === '\\') {
      j += 2
    } else if (c === '`') {
      const run = runOf(s, j)
      const end = codeEnd(s, j, run)
      j = end < 0 ? j + run : end + run
    } else if (c === '[') {
      const link = readLink(s, j)
      j = link ? link.end : j + 1
    } else if (
      (c === 'h' || c === 'H') &&
      /^https?:\/\//i.test(s.slice(j, j + 8))
    ) {
      j = Math.max(urlEnd(s, j), j + 1)
    } else if (c === ch) {
      const run = runOf(s, j)
      const before = s[j - 1] ?? ' '
      const after = s[j + run] ?? ' '
      // An underscore inside a name closes nothing: snake_case, and
      // "__init__.py", where a letter follows the dot.
      const inName =
        ch === '_' &&
        (/[A-Za-z0-9]/.test(after) ||
          (/[.\-/]/.test(after) && /[A-Za-z0-9]/.test(s[j + run + 1] ?? ' ')))
      const closes = j > from && !/\s/.test(before) && !inName
      if (closes) {
        if (run === len) return j
        // "**bold *and italic***": the last marks close the outer one.
        if (run > len && (len > 1 || run === 3)) return j + run - len
      }
      j += run
    } else j++
  }
  return -1
}

/** Pure: the marks in a run of text: **bold**, *italic*, ~~strike~~,
 *  `code`, [label](address), <address> and bare addresses; a line break
 *  for each newline. `links: false` inside a link's own label. */
export function parseInline(src: string, links = true, depth = 0): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', text: buf })
    buf = ''
  }
  const s = src
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\n') {
      flush()
      out.push({ t: 'br' })
      i++
    } else if (c === '\\' && i + 1 < s.length && PUNCT_RE.test(s[i + 1])) {
      buf += s[i + 1]
      i += 2
    } else if (c === '`') {
      const run = runOf(s, i)
      const end = codeEnd(s, i, run)
      if (end < 0) {
        buf += s.slice(i, i + run)
        i += run
      } else {
        flush()
        const text = s.slice(i + run, end).replace(/\n/g, ' ')
        // "`` `a` ``": one space of padding each side comes off.
        out.push({
          t: 'code',
          text: /^ .* $/.test(text) && text.trim() ? text.slice(1, -1) : text,
        })
        i = end + run
      }
    } else if (c === '[' && links) {
      const link = readLink(s, i)
      const href = link && webAddress(link.dest)
      const path = link && !href ? localPath(link.dest) : null
      if (link && href) {
        flush()
        out.push({
          t: 'link',
          href,
          kids: parseInline(link.label, false, depth + 1),
        })
        i = link.end
      } else if (link && path) {
        flush()
        out.push({
          t: 'file',
          path,
          kids: parseInline(link.label, false, depth + 1),
        })
        i = link.end
      } else if (link) {
        // Not an address a browser should open: the words as typed.
        buf += s.slice(i, link.end)
        i = link.end
      } else {
        buf += c
        i++
      }
    } else if (c === '<' && links) {
      const m = /^<(https?:\/\/[^\s<>]+)>/i.exec(s.slice(i, i + 2100))
      const href = m && webAddress(m[1])
      if (m && href) {
        flush()
        out.push({
          t: 'link',
          href,
          auto: true,
          kids: [{ t: 'text', text: m[1].replace(/^https?:\/\//i, '') }],
        })
        i += m[0].length
      } else {
        buf += c
        i++
      }
    } else if (
      links &&
      (c === 'h' || c === 'H') &&
      /^https?:\/\//i.test(s.slice(i, i + 8)) &&
      !/[A-Za-z0-9]/.test(s[i - 1] ?? ' ')
    ) {
      const end = urlEnd(s, i)
      const written = s.slice(i, end)
      const href = end > i ? webAddress(written) : null
      if (href) {
        flush()
        out.push({
          t: 'link',
          href,
          auto: true,
          kids: [{ t: 'text', text: written.replace(/^https?:\/\//i, '') }],
        })
        i = end
      } else {
        buf += c
        i++
      }
    } else if (c === '*' || c === '_' || c === '~') {
      const run = runOf(s, i)
      const before = s[i - 1] ?? ' '
      const after = s[i + run] ?? ' '
      const len = c === '~' ? 2 : run
      const opens =
        depth < 8 &&
        run <= 3 &&
        (c !== '~' || run === 2) &&
        (c !== '_' || run <= 2) &&
        !/\s/.test(after) &&
        (c !== '_' || !/[A-Za-z0-9]/.test(before))
      const close = opens ? closerOf(s, i + run, c, len) : -1
      if (close > i + run) {
        flush()
        const kids = parseInline(s.slice(i + run, close), links, depth + 1)
        if (c === '~') out.push({ t: 'del', kids })
        else if (len === 1) out.push({ t: 'em', kids })
        else if (len === 2) out.push({ t: 'strong', kids })
        else out.push({ t: 'strong', kids: [{ t: 'em', kids }] })
        i = close + len
      } else {
        buf += s.slice(i, i + run)
        i += run
      }
    } else {
      buf += c
      i++
    }
  }
  flush()
  return out
}

/** Pure: the words of a run of marks, with none of the marks. */
export function plainText(kids: Inline[]): string {
  return kids
    .map(k =>
      k.t === 'text' || k.t === 'code'
        ? k.text
        : k.t === 'br'
          ? '\n'
          : plainText(k.kids)
    )
    .join('')
}

// ------------------------------------------------------------------ blocks

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/
const HEAD_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const RULE_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/
const QUOTE_RE = /^ {0,3}>[ \t]?/
const ITEM_RE = /^( *)([-*+•]|\d{1,3}[.)])[ \t]+(\S.*)$/
const TABLE_SEP_RE =
  /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

const lead = (line: string) => /^ */.exec(line)![0].length

/** A table row's cells: split at each | that is not escaped or in code. */
function cellsOf(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (c === '`') {
      const run = runOf(s, i)
      const end = codeEnd(s, i, run)
      const stop = end < 0 ? i + run : end + run
      cur += s.slice(i, stop)
      i = stop - 1
    } else if (c === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += c
  }
  cells.push(cur.trim())
  return cells
}

function isTableAt(lines: string[], i: number): boolean {
  const sep = lines[i + 1]
  return (
    lines[i].includes('|') &&
    sep !== undefined &&
    sep.includes('|') &&
    sep.includes('-') &&
    TABLE_SEP_RE.test(sep)
  )
}

/** Whether a new block starts at this line, ending the paragraph before. */
function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i]
  return (
    FENCE_RE.test(line) ||
    HEAD_RE.test(line) ||
    RULE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    ITEM_RE.test(line) ||
    isTableAt(lines, i)
  )
}

function blocksOf(lines: string[], depth: number, soft: '\n' | ' '): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const mark = fence[1]
      const body: string[] = []
      let j = i + 1
      for (; j < lines.length; j++) {
        const t = lines[j].trim()
        if (
          t.startsWith(mark[0].repeat(mark.length)) &&
          t.replace(new RegExp(`^\\${mark[0]}+`), '').trim() === ''
        )
          break
        body.push(lines[j])
      }
      out.push({ t: 'code', text: body.join('\n'), lang: fence[2].trim() })
      i = j + 1
      continue
    }
    const head = HEAD_RE.exec(line)
    if (head) {
      out.push({
        t: 'head',
        level: head[1].length,
        kids: parseInline(head[2]),
      })
      i++
      continue
    }
    if (RULE_RE.test(line)) {
      out.push({ t: 'rule' })
      i++
      continue
    }
    if (QUOTE_RE.test(line) && depth < 6) {
      const body: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        body.push(lines[i].replace(QUOTE_RE, ''))
        i++
      }
      out.push({ t: 'quote', blocks: blocksOf(body, depth + 1, soft) })
      continue
    }
    if (isTableAt(lines, i)) {
      const head = cellsOf(line)
      const align = cellsOf(lines[i + 1]).map((c): Align => {
        const l = c.startsWith(':')
        const r = c.endsWith(':')
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null
      })
      const rows: Inline[][][] = []
      let j = i + 2
      for (; j < lines.length; j++) {
        if (lines[j].trim() === '' || !lines[j].includes('|')) break
        const cells = cellsOf(lines[j])
        rows.push(head.map((_, k) => parseInline(cells[k] ?? '')))
      }
      out.push({
        t: 'table',
        head: head.map(c => parseInline(c)),
        align: head.map((_, k) => align[k] ?? null),
        rows,
      })
      i = j
      continue
    }
    const first = ITEM_RE.exec(line)
    if (first && depth < 6) {
      const indent = first[1].length
      const ordered = /\d/.test(first[2])
      const items: string[][] = []
      let j = i
      while (j < lines.length) {
        const cur = lines[j]
        if (cur.trim() === '') {
          // A gap stays inside the list when the list goes on after it.
          let k = j + 1
          while (k < lines.length && lines[k].trim() === '') k++
          const next = k < lines.length ? ITEM_RE.exec(lines[k]) : null
          const goesOn =
            k < lines.length &&
            (lead(lines[k]) >= indent + 2 ||
              (next !== null &&
                Math.abs(next[1].length - indent) <= 1 &&
                /\d/.test(next[2]) === ordered))
          if (!goesOn) break
          if (items.length) items[items.length - 1].push('')
          j++
          continue
        }
        const m = ITEM_RE.exec(cur)
        if (m && Math.abs(m[1].length - indent) <= 1) {
          if (/\d/.test(m[2]) !== ordered) break
          items.push([m[3]])
          j++
        } else if (items.length && lead(cur) >= indent + 2) {
          // Under the item: a wrapped line, or a list or paragraph of its own.
          items[items.length - 1].push(cur)
          j++
        } else break
      }
      out.push({
        t: 'list',
        ordered,
        start: ordered ? parseInt(first[2], 10) || 1 : 1,
        items: items.map(item => {
          const under = item.slice(1)
          const strip = Math.min(
            ...under.filter(l => l.trim() !== '').map(lead),
            Infinity
          )
          return blocksOf(
            [
              item[0],
              ...under.map(l =>
                l.slice(Math.min(lead(l), Number.isFinite(strip) ? strip : 0))
              ),
            ],
            depth + 1,
            ' '
          )
        }),
      })
      i = j
      continue
    }
    const para: string[] = [line.trim()]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !startsBlock(lines, i)
    ) {
      para.push(lines[i].trim())
      i++
    }
    out.push({ t: 'p', kids: parseInline(para.join(soft)) })
  }
  return out
}

/** Pure: a reply's text as blocks. A line break inside a paragraph is kept
 *  (Fable relies on them); a wrapped line under a bullet joins it. */
export function parseMarkdown(text: string): Block[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/\t/g, '    ').replace(/\s+$/, ''))
  return blocksOf(lines, 0, '\n')
}

// ------------------------------------------------- the panel back to text

/** As much of a DOM node as `markdownOf` reads, so it can be tested
 *  without a browser. */
export interface DomNode {
  nodeType: number
  nodeName: string
  textContent: string | null
  childNodes: ArrayLike<DomNode>
  getAttribute?: (name: string) => string | null
}

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'THEAD', 'TBODY',
  'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'ASIDE', 'SECTION',
]) // prettier-ignore

function domText(
  node: DomNode,
  list: { ordered: boolean; n: number } | null
): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType !== 1 && node.nodeType !== 11) return ''
  const tag = node.nodeName.toUpperCase()
  if (tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'KBD') return ''
  if (tag === 'BR') return '\n'
  if (tag === 'HR') return '\n\n---\n\n'
  const here =
    tag === 'OL'
      ? { ordered: true, n: Number(node.getAttribute?.('start')) || 1 }
      : tag === 'UL'
        ? { ordered: false, n: 1 }
        : list
  let inner = ''
  for (const child of Array.from(node.childNodes)) {
    inner += domText(child, here)
  }
  if (tag === 'A') {
    const href = node.getAttribute?.('href') ?? ''
    const words = inner.trim()
    if (!/^https?:\/\//i.test(href) || !words) return inner
    // An address shown bare goes back as the full address.
    const bare = (u: string) =>
      u.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    const auto = node.getAttribute?.('data-auto')
    if (auto !== null && auto !== undefined) return href
    return bare(words) === bare(href) ? href : `[${words}](${href})`
  }
  if (tag === 'STRONG' || tag === 'B')
    return inner.trim() ? `**${inner}**` : inner
  if (tag === 'EM' || tag === 'I') return inner.trim() ? `*${inner}*` : inner
  if (tag === 'DEL' || tag === 'S') return inner.trim() ? `~~${inner}~~` : inner
  if (tag === 'CODE') return inner ? `\`${inner}\`` : inner
  if (tag === 'LI') {
    const mark = here?.ordered ? `${here.n}. ` : '- '
    if (here) here.n++
    return `\n${mark}${inner.trim().replace(/\n/g, '\n  ')}\n`
  }
  if (tag === 'TD' || tag === 'TH') return `${inner.trim()} | `
  if (tag === 'TR') return `\n| ${inner.trim()}\n`
  if (BLOCK_TAGS.has(tag)) return `\n\n${inner}\n\n`
  return inner
}

/** Pure: a piece of the drawn panel as Markdown, for the Reply quote: a
 *  link goes back as [label](address) with its whole address, so Fable
 *  still sees where it pointed; bold, italics, code and bullets as typed.
 *  Buttons on the panel's cards are left out. */
export function markdownOf(node: DomNode): string {
  return domText(node, null)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
