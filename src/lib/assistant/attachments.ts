// Documents a visitor attaches to a chatbot message (a CV, a project
// proposal). The browser reads the file and pulls out its text
// (extract-document.ts); only that text travels, as part of the message. The
// file itself never leaves the visitor's computer.
//
// This module is the shared, dependency-free part: the limits, the checks the
// server runs on what it is sent, and the two ways a document is written out,
// once for the model (the whole text) and once for the conversation log (the
// file's name and length only, never its text).

/** A document attached to a user message, already turned into plain text. */
export interface Attachment {
  /** The file's name, for the chip in the chat and the note in the log. */
  name: string
  text: string
  /** The document was longer than MAX_ATTACHMENT_CHARS, so `text` is only its
   *  beginning. The visitor and the model are both told. */
  truncated?: boolean
}

/** Most text read from one document, about ten pages. Bounds what a single
 *  upload adds to every later request in the conversation. */
export const MAX_ATTACHMENT_CHARS = 30_000
/** Documents on one message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 3
/** Document text across a whole conversation. The widget re-sends the
 *  conversation on every turn, so this is the ceiling on what uploads can add
 *  to one request. */
export const MAX_CONVERSATION_ATTACHMENT_CHARS = 60_000
/** Largest file the browser will try to read. Only the text is sent, so this
 *  guards the visitor's tab, not the server. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024
/** Pages read from a PDF before stopping. */
export const MAX_PDF_PAGES = 50
const MAX_NAME_CHARS = 120

/** The file picker's filter. */
export const ACCEPTED_FILE_TYPES = '.pdf,.docx,.txt,.md'

export type DocumentKind = 'pdf' | 'docx' | 'text'

/** Which reader a file needs, from its name and, failing that, its type.
 *  null means the chatbot can't read it. */
export function documentKind(name: string, mimeType = ''): DocumentKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') return 'text'
  if (ext) return null
  if (mimeType === 'application/pdf') return 'pdf'
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx'
  if (mimeType.startsWith('text/')) return 'text'
  return null
}

/** Text as it came out of a file, tidied: no control characters, no trailing
 *  spaces, and no more than one blank line in a row. */
export function tidyDocumentText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // Control characters other than tab and newline.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** Cuts text to a character budget, at a line or word end where one is near,
 *  and says whether anything was cut. */
export function fitToBudget(
  text: string,
  budget: number
): { text: string; truncated: boolean } {
  if (text.length <= budget) return { text, truncated: false }
  const head = text.slice(0, budget)
  const lineEnd = head.lastIndexOf('\n')
  const wordEnd = head.lastIndexOf(' ')
  const cut =
    lineEnd > budget * 0.9 ? lineEnd : wordEnd > budget * 0.9 ? wordEnd : budget
  return { text: head.slice(0, cut).trimEnd(), truncated: true }
}

/** A file name safe to show and to quote to the model: one line, no angle
 *  brackets or quotes (it sits inside a tag in the prompt), and not too long. */
export function cleanAttachmentName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001F\u007F<>"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, MAX_NAME_CHARS) || 'document'
}

/** How much document text a list of messages carries. */
export function attachmentChars(
  messages: { attachments?: Attachment[] }[]
): number {
  let total = 0
  for (const m of messages) {
    for (const a of m.attachments ?? []) total += a.text.length
  }
  return total
}

/** Checks the attachments on one incoming message and returns them cleaned.
 *  Throws on anything the widget itself would never send (too many, too
 *  long), so the route answers 400 instead of quietly paying for it. Entries
 *  that aren't attachments at all are dropped. */
export function cleanAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return []
  const out: Attachment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const a = item as { name?: unknown; text?: unknown; truncated?: unknown }
    if (typeof a.text !== 'string' || a.text.length === 0) continue
    if (a.text.length > MAX_ATTACHMENT_CHARS) {
      throw new Error('attached document is too long')
    }
    out.push({
      name: cleanAttachmentName(typeof a.name === 'string' ? a.name : ''),
      text: a.text,
      ...(a.truncated === true ? { truncated: true } : {}),
    })
  }
  if (out.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error('too many attached documents on one message')
  }
  return out
}

/** One attached document as the model reads it. The closing tag is taken out
 *  of the text so a document can't end its own block early. */
export function attachmentPromptBlock(a: Attachment): string {
  const text = a.text.replace(/<\/attached_document>/gi, '')
  const cutNote = a.truncated
    ? '\n[The document is longer than the chatbot can read. Only its beginning is above.]'
    : ''
  return `<attached_document name="${cleanAttachmentName(a.name)}">\n${text}${cutNote}\n</attached_document>`
}

/** What stands in for a message's documents in the conversation log: each
 *  file's name and length, never its text. A CV carries a name, an address
 *  and a phone number; the log is read by the team and partners, and nobody
 *  needs those to judge a reply. */
export function attachmentLogNote(attachments: Attachment[]): string {
  if (attachments.length === 0) return ''
  const parts = attachments.map(
    a =>
      `${cleanAttachmentName(a.name)} (${a.text.length.toLocaleString('en-US')} characters${a.truncated ? ', beginning only' : ''})`
  )
  return `[Attached: ${parts.join('; ')}. Document text is not stored.]`
}

/** A message's text as the log stores it: what the visitor typed, then the
 *  note about any documents. */
export function logContent(m: {
  content: string
  attachments?: Attachment[]
}): string {
  const note = attachmentLogNote(m.attachments ?? [])
  if (!note) return m.content
  return m.content ? `${m.content}\n\n${note}` : note
}
