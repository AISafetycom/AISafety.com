import { describe, expect, it } from 'vitest'
import {
  PUBLIC_TEXT_MAX,
  publicBoxText,
  publicSpan,
  readable,
  rewritePublic,
  type PolicyEdit,
} from './queue-rule-public'

const FILE = '~/Comb/listing-policy.md'

// The /funding rule waiting on 27 Nov 2026: a bullet added after another.
const ANCHOR =
  '- Funders that are closed for now or invitation-only stay on the page, flagged as not accepting.'
const ADDED =
  '- A funder that has shut down or been inactive for a long time may be removed.'
const added: PolicyEdit = {
  file: FILE,
  find: ANCHOR,
  replace: `${ANCHOR}\n${ADDED}`,
}
const addedBlock = {
  edits: [added],
  wording: ADDED,
  was: null,
  diff: '--- a/Comb/listing-policy.md\n+++ b/Comb/listing-policy.md\n',
}

// A rewrite of one bullet into two (the Recurring listing rule).
const OLD = '- A program earns a Recurring listing once it has two rounds.'
const NEW_1 = '- A program can earn a Recurring listing once it has two rounds.'
const NEW_2 = "- Two rounds aren't enough alone."
const rewrite: PolicyEdit = {
  file: FILE,
  find: OLD,
  replace: `${NEW_1}\n${NEW_2}`,
}

describe('readable', () => {
  it('joins hard-wrapped lines and drops bold, keeping bullets', () => {
    expect(readable('- One line\n  wrapped on.\n- **Two**')).toBe(
      '- One line wrapped on.\n- Two'
    )
  })

  it('keeps one blank line between paragraphs', () => {
    expect(readable('\nFirst.\n\n\n\nSecond.\n')).toBe('First.\n\nSecond.')
  })
})

describe('publicSpan', () => {
  it('is the shown wording when replace holds it once', () => {
    const [s, e] = publicSpan(added, ADDED)!
    expect(added.replace.slice(s, e)).toBe(ADDED)
  })

  it('is the lines the edit adds when the wording is not in replace as is', () => {
    const [s, e] = publicSpan(added, 'shown differently')!
    expect(added.replace.slice(s, e)).toBe(ADDED)
    const [s2, e2] = publicSpan(rewrite, 'shown differently')!
    expect(rewrite.replace.slice(s2, e2)).toBe(`${NEW_1}\n${NEW_2}`)
  })

  it('keeps lines the edit leaves alone at either end out of it', () => {
    const edit: PolicyEdit = {
      file: FILE,
      find: 'Top.\nOld middle.\nBottom.',
      replace: 'Top.\nNew middle.\nBottom.',
    }
    const [s, e] = publicSpan(edit, '')!
    expect(edit.replace.slice(s, e)).toBe('New middle.')
  })

  it('is null for an edit that only takes words out', () => {
    expect(
      publicSpan({ file: FILE, find: 'Keep.\nGo.', replace: 'Keep.' }, '')
    ).toBeNull()
  })
})

describe('publicBoxText', () => {
  it('starts the box with the words as written on the page', () => {
    expect(publicBoxText([added], ADDED)).toBe(ADDED)
  })

  it('is null for a rule that changes the page in several places', () => {
    expect(publicBoxText([added, rewrite], ADDED)).toBeNull()
  })
})

describe('rewritePublic', () => {
  it('puts the new words in place of the shown ones, after the same anchor', () => {
    const next = rewritePublic(
      addedBlock,
      '- A funder with no round for a year is removed.'
    )
    expect(next).toEqual({
      edits: [
        {
          file: FILE,
          find: ANCHOR,
          replace: `${ANCHOR}\n- A funder with no round for a year is removed.`,
        },
      ],
      wording: '- A funder with no round for a year is removed.',
      was: null,
    })
  })

  it('rewrites the whole new text of a rewrite, and keeps what it replaces', () => {
    const next = rewritePublic(
      { edits: [rewrite], wording: `${NEW_1}\n${NEW_2}`, was: OLD },
      `${NEW_1}\n- Two rounds are not enough on their own.`
    )
    expect(next?.edits).toEqual([
      {
        file: FILE,
        find: OLD,
        replace: `${NEW_1}\n- Two rounds are not enough on their own.`,
      },
    ])
    expect(next?.was).toBe(OLD)
  })

  it('tidies what a paste leaves: Windows line ends, end spaces, blank edges', () => {
    const next = rewritePublic(
      addedBlock,
      '\r\n- New words.  \r\n- More.\r\n\n'
    )
    expect(next?.edits).toEqual([
      { file: FILE, find: ANCHOR, replace: `${ANCHOR}\n- New words.\n- More.` },
    ])
    expect(next?.wording).toBe('- New words.\n- More.')
  })

  it('is null when the words are the same as before', () => {
    expect(rewritePublic(addedBlock, ADDED)).toBeNull()
    expect(rewritePublic(addedBlock, `${ADDED}  \n`)).toBeNull()
  })

  it('keeps the other keys of the block', () => {
    const next = rewritePublic({ ...addedBlock, extra: 1 }, '- New.')
    expect(next?.extra).toBe(1)
    expect(next && 'diff' in next).toBe(false)
  })

  it('refuses words the public page cannot take', () => {
    expect(() => rewritePublic(addedBlock, '  \n ')).toThrow(/Keep it internal/)
    expect(() => rewritePublic(addedBlock, '- Use `code`.')).toThrow(/backtick/)
    expect(() => rewritePublic(addedBlock, '- Costs ${x}.')).toThrow(/backtick/)
    expect(() =>
      rewritePublic(addedBlock, '- New.\nLast updated: 1 May 2026')
    ).toThrow(/Last updated/)
    expect(() =>
      rewritePublic(addedBlock, 'x'.repeat(PUBLIC_TEXT_MAX + 1))
    ).toThrow(/longer/)
  })

  it('refuses words that leave the page as it is', () => {
    const edit: PolicyEdit = { file: FILE, find: 'Old.', replace: 'New.' }
    expect(() =>
      rewritePublic({ edits: [edit], wording: 'New.', was: 'Old.' }, 'Old.')
    ).toThrow(/says already/)
  })

  it('refuses a block it cannot edit', () => {
    expect(() =>
      rewritePublic({ ...addedBlock, edits: [added, rewrite] }, '- New.')
    ).toThrow(/more than one place/)
    expect(() => rewritePublic({ wording: ADDED }, '- New.')).toThrow(
      /more than one place/
    )
    expect(() =>
      rewritePublic(
        {
          edits: [{ file: FILE, find: 'Keep.\nGo.', replace: 'Keep.' }],
          wording: '',
        },
        '- New.'
      )
    ).toThrow(/only takes words off/)
  })
})
