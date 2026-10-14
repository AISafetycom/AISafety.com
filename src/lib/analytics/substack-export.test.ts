import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { csvRecords, parseCsv } from '@/lib/csv'
import { zipEntries } from '@/lib/zip-read'
import { parseSubstackHistory, readSubstackExport } from './substack-export'

/** A zip of these files, built the way any zip tool would: each file
 *  deflated (or stored), a local header before each, the central directory
 *  and its end record after. */
function zip(files: Record<string, string>, store = false): Uint8Array {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const raw = Buffer.from(text)
    const data = store ? raw : deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(store ? 0 : 8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    parts.push(local, nameBytes, data)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(store ? 0 : 8, 10)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(raw.length, 24)
    dir.writeUInt16LE(nameBytes.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const dirBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(dirBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...parts, dirBytes, end]))
}

const EXPORT = {
  'email_list.aisafetyeventsandtraining.csv':
    'email,active_subscription,expiry,plan,email_disabled,created_at,first_payment_at\n' +
    'a@example.com,false,,other,false,2024-04-02T10:00:00.000Z,\n' +
    'b@example.com,false,,other,false,2026-10-08T08:00:00.000Z,\n' +
    'c@example.com,false,,other,false,2026-09-30T08:00:00.000Z,\n',
  'posts.csv':
    'post_id,post_date,is_published,email_sent_at,inbox_sent_at,type,audience,title,subtitle,podcast_url\n' +
    '1001.week-39,2026-09-24T14:46:00.000Z,true,2026-09-24T14:46:01.000Z,,newsletter,everyone,"Week 39, with a comma","A ""quoted"" subtitle",\n' +
    '1002.week-40,2026-10-01T15:19:35.000Z,true,2026-10-01T15:19:36.000Z,,newsletter,everyone,Week 40,,\n' +
    '1003.draft,2026-10-02T00:00:00.000Z,false,,,newsletter,everyone,"A draft\nover two lines",,\n',
  'posts/1001.delivers.csv':
    'post_id,timestamp,email,post_type,post_audience,active_subscription\n' +
    '1001,2026-09-24T14:46:02Z,a@example.com,newsletter,everyone,false\n',
  'posts/1002.delivers.csv':
    'post_id,timestamp,email,post_type,post_audience,active_subscription\r\n' +
    '1002,2026-10-01T15:19:37Z,a@example.com,newsletter,everyone,false\r\n' +
    '1002,2026-10-01T15:19:37Z,c@example.com,newsletter,everyone,false\r\n' +
    '1002,2026-10-01T15:20:00Z,C@example.com,newsletter,everyone,false\r\n',
  'posts/1002.opens.csv': 'post_id,timestamp,email\n',
  'posts/1003.delivers.csv': 'post_id,timestamp,email\n',
}

describe('parseCsv', () => {
  it('reads quoted commas, quotes and line breaks', () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\r\nx,,z\n')).toEqual([
      ['a', 'b, c', 'say "hi"', 'two\nlines'],
      ['x', '', 'z'],
    ])
  })

  it('keys rows by the header, past a byte-order mark', () => {
    expect(csvRecords('﻿name,count\nA,1\nB')).toEqual([
      { name: 'A', count: '1' },
      { name: 'B', count: '' },
    ])
  })
})

describe('zipEntries', () => {
  it('reads deflated and stored files', async () => {
    for (const store of [false, true]) {
      const entries = zipEntries(
        zip({ 'a.txt': 'hello', 'b/c.txt': 'world' }, store)
      )
      expect(entries.map(e => e.name)).toEqual(['a.txt', 'b/c.txt'])
      expect(new TextDecoder().decode(await entries[1].read())).toBe('world')
    }
  })

  it('refuses something that isn’t a zip', () => {
    expect(() =>
      zipEntries(new TextEncoder().encode('not a zip at all, sorry'))
    ).toThrow('Not a zip file')
  })
})

describe('readSubstackExport', () => {
  it('counts the people each emailed issue reached', async () => {
    const h = await readSubstackExport(zipEntries(zip(EXPORT)))
    expect(h.publication).toBe('aisafetyeventsandtraining')
    expect(h.onList).toBe(3)
    // The draft was never emailed; one address delivered twice counts once.
    expect(h.issues).toEqual([
      { t: Date.parse('2026-09-24T14:46:01.000Z'), n: 1 },
      { t: Date.parse('2026-10-01T15:19:36.000Z'), n: 2 },
    ])
    // The newest signup is later than the last issue.
    expect(h.asOf).toBe(Date.parse('2026-10-08T08:00:00.000Z'))
  })

  it('says what’s wrong with something else', async () => {
    await expect(
      readSubstackExport(zipEntries(zip({ 'notes.txt': 'hi' })))
    ).rejects.toThrow('isn’t a Substack export')
    const other = {
      ...EXPORT,
      'email_list.someoneelse.csv':
        EXPORT['email_list.aisafetyeventsandtraining.csv'],
    }
    delete (other as Record<string, string>)[
      'email_list.aisafetyeventsandtraining.csv'
    ]
    await expect(readSubstackExport(zipEntries(zip(other)))).rejects.toThrow(
      'for someoneelse'
    )
  })
})

describe('parseSubstackHistory', () => {
  const good = {
    publication: 'aisafetyfunding',
    asOf: Date.parse('2026-10-08T08:00:00Z'),
    onList: 900,
    issues: [
      { t: Date.parse('2026-10-01T15:00:00Z'), n: 850 },
      { t: Date.parse('2026-09-24T15:00:00Z'), n: 840 },
    ],
  }

  it('accepts a history, its issues oldest first', () => {
    expect(parseSubstackHistory(good)?.issues.map(i => i.n)).toEqual([840, 850])
  })

  it('refuses anything else', () => {
    expect(parseSubstackHistory(null)).toBeNull()
    expect(parseSubstackHistory({ ...good, publication: 'other' })).toBeNull()
    expect(parseSubstackHistory({ ...good, issues: [] })).toBeNull()
    expect(
      parseSubstackHistory({ ...good, issues: [{ t: good.asOf, n: -1 }] })
    ).toBeNull()
    expect(
      parseSubstackHistory({ ...good, issues: [{ t: 'soon', n: 1 }] })
    ).toBeNull()
    expect(parseSubstackHistory({ ...good, onList: 1.5 })).toBeNull()
  })
})
