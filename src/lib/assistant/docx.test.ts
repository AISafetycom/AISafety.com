import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { documentXmlText, docxText } from './docx'

/** A minimal zip archive holding the given files, packed with deflate or
 *  stored as is. Checksums are left at zero: the reader doesn't check them. */
function zip(
  files: Record<string, string>,
  method: 'deflate' | 'stored' = 'deflate'
): Uint8Array {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const raw = Buffer.from(content)
    const data = method === 'deflate' ? deflateRawSync(raw) : raw
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(method === 'deflate' ? 8 : 0, 8)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(raw.length, 22)
    header.writeUInt16LE(nameBytes.length, 26)
    local.push(header, nameBytes, data)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(method === 'deflate' ? 8 : 0, 10)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(nameBytes.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const centralBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...local, centralBytes, end]))
}

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Jane Doe</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Research </w:t></w:r><w:r><w:t>engineer &amp; writer</w:t></w:r></w:p>
<w:p><w:r><w:t>2021</w:t><w:tab/><w:t>Caf&#233; &#x2014; barista</w:t><w:br/><w:t>second line</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Skill</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Level</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Python</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Advanced</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Last paragraph</w:t></w:r></w:p>
</w:body></w:document>`

const EXPECTED = [
  'Jane Doe',
  'Research engineer & writer',
  '2021\tCafé — barista',
  'second line',
  'Skill\tLevel',
  'Python\tAdvanced',
  'Last paragraph',
  '',
].join('\n')

describe('documentXmlText', () => {
  it('keeps the words, one paragraph per line, with tabs between table cells', () => {
    expect(documentXmlText(DOCUMENT_XML)).toBe(EXPECTED)
  })

  it('skips tab-stop settings, which use the same tag as a typed tab', () => {
    expect(
      documentXmlText(
        '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Hi</w:t><w:tab/><w:t>there</w:t></w:r></w:p>'
      )
    ).toBe('Hi\tthere\n')
  })
})

describe('docxText', () => {
  const files = {
    '[Content_Types].xml': '<Types/>',
    'word/styles.xml': '<w:styles/>',
    'word/document.xml': DOCUMENT_XML,
  }

  it('reads a packed Word document', async () => {
    expect(await docxText(zip(files))).toBe(EXPECTED)
  })

  it('reads one whose files are stored unpacked', async () => {
    expect(await docxText(zip(files, 'stored'))).toBe(EXPECTED)
  })

  it('turns down a zip archive that is not a Word document', async () => {
    await expect(
      docxText(zip({ 'ppt/slides/slide1.xml': '<p/>' }))
    ).rejects.toThrow('not a Word document')
  })

  it('turns down bytes that are not a zip archive at all', async () => {
    await expect(
      docxText(
        new TextEncoder().encode('%PDF-1.7 just pretending to be a docx')
      )
    ).rejects.toThrow('not a zip archive')
  })

  it('turns down an archive cut off partway', async () => {
    const whole = zip(files)
    // Keep the index at the end but lose the start of the file it points to.
    const broken = whole.slice(200)
    await expect(docxText(broken)).rejects.toThrow()
  })
})
