import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  isShown,
  shownOf,
  shownOfRecord,
  shownRecordValue,
  shownValue,
} from './queue-shown'

// The vectors below are shared with the Mac (~/Queue), which computes the
// same fingerprint from the same row in Python: change one here and the two
// sides no longer agree on what a decision was made on.

/** A Change row's Proposal, as the text sits in Airtable: a float that is a
 *  whole number (52.0), keys out of order, spaces, text outside ASCII. 738
 *  bytes as UTF-8. */
const CHANGE = String.raw`{"kind": "change", "table": "tblXbN9swwldwq8f7", "record": "recAAAAAAAAAAAAAA", "page": "/events", "changes": [{"table": "tblXbN9swwldwq8f7", "record": "recAAAAAAAAAAAAAA", "field": "Description", "from": "Short talks.\nThen questions.", "to": "Zoë said \"6 pm\" – 你好"}, {"field": "Latitude", "from": null, "to": 52.0}, {"field": "Longitude", "from": -0.5, "to": 37.7749}, {"field": "Type", "from": ["Meetup"], "to": ["Meetup", "Talk"]}, {"field": "Online?", "from": false, "to": true}, {"to": [{"url": "https://example.org/a.png"}], "field": "Logo", "from": null, "copy_from": {"table": "tblXbN9swwldwq8f7", "record": "recBBBBBBBBBBBBBB", "filename": "a.png", "field": "Logo"}}], "chat": {"by": "Rob", "email": "rob@example.org"}}`

/** A Rule row's Proposal, with wording for the public policy. 447 bytes. */
const RULE = String.raw`{"kind": "rule", "file": "~/Queue/chat-lessons.md", "title": "Queue chat lessons: dates", "summary": "free text", "edits": [{"file": "~/Queue/chat-lessons.md", "find": "## Dates\n", "replace": "## Dates\n- Write 4 February 2026, never \"Feb 4\".\n"}], "public": {"wording": "free text", "edits": [{"file": "~/Comb/listing-policy.md", "find": "old line", "replace": "new line – café"}]}, "bryce_applies": {"why": "x", "chat": "rob@example.org"}}`

const TABLE = 'tblXbN9swwldwq8f7'
const RECORD = 'recAAAAAAAAAAAAAA'
const changeRow = (proposal: unknown = JSON.parse(CHANGE)) => ({
  type: 'Change',
  proposal,
  targetTable: TABLE,
  targetRecord: RECORD,
})
const ruleRow = (proposal: unknown = JSON.parse(RULE)) => ({
  type: 'Rule',
  proposal,
})

describe('the shared vectors', () => {
  it('reads the Proposal texts as the Mac does', () => {
    expect(Buffer.byteLength(CHANGE)).toBe(738)
    expect(Buffer.byteLength(RULE)).toBe(447)
  })

  it('fingerprints a change', () => {
    expect(canonicalJson(shownValue(changeRow()))).toBe(
      String.raw`{"changes":[{"field":"Description","from":"Short talks.\nThen questions.","record":"recAAAAAAAAAAAAAA","table":"tblXbN9swwldwq8f7","to":"Zoë said \"6 pm\" – 你好"},{"field":"Latitude","from":null,"to":52},{"field":"Longitude","from":-0.5,"to":37.7749},{"field":"Type","from":["Meetup"],"to":["Meetup","Talk"]},{"field":"Online?","from":false,"to":true},{"copy_from":{"field":"Logo","filename":"a.png","record":"recBBBBBBBBBBBBBB","table":"tblXbN9swwldwq8f7"},"field":"Logo","from":null,"to":null}],"record":"recAAAAAAAAAAAAAA","table":"tblXbN9swwldwq8f7"}`
    )
    expect(shownOf(changeRow())).toBe(
      '27e31888f7d16513c4ee992fc009c02710e0d458139f184ebe5e05c446d8fe77'
    )
  })

  it('fingerprints a rule, its public wording included', () => {
    expect(canonicalJson(shownValue(ruleRow()))).toBe(
      String.raw`{"edits":[{"file":"~/Queue/chat-lessons.md","find":"## Dates\n","replace":"## Dates\n- Write 4 February 2026, never \"Feb 4\".\n"}],"public":[{"file":"~/Comb/listing-policy.md","find":"old line","replace":"new line – café"}]}`
    )
    expect(shownOf(ruleRow())).toBe(
      'e3f490b83393d6920b22a2d9e4f69fd00c329f31e4234936626d48212ccabb09'
    )
  })

  // The fifth vector (28 Nov 2026): only a picture copied from a record
  // has its `to` left out. A `copy_from` on any other field, or one that
  // names no record, hides nothing.
  it('leaves out the link of a picture copied from a record, and of nothing else', () => {
    const row = changeRow({
      changes: [
        {
          field: 'Description',
          from: 'a',
          to: 'b',
          copy_from: {
            table: TABLE,
            record: 'recBBBBBBBBBBBBBB',
            field: 'Description',
          },
        },
        {
          field: 'Logo',
          from: null,
          to: [{ url: 'https://example.org/a.png' }],
          copy_from: { filename: 'a.png' },
        },
        {
          field: 'Logo (map)',
          from: null,
          to: [{ url: 'https://example.org/b.png' }],
          copy_from: {
            table: TABLE,
            record: 'recBBBBBBBBBBBBBB',
            field: 'Logo',
          },
        },
      ],
    })
    expect(canonicalJson(shownValue(row))).toBe(
      String.raw`{"changes":[{"copy_from":{"field":"Description","record":"recBBBBBBBBBBBBBB","table":"tblXbN9swwldwq8f7"},"field":"Description","from":"a","to":"b"},{"copy_from":{"filename":"a.png"},"field":"Logo","from":null,"to":[{"url":"https://example.org/a.png"}]},{"copy_from":{"field":"Logo","record":"recBBBBBBBBBBBBBB","table":"tblXbN9swwldwq8f7"},"field":"Logo (map)","from":null,"to":null}],"record":"recAAAAAAAAAAAAAA","table":"tblXbN9swwldwq8f7"}`
    )
    expect(shownOf(row)).toBe(
      '25571a63d3be3326a7245f1fe68630838c70d22a689acfc2af2b0eb2e3aae385'
    )
  })

  it('fingerprints a row with nothing in it', () => {
    const change = { type: 'Change', proposal: {}, targetRecord: '' }
    expect(canonicalJson(shownValue(change))).toBe(
      '{"changes":[],"record":null,"table":null}'
    )
    expect(shownOf(change)).toBe(
      'f361aafd4d0424bda4bd3311ce5fc65f5c747ceab0bbd8351f34c7d1d65bb1c0'
    )
    const rule = { type: 'Rule', proposal: null }
    expect(canonicalJson(shownValue(rule))).toBe('{"edits":[],"public":[]}')
    expect(shownOf(rule)).toBe(
      '801cc7c4ecdd7ba2f7c2f30297931f848696299bc9d8c08c4bf89cd9af2298b1'
    )
  })
})

describe('what the fingerprint follows', () => {
  const change = () =>
    JSON.parse(CHANGE) as { changes: Record<string, unknown>[] }
  const rule = () =>
    JSON.parse(RULE) as {
      edits: Record<string, string>[]
      public: { edits: Record<string, string>[]; wording: string }
      summary: string
    }

  it('moves with any proposed change: a value, a field, one more, one fewer', () => {
    const was = shownOf(changeRow())
    for (const alter of [
      (p: ReturnType<typeof change>) => (p.changes[0].to = 'Something else'),
      (p: ReturnType<typeof change>) => (p.changes[0].field = 'Name'),
      (p: ReturnType<typeof change>) => (p.changes[0].from = null),
      (p: ReturnType<typeof change>) => (p.changes[1].to = 52.5),
      (p: ReturnType<typeof change>) =>
        p.changes.push({ field: 'Hide?', from: false, to: true }),
      (p: ReturnType<typeof change>) => p.changes.pop(),
      (p: ReturnType<typeof change>) => p.changes.reverse(),
    ]) {
      const p = change()
      alter(p)
      expect(shownOf(changeRow(p))).not.toBe(was)
    }
  })

  it('moves when the change is pointed at another listing', () => {
    const was = shownOf(changeRow())
    expect(
      shownOf({ ...changeRow(), targetRecord: 'recCCCCCCCCCCCCCC' })
    ).not.toBe(was)
    expect(
      shownOf({ ...changeRow(), targetTable: 'tbli1YSCpIuNY2DvL' })
    ).not.toBe(was)
  })

  it('stays put when a copied picture’s link is renewed', () => {
    const p = change()
    p.changes[5].to = [{ url: 'https://example.org/renewed-link.png' }]
    expect(shownOf(changeRow(p))).toBe(shownOf(changeRow()))
    // But not when it becomes another picture.
    const other = change()
    other.changes[5].copy_from = {
      ...(other.changes[5].copy_from as object),
      filename: 'b.png',
    }
    expect(shownOf(changeRow(other))).not.toBe(shownOf(changeRow()))
    // And a picture that was not copied is taken as it reads.
    const plain = change()
    delete plain.changes[5].copy_from
    const moved = change()
    delete moved.changes[5].copy_from
    moved.changes[5].to = [{ url: 'https://example.org/renewed-link.png' }]
    expect(shownOf(changeRow(moved))).not.toBe(shownOf(changeRow(plain)))
  })

  it('takes a `copy_from` on anything but a copied picture as it reads, value and all', () => {
    // On a field that holds no picture: a `copy_from` there must not let
    // the value be rewritten unseen.
    const text = (to: string) => {
      const p = change()
      p.changes[0] = {
        ...p.changes[0],
        to,
        copy_from: { table: TABLE, record: 'recBBBBBBBBBBBBBB' },
      }
      return shownOf(changeRow(p))
    }
    expect(text('What he read')).not.toBe(text('What was put there after'))
    // On a picture field, when it names no record (or not by a record id,
    // or is not an object at all).
    for (const from of [
      { filename: 'a.png' },
      { table: TABLE, record: 'not a record id' },
      { table: TABLE, record: 42 },
      'recBBBBBBBBBBBBBB',
      null,
      true,
    ]) {
      const picture = (url: string) => {
        const p = change()
        p.changes[5] = { ...p.changes[5], to: [{ url }], copy_from: from }
        return shownOf(changeRow(p))
      }
      expect(picture('https://example.org/a.png')).not.toBe(
        picture('https://example.org/other.png')
      )
    }
    // A picture field is one with "logo" or "image" in its name, in any
    // case, as the Mac reads it.
    for (const [field, left] of [
      ['Logo', true],
      ['LOGO (map)', true],
      ['Header image', true],
      ['Photo', false],
      ['Description', false],
    ] as const) {
      const one = (url: string) => {
        const p = change()
        p.changes[5] = { ...p.changes[5], field, to: [{ url }] }
        return shownOf(changeRow(p))
      }
      expect(
        one('https://example.org/a.png') ===
          one('https://example.org/renewed.png')
      ).toBe(left)
    }
  })

  it('stays put for everything about the row that is not the change', () => {
    const p = {
      ...change(),
      chat: { by: 'Someone else' },
      name: 'X',
      checked: {},
    }
    expect(shownOf(changeRow(p))).toBe(shownOf(changeRow()))
  })

  it('moves with a rule’s edits and its public edits, not with the words about them', () => {
    const was = shownOf(ruleRow())
    for (const alter of [
      (p: ReturnType<typeof rule>) =>
        (p.edits[0].replace += 'and one more line\n'),
      (p: ReturnType<typeof rule>) => (p.edits[0].find = '## Other\n'),
      (p: ReturnType<typeof rule>) => (p.edits[0].file = '~/Comb/main.py'),
      (p: ReturnType<typeof rule>) =>
        (p.public.edits[0].replace = 'another line'),
      (p: ReturnType<typeof rule>) =>
        p.edits.push({ file: 'f', find: 'a', replace: 'b' }),
    ]) {
      const p = rule()
      alter(p)
      expect(shownOf(ruleRow(p))).not.toBe(was)
    }
    const words = rule()
    words.summary = 'a wholly different story'
    words.public.wording = 'other words'
    expect(shownOf(ruleRow(words))).toBe(was)
  })

  it('has none for an addition', () => {
    expect(shownValue({ type: 'Add', proposal: { kind: 'add' } })).toBeNull()
    expect(shownOf({ type: 'Add', proposal: { kind: 'add' } })).toBeNull()
  })

  it('reads anything that is not a list as no list', () => {
    expect(shownOf(changeRow({ changes: 'none' }))).toBe(shownOf(changeRow({})))
    expect(shownOf(ruleRow({ edits: {}, public: 'x' }))).toBe(
      '801cc7c4ecdd7ba2f7c2f30297931f848696299bc9d8c08c4bf89cd9af2298b1'
    )
  })
})

describe('an addition: the record the page showed', () => {
  const REC = 'recAAAAAAAAAAAAAA'
  const types = new Map([
    ['Name', 'singleLineText'],
    ['Description', 'multilineText'],
    ['Type', 'multipleSelects'],
    ['Online?', 'checkbox'],
    ['Latitude', 'number'],
    ['Logo', 'multipleAttachments'],
    ['Days left', 'formula'],
    ['Last edited', 'lastModifiedTime'],
    ['Organizer', 'singleCollaborator'],
  ])
  const fields = (): Record<string, unknown> => ({
    Name: 'Careers Evening',
    Description: 'Short talks.\nThen questions.',
    Type: ['Meetup', 'Talk'],
    'Online?': true,
    Latitude: 52.0,
    Logo: [
      {
        id: 'attAAAAAAAAAAAAAA',
        url: 'https://v5.airtableusercontent.com/one-link',
        filename: 'a.png',
        size: 1234,
        type: 'image/png',
      },
    ],
    'Days left': 12,
    'Last edited': '2026-11-28T03:00:00.000Z',
    Created: '2026-11-01',
    Organizer: { id: 'usr1', email: 'x@example.org', name: 'X' },
    'Publish?': false,
  })
  const never = new Set(['Publish?', 'Hide?'])
  const of = (f: Record<string, unknown> = fields(), t = types) =>
    shownOfRecord({ table: TABLE, record: REC, fields: f, types: t, never })

  it('is taken over the fields the page shows, and only those', () => {
    expect(
      canonicalJson(
        shownRecordValue({
          table: TABLE,
          record: REC,
          fields: fields(),
          types,
          never,
        })
      )
    ).toBe(
      String.raw`{"fields":{"Description":"Short talks.\nThen questions.","Latitude":52,"Logo":["attAAAAAAAAAAAAAA"],"Name":"Careers Evening","Online?":true,"Type":["Meetup","Talk"]},"record":"recAAAAAAAAAAAAAA","table":"tblXbN9swwldwq8f7"}`
    )
    expect(of()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('moves with anything a person or a chat can change on the record', () => {
    const was = of()
    for (const alter of [
      (f: Record<string, unknown>) => (f.Name = 'Careers Night'),
      (f: Record<string, unknown>) => (f.Description = 'Something else.'),
      (f: Record<string, unknown>) => (f.Type = ['Meetup']),
      (f: Record<string, unknown>) => (f.Type = ['Talk', 'Meetup']),
      (f: Record<string, unknown>) => delete f['Online?'],
      (f: Record<string, unknown>) => (f.Latitude = 52.5),
      (f: Record<string, unknown>) => (f.Link = 'https://example.org'),
      // Another picture in the slot, or none.
      (f: Record<string, unknown>) =>
        (f.Logo = [
          { id: 'attBBBBBBBBBBBBBB', url: 'https://x/y', filename: 'a.png' },
        ]),
      (f: Record<string, unknown>) => delete f.Logo,
    ]) {
      const f = fields()
      alter(f)
      expect(of(f)).not.toBe(was)
    }
    // And with which record it is.
    expect(
      shownOfRecord({
        table: TABLE,
        record: 'recBBBBBBBBBBBBBB',
        fields: fields(),
        types,
        never,
      })
    ).not.toBe(was)
  })

  it('stays put for what moves by itself, and for what the page is never handed', () => {
    const was = of()
    for (const alter of [
      // A file's link is new with every read, and its size and type are
      // filled in a moment after an upload.
      (f: Record<string, unknown>) =>
        (f.Logo = [
          {
            id: 'attAAAAAAAAAAAAAA',
            url: 'https://v5.airtableusercontent.com/another-link',
          },
        ]),
      // Computed fields, and Airtable's bookkeeping.
      (f: Record<string, unknown>) => (f['Days left'] = 11),
      (f: Record<string, unknown>) =>
        (f['Last edited'] = '2026-11-29T00:00:00.000Z'),
      (f: Record<string, unknown>) => (f.Created = '2026-11-02'),
      // Values the page is not handed.
      (f: Record<string, unknown>) => (f.Organizer = { id: 'usr2' }),
      (f: Record<string, unknown>) => (f['Publish?'] = true),
      // Empty is the same as not there.
      (f: Record<string, unknown>) => (f.Link = ''),
      (f: Record<string, unknown>) => (f.Cost = null),
      (f: Record<string, unknown>) => (f.Tags = []),
      (f: Record<string, unknown>) => (f['In person?'] = false),
    ]) {
      const f = fields()
      alter(f)
      expect(of(f)).toBe(was)
    }
  })

  it('goes by a file’s name and size when it has no id', () => {
    const one = (file: Record<string, unknown>) => of({ Logo: [file] })
    const a = one({ url: 'https://x/1', filename: 'a.png', size: 10 })
    expect(one({ url: 'https://x/2', filename: 'a.png', size: 10 })).toBe(a)
    expect(one({ url: 'https://x/1', filename: 'b.png', size: 10 })).not.toBe(a)
    expect(one({ url: 'https://x/1', filename: 'a.png', size: 11 })).not.toBe(a)
  })

  it('keeps every field but the bookkeeping when the table’s field list is not known', () => {
    const none = new Map<string, string>()
    const was = of(fields(), none)
    const f = fields()
    f['Days left'] = 11
    expect(of(f, none)).not.toBe(was)
    const g = fields()
    g.Created = '2026-11-02'
    expect(of(g, none)).toBe(was)
  })

  it('is never a change’s or a rule’s fingerprint', () => {
    const empty = shownOfRecord({
      table: '',
      record: '',
      fields: {},
      types: new Map(),
    })
    expect(empty).not.toBe(shownOf({ type: 'Change', proposal: {} }))
    expect(empty).not.toBe(shownOf({ type: 'Rule', proposal: {} }))
  })
})

describe('canonicalJson', () => {
  it('sorts keys, at every depth, and leaves lists in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,1,2]},"b":1}'
    )
  })
  it('sorts keys by code point, as Python does', () => {
    // U+FF21 sorts before U+1F600 by code point, after it by UTF-16 unit.
    expect(canonicalJson({ '\u{1F600}': 1, Ａ: 2, Z: 3, a: 4 })).toBe(
      '{"Z":3,"a":4,"Ａ":2,"\u{1F600}":1}'
    )
  })
  it('writes a whole number without a fraction', () => {
    expect(
      canonicalJson(JSON.parse('[52.0, -0.0, 1e3, 37.7749, -0.5, 12]'))
    ).toBe('[52,0,1000,37.7749,-0.5,12]')
  })
  it('escapes only what JSON must, and nothing outside ASCII', () => {
    expect(canonicalJson('a"b\\c\n\t\u0001é–你 ')).toBe(
      '"a\\"b\\\\c\\n\\t\\u0001é–你 "'
    )
  })
  it('has no spaces, and null for what is missing', () => {
    expect(canonicalJson({ a: [true, false, null], b: undefined })).toBe(
      '{"a":[true,false,null]}'
    )
    expect(canonicalJson(undefined)).toBe('null')
  })
})

describe('isShown', () => {
  it('is 64 lower-case hex characters', () => {
    expect(isShown(shownOf(ruleRow()))).toBe(true)
    for (const bad of ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), null, 7]) {
      expect(isShown(bad)).toBe(false)
    }
  })
})
