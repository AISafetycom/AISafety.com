import { describe, expect, it } from 'vitest'

import { listingPageLabel, listingSiteUrl, listingState } from './queue-listing'

const RECURRING = 'tblEEIbj6dW5oS4cX'
const DATED = 'tbli1YSCpIuNY2DvL'

describe('listingState', () => {
  it('reads the two boxes, Hide? first', () => {
    expect(listingState({ 'Publish?': true })).toBe('published')
    expect(listingState({})).toBe('unpublished')
    expect(listingState({ 'Publish?': false })).toBe('unpublished')
    expect(listingState({ 'Hide?': true })).toBe('hidden')
    expect(listingState({ 'Publish?': true, 'Hide?': true })).toBe('hidden')
  })

  it('counts only a real tick', () => {
    expect(listingState({ 'Publish?': 'true' })).toBe('unpublished')
    expect(listingState({ 'Hide?': 1 })).toBe('unpublished')
  })
})

describe('listingPageLabel', () => {
  it('names the recurring view', () => {
    expect(listingPageLabel({ table: DATED, page: '/training' })).toBe(
      '/training'
    )
    expect(listingPageLabel({ table: RECURRING, page: '/training' })).toBe(
      '/training (recurring)'
    )
  })
})

describe('listingSiteUrl', () => {
  const at = (table: string, state: 'published' | 'unpublished' | 'hidden') =>
    listingSiteUrl({
      table,
      record: 'recLfD9z9MnrA9987',
      page: '/training',
      state,
    })

  it("lands on a published listing's card", () => {
    expect(at(DATED, 'published')).toBe(
      'https://aisafety.com/training#recLfD9z9MnrA9987'
    )
    expect(at(RECURRING, 'published')).toBe(
      'https://aisafety.com/training?view=recurring#recLfD9z9MnrA9987'
    )
  })

  it('has no live card for a listing the site does not show', () => {
    expect(at(DATED, 'unpublished')).toBeNull()
    expect(at(DATED, 'hidden')).toBeNull()
  })
})
