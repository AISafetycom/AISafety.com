// Reads the text out of a Word document (.docx) with nothing but what the
// browser already has. A .docx is a zip archive; the words are in one XML
// file inside it, word/document.xml. So: find that file in the archive,
// unpack it with the built-in DecompressionStream, and keep the text between
// the tags. No library, and it runs the same in Node, where its test lives.
//
// Headers, footers, footnotes and text boxes are left out. Tables come out
// as one row per line with tabs between cells.

/** Most of word/document.xml this will unpack. A real document's XML is a
 *  few hundred kilobytes; the cap stops a file built to unpack to gigabytes
 *  from freezing the visitor's tab. */
const MAX_XML_BYTES = 30 * 1024 * 1024

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** The bytes of one named file inside a zip archive, still packed, plus how
 *  it was packed (0 = stored as is, 8 = deflate). null when the archive has
 *  no such file. Throws when the bytes are not a zip archive at all. */
function findZipEntry(
  bytes: Uint8Array,
  wanted: string
): { data: Uint8Array; method: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The archive's index sits at the very end, after an optional comment of
  // up to 65,535 bytes, so look backwards for its marker.
  let eocd = -1
  const lowest = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new Error('not a zip archive')
  const entries = view.getUint16(eocd + 10, true)
  let pos = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > bytes.length) break
    if (view.getUint32(pos, true) !== CENTRAL_SIGNATURE) break
    const method = view.getUint16(pos + 10, true)
    const packedSize = view.getUint32(pos + 20, true)
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    const localOffset = view.getUint32(pos + 42, true)
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength))
    if (name === wanted) {
      if (
        localOffset + 30 > bytes.length ||
        view.getUint32(localOffset, true) !== LOCAL_SIGNATURE
      ) {
        throw new Error('damaged zip archive')
      }
      const start =
        localOffset +
        30 +
        view.getUint16(localOffset + 26, true) +
        view.getUint16(localOffset + 28, true)
      if (start + packedSize > bytes.length) {
        throw new Error('damaged zip archive')
      }
      return { data: bytes.subarray(start, start + packedSize), method }
    }
    pos += 46 + nameLength + extraLength + commentLength
  }
  return null
}

/** Unpacks deflate data, stopping with an error once it passes `limit`
 *  bytes. */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('this browser cannot unpack Word documents')
  }
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new Error('Word document is too large to read')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : ''
      }
      return ENTITIES[body.toLowerCase()] ?? whole
    }
  )
}

/** The text of a word/document.xml: each paragraph on its own line, a table
 *  row on one line with a tab between its cells, and tabs and line breaks
 *  where the writer put them. */
export function documentXmlText(xml: string): string {
  let out = ''
  // The tags that carry text or spacing, in document order. Everything else
  // (formatting, pictures, tracked-change marks) is skipped.
  const tag =
    /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>|<\/w:tc>|<\/w:tr>/g
  // A paragraph's tab stops (<w:tabs>) are settings written with the same
  // <w:tab/> tag as a typed tab, so they go first.
  const body = xml.replace(/<w:tabs>[\s\S]*?<\/w:tabs>/g, '')
  let match: RegExpExecArray | null
  while ((match = tag.exec(body)) !== null) {
    const found = match[0]
    if (match[1] !== undefined) out += decodeEntities(match[1])
    else if (found.startsWith('<w:tab')) out += '\t'
    else if (found === '</w:tc>') {
      // A cell ends with its last paragraph's line break; the cell divider
      // takes its place.
      out = out.replace(/\n$/, '') + '\t'
    } else if (found === '</w:tr>') {
      // And a row ends with a divider after its last cell; the line break
      // takes that one's place.
      out = out.replace(/\t$/, '') + '\n'
    } else out += '\n'
  }
  return out
}

/** The text of a .docx file. Throws when the bytes aren't a Word document. */
export async function docxText(bytes: Uint8Array): Promise<string> {
  const entry = findZipEntry(bytes, 'word/document.xml')
  if (!entry) throw new Error('not a Word document')
  let xmlBytes: Uint8Array
  if (entry.method === 0) xmlBytes = entry.data
  else if (entry.method === 8) {
    xmlBytes = await inflate(entry.data, MAX_XML_BYTES)
  } else throw new Error('Word document uses an unknown packing method')
  return documentXmlText(new TextDecoder().decode(xmlBytes))
}
