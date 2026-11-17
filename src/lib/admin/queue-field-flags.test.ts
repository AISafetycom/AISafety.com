import { describe, expect, it } from 'vitest'
import {
  FLAG_VERDICTS,
  fieldFlagsOf,
  flagShown,
  flagState,
  flagText,
  pictureState,
  sameValue,
  shownFlags,
  shownPictures,
  withFlags,
  withoutFlag,
  wordDiff,
  type FieldFlag,
  type PictureFlag,
} from './queue-field-flags'
import type { PreparedFile } from './queue-prepared'

describe('FLAG_VERDICTS', () => {
  it('shows the field check on Publish and Unsure additions only', () => {
    expect(FLAG_VERDICTS.has('Publish')).toBe(true)
    expect(FLAG_VERDICTS.has('Unsure')).toBe(true)
    expect(FLAG_VERDICTS.has("Don't publish")).toBe(false)
    expect(FLAG_VERDICTS.has('Fix')).toBe(false)
  })
})

const category: FieldFlag = {
  field: 'Category',
  from: ['Strategy'],
  to: ['Research support', 'Strategy'],
  why: 'It runs events for the field rather than doing strategy research.',
}

describe('fieldFlagsOf', () => {
  it('reads the block the Mac writes', () => {
    expect(
      fieldFlagsOf({
        at: '2026-11-16T12:00:00Z',
        review: 'abc123',
        checked: 6,
        flags: [category],
      })
    ).toEqual({
      at: '2026-11-16T12:00:00Z',
      checked: 6,
      flags: [category],
      pictures: [],
    })
  })

  it('is null until the check has run', () => {
    expect(fieldFlagsOf(undefined)).toBeNull()
    expect(fieldFlagsOf(null)).toBeNull()
    expect(fieldFlagsOf({ at: 'x' })).toBeNull()
    expect(fieldFlagsOf([category])).toBeNull()
  })

  it('keeps a check that found nothing', () => {
    expect(fieldFlagsOf({ checked: 9, flags: [] })).toEqual({
      at: null,
      checked: 9,
      flags: [],
      pictures: [],
    })
  })

  it('leaves out a flag that is not well formed, and keeps the rest', () => {
    const got = fieldFlagsOf({
      flags: [
        { field: 'Publish?', from: false, to: true, why: 'no' },
        { field: 'Hide?', from: false, to: true, why: 'no' },
        { field: 'Logo', from: null, to: [{ url: 'x' }], why: 'a picture' },
        { field: 'Name', from: 'A', to: 'B' },
        { field: '', from: 'A', to: 'B', why: 'no field' },
        category,
        { ...category, to: ['Strategy'] },
        { field: 'Deadline', to: '2026-12-01', why: 'the page gives it' },
      ],
    })
    expect(got?.flags.map(f => f.field)).toEqual(['Category', 'Deadline'])
    expect(got?.flags[1].from).toBeNull()
  })
})

describe('flagText and flagShown', () => {
  it('hold a value the way the editors do', () => {
    expect(flagText(['Research support', 'Strategy'])).toBe(
      'Research support, Strategy'
    )
    expect(flagText(true)).toBe('true')
    expect(flagText(false)).toBe('false')
    expect(flagText(null)).toBe('')
    expect(flagText(5000)).toBe('5000')
  })

  it('show a value the way people read it', () => {
    expect(flagShown(null)).toBe('empty')
    expect(flagShown([])).toBe('empty')
    expect(flagShown(true)).toBe('ticked')
    expect(flagShown(false)).toBe('unticked')
    expect(flagShown('2026-12-01')).toBe('1 December 2026')
    expect(flagShown(['A', 'B'])).toBe('A, B')
    expect(flagShown('Free')).toBe('Free')
  })
})

describe('sameValue', () => {
  it('reads a list and its comma-separated edit as the same', () => {
    expect(sameValue(['A', 'B'], 'A, B')).toBe(true)
    expect(sameValue(['A', 'B'], 'A,B')).toBe(true)
    expect(sameValue(['A'], 'A')).toBe(true)
  })

  it('counts the order of a list', () => {
    expect(sameValue(['A', 'B'], ['B', 'A'])).toBe(false)
  })

  it('reads empty, unticked and an empty list as the same', () => {
    expect(sameValue(null, '')).toBe(true)
    expect(sameValue(undefined, null)).toBe(true)
    expect(sameValue(false, null)).toBe(true)
    expect(sameValue(false, 'false')).toBe(true)
    expect(sameValue([], null)).toBe(true)
    expect(sameValue(true, 'true')).toBe(true)
    expect(sameValue(true, false)).toBe(false)
  })

  it('ignores spacing, not wording', () => {
    expect(sameValue('Two  words ', 'Two words')).toBe(true)
    expect(sameValue('Two words', 'Two Words')).toBe(false)
    expect(sameValue(5000, '5000')).toBe(true)
  })
})

describe('flagState', () => {
  it('is open while the field reads as it did', () => {
    expect(flagState(category, ['Strategy'], undefined)).toBe('open')
  })

  it('is used once the edit holds the flagged value', () => {
    expect(
      flagState(category, ['Strategy'], 'Research support, Strategy')
    ).toBe('used')
  })

  it('is gone once he edits the field to something else', () => {
    expect(flagState(category, ['Strategy'], 'Governance')).toBe('gone')
  })

  it('is gone once the record itself says so', () => {
    expect(
      flagState(category, ['Research support', 'Strategy'], undefined)
    ).toBe('gone')
  })

  it('is gone when the record has changed to something else', () => {
    expect(flagState(category, ['Advocacy'], undefined)).toBe('gone')
  })

  it('is open on an edit the flag was judged against', () => {
    const f: FieldFlag = { field: 'Cost', from: 'Free', to: 'Paid', why: 'x' }
    expect(flagState(f, null, 'Free')).toBe('open')
  })
})

describe('withFlags and withoutFlag', () => {
  const deadline: FieldFlag = {
    field: 'Deadline',
    from: null,
    to: '2026-12-01',
    why: 'The page gives 1 December.',
  }

  it('put every open flag into the edits', () => {
    expect(
      withFlags([category, deadline], { Category: ['Strategy'] }, { Name: 'N' })
    ).toEqual({
      Name: 'N',
      Category: 'Research support, Strategy',
      Deadline: '2026-12-01',
    })
  })

  it('leave an overtaken flag and his own edit alone', () => {
    const edits = { Category: 'Governance' }
    expect(withFlags([category], { Category: ['Strategy'] }, edits)).toEqual(
      edits
    )
  })

  it('take a used flag back off', () => {
    const live = { Category: ['Strategy'] }
    const used = withFlags([category], live, {})
    expect(withoutFlag(category, live, used)).toEqual({})
  })

  it('go back to the earlier edit the flag was judged against', () => {
    const f: FieldFlag = { field: 'Cost', from: 'Free', to: 'Paid', why: 'x' }
    expect(withoutFlag(f, { Cost: null }, { Cost: 'Paid' })).toEqual({
      Cost: 'Free',
    })
  })
})

describe('shownFlags', () => {
  it('lists open and used flags, not overtaken ones', () => {
    const cost: FieldFlag = {
      field: 'Cost',
      from: 'Free',
      to: 'Paid',
      why: 'x',
    }
    const gone: FieldFlag = {
      field: 'Mode',
      from: 'Online',
      to: 'Hybrid',
      why: 'x',
    }
    expect(
      shownFlags(
        [category, cost, gone],
        { Category: ['Strategy'], Cost: 'Free', Mode: 'In person' },
        { Cost: 'Paid' }
      ).map(x => [x.flag.field, x.state])
    ).toEqual([
      ['Category', 'open'],
      ['Cost', 'used'],
    ])
  })

  it('leaves out a field the page cannot edit', () => {
    expect(
      shownFlags([category], { Category: ['Strategy'] }, {}, () => false)
    ).toEqual([])
  })
})

describe('wordDiff', () => {
  const from =
    'Brings together researchers, policymakers, and practitioners on AI safety. Runs the invitation-only Summit on Existential Security.'
  const to =
    'Brings together researchers, policymakers, and practitioners on AI safety. Runs the Summit on Existential Security.'

  it('marks what was cut and what is new', () => {
    const parts = wordDiff(from, to)
    expect(parts).toEqual([
      {
        kind: 'same',
        text: 'Brings together researchers, policymakers, and practitioners on AI safety. Runs the',
      },
      { kind: 'cut', text: 'invitation-only' },
      { kind: 'same', text: 'Summit on Existential Security.' },
    ])
  })

  it('gives every word of both sides back', () => {
    const parts = wordDiff(from, `${to} It also hosts the AI Horizons Forum.`)
    const side = (drop: string) =>
      (parts ?? [])
        .filter(p => p.kind !== drop)
        .map(p => p.text)
        .join(' ')
    expect(side('new')).toBe(from)
    expect(side('cut')).toBe(`${to} It also hosts the AI Horizons Forum.`)
  })

  it('is null for short values, lists and unrelated texts', () => {
    expect(wordDiff('Free', 'Paid')).toBeNull()
    expect(wordDiff(['A'], ['B'])).toBeNull()
    expect(wordDiff(null, to)).toBeNull()
    expect(
      wordDiff(
        from,
        'A weekly newsletter of newly announced training programs, online and in person, for people new to the field.'
      )
    ).toBeNull()
  })
})

// 17 Nov 2026 – Bryce, told the field check never changed pictures: "Why
// not?". A proposed logo names files by name and size; the prepared one sits
// on the row's Prepared logo field.
const logoFlag = {
  field: 'Logo (for cards)',
  picture: true,
  from: { file: 'poseidon-research.svg', size: 1113 },
  to: { file: 'poseidon-research.webp', size: 8194, width: 250, height: 90 },
  source: 'the site header of poseidonresearch.org',
  prep: 'used unchanged',
  why: "The favicon's PR monogram; the header draws the wordmark.",
}

const prepared: PreparedFile[] = [
  {
    url: 'https://v5.airtableusercontent.com/p/1',
    filename: 'poseidon-research.webp',
    size: 8194,
    width: 250,
    height: 90,
    type: 'image/webp',
  },
]

describe('picture flags', () => {
  it('reads a proposed logo apart from the field flags', () => {
    const got = fieldFlagsOf({ checked: 6, flags: [logoFlag, category] })
    expect(got?.flags).toEqual([category])
    expect(got?.pictures).toEqual([
      {
        field: 'Logo (for cards)',
        from: { file: 'poseidon-research.svg', size: 1113 },
        to: {
          file: 'poseidon-research.webp',
          size: 8194,
          width: 250,
          height: 90,
        },
        source: 'the site header of poseidonresearch.org',
        prep: 'used unchanged',
        why: "The favicon's PR monogram; the header draws the wordmark.",
      },
    ])
  })

  it('takes an empty field as from null, and leaves out what is not well formed', () => {
    const got = fieldFlagsOf({
      flags: [
        { ...logoFlag, from: null },
        { ...logoFlag, field: 'Logo (for map)', from: 'a link' },
        { ...logoFlag, field: 'Description' },
        { ...logoFlag, field: 'Image', to: { url: 'https://x/y.png' } },
        { ...logoFlag, field: 'Logo', why: '' },
        { ...logoFlag, field: 'Logo (for cards)' },
      ],
    })
    expect(got?.pictures.map(p => [p.field, p.from])).toEqual([
      ['Logo (for cards)', null],
    ])
  })

  it('a site without picture flags read them as nothing', () => {
    // what the page did before 17 Nov 2026: from and to are not values
    const got = fieldFlagsOf({ flags: [{ ...logoFlag, picture: undefined }] })
    expect(got?.flags).toEqual([])
  })

  const flag = fieldFlagsOf({ flags: [logoFlag] })?.pictures[0] as PictureFlag

  it('stands open, used or gone by the file the record holds', () => {
    expect(pictureState(flag, undefined)).toBe('open') // record not read yet
    expect(
      pictureState(flag, { filename: 'poseidon-research.svg', size: 1113 })
    ).toBe('open')
    expect(
      pictureState(flag, { filename: 'poseidon-research.webp', size: 8194 })
    ).toBe('used')
    // the same name at another size is another file: dropped in by hand
    expect(
      pictureState(flag, { filename: 'poseidon-research.svg', size: 999 })
    ).toBe('gone')
    expect(pictureState(flag, null)).toBe('gone')
    const empty = { ...flag, from: null }
    expect(pictureState(empty, null)).toBe('open')
    expect(pictureState(empty, { filename: 'other.png', size: 1 })).toBe('gone')
  })

  it('shows a flag only while its prepared file is on the row', () => {
    const now = () => ({ filename: 'poseidon-research.svg', size: 1113 })
    expect(shownPictures([flag], now, prepared)).toEqual([
      { flag, state: 'open', file: prepared[0] },
    ])
    expect(shownPictures([flag], now, [])).toEqual([])
    expect(shownPictures([flag], now, [{ ...prepared[0], size: 1 }])).toEqual(
      []
    )
    expect(shownPictures([flag], now, prepared, () => false)).toEqual([])
    expect(
      shownPictures([flag], () => ({ filename: 'x.png', size: 3 }), prepared)
    ).toEqual([])
  })
})
