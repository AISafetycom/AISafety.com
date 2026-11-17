import { describe, expect, it } from 'vitest'
import {
  notTakenOff,
  replaceBoxWords,
  replacedOf,
  replaceOldOf,
  replacesChanged,
  replacesOf,
  stillOnNote,
  tookOffNote,
} from './queue-replaces'

const EVENTS = 'tblXbN9swwldwq8f7'
const OLD = 'rec0000000000old1'
const block = {
  table: EVENTS,
  record: OLD,
  name: 'Encode Sub Saharan Africa',
  page: '/events',
  url: `https://airtable.com/appTest/${EVENTS}/${OLD}`,
}

describe('replacesOf', () => {
  it('reads the block the Mac writes', () => {
    expect(replacesOf(block)).toEqual(block)
  })

  it('names the listing by its record id when it has no name, and takes no page for granted', () => {
    expect(replacesOf({ table: EVENTS, record: OLD })).toEqual({
      table: EVENTS,
      record: OLD,
      name: OLD,
      page: null,
      url: null,
    })
  })

  it('keeps a link only when it is Airtable’s', () => {
    expect(
      replacesOf({ ...block, url: 'https://example.com/x' })?.url
    ).toBeNull()
    expect(replacesOf({ ...block, url: 'javascript:alert(1)' })?.url).toBeNull()
  })

  it('is nothing without a table id and a record id', () => {
    for (const v of [
      null,
      undefined,
      'rec0000000000old1',
      [],
      {},
      { ...block, table: 'Events' },
      { ...block, record: 'the old one' },
      { ...block, record: `${OLD}/comments` },
    ]) {
      expect(replacesOf(v)).toBeNull()
    }
  })
})

describe('replacedOf', () => {
  it('reads back how the listing was', () => {
    expect(replacedOf({ ...block, publish: true, hide: false })).toEqual({
      ...block,
      publish: true,
      hide: false,
    })
  })

  it('takes anything but true for unticked, and nothing for an empty field', () => {
    expect(replacedOf({ ...block, publish: 'yes' })).toMatchObject({
      publish: false,
      hide: false,
    })
    expect(replacedOf(null)).toBeNull()
    expect(replacedOf('')).toBeNull()
  })
})

describe('replaceOldOf', () => {
  const add = { type: 'Add', replaces: block }

  it('names the record the box showed while the box is ticked', () => {
    expect(replaceOldOf(add, false)).toEqual({ replaceOld: OLD })
  })

  it('sends nothing when the box is unticked, or there is no box', () => {
    expect(replaceOldOf(add, true)).toEqual({})
    expect(replaceOldOf({ type: 'Add', replaces: null }, false)).toEqual({})
    expect(replaceOldOf({ type: 'Add' }, false)).toEqual({})
    expect(replaceOldOf({ type: 'Change', replaces: block }, false)).toEqual({})
  })
})

describe('replacesChanged', () => {
  it('is nothing when the page named the row’s listing, or named none', () => {
    expect(replacesChanged(OLD, block)).toBeNull()
    expect(replacesChanged(null, block)).toBeNull()
    expect(replacesChanged(null, null)).toBeNull()
  })

  it('says so when the row names another listing now, or none', () => {
    expect(replacesChanged('rec000000000other', block)).toContain(
      'Encode Sub Saharan Africa'
    )
    expect(replacesChanged(OLD, null)).toContain('no longer names a listing')
    expect(replacesChanged(OLD, undefined)).toContain(
      'no longer names a listing'
    )
  })
})

describe('the words on the page', () => {
  it('names the page the old listing is on', () => {
    expect(replaceBoxWords(block)).toEqual(['Also take', 'off /events'])
    expect(tookOffNote(block)).toBe(
      'Took Encode Sub Saharan Africa off /events'
    )
    expect(stillOnNote(block)).toBe(
      'Encode Sub Saharan Africa is still on /events'
    )
  })

  it('says "the site" when the page is not known', () => {
    const noPage = { ...block, page: null }
    expect(replaceBoxWords(noPage)).toEqual(['Also take', 'off the site'])
    expect(tookOffNote(noPage)).toBe(
      'Took Encode Sub Saharan Africa off the site'
    )
  })

  it('keeps the row’s note on a failure short enough for the field', () => {
    const note = notTakenOff(block, 'x'.repeat(3000))
    expect(note.length).toBe(1000)
    expect(note).toMatch(
      /^Published, but Encode Sub Saharan Africa could not be taken off \/events: x/
    )
  })
})
