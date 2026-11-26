// Turns a file the visitor picked into plain text, in their own browser.
// Nothing here sends anything anywhere: the chatbot later sends the text with
// the visitor's message, and the file itself stays on their computer.
//
// Browser-only. The PDF reader (PDF.js, about a megabyte) is fetched the
// first time someone attaches a PDF, never on page load.

import {
  MAX_ATTACHMENT_CHARS,
  MAX_FILE_BYTES,
  MAX_PDF_PAGES,
  cleanAttachmentName,
  documentKind,
  fitToBudget,
  tidyDocumentText,
  type Attachment,
  type DocumentKind,
} from './attachments'
import { docxText } from './docx'

/** Why a file couldn't be attached. */
export type DocumentErrorCode =
  /** Not a PDF, Word (.docx) or text file. */
  | 'unsupported'
  /** Over MAX_FILE_BYTES. */
  | 'too-big'
  /** Read fine, but there was no text in it (a scanned PDF, a blank file). */
  | 'empty'
  /** A PDF that needs a password. */
  | 'protected'
  /** Damaged, or something else went wrong while reading. */
  | 'unreadable'

export class DocumentError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    detail?: string
  ) {
    super(detail ?? code)
    this.name = 'DocumentError'
  }
}

/** What the visitor is told when a file can't be attached. */
export function documentErrorMessage(code: DocumentErrorCode): string {
  switch (code) {
    case 'unsupported':
      return 'That file type can’t be read. Try a PDF, a Word document (.docx), or a text file.'
    case 'too-big':
      return 'That file is too big. The limit is 20 MB.'
    case 'empty':
      return 'No text was found in that file. A scanned document is a picture of text, which the chatbot can’t read.'
    case 'protected':
      return 'That PDF is password-protected, so it can’t be read.'
    case 'unreadable':
      return 'That file couldn’t be read. It may be damaged.'
  }
}

/** The text of a PDF, page by page, stopping once there is more than the
 *  chatbot will take or after MAX_PDF_PAGES. `cutShort` says pages were left
 *  unread. */
async function pdfText(
  bytes: Uint8Array
): Promise<{ text: string; cutShort: boolean }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // A worker of its own for this one file, shut down when the file is read,
  // so nothing lingers in the visitor's tab.
  const port = new Worker(new URL('./pdf-worker.ts', import.meta.url), {
    type: 'module',
  })
  const worker = pdfjs.PDFWorker.create({ port })
  const task = pdfjs.getDocument({ data: bytes, worker })
  try {
    const doc = await task.promise
    const pages = Math.min(doc.numPages, MAX_PDF_PAGES)
    let text = ''
    let read = 0
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        if (item.hasEOL) text += '\n'
      }
      text += '\n\n'
      read = n
      if (text.length > MAX_ATTACHMENT_CHARS) break
    }
    return { text, cutShort: read < doc.numPages }
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') {
      throw new DocumentError('protected')
    }
    throw err
  } finally {
    // Tidying up must never turn a successful read into a failure.
    await task.destroy().catch(() => {})
    worker.destroy()
    port.terminate()
  }
}

async function readByKind(
  file: File,
  kind: DocumentKind
): Promise<{ text: string; cutShort: boolean }> {
  if (kind === 'text') return { text: await file.text(), cutShort: false }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (kind === 'docx') return { text: await docxText(bytes), cutShort: false }
  return pdfText(bytes)
}

/** Reads one picked file into an attachment. Throws a DocumentError the
 *  composer can show; never returns an empty document. */
export async function extractDocument(file: File): Promise<Attachment> {
  const kind = documentKind(file.name, file.type)
  if (!kind) throw new DocumentError('unsupported')
  if (file.size > MAX_FILE_BYTES) throw new DocumentError('too-big')

  let raw: { text: string; cutShort: boolean }
  try {
    raw = await readByKind(file, kind)
  } catch (err) {
    if (err instanceof DocumentError) throw err
    // The reader's own error goes to the console for debugging; the visitor
    // gets the plain message.
    console.warn('[assistant] could not read attached file', err)
    throw new DocumentError(
      'unreadable',
      err instanceof Error ? err.message : String(err)
    )
  }

  const tidy = tidyDocumentText(raw.text)
  if (!tidy) throw new DocumentError('empty')
  const fitted = fitToBudget(tidy, MAX_ATTACHMENT_CHARS)
  return {
    name: cleanAttachmentName(file.name),
    text: fitted.text,
    ...(fitted.truncated || raw.cutShort ? { truncated: true } : {}),
  }
}
