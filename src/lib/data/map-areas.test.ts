import { describe, expect, it, vi } from 'vitest'
import { isInactive, mapAreaFor, placingCategory } from './map-areas'

describe('placingCategory', () => {
  it('is the first category for an active org', () => {
    expect(placingCategory('Governance, Advocacy', 'Active')).toBe('Governance')
  })
  it('is "No longer active" for a shut-down org, whatever its categories', () => {
    expect(placingCategory('Funding, Resource', 'Inactive')).toBe(
      'No longer active'
    )
    expect(placingCategory('No longer active', 'Inactive')).toBe(
      'No longer active'
    )
  })
  it('treats a blank Status as Active', () => {
    expect(isInactive(null)).toBe(false)
    expect(isInactive('')).toBe(false)
    expect(placingCategory('Blog', undefined)).toBe('Blog')
  })
  it('is null for an org with no category', () => {
    expect(placingCategory('', 'Active')).toBeNull()
  })
})

describe('mapAreaFor', () => {
  it('names the region for the first category', () => {
    expect(mapAreaFor('Governance, Advocacy', 'Active')).toBe(
      'Governance Grove'
    )
  })
  it('names the Graveyard for a shut-down org', () => {
    expect(mapAreaFor('Advocacy', 'Inactive')).toBe('Gone Graveyard')
  })
  it('warns and gives null for a category with no region', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(mapAreaFor('Nope', 'Active')).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
