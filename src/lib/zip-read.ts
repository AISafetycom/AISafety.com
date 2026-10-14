/** Reads the files in a zip archive without a library, in the browser (the
 *  Newsletters tab reads a Substack export there, so the addresses in it
 *  never leave the computer) or on the server. The archive's central
 *  directory says where each file is; stored and deflated files are read,
 *  which is all a Substack export uses. Encrypted files and zip64 archives
 *  (over 4 GB) are refused. */

export interface ZipEntry {
  name: string
  read(): Promise<Uint8Array>
}

/** Raw deflate data as bytes, with the platform's own decompressor. */
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** The archive's files (folders left out), in its own order. Throws when
 *  the bytes aren't a zip it can read. */
export function zipEntries(
  bytes: Uint8Array,
  inflate: (data: Uint8Array) => Promise<Uint8Array> = inflateRaw
): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)
  // The end record sits in the last 22 bytes, or before a comment of up to
  // 64 KB.
  let end = -1
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 22 - 0xffff);
    at--
  )
    if (u32(at) === EOCD) {
      end = at
      break
    }
  if (end < 0) throw new Error('Not a zip file')
  const count = u16(end + 10)
  const dirOffset = u32(end + 16)
  if (count === 0xffff || dirOffset === 0xffffffff)
    throw new Error('Zip64 archives are not supported')
  const names = new TextDecoder()
  const out: ZipEntry[] = []
  let at = dirOffset
  for (let i = 0; i < count; i++) {
    if (u32(at) !== CENTRAL) throw new Error('Damaged zip directory')
    const flags = u16(at + 8)
    const method = u16(at + 10)
    const size = u32(at + 20)
    const nameLength = u16(at + 28)
    const extraLength = u16(at + 30)
    const commentLength = u16(at + 32)
    const local = u32(at + 42)
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (flags & 1) throw new Error(`${name} is encrypted`)
    if (method !== 0 && method !== 8)
      throw new Error(`${name} uses an unsupported compression method`)
    out.push({
      name,
      read: async () => {
        if (u32(local) !== LOCAL) throw new Error(`Damaged zip entry ${name}`)
        const start = local + 30 + u16(local + 26) + u16(local + 28)
        const data = bytes.subarray(start, start + size)
        return method === 0 ? data : inflate(data)
      },
    })
  }
  return out
}
