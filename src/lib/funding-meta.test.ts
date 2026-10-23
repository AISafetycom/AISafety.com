import { describe, expect, it } from 'vitest'
import {
  GRANT_LABELS,
  GRANT_TOP,
  applicationLabel,
  grantBars,
  grantOverlaps,
  grantRangeActive,
  grantRangeSummary,
  grantSizeLabel,
  whoCanApplyLabel,
} from './funding-meta'

describe('applicationLabel', () => {
  it('reads "on a rolling basis" for open funders with no deadline', () => {
    expect(applicationLabel('Applications open', null)).toBe(
      'Applications on a rolling basis'
    )
  })

  it('writes the deadline out in full for open funders with one', () => {
    expect(applicationLabel('Applications open', '2026-10-31')).toBe(
      'Applications close 31 October 2026'
    )
  })

  it('shows the other two statuses as they are', () => {
    expect(applicationLabel('Not currently accepting applications', null)).toBe(
      'Not currently accepting applications'
    )
    expect(applicationLabel('Invite only, no applications', null)).toBe(
      'Invite only, no applications'
    )
  })

  it('has nothing to show without a known status', () => {
    expect(applicationLabel('', null)).toBeNull()
    expect(applicationLabel('Maybe later', '2026-10-31')).toBeNull()
  })
})

describe('card lines', () => {
  it('lists who can apply in lowercase, in the order given', () => {
    expect(whoCanApplyLabel(['Universities', 'Non-profits'])).toBe(
      'Who can apply: universities, non-profits'
    )
    expect(whoCanApplyLabel([])).toBeNull()
  })

  it("puts the funder's own wording after the label, or hides the line", () => {
    expect(grantSizeLabel('Up to £1m')).toBe('Grant size: Up to £1m')
    expect(grantSizeLabel('')).toBeNull()
  })
})

describe('grant size slider', () => {
  it('labels every position, ending in "no upper limit"', () => {
    expect(GRANT_LABELS).toHaveLength(GRANT_TOP + 1)
    expect(GRANT_LABELS[0]).toBe('$0')
    expect(GRANT_LABELS[2]).toBe('$10k')
    expect(GRANT_LABELS[GRANT_TOP - 1]).toBe('$1m')
    expect(GRANT_LABELS[GRANT_TOP]).toBe('$1m+')
  })

  it('has eight sections, so eight bars', () => {
    expect(GRANT_TOP).toBe(8)
    expect(grantBars([])).toHaveLength(8)
  })

  it('matches funders whose grants reach into the range', () => {
    const foresight = { grantMinUsd: 30_000, grantMaxUsd: 100_000 }
    expect(grantOverlaps(foresight, 4, GRANT_TOP)).toBe(true) // $50k and up
    expect(grantOverlaps(foresight, 5, GRANT_TOP)).toBe(true) // $100k: its top
    expect(grantOverlaps(foresight, 6, GRANT_TOP)).toBe(false) // $250k and up
    expect(grantOverlaps(foresight, 0, 2)).toBe(false) // up to $10k
    expect(grantOverlaps(foresight, 0, 4)).toBe(true) // up to $50k
  })

  it('treats a missing minimum as $0 and a missing maximum as no limit', () => {
    expect(
      grantOverlaps({ grantMinUsd: null, grantMaxUsd: 20_000 }, 0, 1)
    ).toBe(true)
    expect(
      grantOverlaps({ grantMinUsd: 5_000, grantMaxUsd: null }, 7, GRANT_TOP)
    ).toBe(true)
  })

  it('never matches a funder with no stated size', () => {
    const none = { grantMinUsd: null, grantMaxUsd: null }
    expect(grantOverlaps(none, 0, GRANT_TOP)).toBe(false)
    expect(grantBars([none]).every(count => count === 0)).toBe(true)
  })

  it('counts, for each stretch of the range, the funders reaching into it', () => {
    const bars = grantBars([
      { grantMinUsd: 30_000, grantMaxUsd: 100_000 },
      { grantMinUsd: 0, grantMaxUsd: 1_000_000 },
      { grantMinUsd: null, grantMaxUsd: null },
    ])
    expect(bars).toEqual([1, 1, 1, 2, 2, 2, 1, 1])
  })

  it('knows when the slider has been narrowed and says so in words', () => {
    expect(grantRangeActive(0, GRANT_TOP)).toBe(false)
    expect(grantRangeActive(1, GRANT_TOP)).toBe(true)
    expect(grantRangeActive(0, GRANT_TOP - 1)).toBe(true)
    expect(grantRangeSummary(0, GRANT_TOP)).toBe('')
    expect(grantRangeSummary(0, 5)).toBe('up to $100k')
    expect(grantRangeSummary(1, 5)).toBe('$5k – $100k')
    expect(grantRangeSummary(3, GRANT_TOP)).toBe('$25k+')
  })
})
