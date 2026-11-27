import { describe, expect, it } from 'vitest'
import { canonicalJson, isShown, shownOf, shownValue } from './queue-shown'

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
