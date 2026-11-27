import { describe, expect, it } from 'vitest'
import {
  decidedBy,
  historyOf,
  lineText,
  listingLines,
  nameList,
  namesItself,
  rowLines,
  standing,
  withEntry,
  type HistoryEntry,
  type HistoryLine,
  type HistoryRow,
} from './queue-history'

const AT = '2026-11-18T06:00:00.000Z'
const LATER = '2026-11-19T09:30:00.000Z'

function row(over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: 'recAAAAAAAAAAAAAA',
    type: 'Add',
    source: 'Comb',
    status: 'Applied',
    decidedAt: AT,
    declined: false,
    reviewAgainOn: null,
    history: [],
    written: [],
    proposed: [],
    ...over,
  }
}

function line(over: Partial<HistoryLine>): HistoryLine {
  return {
    at: AT,
    by: 'Rob Example',
    did: 'accept',
    row: 'recAAAAAAAAAAAAAA',
    type: 'Add',
    source: 'Comb',
    recorded: true,
    ...over,
  }
}

describe('historyOf', () => {
  it('reads the field as Airtable holds it', () => {
    const raw = JSON.stringify([{ at: AT, by: 'Rob Example', did: 'accept' }])
    expect(historyOf(raw)).toEqual([
      { at: AT, by: 'Rob Example', did: 'accept' },
    ])
  })
  it('is empty for a row with none, or one it cannot read', () => {
    expect(historyOf(undefined)).toEqual([])
    expect(historyOf('')).toEqual([])
    expect(historyOf('not json')).toEqual([])
    expect(historyOf('{"at":"x"}')).toEqual([])
  })
  it('drops what is not an entry and keeps the rest', () => {
    const raw = JSON.stringify([
      { at: 'no date', by: 'A', did: 'accept' },
      { at: AT, by: 'A', did: 'something else' },
      null,
      { at: AT, by: '', did: 'reject', fields: ['x'], undid: 'accept' },
    ])
    // No name is null; `undid` belongs to an undo only.
    expect(historyOf(raw)).toEqual([
      { at: AT, by: null, did: 'reject', fields: ['x'] },
    ])
  })
})

describe('an entry the Mac wrote', () => {
  it('reads Fable’s change with who asked, as Python writes it', () => {
    // json.dumps with compact separators, the name of whoever sent the message.
    const raw =
      '[{"at":"2026-11-18T05:00:00Z","by":"Rob Example","did":"fable","fields":["Logo","Name"]}]'
    expect(historyOf(raw)).toEqual([
      {
        at: '2026-11-18T05:00:00Z',
        by: 'Rob Example',
        did: 'fable',
        fields: ['Logo', 'Name'],
      },
    ])
  })
  it('is no decision: the row’s own decision still stands beside it', () => {
    const r = row({
      history: [
        { at: AT, by: 'Rob', did: 'accept' },
        { at: LATER, by: 'Bryce', did: 'fable', fields: ['Logo'] },
      ],
    })
    expect(decidedBy(r)).toBe('Rob')
    expect(rowLines(r).map(l => [l.did, l.by])).toEqual([
      ['accept', 'Rob'],
      ['fable', 'Bryce'],
    ])
  })
})

describe('withEntry', () => {
  it('adds the entry after what the row holds', () => {
    const before: HistoryEntry[] = [{ at: AT, by: 'A', did: 'accept' }]
    const next = historyOf(
      withEntry(before, { at: LATER, by: 'B', did: 'undo', undid: 'accept' })
    )
    expect(next).toEqual([
      { at: AT, by: 'A', did: 'accept' },
      { at: LATER, by: 'B', did: 'undo', undid: 'accept' },
    ])
  })
  it('keeps field names once each, and leaves an empty list out', () => {
    const one = historyOf(
      withEntry([], {
        at: AT,
        by: 'A',
        did: 'fix',
        fields: ['Deadline', 'Deadline', ' Location '],
      })
    )
    expect(one[0].fields).toEqual(['Deadline', 'Location'])
    const none = historyOf(
      withEntry([], { at: AT, by: 'A', did: 'accept', fields: [] })
    )
    expect(none[0]).toEqual({ at: AT, by: 'A', did: 'accept' })
  })
  it('keeps the newest hundred', () => {
    let history: HistoryEntry[] = []
    for (let i = 0; i < 130; i++) {
      history = historyOf(
        withEntry(history, {
          at: new Date(Date.parse(AT) + i * 1000).toISOString(),
          by: `P${i}`,
          did: 'fix',
        })
      )
    }
    expect(history).toHaveLength(100)
    expect(history[0].by).toBe('P30')
    expect(history[99].by).toBe('P129')
  })
})

describe('standing and decidedBy', () => {
  it('names who made the decision the row holds', () => {
    const r = row({ history: [{ at: AT, by: 'Rob Example', did: 'accept' }] })
    expect(decidedBy(r)).toBe('Rob Example')
  })
  it('matches a Decided at that Airtable handed back rounded', () => {
    const r = row({
      decidedAt: '2026-11-18T06:00:00.000Z',
      history: [{ at: '2026-11-18T06:00:00.412Z', by: 'Rob', did: 'reject' }],
      status: 'Rejected',
    })
    expect(decidedBy(r)).toBe('Rob')
  })
  it('names nobody for a decision with no entry of its own', () => {
    // Published, undone, then published again outside the page.
    const r = row({
      decidedAt: LATER,
      history: [
        { at: AT, by: 'Rob', did: 'accept' },
        { at: AT, by: 'Rob', did: 'undo', undid: 'accept' },
      ],
    })
    expect(standing(r)).toBeNull()
    expect(decidedBy(r)).toBeNull()
  })
  it('names who set an item aside, until it is brought back', () => {
    const aside = row({
      status: 'Pending',
      decidedAt: null,
      reviewAgainOn: LATER,
      history: [{ at: AT, by: 'Rob', did: 'later' }],
    })
    expect(decidedBy(aside)).toBe('Rob')
    expect(decidedBy({ ...aside, reviewAgainOn: null })).toBeNull()
  })
  it('names nobody on an open row', () => {
    const r = row({
      status: 'Pending',
      decidedAt: null,
      history: [
        { at: AT, by: 'Rob', did: 'accept' },
        { at: LATER, by: 'Rob', did: 'undo', undid: 'accept' },
      ],
    })
    expect(decidedBy(r)).toBeNull()
  })
})

describe('rowLines', () => {
  it('adds a nameless line for a decision made before entries were kept', () => {
    expect(rowLines(row())).toEqual([
      {
        at: AT,
        by: null,
        did: 'accept',
        row: 'recAAAAAAAAAAAAAA',
        type: 'Add',
        source: 'Comb',
        recorded: false,
      },
    ])
  })
  it('gives an old applied change the fields it wrote', () => {
    const [l] = rowLines(
      row({ type: 'Change', source: 'Broom', written: ['Deadline'] })
    )
    expect(l.fields).toEqual(['Deadline'])
    expect(lineText(l)).toBe('Changed Deadline')
  })
  it('says which fields a rejected change would have changed', () => {
    const old = row({
      type: 'Change',
      source: 'Broom',
      status: 'Rejected',
      proposed: ['Logo', 'Name'],
    })
    expect(lineText(rowLines(old)[0])).toBe(
      'Rejected a change to Logo and Name'
    )
    const named = rowLines({
      ...old,
      history: [{ at: AT, by: 'Rob', did: 'reject' }],
    })
    expect(named).toHaveLength(1)
    expect(named[0].by).toBe('Rob')
    expect(lineText(named[0])).toBe('Rejected a change to Logo and Name')
    // A flag with nothing proposed, and an addition, are just rejected.
    expect(lineText(rowLines({ ...old, proposed: [] })[0])).toBe('Rejected')
  })
  it('reads an old decline as a reject, also once its record is deleted', () => {
    expect(rowLines(row({ status: 'Rejected' }))[0].did).toBe('reject')
    expect(rowLines(row({ declined: true }))[0].did).toBe('reject')
  })
  it('adds nothing when the decision has its entry, or the row is open', () => {
    const decided = row({ history: [{ at: AT, by: 'Rob', did: 'accept' }] })
    expect(rowLines(decided)).toHaveLength(1)
    expect(rowLines(decided)[0].recorded).toBe(true)
    expect(rowLines(row({ status: 'Pending', decidedAt: null }))).toEqual([])
    // Closed by Delete or by the Mac: no Decided at, so no decision line.
    expect(rowLines(row({ status: 'Closed', decidedAt: null }))).toEqual([])
  })
})

describe('listingLines', () => {
  it('merges every row about the listing, newest first, each row once', () => {
    const add = row({ history: [{ at: AT, by: 'Rob', did: 'accept' }] })
    const change = row({
      id: 'recBBBBBBBBBBBBBB',
      type: 'Change',
      source: 'Broom',
      decidedAt: LATER,
      history: [
        { at: LATER, by: 'Bryce', did: 'accept', fields: ['Deadline'] },
      ],
    })
    const lines = listingLines([add, change, add])
    expect(lines.map(l => [l.row, l.by])).toEqual([
      ['recBBBBBBBBBBBBBB', 'Bryce'],
      ['recAAAAAAAAAAAAAA', 'Rob'],
    ])
  })
})

describe('nameList', () => {
  it('reads as a sentence would', () => {
    expect(nameList(['A'])).toBe('A')
    expect(nameList(['A', 'B'])).toBe('A and B')
    expect(nameList(['A', 'B', 'C'])).toBe('A, B, and C')
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, and 3 more')
  })
})

describe('lineText', () => {
  it('uses the page’s words for each decision', () => {
    expect(lineText(line({ did: 'accept' }))).toBe('Published')
    expect(lineText(line({ did: 'accept', type: 'Rule' }))).toBe('Applied')
    expect(
      lineText(
        line({ did: 'accept', type: 'Change', fields: ['Deadline', 'URL'] })
      )
    ).toBe('Changed Deadline and URL')
    expect(
      lineText(line({ did: 'accept', type: 'Change', source: 'Broom' }))
    ).toBe('Flag cleared')
    expect(
      lineText(line({ did: 'accept', type: 'Change', source: 'Email' }))
    ).toBe('Accepted')
    expect(lineText(line({ did: 'reject' }))).toBe('Rejected')
    expect(lineText(line({ did: 'later' }))).toBe('Set aside for a week')
    expect(lineText(line({ did: 'fix', fields: ['Name'] }))).toBe('Edited Name')
    expect(lineText(line({ did: 'reopen' }))).toBe('Reopened')
    expect(lineText(line({ did: 'delete' }))).toBe('Deleted')
  })
  it('says what Fable changed from the chat', () => {
    expect(lineText(line({ did: 'fable', fields: ['Logo', 'Name'] }))).toBe(
      'Fable changed Logo and Name'
    )
    expect(lineText(line({ did: 'fable' }))).toBe('Fable changed the listing')
  })
  it('says whose chat changed a verdict, and who put it back', () => {
    expect(lineText(line({ did: 'flag', by: 'Rob Grayson' }))).toBe(
      'Fable changed the verdict in Rob’s chat'.replace('’', "'")
    )
    expect(
      lineText(line({ did: 'flag', by: 'Rob Grayson', type: 'Change' }))
    ).toBe("Fable changed the flag in Rob's chat")
    expect(lineText(line({ did: 'unflag', by: 'Rob Grayson' }))).toBe(
      'Rob put the earlier verdict back'
    )
    expect(lineText(line({ did: 'flag', by: null }))).toBe(
      "Fable changed the verdict in Someone's chat"
    )
    // The sentence names them, so the page adds no "by" after it.
    expect(namesItself(line({ did: 'flag' }))).toBe(true)
    expect(namesItself(line({ did: 'unflag' }))).toBe(true)
    // And both are kept when the field is read back.
    expect(
      historyOf(
        JSON.stringify([
          { at: AT, by: 'Rob Grayson', did: 'flag' },
          { at: LATER, by: 'Rob Grayson', did: 'unflag' },
        ])
      ).map(e => e.did)
    ).toEqual(['flag', 'unflag'])
    // Neither is a decision: the row's own decision still stands.
    expect(
      standing(
        row({
          history: [
            { at: AT, by: 'Bryce', did: 'accept' },
            { at: LATER, by: 'Rob Grayson', did: 'flag' },
          ],
        })
      )?.by
    ).toBe('Bryce')
  })
  it('says what an undo took back', () => {
    expect(lineText(line({ did: 'undo', undid: 'accept' }))).toBe(
      'Undid the publish'
    )
    expect(
      lineText(line({ did: 'undo', undid: 'accept', type: 'Change' }))
    ).toBe('Undid the change')
    expect(lineText(line({ did: 'undo', undid: 'reject' }))).toBe(
      'Undid the reject'
    )
    expect(lineText(line({ did: 'undo', undid: 'later' }))).toBe(
      'Brought back early'
    )
    expect(lineText(line({ did: 'undo' }))).toBe('Undid the decision')
  })
})
