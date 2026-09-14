import { describe, expect, it } from 'vitest'
import {
  appendLog,
  appendNote,
  describeAnnotationChanges,
  formatLogLines,
  parseLog,
  parseNotes,
  removeNote,
  serializeNotes,
  stampToDate,
} from './annotation-log'

const before = { review: '', tags: ['scope'], notes: '' }

describe('describeAnnotationChanges', () => {
  it('describes ratings being set, changed and cleared', () => {
    expect(describeAnnotationChanges(before, { review: 'Good' })).toEqual([
      'rated Good',
    ])
    expect(
      describeAnnotationChanges(
        { ...before, review: 'Good' },
        { review: 'Bad' }
      )
    ).toEqual(['changed the rating from Good to Bad'])
    expect(
      describeAnnotationChanges({ ...before, review: 'Bad' }, { review: null })
    ).toEqual(['cleared the Bad rating'])
    expect(
      describeAnnotationChanges(
        { ...before, review: 'Good' },
        { review: 'Good' }
      )
    ).toEqual([])
  })

  it('describes labels added and removed, ignoring unchanged ones', () => {
    expect(
      describeAnnotationChanges(before, { tags: ['scope', 'hallucination'] })
    ).toEqual(['added the label "hallucination"'])
    expect(describeAnnotationChanges(before, { tags: [] })).toEqual([
      'removed the label "scope"',
    ])
    expect(describeAnnotationChanges(before, { tags: ['scope'] })).toEqual([])
  })

  it('describes notes being written, edited and cleared', () => {
    expect(describeAnnotationChanges(before, { notes: 'hmm' })).toEqual([
      'wrote notes',
    ])
    expect(
      describeAnnotationChanges({ ...before, notes: 'a' }, { notes: 'b' })
    ).toEqual(['edited the notes'])
    expect(
      describeAnnotationChanges({ ...before, notes: 'a' }, { notes: '  ' })
    ).toEqual(['cleared the notes'])
    expect(
      describeAnnotationChanges({ ...before, notes: 'a' }, { notes: 'a' })
    ).toEqual([])
  })
})

describe('log lines', () => {
  it('formats, appends and parses back newest first', () => {
    const at = new Date('2026-09-05T11:42:30.000Z')
    const lines = formatLogLines('Bryce', ['rated Good', 'wrote notes'], at)
    expect(lines).toEqual([
      '2026-09-05 11:42 UTC · Bryce · rated Good',
      '2026-09-05 11:42 UTC · Bryce · wrote notes',
    ])
    const log = appendLog('', lines)
    const more = appendLog(
      log,
      formatLogLines('CC', ['added the label "x"'], at)
    )
    expect(more.split('\n')).toHaveLength(3)
    expect(appendLog(more, [])).toBe(more)
    const parsed = parseLog(more + '\nhand-written line')
    expect(parsed[0]).toEqual({ at: '', actor: '', what: 'hand-written line' })
    expect(parsed[1]).toEqual({
      at: '2026-09-05 11:42 UTC',
      actor: 'CC',
      what: 'added the label "x"',
    })
    expect(parsed[3].what).toBe('rated Good')
  })
})

describe('signed notes', () => {
  const at1 = new Date('2026-09-05T12:10:00.000Z')
  const at2 = new Date('2026-09-05T12:15:30.000Z')

  it('appends signed entries and parses them back, oldest first', () => {
    let field = appendNote(
      '',
      'Bryce',
      'Looks like a hallucination in turn 2.',
      at1
    )
    field = appendNote(field, 'CC', 'Agreed.\nSecond line.', at2)
    expect(field).toBe(
      '2026-09-05 12:10 UTC · Bryce\nLooks like a hallucination in turn 2.\n\n' +
        '2026-09-05 12:15 UTC · CC\nAgreed.\nSecond line.'
    )
    expect(parseNotes(field)).toEqual({
      legacy: '',
      entries: [
        {
          at: '2026-09-05 12:10 UTC',
          actor: 'Bryce',
          text: 'Looks like a hallucination in turn 2.',
        },
        {
          at: '2026-09-05 12:15 UTC',
          actor: 'CC',
          text: 'Agreed.\nSecond line.',
        },
      ],
    })
  })

  it('keeps unsigned text from before the first entry as a legacy block', () => {
    const field = appendNote(
      'old free-form note\nfrom July',
      'Bryce',
      'new',
      at1
    )
    const parsed = parseNotes(field)
    expect(parsed.legacy).toBe('old free-form note\nfrom July')
    expect(parsed.entries).toHaveLength(1)
    expect(parseNotes('just old text')).toEqual({
      legacy: 'just old text',
      entries: [],
    })
    expect(parseNotes('')).toEqual({ legacy: '', entries: [] })
  })

  it('ignores an empty note and describes a real one', () => {
    expect(appendNote('x', 'Bryce', '   ', at1)).toBe('x')
    expect(describeAnnotationChanges(before, { addNote: 'hi' })).toEqual([
      'added a note',
    ])
    expect(describeAnnotationChanges(before, { addNote: ' ' })).toEqual([])
  })
})

describe('removeNote', () => {
  const at1 = new Date('2026-09-05T12:10:00.000Z')
  const at2 = new Date('2026-09-05T12:15:00.000Z')
  const field = appendNote(
    appendNote('old text', 'Bryce', 'first', at1),
    'CC',
    'second',
    at2
  )

  it('removes the matching entry and keeps the rest, legacy included', () => {
    const next = removeNote(field, {
      index: 0,
      at: '2026-09-05 12:10 UTC',
      actor: 'Bryce',
    })
    expect(next).toBe('old text\n\n2026-09-05 12:15 UTC · CC\nsecond')
    expect(serializeNotes(parseNotes(field))).toBe(field)
  })

  it('refuses when the position no longer matches the header', () => {
    expect(
      removeNote(field, { index: 0, at: '2026-09-05 12:15 UTC', actor: 'CC' })
    ).toBeNull()
    expect(removeNote(field, { index: 5, at: 'x', actor: 'y' })).toBeNull()
  })

  it('describes the deletion with the note author', () => {
    expect(
      describeAnnotationChanges(before, {
        deleteNote: { index: 0, at: 'a', actor: 'CC' },
      })
    ).toEqual(['deleted a note by CC'])
  })
})

describe('stampToDate', () => {
  it('reads a stored UTC stamp back as the right instant', () => {
    expect(stampToDate('2026-09-05 11:42 UTC')?.toISOString()).toBe(
      '2026-09-05T11:42:00.000Z'
    )
    expect(stampToDate('hand-written')).toBeNull()
  })
})
