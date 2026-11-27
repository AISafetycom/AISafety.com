import { describe, expect, it } from 'vitest'
import {
  editsPrint,
  firstName,
  forBryceOf,
  fromLabel,
  hashOf,
  isWaiting,
  makePrint,
  openSuggestion,
  partWords,
  printDiff,
  rejectSeed,
  replyPrint,
  rowNote,
  stableJson,
  suggestWord,
} from './queue-suggest'

const AT = '2026-11-30T03:00:00.000Z'
const print = makePrint({
  verdict: 'Publish',
  changes: null,
  table: 'tblXbN9swwldwq8f7',
  record: 'rec00000000000001',
  edits: { Name: 'A' },
  reply: 'Thanks!',
})

describe('forBryceOf', () => {
  it('reads a suggestion and a question, from text or an object', () => {
    const s = forBryceOf(
      JSON.stringify({
        kind: 'suggest',
        by: 'Rob Grayson',
        at: AT,
        did: 'reject',
        reason: '  Not about AI safety ',
        rejectReply: 'Sorry',
        keep: ['Logo', 'Logo'],
        publicChoice: 'nope',
        edited: ['Name'],
        print,
      })
    )
    expect(s).toEqual({
      kind: 'suggest',
      by: 'Rob Grayson',
      at: AT,
      did: 'reject',
      reason: 'Not about AI safety',
      rejectReply: 'Sorry',
      keep: ['Logo'],
      publicChoice: null,
      edited: ['Name'],
      print,
      asked: null,
    })
    expect(
      forBryceOf({ kind: 'ask', by: 'Rob', at: AT, question: 'In scope?' })
    ).toEqual({
      kind: 'ask',
      by: 'Rob',
      at: AT,
      question: 'In scope?',
      answer: null,
      answeredBy: null,
      answeredAt: null,
    })
  })

  it('is nothing for an empty field or anything it cannot trust', () => {
    expect(forBryceOf('')).toBeNull()
    expect(forBryceOf(null)).toBeNull()
    expect(forBryceOf('not json')).toBeNull()
    expect(forBryceOf({ kind: 'suggest', at: AT, did: 'accept' })).toBeNull()
    expect(
      forBryceOf({ kind: 'suggest', at: AT, did: 'publish', print })
    ).toBeNull()
    expect(forBryceOf({ kind: 'ask', at: AT, question: '  ' })).toBeNull()
    expect(forBryceOf({ kind: 'ask', at: 'soon', question: 'Q' })).toBeNull()
    expect(forBryceOf({ kind: 'other', at: AT })).toBeNull()
  })

  it('waits until someone acts: any suggestion, a question until answered', () => {
    const s = forBryceOf({ kind: 'suggest', at: AT, did: 'later', print })
    const q = forBryceOf({ kind: 'ask', at: AT, question: 'Q' })
    const a = forBryceOf({
      kind: 'ask',
      at: AT,
      question: 'Q',
      answer: 'Yes',
      answeredBy: 'Bryce',
      answeredAt: AT,
    })
    expect(isWaiting(s)).toBe(true)
    expect(isWaiting(q)).toBe(true)
    expect(isWaiting(a)).toBe(false)
    expect(isWaiting(null)).toBe(false)
    expect(openSuggestion(s)).toBe(s)
    expect(openSuggestion(q)).toBeNull()
  })
})

describe('the fingerprint', () => {
  it('reads a value the same whatever order its keys were written in', () => {
    expect(stableJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      '{"a":[2,{"c":4,"d":3}],"b":1}'
    )
    expect(hashOf({ b: 1, a: 2 })).toBe(hashOf({ a: 2, b: 1 }))
    expect(hashOf('x')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('treats an empty Edits or Reply draft as none', () => {
    expect(editsPrint({})).toBe(editsPrint(null))
    expect(editsPrint(undefined)).toBe(editsPrint(null))
    expect(replyPrint('  ')).toBe(replyPrint(null))
    expect(replyPrint(' Thanks! ')).toBe(replyPrint('Thanks!'))
  })

  it('names the parts that moved, in the page’s words', () => {
    const moved = makePrint({
      verdict: 'Unsure',
      changes: null,
      table: 'tblXbN9swwldwq8f7',
      record: 'rec00000000000001',
      edits: { Name: 'B' },
      reply: 'Thanks!',
    })
    expect(printDiff(print, print)).toEqual([])
    expect(printDiff(print, moved)).toEqual(['verdict', 'edits'])
    expect(partWords(['verdict', 'edits'])).toBe('its verdict and the edits')
    expect(partWords(['changes', 'target', 'reply'])).toBe(
      'the proposed changes, the listing it is about, and the reply draft'
    )
  })
})

describe('words for the page', () => {
  it('names the call as the buttons do', () => {
    expect(suggestWord('accept', 'Add')).toBe('Publish')
    expect(suggestWord('accept', 'Change')).toBe('Apply')
    expect(suggestWord('later', 'Add')).toBe('Review again in a week')
  })

  it('labels the From section with first names', () => {
    expect(firstName('Rob Grayson')).toBe('Rob')
    expect(firstName('rob@aisafety.com')).toBe('rob')
    expect(firstName(null)).toBe('Someone')
    expect(fromLabel(['Rob Grayson', 'Rob Grayson'])).toBe('From Rob')
    expect(fromLabel(['Rob Grayson', 'Sam Lee'])).toBe('From Rob and Sam')
    expect(fromLabel(['Rob', 'Sam', 'Ana'])).toBe('From Rob, Sam, and Ana')
    expect(fromLabel([])).toBe('From the team')
  })

  it('says on a row who suggested or asked what', () => {
    const s = forBryceOf({
      kind: 'suggest',
      by: 'Rob Grayson',
      at: AT,
      did: 'accept',
      print,
    })!
    const a = forBryceOf({
      kind: 'ask',
      by: 'Rob Grayson',
      at: AT,
      question: 'Q',
      answer: 'A',
      answeredBy: 'Bryce',
      answeredAt: AT,
    })!
    expect(rowNote(s, 'Add')).toBe('Rob suggests Publish')
    expect(rowNote(a, 'Add')).toBe('Bryce answered')
  })

  it('fills in a suggested Reject’s reason and decline text', () => {
    const reject = (reason: string) =>
      forBryceOf({
        kind: 'suggest',
        by: 'Rob',
        at: AT,
        did: 'reject',
        reason,
        rejectReply: 'Sorry, not this time.',
        print,
      })
    const chips = ['Not about AI safety', 'Already listed']
    expect(rejectSeed(reject('Already listed'), chips)).toEqual({
      chip: 'Already listed',
      other: '',
      decline: 'Sorry, not this time.',
    })
    expect(rejectSeed(reject('Too small for now'), chips)).toEqual({
      chip: null,
      other: 'Too small for now',
      decline: 'Sorry, not this time.',
    })
    expect(
      rejectSeed(
        forBryceOf({ kind: 'suggest', at: AT, did: 'accept', print }),
        chips
      )
    ).toBeNull()
  })
})
